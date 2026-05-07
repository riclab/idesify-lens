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
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const chatId = body.sessionId?.trim();
  const text = body.text?.trim();
  if (!chatId || !text) {
    return NextResponse.json(
      { error: "sessionId y texto son obligatorios" },
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
    return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });
  }

  const isFirstMessage =
    row.title === "New chat" || row.title === "Nueva auditoría";
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

  try {
    await messageHook.resume(`msg:${chatId}`, { text });
  } catch (e) {
    // Hook can disappear if the workflow run was garbage-collected (e.g. dev
    // server restart). The chat is effectively dead — surface a 410 so the UI
    // can show a useful message rather than a generic 500.
    const err = e as { name?: string; message?: string };
    const isMissing =
      err?.name === "HookNotFoundError" ||
      err?.name === "WorkflowRunNotFoundError" ||
      err?.name === "RunExpiredError" ||
      (typeof err?.message === "string" &&
        /(hook|run).*not found|expired/i.test(err.message));
    if (isMissing) {
      // Clear the stale run pointer so future loads don't re-attempt the SSE.
      await db
        .update(managedAgentSession)
        .set({ workflowRunId: null })
        .where(
          and(
            eq(managedAgentSession.id, chatId),
            eq(managedAgentSession.sessionId, authz.sessionId),
          ),
        );
      return NextResponse.json(
        { error: "Esta sesión de auditoría expiró. Inicia una nueva." },
        { status: 410 },
      );
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
