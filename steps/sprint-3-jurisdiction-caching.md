# Sprint 3 — Jurisdiction-Aware Caching & Agent-Driven Ingestion

## Goal

Pick the correct Anthropic Agent based on the user-selected jurisdiction (Chile, EU, California). Caching is automatic because each Agent has the law baked into its system prompt. Replace pre-upload of policies with two custom tools (`search_policy_url`, `read_url`) the agent calls during the conversation.

## API constraint that drove the design

`client.beta.sessions.create()` and `events.send()` do **not** accept `system` or `tools` per-session — those fields are read-only on the agent snapshot returned in `BetaManagedAgentsSessionAgent`. Caching cannot be controlled from our code via `cache_control` either; the only knob we have is *which Agent ID we pass at session-create time*. So we use **Path A**: one Anthropic Agent per jurisdiction, each with its own law in the system prompt. Anthropic caches the system prompt across all sessions of an Agent automatically.

## Files added

| File | Role |
|---|---|
| `lib/laws.ts` | Loads the three markdown files under `laws/` at module init into `Record<JurisdictionId, Law>`; exports `getLaw`, `isJurisdiction`, `listJurisdictions`, `DEFAULT_JURISDICTION = "cl"`. |
| `lib/ingestion-tools.ts` | Tool handlers `search_policy_url` (Tavily) and `read_url` (Jina Reader). Returns `{text, isError}`. Truncates Jina output at 80 KB. |
| `agent-config/README.md` | Instructions for the user: create three Anthropic Agents, paste each per-jurisdiction file, copy IDs into `.env.local`. |
| `agent-config/cl.md` | System prompt (auditor role + citation rules + Ley 21.719 text) + tool JSON for the Chile Agent. Generated. |
| `agent-config/eu.md` | Same for GDPR. Generated. |
| `agent-config/us-ca.md` | Same for CCPA. Generated. |
| `scripts/build-agent-config.ts` | Generator. Run with `pnpm dlx tsx scripts/build-agent-config.ts`. Combines `lib/laws.ts` text with the per-jurisdiction `ROLE_INTRO` strings and the shared `TOOLS_JSON` schemas. |
| `steps/sprint-3-jurisdiction-caching.md` | This file. |

## Files modified

### `lib/schema.ts`
Added `jurisdiction text not null default 'cl'` to `managed_agent_session`.

### `lib/managed-agents.ts`
`getManagedAgentConfig()` now takes a `JurisdictionId` and reads `ANTHROPIC_AGENT_ID_CL` / `_EU` / `_US_CA` accordingly. `ANTHROPIC_ENVIRONMENT_ID` stays single. `createManagedAgentSession(jurisdiction)` plumbs it through.

### `app/api/managed-agents/session/route.ts`
POST body now accepts `jurisdiction?: string`; validated via `isJurisdiction()`, falls back to `DEFAULT_JURISDICTION`. Stored on the row, passed to the workflow input.

### `app/(dashboard)/new-chat-composer.tsx`
Added a `Scale`-iconed `<select>` inline with the send button row. Three options: `Chile — Ley 21.719` (default), `EU — GDPR`, `California — CCPA`. State held in `jurisdiction`, sent in the POST body. Hardcoded list (mirrors `lib/laws.ts`); deliberately not fetched from the server to avoid an extra round-trip on first paint.

### `app/workflows/tail-session.ts`
Big change: the durable workflow now handles the custom-tool-use loop.

- `pollAndStream()` previously returned `{ lastEventId, done }`. Now returns `{ lastEventId, status, toolUseEventIds }` where `status` is `"continue" | "end_turn" | "requires_action"`. When it sees `session.status_idle` with `stop_reason.type === "requires_action"`, it surfaces the blocking event IDs and breaks the page-iteration early.
- New step `runToolsAndReply({ anthropicSessionId, toolUseEventIds })` re-lists events to look up each `agent.custom_tool_use` by ID, calls `executeIngestionTool(name, input)`, and sends a `user.custom_tool_result` event back via `events.send`. Caps at 10 tool rounds per turn (`MAX_TOOL_ROUNDS`) to bound runaway loops.
- `processTurn()` runs in a poll loop: each iteration sleeps, polls, and if `requires_action` runs the tools step before continuing; if `end_turn` it breaks.
- `sessionWorkflow` input now includes optional `jurisdiction?: string` (logged only — the agent ID was already resolved at session-create time).

