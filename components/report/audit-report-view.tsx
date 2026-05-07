"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, Loader2, PanelLeft, Share2 } from "lucide-react";
import { apiFetch } from "@/lib/anonymous-session";
import { useSidebar } from "@/lib/sidebar-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  countBySeverity,
  SEVERITY_ORDER,
  type Finding,
  type FindingSeverity,
  type PipelineStep,
} from "@/lib/audit-report-types";

type ReportPayload = {
  status: "ready";
  chat: { id: string; title: string; jurisdiction: string };
  report: {
    policyUrl: string | null;
    policyLabel: string;
    jurisdiction: string;
    complianceScore: number;
    riskLevel: "low" | "medium" | "high";
    findings: Finding[];
    pipeline: PipelineStep[];
    createdAt: string;
  };
};

type Filter = "all" | FindingSeverity;

const SEV_LABEL: Record<FindingSeverity, string> = {
  critical: "Crítico",
  warning: "Advertencias",
  info: "Info",
  passing: "Cumple",
};

const SEV_LETTER: Record<FindingSeverity, string> = {
  critical: "C",
  warning: "W",
  info: "I",
  passing: "✓",
};

const SEV_CLASS: Record<FindingSeverity, string> = {
  critical: "crit",
  warning: "warn",
  info: "info",
  passing: "ok",
};

const SEV_COLOR: Record<FindingSeverity, string> = {
  critical: "var(--red)",
  warning: "var(--amber)",
  info: "var(--muted-foreground)",
  passing: "var(--green)",
};

const JURISDICTION_LABEL: Record<string, string> = {
  cl: "🇨🇱 Ley 21.719",
  eu: "🇪🇺 GDPR",
  "us-ca": "🇺🇸 CCPA",
};

