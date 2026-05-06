# Idesify-Lens

A Next.js 16 web app that audits privacy policies against three jurisdictions' data-protection laws (Chile's Ley 21.719, the EU's GDPR, and California's CCPA), drafts data-subject-rights emails, and finds the right DPO contact to send them to. Built on Anthropic's Managed Agents API.

There is no login — users are identified by an anonymous UUID generated in `localStorage` on first visit. Pick a jurisdiction, paste a policy URL or company name, and the agent fetches the policy, cites the law verbatim, grades each finding by severity, and offers to draft an ARCO / data-subject / consumer-rights email.

## Stack

| Layer       | Choice                                                                    |
| ----------- | ------------------------------------------------------------------------- |
| App         | [Next.js 16](https://nextjs.org) (App Router, Turbopack), React 19        |
| UI          | [shadcn/ui](https://ui.shadcn.com) on `@base-ui/react`, Tailwind CSS v4   |
| Identity    | Anonymous UUID in `localStorage`, sent as `x-session-id` header           |
| Data        | [Neon](https://neon.tech) Postgres + [Drizzle ORM](https://orm.drizzle.team) |
| Background  | [Workflow SDK](https://useworkflow.dev) durable workflows                 |
| Streaming   | Server-Sent Events from a Workflow SDK readable (one stream per session)  |
| Agents      | [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) — one Anthropic Agent per jurisdiction |
| Tools       | Tavily (search), Jina Reader (URL fetch), code-side email drafter         |

## Quickstart

### 1. Clone, install, and link

```bash
git clone <this repo>
cd idesify
pnpm install
```

### 2. Provision Postgres

Either provide a Neon `DATABASE_URL` directly, or use Vercel:

```bash
vercel link
vercel integration add neon
vercel env pull
```

### 3. Configure the three Managed Agents

This app uses **one Anthropic Agent per jurisdiction**. The law text is baked into each Agent's system prompt so Anthropic caches it across all sessions.

```bash
pnpm dlx tsx scripts/build-agent-config.ts
```

This generates six files under `agent-config/`:

- `cl.system.md` + `cl.md` — Chile (Ley 21.719)
- `eu.system.md` + `eu.md` — EU (GDPR)
- `us-ca.system.md` + `us-ca.md` — California (CCPA)

Follow the steps in [`agent-config/README.md`](./agent-config/README.md) to create three Agents in the Anthropic console, paste each `*.system.md` into the system-prompt field, and attach the four custom tools (`search_policy_url`, `read_url`, `search_dpo_contact`, `draft_legal_email`) defined in each `*.md`. Enable **Extended Thinking** on each Agent (8k–16k token budget) — the SDK does not expose this knob, so it must be done in the console.

### 4. Set environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable                  | Required | Purpose                                                  |
| ------------------------- | -------- | -------------------------------------------------------- |
| `DATABASE_URL`            | Yes      | Neon Postgres connection string                          |
| `ANTHROPIC_API_KEY`       | Yes      | Anthropic API key                                        |
| `ANTHROPIC_AGENT_ID_CL`   | Yes      | Agent ID for the Chile / Ley 21.719 agent                |
| `ANTHROPIC_AGENT_ID_EU`   | Yes      | Agent ID for the EU / GDPR agent                         |
| `ANTHROPIC_AGENT_ID_US_CA`| Yes      | Agent ID for the California / CCPA agent                 |
| `ANTHROPIC_ENVIRONMENT_ID`| Yes      | Single environment ID shared across the three agents     |
| `TAVILY_API_KEY`          | Yes      | Used by `search_policy_url` and `search_dpo_contact`     |
| `JINA_API_KEY`            | No       | Optional; raises Jina Reader rate limits                 |

### 5. Push schema and run

```bash
pnpm db:push
pnpm dev
```

## Custom tools

The Agents call four custom tools. Their definitions live on the Anthropic Agent (pasted from `agent-config/*.md`); the actual handlers run server-side in the durable workflow when an `agent.custom_tool_use` event arrives.

| Tool                  | Backend                                             | Purpose |
| --------------------- | --------------------------------------------------- | ------- |
| `search_policy_url`   | Tavily search                                       | Find a company's privacy-policy URL by name. |
| `read_url`            | [Jina Reader](https://r.jina.ai)                    | Fetch a public URL as clean markdown. |
| `search_dpo_contact`  | Tavily search (DPO terminology, EN+ES)              | Find the company's DPO / privacy contact email. |
| `draft_legal_email`   | Pure code — per-jurisdiction email templates        | Produce a `To: / Subject: / body` block citing the right legal articles. |

Handlers live in [`lib/tool-handlers.ts`](./lib/tool-handlers.ts).

## Key files

| File                                | Purpose                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `lib/session.ts`                    | `requireSessionId()` — validates the `x-session-id` UUID header                           |
| `lib/anonymous-session.ts`          | Client-side: `getAnonSessionId()` + `apiFetch()` (injects `x-session-id`)                |
| `lib/laws.ts`                       | Loads markdown law texts from `laws/` at module init; `getLaw(jurisdiction)`             |
| `lib/managed-agents.ts`             | `createManagedAgentSession(jurisdiction)` — picks the correct per-jurisdiction agent ID  |
| `lib/tool-handlers.ts`              | The four custom-tool handlers (Tavily, Jina, email drafter)                              |
| `lib/schema.ts`                     | Drizzle schema (single `managed_agent_session` table)                                    |
| `app/workflows/tail-session.ts`     | Durable workflow: tool-call loop, SSE stream of events, `messageHook` for follow-ups     |
| `app/api/managed-agents/`           | REST endpoints (session CRUD, message, transcript)                                       |
| `app/api/readable/[runId]/`         | SSE bridge to the workflow's readable stream                                             |
| `scripts/build-agent-config.ts`     | Regenerates `agent-config/*.md` and `*.system.md` from `laws/*.md`                       |
| `agent-config/`                     | Generated console-paste payloads (system prompts + tool JSON)                            |
| `laws/`                             | Static law texts (one markdown file per jurisdiction)                                    |

## Documentation

| Doc                                                            | What it covers                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [docs/SPEC.md](./docs/SPEC.md)                                 | Product spec: user flows, API contracts, security model              |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)                 | Project structure, routing, end-to-end flow                          |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md)                     | Drizzle schema, conventions, migrations                              |
| [docs/UI_CONVENTIONS.md](./docs/UI_CONVENTIONS.md)             | Component patterns, shadcn/base-ui gotchas, layout rules             |
| [docs/streaming-long-running-agents.md](./docs/streaming-long-running-agents.md) | Architecture essay: streaming vs persistence patterns       |
| [agent-config/README.md](./agent-config/README.md)             | Manual console steps to wire up the three Agents                     |
| [steps/](./steps)                                              | Per-sprint implementation logs                                       |

## References

- [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Workflow SDK docs](https://useworkflow.dev/docs/getting-started/next)
- [Ley 21.719 (Chile)](https://www.bcn.cl/leychile/navegar?idNorma=1209272) · [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) · [CCPA](https://oag.ca.gov/privacy/ccpa)
