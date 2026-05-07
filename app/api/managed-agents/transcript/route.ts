import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { managedAgentSession } from "@/lib/schema";
import { requireSessionId } from "@/lib/session";
import { getAnthropic } from "@/lib/anthropic";
import {
  toTranscriptEvent,
  type TranscriptEvent,
} from "@/lib/managed-agent-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function fetchAnthropicHistory(
  anthropicSessionId: string,
): Promise<TranscriptEvent[]> {
  const client = getAnthropic();
  const events: TranscriptEvent[] = [];
  for await (const ev of client.beta.sessions.events.list(anthropicSessionId)) {
    const tev = toTranscriptEvent(ev);
    if (tev) events.push(tev);
  }
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return events;
}

export async function GET(request: Request) {
  const authz = await requireSessionId();
  if ("error" in authz) return authz.error;

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("sessionId")?.trim();
  if (!chatId) {
    return NextResponse.json(
      { error: "El parámetro sessionId es obligatorio" },
      { status: 400 },
    );
  }

  const sessions = await db
    .select({
      id: managedAgentSession.id,
      title: managedAgentSession.title,
      workflowRunId: managedAgentSession.workflowRunId,
      anthropicSessionId: managedAgentSession.anthropicSessionId,
    })
    .from(managedAgentSession)
    .where(
      and(
        eq(managedAgentSession.id, chatId),
        eq(managedAgentSession.sessionId, authz.sessionId),
      ),
    )
    .limit(1);

  const sessionRow = sessions[0];
  if (!sessionRow) {
    return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });
  }

  // When the workflow run is still alive, the SSE stream replays full history.
  // When it's gone (cleared to null after GC), backfill from Anthropic so the
  // transcript isn't empty for archived audits.
  let events: TranscriptEvent[] = [];
  if (!sessionRow.workflowRunId) {
    try {
      events = await fetchAnthropicHistory(sessionRow.anthropicSessionId);
    } catch (e) {
      console.error(
        `[transcript] Anthropic events.list failed for session=${sessionRow.anthropicSessionId}:`,
        e,
      );
    }
  }

  return NextResponse.json({
    title: sessionRow.title,
    workflowRunId: sessionRow.workflowRunId,
    events,
  });
}
