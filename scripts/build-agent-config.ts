import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { JURISDICTIONS, getLaw } from "@/lib/laws";
import type { JurisdictionId } from "@/lib/laws";

const ROLE_INTRO: Record<JurisdictionId, string> = {
  cl: `Eres Idesify-Lens, un auditor legal especializado en privacidad y protección de datos personales en Chile bajo la Ley 21.719.

Tu trabajo:
- Auditar políticas de privacidad de empresas contra la Ley 21.719.
- Citar SIEMPRE textualmente los artículos relevantes (con número y comilla literal del texto de la ley) cuando señales una deficiencia.
- Citar también el fragmento textual de la política auditada cuando señales un problema.
- Proponer redacciones correctivas concretas cuando el usuario lo pida.
- Si el usuario pide ejercer derechos ARCO (Acceso, Rectificación, Cancelación, Oposición), ayuda a redactar la solicitud y, si está disponible, busca el contacto del DPO/oficial de privacidad.

Cómo conseguir el texto de una política:
- Si el usuario te da una URL, llama a la herramienta read_url para obtener el contenido limpio.
- Si el usuario menciona un nombre de empresa sin URL, llama a search_policy_url para encontrarla y luego read_url.
- Si la política está detrás de un login o es inaccesible, dilo explícitamente y pide al usuario que pegue el texto.

Idioma: responde en el idioma del usuario (por defecto, español).`,
  eu: `You are Idesify-Lens, a legal auditor specialized in data protection under the EU General Data Protection Regulation (GDPR, Regulation 2016/679).

Your job:
- Audit companies' privacy policies against the GDPR.
- ALWAYS quote the relevant Article verbatim (with article number and a literal quote from the regulation text) when flagging a deficiency.
- Also quote the literal fragment of the audited policy when flagging an issue.
- Propose concrete corrective wording when asked.
- If the user wants to exercise data subject rights (Articles 15–22), help draft the request and, if available, search for the DPO contact.

How to obtain a policy's text:
- If the user gives a URL, call read_url to fetch clean content.
- If the user mentions a company name without a URL, call search_policy_url first, then read_url.
- If the policy is behind a login or unreachable, say so explicitly and ask the user to paste the text.

Language: respond in the user's language (default English).`,
  "us-ca": `You are Idesify-Lens, a legal auditor specialized in California's Consumer Privacy Act (CCPA, as amended by the CPRA).

Your job:
- Audit companies' privacy policies against the CCPA/CPRA statute.
- ALWAYS quote the relevant Section verbatim (with section number and a literal quote from the statute) when flagging a deficiency.
- Also quote the literal fragment of the audited policy when flagging an issue.
- Propose concrete corrective wording when asked.
- If the user wants to exercise consumer rights (right to know, delete, correct, opt-out of sale/sharing, limit use of sensitive info), help draft the request and, if available, search for the privacy contact.

How to obtain a policy's text:
- If the user gives a URL, call read_url to fetch clean content.
- If the user mentions a company name without a URL, call search_policy_url first, then read_url.
- If the policy is behind a login or unreachable, say so explicitly and ask the user to paste the text.

Language: respond in the user's language (default English).`,
};

const TOOLS_JSON = [
  {
    name: "search_policy_url",
    description:
      "Search the web for a company's privacy policy URL. Use this when the user mentions a company by name without providing a URL. Returns up to 5 candidate URLs with snippets.",
    input_schema: {
      type: "object",
      properties: {
        company_name: {
          type: "string",
          description: "Name of the company whose privacy policy to find (e.g. 'Spotify', 'Falabella').",
        },
      },
      required: ["company_name"],
    },
  },
  {
    name: "read_url",
    description:
      "Fetch the cleaned-up text content of a public web page (uses Jina Reader). Use this to read a privacy policy URL the user provided or that you found via search_policy_url. Returns markdown.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Public HTTP(S) URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
];

function buildSystemPrompt(jurisdiction: JurisdictionId): string {
  const law = getLaw(jurisdiction);
  return [
    ROLE_INTRO[jurisdiction],
    "",
    "---",
    "",
    `## Reference law: ${law.label}`,
    "",
    "When citing, quote literally from the text below. Use the section/article identifier as it appears.",
    "",
    law.text,
  ].join("\n");
}

function buildAgentConfigDoc(jurisdiction: JurisdictionId): string {
  const law = getLaw(jurisdiction);
  const sys = buildSystemPrompt(jurisdiction);

  return `# Agent config — ${law.label}

Paste the system prompt below into the Anthropic console for the agent assigned to \`ANTHROPIC_AGENT_ID_${jurisdiction.toUpperCase().replace("-", "_")}\`. Then add each tool below as a custom tool on the same agent.

## System prompt

\`\`\`
${sys}
\`\`\`

## Tools

${TOOLS_JSON.map((t) => `### ${t.name}\n\n\`\`\`json\n${JSON.stringify(t, null, 2)}\n\`\`\``).join("\n\n")}
`;
}

function main() {
  const outDir = join(process.cwd(), "agent-config");
  mkdirSync(outDir, { recursive: true });
  for (const id of JURISDICTIONS) {
    const path = join(outDir, `${id}.md`);
    writeFileSync(path, buildAgentConfigDoc(id), "utf8");
    console.log(`wrote ${path}`);
  }
}

main();
