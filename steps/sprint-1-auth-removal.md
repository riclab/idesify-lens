# Sprint 1 — Eradicate Login & Implement Anonymous Sessions

## Goal

Remove all authentication and identify users by a client-generated UUID stored in `localStorage` and forwarded to the API as the `x-session-id` header.

## Scope expansion

The plan called for removing `better-auth` only. In practice, every file that touched per-user identity was coupled to the same chain — the `user` table FK, `requireUserId()`, vault-per-user, MCP-OAuth-per-user, GitHub-token-per-user, the auth proxy middleware, the auth-cookie-aware modal. The build cannot compile in pieces, so this sprint also did Sprint 2's "delete `lib/vault.ts` and MCP OAuth login flows" up front. Sprint 2 is now reduced to verifying the static agent config in `createManagedAgentSession`, which is already correct in this commit.

## Files deleted

| File | Why |
|------|-----|
| `lib/auth.ts` | better-auth `betterAuth(...)` config |
| `lib/auth-client.ts` | client-side `createAuthClient` wrapper |
| `lib/get-github-token.ts` | imports `better-auth/crypto`, looks up tokens by user |
| `lib/mcp-oauth.ts` | per-user MCP OAuth tokens (used `lib/crypto.ts`) |
| `lib/vault.ts` | per-user Anthropic vaults |
| `lib/crypto.ts` | only consumer was `lib/mcp-oauth.ts` |
| `lib/branches.ts` | only consumer was the GitHub routes |
| `proxy.ts` | Next.js middleware that gated routes via `getSessionCookie` from better-auth |
| `app/api/auth/[...all]/route.ts` | better-auth catch-all |
| `app/api/github/` (whole tree) | depended on `getGithubTokenForUser` |
| `app/api/mcp-auth/` (whole tree) | per-user MCP OAuth start/callback/revoke |
| `app/auth/error/page.tsx` | OAuth error page |
| `components/sign-in-modal.tsx` | called `authClient.signIn.oauth2` |
| `components/user-menu.tsx` | called `authClient.signOut` |
| `components/connect-github-modal.tsx` | unused, imported `@/lib/auth-client` |
| `app/(dashboard)/use-repository-picker.ts` | unused after GitHub routes removed |

## Files added

- **`lib/anonymous-session.ts`** — exports `getAnonSessionId()` (reads/writes a UUID under `localStorage["idesify.sessionId"]`, regenerating if missing or malformed) and `apiFetch(input, init)` which wraps `fetch` and injects `x-session-id` automatically.

## Files rewritten

### `lib/schema.ts`
Reduced to a single table:

```ts
export const managedAgentSession = pgTable("managed_agent_session", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(), // anonymous client UUID
  anthropicSessionId: text("anthropic_session_id").notNull().unique(),
  title: text("title").notNull().default("New chat"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  agentId: text("agent_id").notNull(),
  environmentId: text("environment_id").notNull(),
  workflowRunId: text("workflow_run_id"),
});
```

Dropped tables: `user`, `session`, `account`, `verification`, `mcp_oauth_client`, `mcp_oauth_token`. Dropped columns from `managed_agent_session`: `repo_url`, `repo_owner`, `repo_name`, `base_branch`. Renamed `user_id` → `session_id` (no FK; data preserved but orphaned since old client UUIDs from auth no longer match).

### `lib/session.ts`
Replaced `getSession()` / `requireUserId()` with:

- `requireSessionId()` — reads `x-session-id` from `next/headers`, validates UUID v4 format, returns `{ sessionId } | { error: NextResponse }`.
- `requireSessionIdFromQuery(value)` — same contract for routes that can't read the header (the SSE `/api/readable/[runId]` route — `EventSource` doesn't allow custom headers in browsers, so the client passes the anon ID as `?sessionId=`).

### `lib/managed-agents.ts`
`createCodingSession(vaultIds[])` → `createManagedAgentSession()`. The Anthropic `sessions.create` call no longer passes `vault_ids` — uses `ANTHROPIC_AGENT_ID` and `ANTHROPIC_ENVIRONMENT_ID` directly.

### `lib/rate-limit.ts`
Cosmetic: `userId` → `sessionId`, `userCounts` → `sessionCounts`, `PER_USER_LIMIT` → `PER_SESSION_LIMIT`. Logic unchanged.

### API routes

