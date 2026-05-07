const PER_SESSION_LIMIT = 10;
const GLOBAL_LIMIT = 100;

const sessionCounts = new Map<string, { count: number; resetAt: number }>();
let globalCount = 0;
let globalResetAt = getNextReset();

function getNextReset(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.getTime();
}

function maybeReset() {
  if (Date.now() >= globalResetAt) {
    globalCount = 0;
    globalResetAt = getNextReset();
    sessionCounts.clear();
  }
}

export function checkMessageRateLimit(sessionId: string): {
  allowed: boolean;
  reason?: string;
} {
  maybeReset();

  if (globalCount >= GLOBAL_LIMIT) {
    return {
      allowed: false,
      reason: `Se alcanzó el límite diario de mensajes. Inténtalo mañana.`,
    };
  }

  const entry = sessionCounts.get(sessionId);
  const sessionCount = entry?.count ?? 0;

  if (sessionCount >= PER_SESSION_LIMIT) {
    return {
      allowed: false,
      reason: `Enviaste ${PER_SESSION_LIMIT} mensajes hoy. Inténtalo mañana.`,
    };
  }

  sessionCounts.set(sessionId, {
    count: sessionCount + 1,
    resetAt: globalResetAt,
  });
  globalCount++;

  return { allowed: true };
}
