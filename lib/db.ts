import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Neon's HTTP driver runs every query as a fetch() against an edge endpoint.
// In dev (and occasionally in prod) we see transient `TypeError: fetch failed`
// — usually a brief connection reset, DNS hiccup, or TLS retry. Wrapping the
// driver's fetch with bounded retries makes the sidebar polling and other
// read paths resilient to those blips. We retry only on network-layer errors,
// never on HTTP 4xx/5xx responses, and we leave POST bodies (writes) alone
// after the first attempt to avoid double-execution risk on opaque failures.
const RETRYABLE_FETCH_PATTERNS = [
  /fetch failed/i,
  /econn(reset|refused|aborted)/i,
  /etimedout/i,
  /und_err_/i,
  /socket hang up/i,
];

function isRetryableFetchError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : "";
  if (!msg) return false;
  if (RETRYABLE_FETCH_PATTERNS.some((re) => re.test(msg))) return true;
  // AggregateError from undici wraps the real cause(s).
  const cause = (err as { cause?: unknown }).cause;
  if (cause && cause !== err) return isRetryableFetchError(cause);
  return false;
}

async function fetchWithRetry(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const isWrite = (init?.method ?? "GET").toUpperCase() !== "GET";
  const maxAttempts = isWrite ? 2 : 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts || !isRetryableFetchError(e)) throw e;
      const delay = 80 * 2 ** (attempt - 1) + Math.floor(Math.random() * 40);
      console.warn(
        `[db] retrying Neon fetch (attempt ${attempt + 1}/${maxAttempts}) after ${delay}ms:`,
        (e as Error).message,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

neonConfig.fetchFunction = fetchWithRetry;

let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Run `vercel env pull` or copy .env.example to .env.local.",
      );
    }
    _db = drizzle({ client: neon(url), schema });
  }
  return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
