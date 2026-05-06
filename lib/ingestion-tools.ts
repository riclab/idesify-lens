export type ToolResult = {
  text: string;
  isError: boolean;
};

type SearchHit = {
  title?: string;
  url?: string;
  content?: string;
};

async function runSearchPolicyUrl(input: Record<string, unknown>): Promise<ToolResult> {
  const company = typeof input.company_name === "string" ? input.company_name.trim() : "";
  if (!company) {
    return { text: "company_name is required", isError: true };
  }

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
      query: `${company} privacy policy`,
      max_results: 5,
      search_depth: "basic",
      include_answer: false,
    }),
  });

  if (!res.ok) {
    return { text: `Tavily request failed: ${res.status} ${res.statusText}`, isError: true };
  }

  const data = (await res.json()) as { results?: SearchHit[] };
  const hits = (data.results ?? []).slice(0, 5);
  if (hits.length === 0) {
    return { text: `No results found for "${company} privacy policy"`, isError: false };
  }

  const formatted = hits
    .map((hit, i) => {
      const title = hit.title ?? "(untitled)";
      const url = hit.url ?? "";
      const snippet = (hit.content ?? "").slice(0, 200).replace(/\s+/g, " ").trim();
      return `${i + 1}. ${title}\n   URL: ${url}\n   ${snippet}`;
    })
    .join("\n\n");

  return { text: `Top results for "${company} privacy policy":\n\n${formatted}`, isError: false };
}

async function runReadUrl(input: Record<string, unknown>): Promise<ToolResult> {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) {
    return { text: "url is required", isError: true };
  }

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
  const text = truncated ? `${body.slice(0, MAX_CHARS)}\n\n[truncated — original was ${body.length} chars]` : body;
  return { text, isError: false };
}

export async function executeIngestionTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "search_policy_url":
        return await runSearchPolicyUrl(input);
      case "read_url":
        return await runReadUrl(input);
      default:
        return { text: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { text: `Tool ${name} threw: ${message}`, isError: true };
  }
}
