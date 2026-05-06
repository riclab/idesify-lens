import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { managedAgentSession } from "@/lib/schema";
import { createManagedAgentSession } from "@/lib/managed-agents";
import { DEFAULT_JURISDICTION, isJurisdiction } from "@/lib/laws";
import { requireSessionId } from "@/lib/session";
import { sessionWorkflow } from "@/app/workflows/tail-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authz = await requireSessionId();
  if ("error" in authz) return authz.error;

  let body: { text?: string; jurisdiction?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const jurisdiction = isJurisdiction(body.jurisdiction)
    ? body.jurisdiction
    : DEFAULT_JURISDICTION;

  const id = crypto.randomUUID();
  const title = text.length > 60 ? `${text.slice(0, 57)}...` : text;

  let anthropic;
  try {
    anthropic = await createManagedAgentSession(jurisdiction);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const run = await start(sessionWorkflow, [
    {
      internalSessionId: id,
      anthropicSessionId: anthropic.anthropicSessionId,
      initialMessage: text,
      jurisdiction,
      sessionId: authz.sessionId,
    },
  ]);

  await db.insert(managedAgentSession).values({
    id,
    sessionId: authz.sessionId,
    anthropicSessionId: anthropic.anthropicSessionId,
    title,
    agentId: anthropic.agentId,
    environmentId: anthropic.environmentId,
    jurisdiction,
    workflowRunId: run.runId,
  });

  return NextResponse.json({ id, runId: run.runId });
}

export async function DELETE(request: NextRequest) {
  const authz = await requireSessionId();
  if ("error" in authz) return authz.error;

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const [row] = await db
    .select({ id: managedAgentSession.id })
    .from(managedAgentSession)
    .where(
      and(
        eq(managedAgentSession.id, sessionId),
        eq(managedAgentSession.sessionId, authz.sessionId),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(managedAgentSession)
    .where(eq(managedAgentSession.id, sessionId));

  return NextResponse.json({ ok: true });
}
