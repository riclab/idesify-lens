# Anthropic Agent configuration

Path A of Sprint 3 requires **one Anthropic Managed Agent per jurisdiction**, each with the corresponding law text baked into its system prompt and the same two custom tools attached. Caching is automatic — Anthropic caches the agent system prompt across all calls, so the law text is paid for once.

## What to do

1. Go to the Anthropic console → Managed Agents → Create Agent (one per jurisdiction below).
2. For each agent, paste the contents of the per-jurisdiction file:
   - `agent-config/cl.md` — Chile (Ley 21.719)
   - `agent-config/eu.md` — EU (GDPR)
   - `agent-config/us-ca.md` — California (CCPA)

   Each file has two sections: **System prompt** (paste into the system-prompt field) and **Tools** (one JSON block per tool, paste into the custom-tool definition fields).

3. Copy the resulting agent IDs into `.env.local`:

   ```
   ANTHROPIC_AGENT_ID_CL=agent_xxx
   ANTHROPIC_AGENT_ID_EU=agent_yyy
   ANTHROPIC_AGENT_ID_US_CA=agent_zzz
   ANTHROPIC_ENVIRONMENT_ID=env_xxx
   TAVILY_API_KEY=tvly-xxx     # required for search_policy_url
   JINA_API_KEY=jina_xxx       # optional; raises Jina Reader rate limits
   ```

4. Restart the dev server.

## Tool handlers

The custom-tool definitions you paste into the console are *schemas* only — Anthropic emits an `agent.custom_tool_use` event when the agent calls one, and the durable workflow in `app/workflows/tail-session.ts` runs the actual handlers in `lib/ingestion-tools.ts` and replies with `user.custom_tool_result`. You don't deploy any tool code to Anthropic.

## Updating the law text

If you edit a file under `laws/`, regenerate the corresponding `agent-config/<jurisdiction>.md` (run `pnpm tsx scripts/build-agent-config.ts`) and paste the new system prompt into the Anthropic console. The agent ID and environment ID don't change.