function totalDurationMs(steps: PipelineStep[]): number {
  return steps.reduce((acc, s) => acc + s.durationMs, 0);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function riskLabel(risk: "low" | "medium" | "high"): string {
  return risk === "low"
    ? "riesgo bajo"
    : risk === "medium"
      ? "riesgo medio"
      : "riesgo alto";
}

function reportVersion(createdAt: string): string {
  // v.YYYY.MM.DD
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "v.—";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `v.${yyyy}.${mm}.${dd}`;
}

const REGENERATE_PROMPT =
  "Por favor, llama AHORA a la herramienta `submit_findings` con el reporte estructurado de la auditoría que acabas de producir. Es obligatorio para que aparezca en la pestaña Reporte. Incluye TODOS los hallazgos (críticos, warnings, info y passing). No respondas con texto adicional, sólo invoca la herramienta.";

export function AuditReportView({ sessionId }: { sessionId: string }) {
  const sidebar = useSidebar();
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerateNotice, setRegenerateNotice] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch(
          `/api/managed-agents/report?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (res.status === 404) {
          if (!cancelled) {
            setError("El reporte aún no está listo. Espera a que termine la auditoría.");
            setLoading(false);
          }
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? "No se pudo cargar",
          );
        }
        const json = (await res.json()) as ReportPayload;
        if (cancelled) return;
        setData(json);
        setSelectedId(json.report.findings[0]?.id ?? null);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "No se pudo cargar el reporte");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [sessionId]);

  async function handleRegenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setRegenerateError(null);
    setRegenerateNotice(null);
    try {
      const res = await apiFetch("/api/managed-agents/message", {
        method: "POST",
        body: JSON.stringify({ sessionId, text: REGENERATE_PROMPT }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo avisar al agente");
      }
      setRegenerateNotice(
        "Se le pidió al agente llamar a submit_findings. Buscando el reporte…",
      );

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      const startedAt = Date.now();
      pollTimerRef.current = setInterval(async () => {
        try {
          const probe = await apiFetch(
            `/api/managed-agents/report?sessionId=${encodeURIComponent(sessionId)}`,
            { method: "HEAD" },
          );
          if (probe.ok) {
            window.location.reload();
            return;
          }
        } catch {
          /* keep polling */
        }
        if (Date.now() - startedAt > 90_000) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setRegenerating(false);
          setRegenerateError(
            "Aún no hay reporte después de 90s. Abre el chat para ver la respuesta del agente o posibles errores de herramientas.",
          );
        }
      }, 3_000);
    } catch (e) {
      setRegenerating(false);
      setRegenerateError(
          e instanceof Error ? e.message : "No se pudo avisar al agente",
      );
    }
  }

  const findings = useMemo(() => data?.report.findings ?? [], [data]);
  const counts = useMemo(() => countBySeverity(findings), [findings]);
  const filtered = useMemo(
    () => (filter === "all" ? findings : findings.filter((f) => f.severity === filter)),
    [findings, filter],
  );

  const selected = findings.find((f) => f.id === selectedId) ?? null;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="px-6 pt-5 pb-4 md:px-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="lens-crumbs">
              {!sidebar.open && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-ml-2 hidden shrink-0 cursor-pointer md:flex"
                  onClick={sidebar.toggle}
                  aria-label="Abrir barra lateral"
                >
                  <PanelLeft className="size-4" />
                </Button>
              )}
              <Link href="/">Lens</Link>
              <span className="sep">/</span>
              <Link href={`/chat/${sessionId}`}>Auditorías</Link>
              <span className="sep">/</span>
              <span style={{ color: "var(--ink-2)" }}>
                {loading ? "…" : data?.report.policyLabel ?? "Reporte"}
              </span>
            </div>

            {loading ? (
              <div
                className="mt-2 h-12 w-3/4 animate-pulse rounded"
                style={{ background: "var(--secondary)" }}
              />
            ) : data ? (
              <h1 className="lens-title mt-1 truncate">
                {data.report.policyLabel}
              </h1>
            ) : (
              <h1 className="lens-title mt-1">Reporte no disponible</h1>
            )}

            {data && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="lens-meta-pill">
                  {JURISDICTION_LABEL[data.report.jurisdiction] ??
                    data.report.jurisdiction}
                </span>
                <span className="lens-meta-pill">
                  <span
                    className="dot"
                    style={{ background: "var(--green)" }}
                  />
                  Completado · {formatDuration(totalDurationMs(data.report.pipeline))}
                </span>
                <span className="lens-cite">
                  {reportVersion(data.report.createdAt)}
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/chat/${sessionId}`}
              className="lens-btn-ghost cursor-pointer"
            >
              Transcripción
            </Link>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="lens-btn-ghost cursor-pointer"
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copiado" : "Copiar enlace"}
            </button>
            <button
              type="button"
              className="lens-btn-ghost cursor-pointer"
              disabled
              title="Próximamente"
            >
              <Share2 className="size-3.5" /> Compartir
            </button>
            <button
              type="button"
              className="lens-audit-btn cursor-pointer"
              style={{ padding: "10px 16px", fontSize: 13.5 }}
              disabled
              title="Próximamente"
            >
              <Download className="size-3.5" /> Exportar PDF
            </button>
          </div>
        </div>
      </div>

      <div
        className="flex-1 px-6 pb-12 md:px-10"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="mx-auto w-full max-w-[1200px] py-6">
          {loading && <ReportSkeleton />}

          {!loading && error && (
            <div
              className="lens-panel px-5 py-4"
              style={{
                borderColor: "var(--amber)",
                background: "hsl(39 71% 41% / 0.06)",
              }}
            >
              <p
                className="text-[12.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--amber)" }}
              >
                Reporte no listo
              </p>
              <p
                className="mt-1 text-[14px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {error}
              </p>
              <p
                className="mt-3 text-[13px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Si el agente ya produjo una auditoría pero no la guardó,
                pídele que llame a <code>submit_findings</code>:
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleRegenerate()}
                  disabled={regenerating}
                  className="lens-audit-btn cursor-pointer disabled:cursor-wait disabled:opacity-60"
                  style={{ padding: "8px 14px", fontSize: 13 }}
                >
                  {regenerating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {regenerating
                    ? "Avisando al agente…"
                    : "Generar el reporte ahora"}
                </button>
                <Link
                  href={`/chat/${sessionId}`}
                  className="lens-btn-ghost cursor-pointer"
                >
                  Volver a la transcripción
                </Link>
              </div>
              {regenerateNotice && (
                <p
                  className="mt-3 text-[12.5px]"
                  style={{ color: "var(--ink-2)" }}
                >
                  {regenerateNotice}
                </p>
              )}
              {regenerateError && (
                <p
                  className="mt-3 text-[12.5px]"
                  style={{ color: "var(--red)" }}
                >
                  {regenerateError}
                </p>
              )}
            </div>
          )}

          {!loading && !error && data && (
            <>
              <ScoreSummary
                score={data.report.complianceScore}
                risk={data.report.riskLevel}
                counts={counts}
              />

              <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_340px]">
                <FindingsList
                  filter={filter}
                  onFilterChange={setFilter}
                  total={findings.length}
                  filteredCount={filtered.length}
                  counts={counts}
                  findings={filtered}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
                <div className="flex flex-col gap-4">
                  <AuditPipeline steps={data.report.pipeline} />
                  {selected && <FindingDetail finding={selected} />}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Score summary ---------- */

function ScoreSummary({
  score,
  risk,
  counts,
}: {
  score: number;
  risk: "low" | "medium" | "high";
  counts: Record<FindingSeverity, number>;
}) {
  return (
    <div className="lens-panel">
      <div className="grid gap-6 px-7 py-6 md:grid-cols-[260px_1fr]">
        <div>
          <div className="flex items-baseline gap-1">
            <span
              style={{
                fontFamily: "var(--font-serif), serif",
                fontSize: 64,
                fontWeight: 300,
                lineHeight: 1,
                letterSpacing: "-0.02em",
                color: "var(--foreground)",
              }}
            >
              {score}
            </span>
            <span
              style={{
                fontFamily: "var(--font-serif), serif",
                fontSize: 22,
                color: "var(--muted-foreground)",
              }}
            >
              /100
            </span>
          </div>
          <p
            className="mt-2 text-[12.5px] uppercase tracking-[0.08em]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Puntaje de cumplimiento · {riskLabel(risk)}
          </p>
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          {SEVERITY_ORDER.map((sev) => (
            <div key={sev}>
              <div
                style={{
                  fontFamily: "var(--font-serif), serif",
                  fontSize: 36,
                  fontWeight: 300,
                  lineHeight: 1,
                  color: SEV_COLOR[sev],
                }}
              >
                {counts[sev]}
              </div>
              <p
                className="mt-2 text-[12.5px] uppercase tracking-[0.08em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {SEV_LABEL[sev]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Findings list ---------- */

function FindingsList({
  filter,
  onFilterChange,
  total,
  filteredCount,
  counts,
  findings,
  selectedId,
  onSelect,
}: {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  total: number;
  filteredCount: number;
  counts: Record<FindingSeverity, number>;
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const tabs: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "Todos", count: total },
    { key: "critical", label: "Críticos", count: counts.critical },
    { key: "warning", label: "Advertencias", count: counts.warning },
    { key: "info", label: "Info", count: counts.info },
    { key: "passing", label: "Cumple", count: counts.passing },
  ];

  return (
    <div className="lens-panel">
      <div className="lens-panel-head">
        <div className="ttl">
          Hallazgos ·{" "}
          <span style={{ color: "var(--muted-foreground)" }}>
            {filteredCount}/{total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onFilterChange(t.key)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-[12.5px] transition-colors",
                filter === t.key
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              style={
                filter === t.key
                  ? {
                      background: "var(--secondary)",
                      color: "var(--ink-2)",
                    }
                  : undefined
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {findings.length === 0 ? (
          <div
            className="px-6 py-10 text-center text-sm"
            style={{ color: "var(--muted-foreground)" }}
          >
            No hay hallazgos en esta categoría.
          </div>
        ) : (
          findings.map((f, i) => (
            <FindingRow
              key={f.id}
              finding={f}
              selected={selectedId === f.id}
              onSelect={() => onSelect(f.id)}
              hasDivider={i > 0}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  selected,
  onSelect,
  hasDivider,
}: {
  finding: Finding;
  selected: boolean;
  onSelect: () => void;
  hasDivider: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "block w-full cursor-pointer px-6 py-4 text-left transition-colors",
        hasDivider && "border-t",
      )}
      style={{
        borderColor: "var(--border)",
        background: selected ? "var(--secondary)" : "transparent",
      }}
    >
      <div className="flex gap-4">
        <span className={cn("lens-sev mt-0.5", SEV_CLASS[finding.severity])}>
          {SEV_LETTER[finding.severity]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div
              className="text-[15px] font-medium"
              style={{ color: "var(--foreground)" }}
            >
              {finding.title}
            </div>
            <div
              className="shrink-0 text-[12px] uppercase tracking-[0.06em]"
              style={{ color: "var(--muted-foreground)" }}
            >
              {finding.category}
            </div>
          </div>
          <p
            className="mt-1 text-[13.5px]"
            style={{ color: "var(--muted-foreground)", lineHeight: 1.55 }}
          >
            {finding.description}
          </p>
          {(finding.article_ref || finding.law_label) && (
            <div className="mt-2.5">
              <span className="lens-cite">
                {[finding.article_ref, finding.law_label]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/* ---------- Finding detail ---------- */

function FindingDetail({ finding }: { finding: Finding }) {
  return (
    <div className="lens-panel">
      <div className="lens-panel-head">
        <div className="ttl">{finding.id} · Detalle</div>
        <span style={{ color: "var(--muted-foreground)" }}>
          {finding.category}
        </span>
      </div>
      <div className="px-6 py-5">
        {finding.article_quote && (
          <div className="mb-5">
            <p
              className="mb-2 text-[11.5px] uppercase tracking-[0.08em]"
              style={{ color: "var(--muted-foreground)" }}
            >
              El artículo
            </p>
            <blockquote className="lens-quote">{finding.article_quote}</blockquote>
          </div>
        )}

        {finding.why_it_matters && (
          <div className="mb-5">
            <p
              className="mb-2 text-[11.5px] uppercase tracking-[0.08em]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Por qué importa
            </p>
            <p
              className="text-[14px]"
              style={{ color: "var(--foreground)", lineHeight: 1.55 }}
            >
              {finding.why_it_matters}
            </p>
          </div>
        )}

        {finding.suggested_rewrite && (
          <div>
            <p
              className="mb-2 text-[11.5px] uppercase tracking-[0.08em]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Redacción sugerida
            </p>
            <div className="lens-diff space-y-2">
              {finding.suggested_rewrite.before && (
                <div>
                  <span className="del">
                    − {finding.suggested_rewrite.before}
                  </span>
                </div>
              )}
              {finding.suggested_rewrite.after && (
                <div>
                  <span className="ins">
                    + {finding.suggested_rewrite.after}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {!finding.article_quote &&
          !finding.why_it_matters &&
          !finding.suggested_rewrite && (
            <p
              className="text-[14px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              {finding.description}
            </p>
          )}
      </div>
    </div>
  );
}

/* ---------- Audit pipeline ---------- */

function AuditPipeline({ steps }: { steps: PipelineStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="lens-panel">
        <div className="lens-panel-head">
          <div
            className="text-[11.5px] uppercase tracking-[0.08em]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Flujo de auditoría
          </div>
        </div>
        <div
          className="px-6 py-5 text-[13px]"
          style={{ color: "var(--muted-foreground)" }}
        >
          No hay llamadas a herramientas registradas.
        </div>
      </div>
    );
  }
  return (
    <div className="lens-panel">
      <div className="lens-panel-head">
        <div
          className="text-[11.5px] uppercase tracking-[0.08em]"
          style={{ color: "var(--muted-foreground)" }}
        >
          Flujo de auditoría
        </div>
      </div>
      <div className="space-y-1 px-4 py-4">
        {steps.map((step, i) => (
          <div key={i} className="lens-step done">
            <span className="ic">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            <span className="t truncate">{step.label}</span>
            <span className="ms">{formatDuration(step.durationMs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Skeleton ---------- */

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div
        className="h-32 animate-pulse rounded-[18px]"
        style={{ background: "var(--secondary)" }}
      />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_340px]">
        <div
          className="h-96 animate-pulse rounded-[18px]"
          style={{ background: "var(--secondary)" }}
        />
        <div
          className="h-96 animate-pulse rounded-[18px]"
          style={{ background: "var(--secondary)" }}
        />
      </div>
    </div>
  );
}
