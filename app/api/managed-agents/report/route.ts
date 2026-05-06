import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditReport, managedAgentSession } from "@/lib/schema";
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

  const [chat] = await db
    .select({
      id: managedAgentSession.id,
      title: managedAgentSession.title,
      anthropicSessionId: managedAgentSession.anthropicSessionId,
      jurisdiction: managedAgentSession.jurisdiction,
    })
    .from(managedAgentSession)
    .where(
      and(
        eq(managedAgentSession.id, chatId),
        eq(managedAgentSession.sessionId, authz.sessionId),
      ),
    )
    .limit(1);

  if (!chat) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [report] = await db
    .select()
    .from(auditReport)
    .where(eq(auditReport.anthropicSessionId, chat.anthropicSessionId))
    .limit(1);

  if (!report) {
    return NextResponse.json(
      {
        status: "pending",
        chat: { id: chat.id, title: chat.title, jurisdiction: chat.jurisdiction },
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status: "ready",
    chat: { id: chat.id, title: chat.title, jurisdiction: chat.jurisdiction },
    report: {
      policyUrl: report.policyUrl,
      policyLabel: report.policyLabel,
      jurisdiction: report.jurisdiction,
      complianceScore: report.complianceScore,
      riskLevel: report.riskLevel,
      findings: report.findingsJson,
      pipeline: report.pipelineJson ?? [],
      createdAt: report.createdAt.toISOString(),
    },
  });
}

export async function HEAD(request: Request) {
  const authz = await requireSessionId();
  if ("error" in authz) return new Response(null, { status: 401 });

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("sessionId")?.trim();
  if (!chatId) return new Response(null, { status: 400 });

  const [chat] = await db
    .select({ anthropicSessionId: managedAgentSession.anthropicSessionId })
    .from(managedAgentSession)
    .where(
      and(
        eq(managedAgentSession.id, chatId),
        eq(managedAgentSession.sessionId, authz.sessionId),
      ),
    )
    .limit(1);

  if (!chat) return new Response(null, { status: 404 });

  const [exists] = await db
    .select({ id: auditReport.id })
    .from(auditReport)
    .where(eq(auditReport.anthropicSessionId, chat.anthropicSessionId))
    .limit(1);

  return new Response(null, { status: exists ? 200 : 404 });
}
