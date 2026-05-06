# Sprint 2 — Static Agent Configuration & Vault Removal

## Goal

Use application-level Anthropic credentials and a single static Agent. No per-user vaults, no per-user MCP OAuth.

## Status

The vault and MCP OAuth code paths were already removed in Sprint 1 — the build couldn't compile in pieces because `lib/vault.ts`, `lib/mcp-oauth.ts`, and the `app/api/mcp-auth/` tree all transitively imported `better-auth/crypto` and the per-user `User` table. Sprint 1 deleted them up front. This sprint verifies that state, deletes any leftover references, and updates the project docs to match.

## Verification

Confirmed the following are absent from `lib/`, `app/api/`, and `components/`:

| Symbol / file | Status |
|---|---|
| `lib/vault.ts` | Deleted in Sprint 1 |
| `lib/mcp-oauth.ts` | Deleted in Sprint 1 |
| `lib/get-github-token.ts` | Deleted in Sprint 1 |
| `app/api/mcp-auth/` | Deleted in Sprint 1 |
| `app/api/github/` | Deleted in Sprint 1 |
| `vaultIds` parameter / `vault_ids` in Anthropic `sessions.create` | Gone |
| Per-user MCP credential sync in `app/api/managed-agents/session/route.ts` | Gone |

`lib/managed-agents.ts` is the single source of truth for the static agent config:

```ts
export function getManagedAgentConfig() {
  const agentId = process.env.ANTHROPIC_AGENT_ID;
  const environmentId = process.env.ANTHROPIC_ENVIRONMENT_ID;
  if (!agentId || !environmentId) throw new Error(...);
  return { agentId, environmentId };
}

export async function createManagedAgentSession() {
  const client = getAnthropic();
  const { agentId, environmentId } = getManagedAgentConfig();
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
  });
  return { anthropicSessionId: session.id, agentId: session.agent.id, environmentId: session.environment_id };
}
```

No `vault_ids`, no per-user lookups, no fallback paths.

## Display-only MCP references kept

`components/chat/chat-panel.tsx` still contains a small `mcpServerFromName()` helper that maps tool-call names like `notion__search`, `github__create_issue`, `slack__post_message` to icon labels. This is **display-only**: it labels events the agent emits if the underlying Anthropic Agent has those tools configured server-side. It does not depend on per-user MCP OAuth and is harmless to keep. Removing it would only blank out icons for tool events that never fire in the privacy-policy-audit Agent anyway.

## Files modified in this sprint

- `CLAUDE.md` — overhauled to match the slim shape:
  - Project description rewritten as "Idesify-Lens" (privacy-policy auditor) instead of "Claude Managed Agents Showcase".
  - Quick Reference: replaced "Auth: Better Auth..." with "Identity: anonymous client UUID...".
  - Documentation Map: removed the `docs/AUTH.md` row, added `steps/` row.
  - Environment Variables: removed `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`.
  - Project Structure: dropped `app/api/auth/`, `app/auth/error/`, `lib/auth.ts`, `lib/auth-client.ts`, `components/sign-in-modal.tsx`, `components/user-menu.tsx`. Added `lib/anonymous-session.ts`, `lib/rate-limit.ts`, `lib/pending-message.ts`, `lib/time.ts`, `lib/sidebar-context.tsx`, `app/api/readable/[runId]/`. Updated `(dashboard)/layout.tsx` description and `lib/session.ts` to reference `requireSessionId()` instead of `requireUserId()`.
  - End-to-End Flow: replaced step 1 ("sign in via Vercel OAuth") with the anonymous-UUID + `x-session-id` flow, and added the no-per-user-vaults note to step 4.

## Verification commands

```
grep -rn "vault\|mcp-oauth\|requireUserId\|getGithubToken" lib/ app/ components/
# (no results)

grep -rn "vault_ids\|vaultIds" lib/ app/ components/
# (no results)
```

## Follow-ups

None for Sprint 2. Sprint 3 (document ingestion + prompt caching) is the next milestone.