### `CLAUDE.md`
- Environment-variables table replaced single `ANTHROPIC_AGENT_ID` with three jurisdiction-specific IDs and added `TAVILY_API_KEY` (required) + `JINA_API_KEY` (optional).
- Project-structure listing added `lib/laws.ts`, `lib/ingestion-tools.ts`, `laws/`, `agent-config/`, `scripts/build-agent-config.ts`.

## Database migration

```
pnpm db:push    # added jurisdiction column with default 'cl' — applied cleanly
```

Existing rows pre-Sprint-3 (if any) get the `'cl'` default automatically.

## How the tool loop actually flows

1. Agent decides to call e.g. `search_policy_url({company_name: "Spotify"})`.
2. Anthropic emits `agent.custom_tool_use` (`id`, `name`, `input`) followed by `session.status_idle{stop_reason: {type: "requires_action", event_ids: [<id>]}}`.
3. Our workflow's `pollAndStream` step writes both events to the durable stream (so they show in the UI), reads the `event_ids`, and returns `status: "requires_action"`.
4. `processTurn` calls `runToolsAndReply(eventIds)`. That step lists events to get the `name`+`input` for each id, runs `executeIngestionTool(name, input)` (Tavily POST or Jina GET), and sends `events.send({events: [{type: "user.custom_tool_result", custom_tool_use_id, content, is_error}]})`.
5. Anthropic resumes the agent; the next `pollAndStream` sees the agent's response and any further tool calls.

## Caching behavior

Anthropic caches an Agent's system prompt across all sessions of that Agent (automatic ephemeral cache on the inputs that don't change between calls). Because we now have one Agent per jurisdiction with the full law text in its system prompt, the law text is paid for at most once per cache-warmup window, regardless of which user is asking the question. Per-session and per-turn costs scale only with the conversation tokens.

This is exactly the desired behavior — and it's what we get for free by choosing Path A. Manually marking blocks with `cache_control` was not available in the Managed Agents events API surface anyway.

## Verification

- `pnpm exec tsc --noEmit` → clean.
- `pnpm lint` → 0 errors, 2 pre-existing warnings (unchanged from Sprint 1).
- `pnpm db:push` → "Changes applied" (the `jurisdiction` column).
- `pnpm dlx tsx scripts/build-agent-config.ts` → wrote `cl.md` (78 KB), `eu.md` (360 KB), `us-ca.md` (177 KB).

## Manual steps required after this commit

1. In the Anthropic console, create three Managed Agents (e.g. `Idesify-Lens CL`, `... EU`, `... CA`).
2. For each, paste the corresponding `agent-config/<jurisdiction>.md` system prompt and tool definitions.
3. Copy the resulting agent IDs into `.env.local` as `ANTHROPIC_AGENT_ID_CL`, `_EU`, `_US_CA`.
4. Add `TAVILY_API_KEY` (required for `search_policy_url`); optionally `JINA_API_KEY`.
5. Restart `pnpm dev` and try a query — pick a jurisdiction in the composer, ask "audit Spotify's privacy policy" and watch the agent call `search_policy_url`, then `read_url`, then produce the audit.

## Known follow-ups

- **Idempotency of tool calls.** If `runToolsAndReply` succeeds at `executeIngestionTool` but fails to send the result, on workflow retry the tool runs again (e.g. another Tavily charge). Acceptable for a hackathon; revisit with idempotency keys if needed.
- **Sprint 4 (Extended Thinking + citations).** Citation requirement is already in each Agent's system prompt. Extended Thinking would need to be enabled per-Agent in the Anthropic console; planning may move that into Sprint 4 directly.
- **Sprint 5 (DPO email tools).** Add two more custom tools (`search_dpo_contact`, `draft_legal_email`) to each Agent. The workflow's tool-use plumbing already handles them — just extend `executeIngestionTool` (or introduce `executeTool`) and re-paste the tool JSON into each console agent.
