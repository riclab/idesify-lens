import { headers } from "next/headers";
import { NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SessionAuth =
  | { sessionId: string }
  | { error: NextResponse };

function unauthorized(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 401 });
}

export async function requireSessionId(): Promise<SessionAuth> {
  const sessionId = (await headers()).get("x-session-id")?.trim();
  if (!sessionId) return { error: unauthorized("Missing x-session-id header") };
  if (!UUID_RE.test(sessionId)) {
    return { error: unauthorized("Invalid x-session-id") };
  }
  return { sessionId };
}

export function requireSessionIdFromQuery(value: string | null): SessionAuth {
  const sessionId = value?.trim();
  if (!sessionId) return { error: unauthorized("Missing sessionId") };
  if (!UUID_RE.test(sessionId)) return { error: unauthorized("Invalid sessionId") };
  return { sessionId };
}
