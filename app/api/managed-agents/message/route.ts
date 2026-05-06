import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { managedAgentSession } from "@/lib/schema";
import { requireSessionId } from "@/lib/session";
import { checkMessageRateLimit } from "@/lib/rate-limit";
import { messageHook } from "@/app/workflows/tail-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authz = await requireSessionId();
  if ("error" in authz) return authz.error;

  const rateCheck = checkMessageRateLimit(authz.sessionId);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: rateCheck.reason }, { status: 429 });
  }

  let body: { sessionId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const chatId = body.sessionId?.trim();
  const text = body.text?.trim();
  if (!chatId || !text) {
    return NextResponse.json(
      { error: "sessionId and text are required" },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(managedAgentSession)
    .where(
      and(
        eq(managedAgentSession.id, chatId),
        eq(managedAgentSession.sessionId, authz.sessionId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const isFirstMessage = row.title === "New chat";
  const titleUpdate = isFirstMessage
    ? { title: text.length > 60 ? `${text.slice(0, 57)}...` : text }
    : {};

  await db
    .update(managedAgentSession)
    .set({
      updatedAt: new Date(),
      ...titleUpdate,
    })
    .where(
      and(
        eq(managedAgentSession.id, chatId),
        eq(managedAgentSession.sessionId, authz.sessionId),
      ),
    );

  await messageHook.resume(`msg:${chatId}`, { text });

  return NextResponse.json({ ok: true });
}
