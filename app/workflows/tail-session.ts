import { defineHook, getWritable } from "workflow";
import { getAnthropic } from "@/lib/anthropic";
import { anthropicEventId } from "@/lib/managed-agent-events";
import { executeTool, type ToolContext } from "@/lib/tool-handlers";
import type { BetaManagedAgentsSessionEvent } from "@anthropic-ai/sdk/resources/beta/sessions/events";

const MAX_TOOL_ROUNDS = 10;

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

type StreamResult = {
  lastEventId: string | null;
  status: "end_turn" | "requires_action";
  toolUseEventIds: string[];
};

function eventOccurredAt(event: BetaManagedAgentsSessionEvent): string {
  if (
    "processed_at" in event &&
    typeof (event as { processed_at?: string | null }).processed_at === "string"
  ) {
    return (event as { processed_at: string }).processed_at;
  }
  return new Date().toISOString();
}

function classifyTerminal(
  event: BetaManagedAgentsSessionEvent,
): { status: "end_turn" | "requires_action"; toolUseEventIds: string[] } | null {
  if (event.type === "session.status_idle") {
    const stopReason = (
      event as { stop_reason?: { type?: string; event_ids?: string[] } }
    ).stop_reason;
    if (stopReason?.type === "requires_action") {
      return {
        status: "requires_action",
        toolUseEventIds: stopReason.event_ids ?? [],
      };
    }
    return { status: "end_turn", toolUseEventIds: [] };
  }
  if (
    event.type === "session.status_terminated" ||
    event.type === "session.deleted"
  ) {
    return { status: "end_turn", toolUseEventIds: [] };
  }
  return null;
}

async function streamUntilTerminal(input: {
  anthropicSessionId: string;
  lastEventId: string | null;
}): Promise<StreamResult> {
  "use step";
  console.log(
    `[streamUntilTerminal] START session=${input.anthropicSessionId} lastEventId=${input.lastEventId}`,
  );

  const client = getAnthropic();
  const writer = getWritable<SessionEvent>().getWriter();

  const seen = new Set<string>();
  if (input.lastEventId) seen.add(input.lastEventId);

  let result: StreamResult = {
    lastEventId: input.lastEventId,
    status: "end_turn",
    toolUseEventIds: [],
  };
  let written = 0;

  // Open the live stream first so we don't miss anything emitted while we
  // backfill via events.list.
  const stream = await client.beta.sessions.events.stream(
    input.anthropicSessionId,
  );

  const writeEvent = async (event: BetaManagedAgentsSessionEvent) => {
    const aid = anthropicEventId(event);
    if (!aid || seen.has(aid)) return null;
    seen.add(aid);

    await writer.write({
      id: aid,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
      occurredAt: eventOccurredAt(event),
    });
    written++;
    result = { ...result, lastEventId: aid };
    return classifyTerminal(event);
  };

  try {
    // Backfill: any events emitted between sendMessage and stream connection.
    // events.list returns ascending; we iterate forward and pick up everything
    // newer than lastEventId.
    const page = await client.beta.sessions.events.list(
      input.anthropicSessionId,
      { limit: 100 },
    );

    let seenLast = input.lastEventId === null;
    for (const event of page.data) {
      const aid = anthropicEventId(event);
      if (!aid) continue;
      if (!seenLast) {
        if (aid === input.lastEventId) seenLast = true;
        continue;
      }
      const terminal = await writeEvent(event);
      if (terminal) {
        result = { ...result, ...terminal };
        console.log(
          `[streamUntilTerminal] terminal in backfill wrote=${written} status=${terminal.status}`,
        );
        return result;
      }
    }

    // Live tail
    for await (const event of stream) {
      const terminal = await writeEvent(event);
      if (terminal) {
        result = { ...result, ...terminal };
        break;
      }
    }
  } finally {
    try {
      stream.controller.abort();
    } catch {
      // already aborted
    }
    writer.releaseLock();
  }

  console.log(
    `[streamUntilTerminal] DONE wrote=${written} lastId=${result.lastEventId} status=${result.status} toolEvents=${result.toolUseEventIds.length}`,
  );
  return result;
}

async function runToolsAndReply(input: {
  anthropicSessionId: string;
  toolUseEventIds: string[];
  ctx: ToolContext;
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
    const result = await executeTool(call.name, call.toolInput, input.ctx);
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
  ctx: ToolContext,
): Promise<string | null> {
  await sendMessage(anthropicSessionId, text);

  let currentLastEventId = lastEventId;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await streamUntilTerminal({
      anthropicSessionId,
      lastEventId: currentLastEventId,
    });
    currentLastEventId = result.lastEventId;

    if (result.status === "end_turn") {
      console.log(`[sessionWorkflow] turn complete after ${round} tool rounds`);
      break;
    }

    if (round === MAX_TOOL_ROUNDS) {
      console.warn(`[sessionWorkflow] hit MAX_TOOL_ROUNDS=${MAX_TOOL_ROUNDS}, ending turn`);
      break;
    }

    await runToolsAndReply({
      anthropicSessionId,
      toolUseEventIds: result.toolUseEventIds,
      ctx,
    });
  }
  return currentLastEventId;
}

export async function sessionWorkflow(input: {
  internalSessionId: string;
  anthropicSessionId: string;
  initialMessage: string;
  jurisdiction?: string;
  sessionId?: string;
}) {
  "use workflow";
  console.log(`[sessionWorkflow] START internal=${input.internalSessionId} anthropic=${input.anthropicSessionId} jurisdiction=${input.jurisdiction ?? "cl"}`);

  const ctx: ToolContext = {
    anthropicSessionId: input.anthropicSessionId,
    sessionId: input.sessionId ?? "",
    jurisdiction: input.jurisdiction ?? "cl",
  };

  let lastEventId: string | null = null;

  lastEventId = await processTurn(
    input.anthropicSessionId,
    input.initialMessage,
    lastEventId,
    ctx,
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
      ctx,
    );
  }
}
