"use client";

const STORAGE_KEY = "idesify.sessionId";

export function getAnonSessionId(): string {
  if (typeof window === "undefined") {
    throw new Error("getAnonSessionId() must be called in the browser");
  }
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id || !isUuid(id)) {
    id = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const sessionId = getAnonSessionId();
  const headers = new Headers(init.headers);
  headers.set("x-session-id", sessionId);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(input, { ...init, headers });
}
