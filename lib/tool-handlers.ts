import { db } from "./db";
import { auditReport } from "./schema";
import { getAnthropic } from "./anthropic";
import { derivePipelineSteps } from "./audit-pipeline";
import type {
  Finding,
  FindingRewrite,
  FindingSeverity,
  PipelineStep,
} from "./audit-report-types";

export type ToolResult = {
  text: string;
  isError: boolean;
};

export type ToolContext = {
  anthropicSessionId: string;
  sessionId: string;
  jurisdiction: string;
};

type SearchHit = {
  title?: string;
  url?: string;
  content?: string;
};

async function tavilySearch(query: string, maxResults = 5): Promise<ToolResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { text: "TAVILY_API_KEY is not configured on the server", isError: true };
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: "basic",
      include_answer: false,
    }),
  });

  if (!res.ok) {
    return { text: `Tavily request failed: ${res.status} ${res.statusText}`, isError: true };
  }

  const data = (await res.json()) as { results?: SearchHit[] };
  const hits = (data.results ?? []).slice(0, maxResults);
  if (hits.length === 0) {
    return { text: `No results found for "${query}"`, isError: false };
  }

  const formatted = hits
    .map((hit, i) => {
      const title = hit.title ?? "(untitled)";
      const url = hit.url ?? "";
      const snippet = (hit.content ?? "").slice(0, 240).replace(/\s+/g, " ").trim();
      return `${i + 1}. ${title}\n   URL: ${url}\n   ${snippet}`;
    })
    .join("\n\n");

  return { text: `Top results for "${query}":\n\n${formatted}`, isError: false };
}

async function runSearchPolicyUrl(input: Record<string, unknown>): Promise<ToolResult> {
  const company = typeof input.company_name === "string" ? input.company_name.trim() : "";
  if (!company) return { text: "company_name is required", isError: true };
  return tavilySearch(`${company} privacy policy`);
}

async function runReadUrl(input: Record<string, unknown>): Promise<ToolResult> {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) return { text: "url is required", isError: true };

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { text: `Invalid URL: ${url}`, isError: true };
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { text: `Unsupported URL protocol: ${target.protocol}`, isError: true };
  }

  const jinaUrl = `https://r.jina.ai/${target.toString()}`;
  const headers: Record<string, string> = { Accept: "text/markdown" };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }

  const res = await fetch(jinaUrl, { headers });
  if (!res.ok) {
    return {
      text: `Jina Reader request failed for ${url}: ${res.status} ${res.statusText}`,
      isError: true,
    };
  }

  const body = await res.text();
  const MAX_CHARS = 80_000;
  const truncated = body.length > MAX_CHARS;
  const text = truncated
    ? `${body.slice(0, MAX_CHARS)}\n\n[truncated — original was ${body.length} chars]`
    : body;
  return { text, isError: false };
}

async function runSearchDpoContact(input: Record<string, unknown>): Promise<ToolResult> {
  const company = typeof input.company_name === "string" ? input.company_name.trim() : "";
  if (!company) return { text: "company_name is required", isError: true };

  // Mix DPO-specific terminology in EN and ES so we hit either jurisdiction's phrasing.
  const query = `${company} (DPO OR "data protection officer" OR "delegado de protección de datos" OR "oficial de privacidad" OR "privacy officer") email contact`;
  return tavilySearch(query, 6);
}

type Jurisdiction = "cl" | "eu" | "us-ca";

type Right =
  | "access"
  | "rectification"
  | "deletion"
  | "opposition"
  | "portability"
  | "restriction"
  | "opt_out_sale"
  | "limit_sensitive";

