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

## Sprint 3: Document Ingestion (Files API) & Prompt Caching
Lens needs to analyze massive Privacy Policy documents.
- **Goal:** Allow the user to submit a Privacy Policy URL or PDF as the initial message.
- **Tasks:**
  1. Add a UI element (input/upload) to accept either a URL or a PDF file before starting the chat.
  2. If a URL is provided, suggest a placeholder function to fetch the text (we will use Jina Reader API for this).
  3. If a PDF is provided, integrate the **Anthropic Files API** to upload the document before calling `createSession` or sending the first workflow message.
  4. **Prompt Caching:** Modify the Anthropic API calls in `app/workflows/tail-session.ts` (specifically the `sendMessage` step). Ensure the `system` prompt containing the legal framework (e.g., Ley 21.719) and the uploaded document/text are marked with `cache_control: {"type": "ephemeral"}` to save tokens and reduce latency.

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