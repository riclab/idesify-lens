"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, ChevronRight, FileText, Loader2, PanelLeft } from "lucide-react";
import { Streamdown, type Components } from "streamdown";
import { cn } from "@/lib/utils";
import { consumePendingMessage } from "@/lib/pending-message";
import { useSidebar } from "@/lib/sidebar-context";
import { apiFetch, getAnonSessionId } from "@/lib/anonymous-session";
import { Button } from "@/components/ui/button";

type TranscriptEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: string }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("");
}

/* ---------- Markdown (Lens prose) ---------- */

const streamdownComponents: Components = {
  p: ({ children, ...props }) => (
    <p {...props} className="mb-4 last:mb-0">
      {children}
    </p>
  ),
  ol: ({ children, ...props }) => (
    <ol {...props} className="mb-4 list-decimal space-y-1.5 pl-6 last:mb-0">
      {children}
    </ol>
  ),
  ul: ({ children, ...props }) => (
    <ul {...props} className="mb-4 list-disc space-y-1.5 pl-6 last:mb-0">
      {children}
    </ul>
  ),
  li: ({ children, ...props }) => (
    <li {...props} className="pl-1">
      {children}
    </li>
  ),
};

function Markdown({ text }: { text: string }) {
  return (
    <div className="lens-prose">
      <Streamdown components={streamdownComponents} linkSafety={{ enabled: false }}>
        {text}
      </Streamdown>
    </div>
  );
}

/* ---------- Tool categorization ---------- */

function resolveToolName(ev: TranscriptEvent): string {
  const name = typeof ev.payload.name === "string" ? ev.payload.name : "";
  if (name) return name.toLowerCase();
  return ev.type.replace("agent.", "").toLowerCase() || "tool";
}

function toolCategory(name: string): string {
  switch (name) {
    case "read_url":
    case "webfetch":
    case "web_fetch":
      return "fetched";
    case "search_policy_url":
    case "web_search":
    case "search":
      return "searched";
    case "search_dpo_contact":
      return "dpo";
    case "draft_legal_email":
      return "drafted";
    default:
      return "other";
  }
}

