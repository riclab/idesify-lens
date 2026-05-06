export type FindingSeverity = "critical" | "warning" | "info" | "passing";

export type FindingRewrite = {
  before: string;
  after: string;
};

export type Finding = {
  id: string;
  severity: FindingSeverity;
  category: string;
  title: string;
  description: string;
  article_ref?: string;
  law_label?: string;
  article_quote?: string;
  why_it_matters?: string;
  suggested_rewrite?: FindingRewrite;
};

export type PipelineStep = {
  toolName: string;
  label: string;
  durationMs: number;
};

export type AuditReport = {
  policyUrl: string | null;
  policyLabel: string;
  jurisdiction: string;
  complianceScore: number;
  riskLevel: "low" | "medium" | "high";
  findings: Finding[];
  createdAt: string;
};

export const SEVERITY_ORDER: FindingSeverity[] = [
  "critical",
  "warning",
  "info",
  "passing",
];

export function countBySeverity(
  findings: Finding[],
): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
    passing: 0,
  };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