const RIGHT_LABELS: Record<Jurisdiction, Partial<Record<Right, string>>> = {
  cl: {
    access: "derecho de acceso",
    rectification: "derecho de rectificación",
    deletion: "derecho de cancelación (supresión)",
    opposition: "derecho de oposición",
    portability: "derecho de portabilidad",
  },
  eu: {
    access: "right of access (Article 15)",
    rectification: "right to rectification (Article 16)",
    deletion: "right to erasure / 'right to be forgotten' (Article 17)",
    restriction: "right to restriction of processing (Article 18)",
    portability: "right to data portability (Article 20)",
    opposition: "right to object (Article 21)",
  },
  "us-ca": {
    access: "right to know (CCPA § 1798.110 / § 1798.115)",
    deletion: "right to delete (CCPA § 1798.105)",
    rectification: "right to correct (CCPA § 1798.106)",
    opt_out_sale: "right to opt out of sale or sharing (CCPA § 1798.120)",
    limit_sensitive: "right to limit use of sensitive personal information (CCPA § 1798.121)",
  },
};

const LEGAL_BASIS: Record<Jurisdiction, string> = {
  cl: "Ley N° 21.719 sobre Protección de Datos Personales",
  eu: "Regulation (EU) 2016/679 (General Data Protection Regulation)",
  "us-ca": "California Consumer Privacy Act (Cal. Civ. Code § 1798.100 et seq., as amended by the CPRA)",
};

function isJurisdiction(v: unknown): v is Jurisdiction {
  return v === "cl" || v === "eu" || v === "us-ca";
}

