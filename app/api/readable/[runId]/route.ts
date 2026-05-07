import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { getRun } from "workflow/api";
import { requireSessionIdFromQuery } from "@/lib/session";
import { db } from "@/lib/db";
import { managedAgentSession } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ runId: string }>;
};

function isRunNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; code?: string };
  if (e.name === "WorkflowRunNotFoundError") return true;
  if (e.name === "RunExpiredError") return true;
  if (e.code === "WORKFLOW_RUN_NOT_FOUND") return true;
  if (typeof e.message === "string" && /run.*not found/i.test(e.message)) {
    return true;
  }
  return false;
}

async function clearStaleRunId(runId: string): Promise<void> {
  try {
    await db
      .update(managedAgentSession)
      .set({ workflowRunId: null })
      .where(eq(managedAgentSession.workflowRunId, runId));
  } catch (e) {
    console.error(`[readable] failed to clear stale workflowRunId=${runId}:`, e);
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authz = requireSessionIdFromQuery(
    request.nextUrl.searchParams.get("sessionId"),
  );
  if ("error" in authz) return authz.error;

  const { runId } = await params;

  const [row] = await db
    .select({ id: managedAgentSession.id })
    .from(managedAgentSession)
    .where(
      and(
        eq(managedAgentSession.workflowRunId, runId),
        eq(managedAgentSession.sessionId, authz.sessionId),
      ),
    )
    .limit(1);

  if (!row) {
    return Response.json({ error: "No encontrado" }, { status: 404 });
  }

  // Pre-flight: the workflow library returns a Run handle even for dead runIds
  // and the failure surfaces asynchronously from internal pollers (causing
  // unhandledRejection). `Run.exists` is the supported way to check.
  let readable: ReadableStream<unknown>;
  try {
    const run = getRun(runId);
    const alive = await run.exists.catch((e) => {
      if (isRunNotFound(e)) return false;
      throw e;
    });
    if (!alive) {
      await clearStaleRunId(runId);
      return Response.json({ error: "Ejecución expirada" }, { status: 410 });
    }
    readable = run.getReadable() as unknown as ReadableStream<unknown>;
  } catch (e) {
    if (isRunNotFound(e)) {
      await clearStaleRunId(runId);
      return Response.json({ error: "Ejecución expirada" }, { status: 410 });
    }
    console.error(`[readable] getReadable failed for runId=${runId}:`, e);
    return Response.json({ error: "Ejecución no disponible" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const abortSignal = request.signal;

  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = readable.getReader();
      try {
        while (!abortSignal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          const data =
            typeof value === "string" ? value : JSON.stringify(value);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
      } catch (e) {
        if (abortSignal.aborted) return;
        if (isRunNotFound(e)) {
          await clearStaleRunId(runId);
        } else {
          console.error(`[readable] stream error for runId=${runId}:`, e);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // already released
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel(reason) {
      console.log(`[readable] client cancelled stream for runId=${runId}:`, reason);
    },
  });

  return new Response(sseStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
