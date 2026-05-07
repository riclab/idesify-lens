import type { PipelineStep } from "./audit-report-types";

const TOOL_LABELS: Record<string, string> = {
  read_url: "Leer política",
  search_policy_url: "Ubicar URL de la política",
  search_dpo_contact: "Buscar contacto DPO",
  draft_legal_email: "Redactar email legal",
  submit_findings: "Compilar reporte",
};

function labelFor(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

type EventLike = {
  id?: string;
  type: string;
  processed_at?: string | null;
  custom_tool_use_id?: string;
  name?: string;
};

/**
 * Pair custom_tool_use events with their custom_tool_result events
 * (matched on custom_tool_use_id) and emit a step per pair.
 */
export function derivePipelineSteps(events: EventLike[]): PipelineStep[] {
  const startsById = new Map<
    string,
    { name: string; processedAt: string }
  >();

  for (const ev of events) {
    if (ev.type !== "agent.custom_tool_use") continue;
    const id = ev.id;
    const name = ev.name;
    const processedAt = ev.processed_at;
    if (!id || !name || !processedAt) continue;
    startsById.set(id, { name, processedAt });
  }

  const steps: Array<PipelineStep & { startMs: number }> = [];

  for (const ev of events) {
    if (ev.type !== "user.custom_tool_result") continue;
    const id = ev.custom_tool_use_id;
    const endAt = ev.processed_at;
    if (!id || !endAt) continue;
    const start = startsById.get(id);
    if (!start) continue;
    const startMs = Date.parse(start.processedAt);
    const endMs = Date.parse(endAt);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    steps.push({
      toolName: start.name,
      label: labelFor(start.name),
      durationMs: Math.max(0, endMs - startMs),
      startMs,
    });
  }

  steps.sort((a, b) => a.startMs - b.startMs);
  return steps.map(({ toolName, label, durationMs }) => ({
    toolName,
    label,
    durationMs,
  }));
}