All five routes now call `requireSessionId()` (or `requireSessionIdFromQuery` for the SSE one) and filter `managedAgentSession` rows by `sessionId` instead of `userId`:

- `app/api/managed-agents/session/route.ts` — POST creates row + workflow with no vault sync; DELETE checks ownership against `sessionId`.
- `app/api/managed-agents/sessions/route.ts` — lists rows owned by the anon session.
- `app/api/managed-agents/message/route.ts` — rate-limits by anon `sessionId`; query param `body.sessionId` is the chat's row id (renamed locally to `chatId` for clarity).
- `app/api/managed-agents/transcript/route.ts` — `sessionId` query param is the chat row id; ownership is checked via the header.
- `app/api/readable/[runId]/route.ts` — anon ID via query param; ownership joined on `workflowRunId`.

### Frontend

- `app/(dashboard)/layout.tsx` — was a Server Component fetching `getSession()` and the user's chat list from Postgres. Now a 4-line passthrough that just renders `<DashboardShell>`. The sidebar polls `/api/managed-agents/sessions` itself once mounted.
- `app/(dashboard)/page.tsx` — dropped server-side `getSession` and `getUserMCPConnections`. Renders `<NewChatComposer />` with no props.
- `app/(dashboard)/dashboard-shell.tsx` — dropped `viewer` and `initialSessions` props.
- `app/(dashboard)/dashboard-sidebar.tsx` — dropped `viewer`, `<UserMenu>`, `<SignInModal>`, sign-in button. Sessions are loaded client-side via `apiFetch("/api/managed-agents/sessions")` on mount + every 5s. The initial fetch runs via `setTimeout(…, 0)` to satisfy React 19's `react-hooks/set-state-in-effect` lint rule.
- `app/(dashboard)/new-chat-composer.tsx` — dropped `isAuthenticated` gating, sign-in modal, MCP integrations dropdown, Slack-setup modal. Composer is now a single textarea + send button. Heading + suggestion pills retuned for privacy-policy auditing copy. POST goes through `apiFetch`.
- `components/chat/chat-panel.tsx` — three call sites updated: transcript fetch and message POST go through `apiFetch`; the `EventSource` URL appends `?sessionId=<anonId>` from `getAnonSessionId()`.

## Database migration

Performed manually via `psql` (drizzle-kit's interactive rename prompt doesn't run in this shell):

```sql
DROP TABLE IF EXISTS account, session, verification,
                     mcp_oauth_token, mcp_oauth_client, "user" CASCADE;
ALTER TABLE managed_agent_session RENAME COLUMN user_id TO session_id;
ALTER TABLE managed_agent_session
  DROP COLUMN repo_url, DROP COLUMN repo_owner,
  DROP COLUMN repo_name, DROP COLUMN base_branch;
```

`pnpm db:push` afterwards reports "No changes detected" — schema and DB are in sync.

## Package changes

- Removed: `better-auth` (`^1.6.1`).

## Environment variables no longer used

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`. They can be deleted from `.env.local`. `CLAUDE.md` still lists them; will be cleaned up in a later sprint along with the rest of the docs.

## Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm lint` — 0 errors, 2 pre-existing warnings (auto-generated `app/.well-known/workflow/v1/flow/route.js` eslint-disable comment, and an unused tuple element in `chat-panel.tsx`).
- `pnpm dev` — Ready in ~300ms, manifest builds (6 steps / 1 workflow).
- Smoke test against the dev server:

  ```
  GET /api/managed-agents/sessions                                    → 401 (Missing x-session-id header)
  GET /api/managed-agents/sessions  -H "x-session-id: not-a-uuid"     → 401 (Invalid x-session-id)
  GET /api/managed-agents/sessions  -H "x-session-id: <valid-uuid>"   → 200 {"sessions":[]}
  ```

## Known follow-ups

- Sprint 2 is mostly already done in this commit. What remains: tighten `createManagedAgentSession` (no more `vaultIds` param leaks), confirm `app/api/managed-agents/session/route.ts` no longer references vault helpers (verified), and update `CLAUDE.md` env table + project structure to reflect the slim shape.
- The `sessionId` URL query param on the chat row routes is overloaded with the anon `sessionId` header — both are UUIDs, both are called "sessionId", and they mean different things. Renaming the URL param to `chatId` would clarify, but breaks the existing client API; deferred.
