import type { BetaManagedAgentsSessionEvent } from "@anthropic-ai/sdk/resources/beta/sessions/events";

export type TranscriptEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export function anthropicEventId(
  ev: BetaManagedAgentsSessionEvent,
): string | null {
  if ("id" in ev && typeof (ev as { id?: unknown }).id === "string") {
    return (ev as { id: string }).id;
  }
  return null;
}

export function eventOccurredAt(ev: BetaManagedAgentsSessionEvent): string {
  if (
    "processed_at" in ev &&
    typeof (ev as { processed_at?: string | null }).processed_at === "string"
  ) {
    return (ev as { processed_at: string }).processed_at;
  }
  return new Date().toISOString();
}

export function toTranscriptEvent(
  ev: BetaManagedAgentsSessionEvent,
): TranscriptEvent | null {
  const id = anthropicEventId(ev);
  if (!id) return null;
  return {
    id,
    type: ev.type,
    payload: ev as unknown as Record<string, unknown>,
    occurredAt: eventOccurredAt(ev),
  };
}