function summarizeToolGroup(tools: TranscriptEvent[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const cat = toolCategory(resolveToolName(tool));
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  const order: Array<{
    key: string;
    one: string;
    many: (count: number) => string;
  }> = [
    { key: "fetched", one: "Leyó una URL", many: (n) => `Leyó ${n} URLs` },
    { key: "searched", one: "Buscó una consulta", many: (n) => `Buscó ${n} consultas` },
    { key: "dpo", one: "Buscó contacto DPO", many: (n) => `Buscó ${n} contactos DPO` },
    { key: "drafted", one: "Redactó un borrador", many: (n) => `Redactó ${n} borradores` },
    { key: "other", one: "Ejecutó una acción", many: (n) => `Ejecutó ${n} acciones` },
  ];

  const parts: string[] = [];
  for (const { key, one, many } of order) {
    const n = counts.get(key);
    if (!n) continue;
    parts.push(n === 1 ? one : many(n));
  }

  return parts.join(" · ") || `${tools.length} pasos`;
}

function describeToolAction(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  if (name === "read_url") return typeof obj.url === "string" ? obj.url : "";
  if (name === "search_policy_url" || name === "web_search" || name === "search")
    return typeof obj.query === "string" ? obj.query : "";
  if (name === "search_dpo_contact")
    return typeof obj.company === "string" ? obj.company : "";
  if (name === "draft_legal_email")
    return typeof obj.subject === "string" ? obj.subject : "";
  return "";
}

function ToolCallItem({ ev }: { ev: TranscriptEvent }) {
  const [expanded, setExpanded] = useState(false);
  const rawName = resolveToolName(ev);
  const input = ev.payload.input;
  const label = describeToolAction(rawName, input);
  const hasDetail =
    Boolean(input && typeof input === "object" && Object.keys(input as object).length > 0);

  return (
    <div className="py-0.5">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 py-0.5 text-left text-[13px]",
          hasDetail ? "cursor-pointer" : "cursor-default",
        )}
        style={{ color: "var(--muted-foreground)" }}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <Check
          className="size-3 shrink-0"
          style={{ color: "var(--green)" }}
        />
        <span className="lens-cite shrink-0" style={{ fontSize: 11 }}>
          {rawName}
        </span>
        {label && (
          <span
            className="truncate"
            style={{ color: "var(--ink-2)" }}
          >
            {label}
          </span>
        )}
        {hasDetail && (
          <ChevronRight
            className={cn(
              "ml-auto size-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {expanded && (
        <pre
          className="mt-1 mb-1 ml-5 max-h-48 overflow-auto rounded-[10px] p-3 text-[11px]"
          style={{
            background: "var(--background)",
            border: "1px solid var(--border)",
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        >
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolGroup({ tools }: { tools: TranscriptEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const label = summarizeToolGroup(tools);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex cursor-pointer items-center gap-2 py-1 text-[13px] transition-colors"
        style={{ color: "var(--muted-foreground)" }}
      >
        <span className="lens-cite" style={{ fontSize: 11 }}>
          {tools.length} paso{tools.length === 1 ? "" : "s"}
        </span>
        <span style={{ color: "var(--ink-2)" }}>{label}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-all",
            expanded ? "rotate-90 opacity-100" : "opacity-50",
          )}
        />
      </button>
      {expanded && (
        <div
          className="ml-3 pl-3 pt-1 pb-1"
          style={{ borderLeft: "1px solid var(--border)" }}
        >
          {tools.map((ev) => (
            <ToolCallItem key={ev.id} ev={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Transcript renderer ---------- */

type EventGroup =
  | { kind: "event"; event: TranscriptEvent }
  | { kind: "tools"; events: TranscriptEvent[] };

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="lens-panel max-w-[80%]" style={{ borderRadius: 18 }}>
        <div
          className="px-4 py-3"
          style={{
            fontSize: 15,
            lineHeight: 1.55,
            color: "var(--foreground)",
            whiteSpace: "pre-wrap",
          }}
        >
          {text || "(vacío)"}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div
      className="lens-panel"
      style={{ borderRadius: 18, padding: "18px 20px" }}
    >
      <div
        className="mb-3 flex items-center gap-2 text-[11.5px] uppercase tracking-[0.08em]"
        style={{ color: "var(--muted-foreground)", fontWeight: 500 }}
      >
        <span className="brand-dot" style={{ width: 12, height: 12 }} />
        Idesify - Lens
      </div>
      <Markdown text={text} />
    </div>
  );
}

function TranscriptRenderer({ grouped }: { grouped: EventGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      {grouped.map((group, idx) => {
        if (group.kind === "tools") {
          return <ToolGroup key={`tg-${idx}`} tools={group.events} />;
        }
        const ev = group.event;
        const { type, payload } = ev;

        if (type === "user.message") {
          return <UserMessage key={ev.id} text={textFromContent(payload.content)} />;
        }

        if (type === "agent.message") {
          const msg = textFromContent(payload.content);
          if (!msg) return null;
          return <AssistantMessage key={ev.id} text={msg} />;
        }

        if (type === "user.custom_tool_result") {
          const msg = toolErrorText(ev);
          if (!msg) return null;
          const toolUseId =
            (payload as { custom_tool_use_id?: string }).custom_tool_use_id ?? "";
          return (
            <div
              key={ev.id}
              className="lens-panel px-4 py-3"
              style={{
                borderColor: "var(--red)",
                background: "hsl(0 51% 47% / 0.06)",
              }}
            >
              <p
                className="text-[12.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--red)" }}
              >
                Error de herramienta{toolUseId ? ` · ${toolUseId.slice(0, 12)}` : ""}
              </p>
              <p
                className="mt-1 text-[13px] whitespace-pre-wrap"
                style={{ color: "var(--muted-foreground)" }}
              >
                {msg}
              </p>
            </div>
          );
        }

        if (type === "session.status_idle") {
          return (
            <div
              key={ev.id}
              className="lens-panel px-4 py-3"
              style={{
                borderColor: "var(--amber)",
                background: "hsl(39 71% 41% / 0.06)",
              }}
            >
              <p
                className="text-[12.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--amber)" }}
              >
                Requiere acción
              </p>
              <p
                className="mt-1 text-[13px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Esta auditoría necesita confirmación en la consola de Anthropic.
              </p>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

/* ---------- Skeleton ---------- */

function ChatSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
      <div className="flex justify-end">
        <div
          className="h-10 w-48 animate-pulse rounded-[18px]"
          style={{ background: "var(--secondary)" }}
        />
      </div>
      <div
        className="space-y-2 rounded-[18px] p-5"
        style={{ background: "var(--secondary)", opacity: 0.6 }}
      >
        <div
          className="h-4 w-3/4 animate-pulse rounded"
          style={{ background: "var(--border)" }}
        />
        <div
          className="h-4 w-1/2 animate-pulse rounded"
          style={{ background: "var(--border)" }}
        />
        <div
          className="h-4 w-2/3 animate-pulse rounded"
          style={{ background: "var(--border)" }}
        />
      </div>
    </div>
  );
}

/* ---------- Event grouping ---------- */

const HIDDEN_TYPES = new Set([
  "span.model_request_start",
  "span.model_request_end",
  "agent.tool_result",
  "session.status_terminated",
  "session.status_running",
  "session.deleted",
  "agent.thinking",
]);

function toolErrorText(ev: TranscriptEvent): string | null {
  if (ev.type !== "user.custom_tool_result") return null;
  const payload = ev.payload as { is_error?: boolean; content?: unknown };
  if (!payload.is_error) return null;
  const parts: string[] = [];
  if (Array.isArray(payload.content)) {
    for (const block of payload.content as Array<{ type?: string; text?: string }>) {
      if (block?.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n").trim() || "La herramienta devolvió un error.";
}

const TOOL_TYPES = new Set([
  "agent.tool_use",
  "agent.mcp_tool_use",
  "agent.custom_tool_use",
]);

function hasMoreToolsAhead(events: TranscriptEvent[], fromIndex: number): boolean {
  for (let j = fromIndex; j < events.length; j++) {
    const t = events[j].type;
    if (TOOL_TYPES.has(t)) return true;
    if (t === "user.message") return false;
    if (t === "session.status_idle") return false;
  }
  return false;
}

function groupEvents(events: TranscriptEvent[]) {
  const visible = events.filter((ev) => !HIDDEN_TYPES.has(ev.type));
  const groups: EventGroup[] = [];
  let pendingTools: TranscriptEvent[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    groups.push({ kind: "tools", events: pendingTools });
    pendingTools = [];
  };

  for (let i = 0; i < visible.length; i++) {
    const ev = visible[i];

    if (TOOL_TYPES.has(ev.type)) {
      pendingTools.push(ev);
      continue;
    }

    if (ev.type === "user.message") {
      flushTools();
      groups.push({ kind: "event", event: ev });
      continue;
    }

    if (ev.type === "agent.message") {
      const msg = textFromContent(ev.payload.content);
      if (!msg) continue;
      if (pendingTools.length > 0 && hasMoreToolsAhead(visible, i + 1)) {
        continue;
      }
      flushTools();
      groups.push({ kind: "event", event: ev });
      continue;
    }

    if (ev.type === "session.status_idle") {
      const sr = ev.payload.stop_reason as { type?: string } | undefined;
      if (sr?.type !== "requires_action") continue;
      flushTools();
      groups.push({ kind: "event", event: ev });
      continue;
    }

    if (ev.type === "user.custom_tool_result") {
      if (!toolErrorText(ev)) continue;
      flushTools();
      groups.push({ kind: "event", event: ev });
      continue;
    }

    groups.push({ kind: "event", event: ev });
  }

  flushTools();
  return groups;
}

/* ---------- Main panel ---------- */

export function ChatPanel({ sessionId }: { sessionId: string }) {
  const sidebar = useSidebar();
  const [pending] = useState(() => consumePendingMessage(sessionId));
  const [events, setEvents] = useState<TranscriptEvent[]>(() => {
    if (!pending) return [];
    return [
      {
        id: "optimistic-initial",
        type: "user.message",
        payload: { content: [{ type: "text", text: pending }] },
        occurredAt: new Date().toISOString(),
      },
    ];
  });
  const [tailing, setTailing] = useState(!!pending);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [hasReport, setHasReport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const seenIdsRef = useRef(new Set<string>());
  const runIdRef = useRef<string | null>(null);

  function connectToStream(runId: string) {
    eventSourceRef.current?.close();
    runIdRef.current = runId;

    const anonId = getAnonSessionId();
    const es = new EventSource(
      `/api/readable/${runId}?sessionId=${encodeURIComponent(anonId)}`,
    );
    eventSourceRef.current = es;
    setTailing(true);

    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as TranscriptEvent;
        if (seenIdsRef.current.has(ev.id)) return;
        seenIdsRef.current.add(ev.id);

        setEvents((prev) => {
          if (prev.some((e) => e.id === ev.id)) return prev;

          const withoutOptimistic =
            ev.type === "user.message"
              ? prev.filter((e) => {
                  if (!e.id.startsWith("optimistic-")) return true;
                  return (
                    textFromContent(e.payload.content) !==
                    textFromContent(ev.payload.content)
                  );
                })
              : prev;
          return [...withoutOptimistic, ev];
        });
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      // Browser EventSource fires `error` for both transient blips and terminal
      // closes (e.g. server returned 410 Gone because the workflow run was
      // garbage-collected). After close() readyState is CLOSED — there will be
      // no further reconnects, so it's safe to stop tailing.
      es.close();
      eventSourceRef.current = null;
      runIdRef.current = null;
      setTailing(false);
    };
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const res = await apiFetch(
          `/api/managed-agents/transcript?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? "No se pudo cargar",
          );
        }
        const data = (await res.json()) as {
          title: string | null;
          workflowRunId: string | null;
        };
        if (cancelled) return;

        setTitle(data.title);

        if (data.workflowRunId) {
          connectToStream(data.workflowRunId);
        } else {
          setTailing(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "No se pudo cargar la transcripción",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
    };
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, tailing, sending]);

  // Watch for the agent calling submit_findings, then verify the report row exists.
  // Also do an initial check in case the report was already produced before mount.
  useEffect(() => {
    if (hasReport) return;
    const sawSubmit = events.some(
      (ev) =>
        ev.type === "agent.custom_tool_use" &&
        (ev.payload as { name?: string }).name === "submit_findings",
    );
    if (!sawSubmit && events.length > 0) return;

    let cancelled = false;
    async function check() {
      try {
        const res = await apiFetch(
          `/api/managed-agents/report?sessionId=${encodeURIComponent(sessionId)}`,
          { method: "HEAD" },
        );
        if (!cancelled && res.ok) setHasReport(true);
      } catch {
        /* network blip — try again on next event */
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [events, hasReport, sessionId]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setTailing(true);
    setError(null);

    const optimisticId = `optimistic-${Date.now()}`;
    setEvents((prev) => [
      ...prev,
      {
        id: optimisticId,
        type: "user.message",
        payload: { content: [{ type: "text", text: trimmed }] },
        occurredAt: new Date().toISOString(),
      },
    ]);
    setText("");

    try {
      const res = await apiFetch("/api/managed-agents/message", {
        method: "POST",
        body: JSON.stringify({ sessionId, text: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "No se pudo enviar");
      }

      if (runIdRef.current) {
        connectToStream(runIdRef.current);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar");
      setTailing(false);
      setEvents((prev) => prev.filter((ev) => ev.id !== optimisticId));
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => groupEvents(events), [events]);

  const lastUserIdx = events.findLastIndex((e) => e.type === "user.message");
  const agentDoneAfterLastMsg =
    lastUserIdx >= 0 &&
    events.slice(lastUserIdx + 1).some((ev) => {
      if (
        ev.type === "session.status_terminated" ||
        ev.type === "session.deleted"
      )
        return true;
      if (ev.type === "session.status_idle") {
        const sr = (ev.payload as { stop_reason?: { type?: string } })
          .stop_reason;
        return sr?.type === "end_turn" || sr?.type === "retries_exhausted";
      }
      return false;
    });

  const isActive = (tailing || sending) && !agentDoneAfterLastMsg;
  const showThinking = isActive && lastUserIdx >= 0;

  const displayTitle =
    title && title !== "New chat" && title !== "Nueva auditoría"
      ? title
      : "Nueva auditoría";

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 md:px-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="lens-crumbs">
                {!sidebar.open && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-ml-2 hidden shrink-0 md:flex"
                    onClick={sidebar.toggle}
                    aria-label="Abrir barra lateral"
                  >
                    <PanelLeft className="size-4" />
                  </Button>
                )}
                <Link href="/">Idesify - Lens</Link>
                <span className="sep">/</span>
                <span>Auditorías</span>
                <span className="sep">/</span>
                <span style={{ color: "var(--ink-2)" }}>
                  {loading ? "…" : displayTitle.length > 40 ? `${displayTitle.slice(0, 40)}…` : displayTitle}
                </span>
              </div>
              {loading ? (
                <div
                  className="mt-2 h-12 w-3/4 animate-pulse rounded"
                  style={{ background: "var(--secondary)" }}
                />
              ) : (
                <h1 className="lens-title mt-1 truncate">{displayTitle}</h1>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="lens-meta-pill">
                  <span className="dot" />
                  CL · Ley 21.719
                </span>
                <span className={cn("lens-meta-pill", isActive && "live")}>
                  <span className="dot" />
                  {isActive ? "auditando" : "en espera"}
                </span>
                {hasReport && (
                  <Link
                    href={`/chat/${sessionId}/report`}
                    className="lens-meta-pill cursor-pointer"
                    style={{
                      borderColor: "var(--accent-deep)",
                      color: "var(--accent-deep)",
                    }}
                  >
                    <FileText className="size-3" />
                    Reporte listo →
                  </Link>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span
                className="cursor-default rounded-full px-3 py-1.5 text-[12.5px]"
                style={{
                  background: "var(--secondary)",
                  color: "var(--ink-2)",
                }}
              >
                Transcripción
              </span>
              <Link
                href={`/chat/${sessionId}/report`}
                className="cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] transition-colors hover:bg-secondary"
                style={{ color: hasReport ? "var(--ink-2)" : "var(--muted-foreground)" }}
              >
                Reporte
              </Link>
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-6 md:px-10"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {loading && !pending ? (
            <ChatSkeleton />
          ) : (
            <div className="mx-auto max-w-3xl space-y-3 py-6 pb-44">
              {error && (
                <div
                  className="lens-panel px-4 py-3"
                  style={{
                    borderColor: "var(--red)",
                    background: "hsl(0 51% 47% / 0.06)",
                  }}
                >
                  <p className="text-sm" style={{ color: "var(--red)" }}>
                    {error}
                  </p>
                </div>
              )}
              <TranscriptRenderer grouped={grouped} />
              {showThinking && (
                <div className="pt-2" role="status" aria-live="polite">
                  <span className="live-pill">
                    <span className="live-dot" />
                    <span style={{ color: "var(--ink-2)" }}>Analizando…</span>
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-5 pt-12 md:px-10">
          <div
            className="absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(to top, var(--background) 60%, transparent)",
            }}
            aria-hidden
          />
          <div className="pointer-events-auto mx-auto max-w-3xl">
            <div className="lens-search">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Pregunta algo más…"
                rows={1}
                disabled={sending || isActive}
                className="lens-search-input"
                style={{ height: "auto", overflow: "hidden" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
                  el.style.overflow =
                    el.scrollHeight > 200 ? "auto" : "hidden";
                }}
              />
              <button
                type="button"
                aria-label="Enviar mensaje"
                onClick={() => void handleSend()}
                disabled={sending || !text.trim() || isActive}
                className="lens-audit-btn"
                style={{ padding: "10px 14px" }}
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
