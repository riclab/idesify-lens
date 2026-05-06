# Sprint 5 — The Proactive DPO Agent (Tool Calling)

## Goal

Let the agent help users actually *exercise* data subject rights, not just identify them. When the user wants to file an access/erasure/etc. request, the agent finds the DPO contact for the company and produces a ready-to-send, jurisdiction-correct email draft.

## Approach

The custom-tool loop and `agent.custom_tool_use` plumbing from Sprint 3 already handles arbitrary tools — adding new ones is purely additive. Two new tools were defined on the Anthropic Agents and wired into the same dispatcher.

## Files modified

### `lib/ingestion-tools.ts` → `lib/tool-handlers.ts` (renamed)

The name "ingestion-tools" no longer fits — half the tools are now post-ingestion. Renamed via `git mv`. Public function `executeIngestionTool` → `executeTool`.

New handlers:

- `runSearchDpoContact(input)` — same Tavily endpoint as `search_policy_url`, but the query mixes EN/ES DPO terminology so we hit either jurisdiction's phrasing:
  ```
  ${company} (DPO OR "data protection officer" OR "delegado de protección de datos" OR "oficial de privacidad" OR "privacy officer") email contact
  ```
  Pulled the Tavily call out of `runSearchPolicyUrl` into a shared `tavilySearch(query, maxResults)` helper.
- `runDraftLegalEmail(input)` — pure code, no network. Validates `jurisdiction`, `right`, `recipient_email`, `company_name`, `requester_name`. Looks up a per-jurisdiction `RIGHT_LABELS` map (e.g. CL has `derecho de acceso`, EU has `right of access (Article 15)`, US-CA has `right to know (CCPA § 1798.110 / § 1798.115)`). Calls `buildEmailDraft` which produces a `{ subject, body }` pair using one of three jurisdiction templates:
  - **CL** — Spanish; cites `Ley N° 21.719`; explicitly invokes "el mismo medio o cualquier otro idóneo, y sin costo para el titular"; lines for nombre / RUT / correo.
  - **EU** — English; cites GDPR Article 12(3) one-month deadline and Article 12(5) free-of-charge requirement.
  - **US-CA** — English; cites CCPA § 1798.130(a)(2) for 10-business-day acknowledgement and 45-day substantive response.

  Returns a `To: ... \nSubject: ... \n\n<body>` block, ready for the user to copy.

`executeTool` now switches on four cases: `search_policy_url`, `read_url`, `search_dpo_contact`, `draft_legal_email`.

### `app/workflows/tail-session.ts`

Single-line change: `import { executeIngestionTool }` from `@/lib/ingestion-tools` → `import { executeTool }` from `@/lib/tool-handlers`. The custom-tool loop is unchanged.

### `scripts/build-agent-config.ts`

- Added `search_dpo_contact` and `draft_legal_email` JSON schemas to `TOOLS_JSON`. The `draft_legal_email` schema uses `enum` constraints for `jurisdiction` and `right` so the model can't pick an invalid combination — and the tool handler still validates server-side as a defense-in-depth.
- Added an "Ejercicio de derechos ARCO" / "Exercising data subject rights" / "Exercising consumer rights" section to each jurisdiction's `ROLE_INTRO`. The instructions are: (1) call `search_dpo_contact` and propose the most authoritative match; (2) ask the user for name + optional ID + scope; (3) call `draft_legal_email` with the collected fields and present the exact `To:/Subject:/body` block; (4) remind the user to fill placeholders and keep proof of submission.
- Regenerated `cl.md`, `cl.system.md`, `eu.md`, `eu.system.md`, `us-ca.md`, `us-ca.system.md`.

### `agent-config/README.md`

Updated "two custom tools" → "four custom tools" and explicitly listed all four. Updated the `lib/ingestion-tools.ts` reference to `lib/tool-handlers.ts`.

### `CLAUDE.md` and `plan.md`

Stale `ingestion-tools.ts` references replaced with `tool-handlers.ts`. CLAUDE.md project-structure description expanded to list all four tools.

## Files added

- `steps/sprint-5-dpo-email-tools.md` — this document.

## Verification

- `pnpm dlx tsx scripts/build-agent-config.ts` → wrote 6 files, no errors.
- `pnpm exec tsc --noEmit` → clean.
- `pnpm lint` → 0 errors, same 2 pre-existing warnings.

## Manual steps required after this commit

1. Re-paste each `agent-config/<jurisdiction>.system.md` into the corresponding Agent's system-prompt field in the Anthropic console (the rights-workflow sections are new).
2. **Add the two new custom tools** (`search_dpo_contact`, `draft_legal_email`) to each of the three Agents — paste the JSON blocks from `agent-config/<jurisdiction>.md`. The two existing tools (`search_policy_url`, `read_url`) don't need to be re-added.
3. Restart `pnpm dev` and try `"I want to delete my Spotify data"` — the agent should call `search_dpo_contact("Spotify")`, propose a contact, ask for the user's name, then call `draft_legal_email(...)` and show the email block.

## Known follow-ups

- **DPO match quality is best-effort.** Tavily can return aggregator pages (`get-gdpr.com`, etc.) above the company's own privacy page. The model is instructed to prefer the company's own page, but a code-side filter that prioritises the company's domain would harden this.
- **No "send" capability.** The agent produces a draft only — the user copies it into their own mail client. Wiring up a Gmail/Outlook send action is a separate sprint and a much higher trust ask.
- **Idempotency.** Workflow retries could double-charge Tavily on a `search_dpo_contact` call. Same caveat as Sprint 3; not addressed here.
- **Email i18n.** US-CA emails are English-only; if a Spanish-speaking California consumer asks, the email will still come back in English. The model is told to "respond in the user's language" but the template strings themselves are fixed per jurisdiction. A `language` parameter on `draft_legal_email` would fix this if it shows up in testing.
