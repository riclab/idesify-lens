import { defineHook, sleep, getWritable } from "workflow";
import { getAnthropic } from "@/lib/anthropic";
import { anthropicEventId } from "@/lib/managed-agent-events";
import { executeIngestionTool } from "@/lib/ingestion-tools";

const MAX_POLLS_PER_TURN = 200;
const MAX_TOOL_ROUNDS = 10;
const POLL_INTERVAL = "3s";

export type SessionEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export const messageHook = defineHook<{ text: string }>();

async function sendMessage(
  anthropicSessionId: string,
  text: string,
): Promise<void> {
  "use step";
  console.log(`[sendMessage] session=${anthropicSessionId} text=${text.slice(0, 60)}`);

  const client = getAnthropic();
  await client.beta.sessions.events.send(anthropicSessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  });

  console.log(`[sendMessage] DONE`);
}

type PollResult = {
  lastEventId: string | null;
  status: "continue" | "end_turn" | "requires_action";
  toolUseEventIds: string[];
};

async function pollAndStream(input: {
  anthropicSessionId: string;
  lastEventId: string | null;
}): Promise<PollResult> {
  "use step";
  console.log(`[pollAndStream] START session=${input.anthropicSessionId} lastEventId=${input.lastEventId}`);

  const client = getAnthropic();
  const writer = getWritable<SessionEvent>().getWriter();

  let status: PollResult["status"] = "continue";
  let toolUseEventIds: string[] = [];
  let lastId = input.lastEventId;
  let written = 0;

  try {
    const page = await client.beta.sessions.events.list(
      input.anthropicSessionId,
      { limit: 100 },
    );

    console.log(`[pollAndStream] fetched ${page.data.length} events`);

    let seenLast = input.lastEventId === null;
    for (const event of page.data) {
      const aid = anthropicEventId(event);
      if (!aid) continue;

      if (!seenLast) {
        if (aid === input.lastEventId) seenLast = true;
        continue;
      }

      const occurredAt =
        "processed_at" in event &&
        typeof (event as { processed_at?: string | null }).processed_at ===
          "string"
          ? (event as { processed_at: string }).processed_at
          : new Date().toISOString();

      await writer.write({
        id: aid,
        type: event.type,
        payload: event as unknown as Record<string, unknown>,
        occurredAt,
      });

      written++;
      lastId = aid;

      if (event.type === "session.status_idle") {
        const stopReason = (event as { stop_reason?: { type?: string; event_ids?: string[] } }).stop_reason;
        if (stopReason?.type === "requires_action") {
          status = "requires_action";
          toolUseEventIds = stopReason.event_ids ?? [];
        } else {
          status = "end_turn";
        }
        break;
      }

      if (
        event.type === "session.status_terminated" ||
        event.type === "session.deleted"
      ) {
        status = "end_turn";
        break;
      }
    }
  } finally {
    writer.releaseLock();
  }

  console.log(`[pollAndStream] DONE wrote=${written} lastId=${lastId} status=${status} toolEvents=${toolUseEventIds.length}`);
  return { lastEventId: lastId, status, toolUseEventIds };
}

async function runToolsAndReply(input: {
  anthropicSessionId: string;
  toolUseEventIds: string[];
}): Promise<void> {
  "use step";
  console.log(`[runTools] START session=${input.anthropicSessionId} ids=${input.toolUseEventIds.join(",")}`);

  if (input.toolUseEventIds.length === 0) return;

  const client = getAnthropic();

  const page = await client.beta.sessions.events.list(
    input.anthropicSessionId,
    { limit: 100 },
  );

  const idSet = new Set(input.toolUseEventIds);
  const calls: Array<{ id: string; name: string; toolInput: Record<string, unknown> }> = [];

  for (const ev of page.data) {
    if (ev.type !== "agent.custom_tool_use") continue;
    const id = anthropicEventId(ev);
    if (!id || !idSet.has(id)) continue;
    const cast = ev as unknown as {
      id: string;
      name: string;
      input: Record<string, unknown>;
    };
    calls.push({ id: cast.id, name: cast.name, toolInput: cast.input });
  }

  console.log(`[runTools] resolved ${calls.length}/${input.toolUseEventIds.length} tool calls`);

  for (const call of calls) {
    console.log(`[runTools] executing ${call.name} (${call.id})`);
    const result = await executeIngestionTool(call.name, call.toolInput);
    await client.beta.sessions.events.send(input.anthropicSessionId, {
      events: [
        {
          type: "user.custom_tool_result",
          custom_tool_use_id: call.id,
          content: [{ type: "text", text: result.text }],
          is_error: result.isError,
        },
      ],
    });
    console.log(`[runTools] sent result for ${call.id} (isError=${result.isError})`);
  }
}

async function processTurn(
  anthropicSessionId: string,
  text: string,
  lastEventId: string | null,
): Promise<string | null> {
  await sendMessage(anthropicSessionId, text);

  let currentLastEventId = lastEventId;
  let toolRounds = 0;

  for (let i = 0; i < MAX_POLLS_PER_TURN; i++) {
    await sleep(POLL_INTERVAL);

    const result = await pollAndStream({
      anthropicSessionId,
      lastEventId: currentLastEventId,
    });

    currentLastEventId = result.lastEventId;

    if (result.status === "end_turn") {
      console.log(`[sessionWorkflow] turn complete after ${i + 1} polls`);
      break;
    }

    if (result.status === "requires_action") {
      if (toolRounds >= MAX_TOOL_ROUNDS) {
        console.warn(`[sessionWorkflow] hit MAX_TOOL_ROUNDS=${MAX_TOOL_ROUNDS}, ending turn`);
        break;
      }
      toolRounds++;
      await runToolsAndReply({
        anthropicSessionId,
        toolUseEventIds: result.toolUseEventIds,
      });
    }
  }
  return currentLastEventId;
}

export async function sessionWorkflow(input: {
  internalSessionId: string;
  anthropicSessionId: string;
  initialMessage: string;
  jurisdiction?: string;
}) {
  "use workflow";
  console.log(`[sessionWorkflow] START internal=${input.internalSessionId} anthropic=${input.anthropicSessionId} jurisdiction=${input.jurisdiction ?? "cl"}`);

  let lastEventId: string | null = null;

  lastEventId = await processTurn(
    input.anthropicSessionId,
    input.initialMessage,
    lastEventId,
  );

  const hook = messageHook.create({
    token: `msg:${input.internalSessionId}`,
  });

  for await (const { text } of hook) {
    console.log(`[sessionWorkflow] received message: ${text.slice(0, 60)}`);
    lastEventId = await processTurn(
      input.anthropicSessionId,
      text,
      lastEventId,
    );
  }
}
