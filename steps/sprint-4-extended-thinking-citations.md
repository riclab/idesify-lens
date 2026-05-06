# Sprint 4 — The Audit Engine (Extended Thinking & Citations)

## Goal

Make Idesify-Lens produce rigorous, structured audits with verbatim citations from both the law and the audited policy. Enable Extended Thinking so the agent reasons before writing the report.

## API constraint that drove the design

`BetaManagedAgentsModelConfig` exposes only `id` and `speed` — there is no `thinking.budget_tokens` parameter from our code. Extended Thinking is enabled per-Agent in the Anthropic console (model + thinking settings on the agent definition). The original plan called for setting `thinking.budget_tokens` in `sendMessage` — that path is unavailable in the Managed Agents SDK. We do the equivalent in two places: (a) the Agent's console settings (manual step), and (b) the system prompt instructs the model to "think deeply" before audits, which steers the thinking-capable model to use its budget.

## Files modified

### `scripts/build-agent-config.ts`
- The `ROLE_INTRO` strings for each jurisdiction (CL/EU/US-CA) were rewritten as a structured Markdown system prompt with these sections:
  - **Tu rol / Your role** — auditor responsibilities.
  - **Cómo conseguir el texto de una política / How to obtain a policy's text** — explicit usage rules for `search_policy_url` and `read_url`.
  - **Modo auditoría / Audit mode** — triggered when the user asks to "audit / evaluate / check compliance" (or local equivalents). Instructs the model to "think deeply" and produce output in a fixed Markdown template with Executive summary → Findings → Conclusion. Each finding has: severity tag, article/section number, verbatim law quote (`>` blockquote), verbatim policy quote (or `"Absent — ..."` if missing), 1–3 sentence issue, and a concrete suggested rewrite.
  - **Severity levels** — Critical / High / Medium / Low / Info, defined per-jurisdiction (e.g. CL references the Agencia de Protección de Datos; CCPA references AG/CPPA enforcement).
  - **Mandatory citation rules** — quotes must be verbatim, blockquoted, and tagged with the exact article/section number; truncation must use `[…]`; never paraphrase as a quote; if uncertain, re-check the law.
- The generator now also emits a `<jurisdiction>.system.md` file containing the **raw** system prompt with no markdown wrapper. This avoids the prior nested-fence problem (the audit-template example uses ` ``` ` blocks, which broke the outer wrapper). The `.md` file becomes a short pointer that lists the tools' JSON schemas.

### `agent-config/README.md`
- Added a new step 3 documenting the manual console toggle: pick a thinking-capable model (e.g. `claude-sonnet-4-6` or `claude-opus-4-6`) and enable Extended Thinking with a budget of 8k–16k tokens on each of the three Agents. Made explicit that this is required for full audit quality and that the SDK does not expose the knob.
- Updated step 2 to point at `<jurisdiction>.system.md` for the system prompt and the matching `<jurisdiction>.md` for the tool JSON. Renumbered subsequent steps.

### `plan.md`
- Sprint 4 section rewritten to surface the API constraint and the two-pronged approach (system-prompt rubric + console toggle).

## Files added

- `agent-config/cl.system.md`, `agent-config/eu.system.md`, `agent-config/us-ca.system.md` — generated raw system prompts, copy-paste-ready into the Anthropic console.
- `steps/sprint-4-extended-thinking-citations.md` — this document.

## Files unchanged but worth noting

- `app/workflows/tail-session.ts` — no changes. The workflow's tool-loop, polling, and event streaming all work the same way regardless of whether the underlying Agent has Extended Thinking enabled. `agent.thinking` events have always been emitted into the durable stream.
- `components/chat/chat-panel.tsx` — `agent.thinking` events stay in `HIDDEN_TYPES`. The existing "Thinking…" shimmer indicator already covers the user-visible affordance; per-event rendering would be too noisy for a polished UI. Revisit if the user wants per-pulse visibility.

## Verification

- `pnpm dlx tsx scripts/build-agent-config.ts` → wrote 3 `.md` + 3 `.system.md` files, no errors.
- `pnpm exec tsc --noEmit` → clean.
- `pnpm lint` → 0 errors, same 2 pre-existing warnings as previous sprints.

## Manual steps required after this commit

1. Re-paste each `agent-config/<jurisdiction>.system.md` into the corresponding Agent's system-prompt field in the Anthropic console (overwrite the Sprint 3 version).
2. On each Agent, switch to a thinking-capable model and enable Extended Thinking with budget ≈ 8k–16k tokens.
3. (Tools and IDs from Sprint 3 are unchanged — no other re-wiring needed.)
4. Restart `pnpm dev` and try `"Audit Spotify's privacy policy"` — the agent should call `search_policy_url`, then `read_url`, think for several seconds, and produce a report in the Findings template.

## Known follow-ups

- **Audit-mode trigger detection lives in the prompt, not in code.** The model decides whether the user requested an audit based on phrasing. If false-positive triggering (every casual question becomes a full audit report) shows up in testing, tighten the trigger sentence in `ROLE_INTRO`.
- **No structured rendering yet.** The audit Markdown is rendered by Streamdown like any other agent message. If we want collapsible findings, severity-color badges, or a sidebar TOC, that's a UI sprint of its own.
- **Citation faithfulness is best-effort.** Even with the rule "never paraphrase as if it were a quote", the model may occasionally produce a near-quote. A code-side verifier that diffs blockquoted spans against the canonical law text could be added later.
- **Sprint 5 (DPO email tools).** `executeIngestionTool` is already structured for additional tools — adding `search_dpo_contact` and `draft_legal_email` is purely additive.
