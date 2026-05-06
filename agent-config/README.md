# Anthropic Agent configuration

Path A of Sprint 3 requires **one Anthropic Managed Agent per jurisdiction**, each with the corresponding law text baked into its system prompt and the same four custom tools attached (`search_policy_url`, `read_url`, `search_dpo_contact`, `draft_legal_email`). Caching is automatic — Anthropic caches the agent system prompt across all calls, so the law text is paid for once.

## What to do

1. Go to the Anthropic console → Managed Agents → Create Agent (one per jurisdiction below).
2. For each agent:
   - Paste the contents of `agent-config/<jurisdiction>.system.md` into the system-prompt field.
   - Add the four custom tools listed in `agent-config/<jurisdiction>.md` (one JSON block per tool).

   Files per jurisdiction:
   - `cl.system.md` + `cl.md` — Chile (Ley 21.719)
   - `eu.system.md` + `eu.md` — EU (GDPR)
   - `us-ca.system.md` + `us-ca.md` — California (CCPA)

3. **Enable Extended Thinking on each Agent.** In the Anthropic console, on each Agent's settings, pick a thinking-capable model (e.g. `claude-sonnet-4-6` or `claude-opus-4-6`) and turn on Extended Thinking with a budget around 8k–16k tokens. This is what lets the agent reason carefully before producing a structured audit. The Managed Agents SDK does not expose `thinking.budget_tokens` per session, so this must be done in the console. Without it the audit format still works, but the reasoning quality drops.

4. Copy the resulting agent IDs into `.env.local`:

   ```
   ANTHROPIC_AGENT_ID_CL=agent_xxx
   ANTHROPIC_AGENT_ID_EU=agent_yyy
   ANTHROPIC_AGENT_ID_US_CA=agent_zzz
   ANTHROPIC_ENVIRONMENT_ID=env_xxx
   TAVILY_API_KEY=tvly-xxx     # required for search_policy_url
   JINA_API_KEY=jina_xxx       # optional; raises Jina Reader rate limits
   ```

5. Restart the dev server.

## Tool handlers

The custom-tool definitions you paste into the console are *schemas* only — Anthropic emits an `agent.custom_tool_use` event when the agent calls one, and the durable workflow in `app/workflows/tail-session.ts` runs the actual handlers in `lib/tool-handlers.ts` and replies with `user.custom_tool_result`. You don't deploy any tool code to Anthropic.

## Updating the law text

If you edit a file under `laws/`, regenerate the corresponding `agent-config/<jurisdiction>.md` (run `pnpm tsx scripts/build-agent-config.ts`) and paste the new system prompt into the Anthropic console. The agent ID and environment ID don't change.