function buildEmailDraft(args: {
  jurisdiction: Jurisdiction;
  right: Right;
  rightLabel: string;
  recipientName?: string;
  companyName: string;
  requesterName: string;
  requesterId?: string;
  subjectData?: string;
}): { subject: string; body: string } {
  const {
    jurisdiction,
    rightLabel,
    recipientName,
    companyName,
    requesterName,
    requesterId,
    subjectData,
  } = args;
  const basis = LEGAL_BASIS[jurisdiction];
  const greetingName = recipientName?.trim() || (jurisdiction === "cl" ? "Oficial de Protección de Datos" : "Data Protection Officer");
  const dataLine = subjectData?.trim();

  if (jurisdiction === "cl") {
    return {
      subject: `Solicitud de ejercicio de ${rightLabel} — ${requesterName}`,
      body: [
        `Estimado/a ${greetingName},`,
        ``,
        `Por la presente, en mi calidad de titular de datos personales, vengo a ejercer mi ${rightLabel} respecto del tratamiento de mis datos personales que efectúa ${companyName}, conforme a lo dispuesto en la ${basis}.`,
        ``,
        `Datos del titular:`,
        `- Nombre: ${requesterName}`,
        requesterId ? `- RUT / Identificación: ${requesterId}` : null,
        `- Correo de contacto: [completar]`,
        ``,
        dataLine
          ? `Solicitud específica: ${dataLine}`
          : `Solicitud específica: [describa los datos o tratamientos a los que se refiere su solicitud].`,
        ``,
        `Solicito formalmente que, dentro de los plazos establecidos por la ${basis}, se dé respuesta a esta solicitud, indicando las acciones adoptadas o, en su defecto, los fundamentos legales que justifiquen su rechazo. Le recuerdo que, conforme a la ley, debe responder por el mismo medio o cualquier otro idóneo, y sin costo para el titular.`,
        ``,
        `Quedo atento/a a su confirmación de recepción y respuesta.`,
        ``,
        `Atentamente,`,
        requesterName,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (jurisdiction === "eu") {
    return {
      subject: `Data subject request — ${rightLabel} — ${requesterName}`,
      body: [
        `Dear ${greetingName},`,
        ``,
        `I am writing to exercise my ${rightLabel} regarding the personal data that ${companyName} processes about me, pursuant to the ${basis}.`,
        ``,
        `Data subject details:`,
        `- Name: ${requesterName}`,
        requesterId ? `- Identifier: ${requesterId}` : null,
        `- Contact email: [fill in]`,
        ``,
        dataLine
          ? `Specific request: ${dataLine}`
          : `Specific request: [describe the data or processing activities your request covers].`,
        ``,
        `Please respond within one month of receipt as required by Article 12(3) of the GDPR. Where the response cannot be provided in that time, please notify me of the extension and the reasons for the delay. The response should be provided free of charge in accordance with Article 12(5).`,
        ``,
        `I look forward to your acknowledgement of receipt and substantive reply.`,
        ``,
        `Yours sincerely,`,
        requesterName,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // us-ca
  return {
    subject: `Consumer privacy request — ${rightLabel} — ${requesterName}`,
    body: [
      `Dear ${greetingName},`,
      ``,
      `I am submitting a verifiable consumer request to exercise my ${rightLabel} concerning the personal information that ${companyName} has collected, used, sold, or shared about me, pursuant to the ${basis}.`,
      ``,
      `Consumer details:`,
      `- Name: ${requesterName}`,
      requesterId ? `- Identifier: ${requesterId}` : null,
      `- Contact email: [fill in]`,
      ``,
      dataLine
        ? `Specific request: ${dataLine}`
        : `Specific request: [describe the personal information or processing activities your request covers].`,
      ``,
      `Please confirm receipt within 10 business days and provide a substantive response within 45 calendar days, in accordance with CCPA § 1798.130(a)(2). If you require additional time, please notify me of the extension and the reasons. The response should be provided free of charge as required by § 1798.130(a)(2).`,
      ``,
      `Thank you for your attention to this matter.`,
      ``,
      `Sincerely,`,
      requesterName,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function runDraftLegalEmail(input: Record<string, unknown>): Promise<ToolResult> {
  const jurisdiction = input.jurisdiction;
  if (!isJurisdiction(jurisdiction)) {
    return { text: "jurisdiction must be 'cl', 'eu', or 'us-ca'", isError: true };
  }

  const right = typeof input.right === "string" ? (input.right as Right) : null;
  if (!right) return { text: "right is required", isError: true };

  const rightLabel = RIGHT_LABELS[jurisdiction][right];
  if (!rightLabel) {
    const valid = Object.keys(RIGHT_LABELS[jurisdiction]).join(", ");
    return {
      text: `right "${right}" is not valid for jurisdiction "${jurisdiction}". Valid: ${valid}`,
      isError: true,
    };
  }

  const recipientEmail = typeof input.recipient_email === "string" ? input.recipient_email.trim() : "";
  const companyName = typeof input.company_name === "string" ? input.company_name.trim() : "";
  const requesterName = typeof input.requester_name === "string" ? input.requester_name.trim() : "";
  if (!recipientEmail || !companyName || !requesterName) {
    return { text: "recipient_email, company_name, and requester_name are required", isError: true };
  }

  const recipientName = typeof input.recipient_name === "string" ? input.recipient_name.trim() : undefined;
  const requesterId = typeof input.requester_id === "string" ? input.requester_id.trim() : undefined;
  const subjectData = typeof input.subject_data === "string" ? input.subject_data.trim() : undefined;

  const { subject, body } = buildEmailDraft({
    jurisdiction,
    right,
    rightLabel,
    recipientName,
    companyName,
    requesterName,
    requesterId,
    subjectData,
  });

  const text = [`To: ${recipientEmail}`, `Subject: ${subject}`, ``, body].join("\n");
  return { text, isError: false };
}

const VALID_SEVERITIES: ReadonlySet<FindingSeverity> = new Set([
  "critical",
  "warning",
  "info",
  "passing",
]);

const VALID_RISK = new Set(["low", "medium", "high"]);

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asTrimmed(v: unknown): string | undefined {
  const s = asString(v)?.trim();
  return s ? s : undefined;
}

function parseRewrite(v: unknown): FindingRewrite | undefined {
  if (!v || typeof v !== "object") return undefined;
  const obj = v as Record<string, unknown>;
  const before = asString(obj.before);
  const after = asString(obj.after);
  if (typeof before !== "string" || typeof after !== "string") return undefined;
  return { before, after };
}

function parseFinding(raw: unknown, fallbackId: string): Finding | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "finding is not an object" };
  const obj = raw as Record<string, unknown>;
  const id = asTrimmed(obj.id) ?? fallbackId;
  const rawSev = asTrimmed(obj.severity)?.toLowerCase();
  const sev = (rawSev && VALID_SEVERITIES.has(rawSev as FindingSeverity)
    ? (rawSev as FindingSeverity)
    : "info") as FindingSeverity;
  const category = asTrimmed(obj.category) ?? "General";
  const title = asTrimmed(obj.title) ?? asTrimmed(obj.description) ?? "Finding";
  const description =
    asTrimmed(obj.description) ?? asTrimmed(obj.why_it_matters) ?? title;
  return {
    id,
    severity: sev,
    category,
    title,
    description,
    article_ref: asTrimmed(obj.article_ref),
    law_label: asTrimmed(obj.law_label),
    article_quote: asTrimmed(obj.article_quote),
    why_it_matters: asTrimmed(obj.why_it_matters),
    suggested_rewrite: parseRewrite(obj.suggested_rewrite),
  };
}

async function fetchPipelineSteps(
  anthropicSessionId: string,
): Promise<PipelineStep[]> {
  try {
    const client = getAnthropic();
    const page = await client.beta.sessions.events.list(anthropicSessionId, {
      limit: 100,
    });
    return derivePipelineSteps(
      page.data as unknown as Parameters<typeof derivePipelineSteps>[0],
    );
  } catch (e) {
    console.warn(
      `[submit_findings] could not fetch events for pipeline: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return [];
  }
}

async function runSubmitFindings(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const policyLabel = asTrimmed(input.policy_label) ?? "Audited policy";

  const scoreRaw = input.compliance_score;
  const scoreParsed =
    typeof scoreRaw === "number"
      ? Math.round(scoreRaw)
      : typeof scoreRaw === "string"
        ? Math.round(Number(scoreRaw))
        : NaN;
  const score = Number.isFinite(scoreParsed)
    ? Math.max(0, Math.min(100, scoreParsed))
    : 50;

  const riskRaw = asTrimmed(input.risk_level)?.toLowerCase();
  const riskLevel = riskRaw && VALID_RISK.has(riskRaw) ? riskRaw : "medium";

  const findingsRaw = input.findings;
  if (!Array.isArray(findingsRaw) || findingsRaw.length === 0) {
    return { text: "findings must be a non-empty array", isError: true };
  }

  const findings: Finding[] = [];
  findingsRaw.forEach((raw, i) => {
    const parsed = parseFinding(raw, `F-${String(i + 1).padStart(2, "0")}`);
    if ("error" in parsed) return;
    findings.push(parsed);
  });
  if (findings.length === 0) {
    return { text: "no valid findings could be parsed", isError: true };
  }

  const policyUrl = asTrimmed(input.policy_url) ?? null;
  const pipeline = await fetchPipelineSteps(ctx.anthropicSessionId);
  const id = crypto.randomUUID();

  await db
    .insert(auditReport)
    .values({
      id,
      anthropicSessionId: ctx.anthropicSessionId,
      sessionId: ctx.sessionId,
      jurisdiction: ctx.jurisdiction,
      policyUrl,
      policyLabel,
      complianceScore: score,
      riskLevel,
      findingsJson: findings,
      pipelineJson: pipeline,
    })
    .onConflictDoUpdate({
      target: auditReport.anthropicSessionId,
      set: {
        policyUrl,
        policyLabel,
        complianceScore: score,
        riskLevel,
        findingsJson: findings,
        pipelineJson: pipeline,
        jurisdiction: ctx.jurisdiction,
      },
    });

  return {
    text: `Report saved with ${findings.length} findings (score ${score}/100, risk ${riskLevel}).`,
    isError: false,
  };
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "search_policy_url":
        return await runSearchPolicyUrl(input);
      case "read_url":
        return await runReadUrl(input);
      case "search_dpo_contact":
        return await runSearchDpoContact(input);
      case "draft_legal_email":
        return await runDraftLegalEmail(input);
      case "submit_findings":
        return await runSubmitFindings(input, ctx);
      default:
        return { text: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { text: `Tool ${name} threw: ${message}`, isError: true };
  }
}
