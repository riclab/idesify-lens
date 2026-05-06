# Project Context: Idesify-Lens
You are an expert full-stack developer working on a Next.js (Vercel) project based on the "Claude Managed Agents Starter". We are transforming this template into "Idesify-Lens", a privacy policy legal auditing tool for a hackathon.

## ⚠️ GLOBAL RULES FOR THIS ENTIRE PROJECT
1. **Documentation:** For every major change or completed Sprint, you MUST create a `.md` file inside a `steps/` directory (e.g., `steps/sprint-1-auth-removal.md`) explaining exactly what files were modified and how the logic works now. Create the `steps/` directory if it doesn't exist.
2. **Version Control:** After completing a Sprint and creating its `.md` file, you MUST generate a Git commit with a clear, descriptive message (e.g., `git commit -m "feat(sprint-1): remove better-auth and implement anonymous sessions"`). Pause and ask for my approval to proceed to the next sprint.

---

## Sprint 1: Eradicate Login & Implement Anonymous Sessions
The current template uses `better-auth` and requires a logged-in user. We need to remove this friction entirely.
- **Goal:** Remove all authentication and use a client-generated anonymous session ID.
- **Tasks:**
  1. Uninstall `better-auth` and remove all related auth files (e.g., `lib/session.ts` or auth route handlers).
  2. Modify the database schema (`lib/schema.ts`): Remove the `userId` field from `managedAgentSession` and any `User` tables. Rely entirely on the session `id` (UUID).
  3. Update API Routes: Modify `app/api/managed-agents/session/route.ts`, `app/api/managed-agents/message/route.ts`, and `app/api/readable/[runId]/route.ts`. Remove all instances of `requireUserId()`. The client will now generate a `sessionId` (UUID) and pass it via headers or body. Validate sessions using this ID instead of the user ID.
  4. Update the Frontend (`ChatPanel`): Generate a standard UUID in `localStorage` on the first visit and send it as the `sessionId` for all API calls.

## Sprint 2: Static Agent Configuration & Vault Removal
We do not want users to connect personal MCP accounts (like their own GitHub). We will use application-level credentials and a single static Agent.
- **Goal:** Clean up vault logic and hardcode the Anthropic Agent targets.
- **Tasks:**
  1. Delete `lib/vault.ts` and any MCP OAuth login flows (GitHub, Notion, etc.). 
  2. In `app/api/managed-agents/session/route.ts`, remove the logic that creates Vaults and syncs MCP credentials.
  3. Update `lib/managed-agents.ts`: Ensure `createSession` just uses `process.env.ANTHROPIC_AGENT_ID` and `process.env.ANTHROPIC_ENVIRONMENT_ID` directly without expecting `vaultIds`.

## Sprint 3: Jurisdiction-Aware Caching & Agent-Driven Ingestion (Path A)
Lens needs to analyze Privacy Policies against a selected jurisdiction's law. Ingestion is performed by the agent via tools (not pre-uploaded by the user). The static law text is what we cache.
- **API constraint discovered during planning:** `client.beta.sessions.create()` does NOT accept `system` or `tools` per-session — these are baked into the Anthropic Agent. We therefore use **one Agent per jurisdiction** (Path A): the law text lives in each Agent's system prompt (cached for free by Anthropic), and `search_policy_url` + `read_url` are configured as custom tools on each Agent.
- **Goal:** Pick the correct Anthropic Agent based on the selected jurisdiction; handle the custom-tool-use → custom-tool-result loop in the durable workflow.
- **Tasks:**
  1. **Jurisdiction registry.** Build `lib/laws.ts` that loads the markdown files in `laws/` at module init into a `Record<JurisdictionId, { id, label, text }>` map (`cl`, `eu`, `us-ca`). Default = `cl`.
  2. **Schema.** Add `jurisdiction` column to `managed_agent_session` (text, default `'cl'`). Pass it from the new-chat composer when creating the session.
  3. **Env wiring.** Replace the single `ANTHROPIC_AGENT_ID` with one ID per jurisdiction: `ANTHROPIC_AGENT_ID_CL`, `ANTHROPIC_AGENT_ID_EU`, `ANTHROPIC_AGENT_ID_US_CA`. `ANTHROPIC_ENVIRONMENT_ID` stays single (one container env shared across agents).
  4. **`getManagedAgentConfig(jurisdiction)`** picks the right agent ID. `createManagedAgentSession(jurisdiction)` plumbs the jurisdiction through.
  5. **UI: jurisdiction selector.** Dropdown in `new-chat-composer.tsx` next to the textarea — Chile (default), EU (GDPR), California (CCPA). Selection sent in the `POST /api/managed-agents/session` body.
  6. **Two ingestion tools** wired into the durable workflow:
     - `search_policy_url(company_name)` — Tavily search; returns top candidate URLs with snippets.
     - `read_url(url)` — Jina Reader (`https://r.jina.ai/<url>`); returns clean markdown of the page.

     The workflow watches for `agent.custom_tool_use` events emitted alongside `session.status_idle{stop_reason: requires_action}`, executes the corresponding handler (`lib/ingestion-tools.ts`), and replies with a `user.custom_tool_result` event. The tool definitions themselves live on the Anthropic Agent (configured in the console).
  7. **Agent-config payloads.** Generate `agent-config/<jurisdiction>.md` for each jurisdiction containing the system prompt (auditor role + citation rules + the law text) and the tool JSON schemas, ready to paste into the Anthropic console.
- **Deferred from original Sprint 3:** PDF upload (drop entirely, revisit only if the agent can't reach a paywalled policy).

## Sprint 4: The Audit Engine (Extended Thinking & Citations)
The primary function is to audit the ingested policy against the law.
- **Goal:** Enhance Claude's reasoning for the legal audit.
- **Tasks:**
  1. In the `sendMessage` function (`app/workflows/tail-session.ts`), configure the Anthropic API call to enable **Extended Thinking** (Claude 3.7 Sonnet feature) when the user requests an audit. Set a `thinking.budget_tokens` parameter.
  2. Adjust the System Prompt to strictly require **Citations**. Claude must quote the exact paragraphs from the ingested document when pointing out a legal deficiency.

## Sprint 5: The Proactive DPO Agent (Tool Calling)
If the user wants to exercise their ARCO rights, the agent must autonomously find the Data Protection Officer (DPO) and draft an email.
- **Goal:** Implement the Agent SDK Tool Calling.
- **Tasks:**
  1. Define two tools in the Anthropic API call configuration:
     - `search_dpo_contact`: A tool that takes a company name and searches the web (we will wire this to Tavily API) to find the DPO email address.
     - `draft_legal_email`: A tool that takes the DPO email, user name, and the specific ARCO right to exercise, returning a legally sound email draft citing the law.
  2. Update the workflow loop to handle `tool_calls` emitted by Claude, execute the corresponding backend function, and return the `tool_result` to Claude so it can present the final email draft to the user for confirmation.