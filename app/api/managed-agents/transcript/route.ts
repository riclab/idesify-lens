import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { managedAgentSession } from "@/lib/schema";
import { requireSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authz = await requireSessionId();
  if ("error" in authz) return authz.error;

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("sessionId")?.trim();
  if (!chatId) {
    return NextResponse.json(
      { error: "sessionId query parameter is required" },
      { status: 400 },
    );
  }

  const sessions = await db
    .select({
      id: managedAgentSession.id,
      title: managedAgentSession.title,
      workflowRunId: managedAgentSession.workflowRunId,
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
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    title: sessionRow.title,
    workflowRunId: sessionRow.workflowRunId,
  });
}
