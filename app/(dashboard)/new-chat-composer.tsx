"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronDown,
  Code,
  FileText,
  Loader2,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { GitHubIcon } from "@/components/icons";
import { setPendingMessage } from "@/lib/pending-message";
import { apiFetch } from "@/lib/anonymous-session";

const JURISDICTIONS = [
  { id: "cl", flag: "🇨🇱", code: "CL", law: "Ley 21.719" },
  { id: "eu", flag: "🇪🇺", code: "EU", law: "GDPR" },
  { id: "us-ca", flag: "🇺🇸", code: "US-CA", law: "CCPA" },
] as const;
type JurisdictionId = (typeof JURISDICTIONS)[number]["id"];

const HEADING_PROMPTS = [
  ["Audit a", "privacy", "policy"],
  ["Check", "Ley 21.719", "compliance"],
  ["Find a", "DPO", "contact"],
  ["Draft an", "ARCO rights", "request"],
  ["Spot legal", "deficiencies", ""],
] as const;

const SUGGESTION_PILLS = [
  {
    label: "Audit",
    prompt: "Audit this privacy policy for Ley 21.719 compliance",
    icon: <Search className="size-3.5" />,
  },
  {
    label: "Summarize",
    prompt: "Summarize the data collection practices described in this policy",
    icon: <FileText className="size-3.5" />,
  },
  {
    label: "Explain clauses",
    prompt: "Explain the most surprising clauses in this policy in plain language",
    icon: <Code className="size-3.5" />,
  },
  {
    label: "Find DPO",
    prompt: "Find the Data Protection Officer contact for this company",
    icon: <BookOpen className="size-3.5" />,
  },
  {
    label: "Draft request",
    prompt: "Draft a data deletion request citing the relevant law",
    icon: <Sparkles className="size-3.5" />,
  },
  {
    label: "Risk check",
    prompt: "List the riskiest data sharing practices in this policy",
    icon: <Zap className="size-3.5" />,
  },
];

export function NewChatComposer() {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [jurisdiction, setJurisdiction] = useState<JurisdictionId>("cl");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headingIndex, setHeadingIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setHeadingIndex((i) => (i + 1) % HEADING_PROMPTS.length),
      4500,
    );
    return () => clearInterval(id);
  }, []);

  const startSession = useCallback(
    async (text?: string) => {
      const message = text ?? prompt;
      if (!message.trim()) return;
      setCreating(true);
      setError(null);
      try {
        const trimmed = message.trim();
        const res = await apiFetch("/api/managed-agents/session", {
          method: "POST",
          body: JSON.stringify({ text: trimmed, jurisdiction }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(
            (body as { error?: string }).error ?? "Failed to create session",
          );
          return;
        }
        const data = (await res.json()) as { id: string };
        setPrompt("");
        setPendingMessage(data.id, trimmed);
        router.push(`/chat/${data.id}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create session",
        );
      } finally {
        setCreating(false);
      }
    },
    [prompt, jurisdiction, router],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void startSession();
      }
    },
    [startSession],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void startSession();
    },
    [startSession],
  );

  const heading = HEADING_PROMPTS[headingIndex];
  const currentJuris = JURISDICTIONS.find((j) => j.id === jurisdiction)!;

  return (
    <div className="relative flex h-full items-center justify-center px-4 pb-20 md:px-8">
      <div className="w-full max-w-3xl">
        <div className="mb-2 flex items-center gap-3">
          <span
            className="live-pill"
            aria-label="Live status indicator"
          >
            <span className="live-dot" />
            <span style={{ color: "var(--ink-2)" }}>
              Lens · privacy auditor
            </span>
          </span>
        </div>

        <h1
          key={headingIndex}
          className="lens-h1 mb-12 animate-in fade-in slide-in-from-bottom-2 duration-500"
        >
          {heading[0]}{" "}
          <span className="ital" style={{ color: "var(--accent-deep)" }}>
            {heading[1]}
          </span>
          {heading[2] && <> {heading[2]}</>}.
        </h1>

        <form onSubmit={onSubmit}>
          <div className="lens-search">
            <Search
              className="size-4 shrink-0"
              style={{ color: "var(--muted-2)" }}
              aria-hidden
            />
            <textarea
              ref={inputRef}
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Paste a policy URL or describe what you want audited…"
              rows={1}
              disabled={creating}
              className="lens-search-input"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                el.style.overflow = el.scrollHeight > 160 ? "auto" : "hidden";
              }}
            />

            <label className="lens-juris" tabIndex={0}>
              <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                {currentJuris.flag}
              </span>
              <span style={{ fontWeight: 500 }}>{currentJuris.code}</span>
              <span style={{ color: "var(--muted-foreground)" }}>
                {currentJuris.law}
              </span>
              <ChevronDown
                className="size-3.5"
                style={{ color: "var(--muted-2)" }}
                aria-hidden
              />
              <span className="sr-only">Jurisdiction</span>
              <select
                value={jurisdiction}
                onChange={(e) =>
                  setJurisdiction(e.target.value as JurisdictionId)
                }
                disabled={creating}
                className="absolute inset-0 cursor-pointer opacity-0"
                style={{ width: "100%" }}
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.flag} {j.code} — {j.law}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              aria-label="Run audit"
              disabled={!prompt.trim() || creating}
              className="lens-audit-btn"
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <span>Audit</span>
                  <span className="lens-kbd" aria-hidden>
                    ⏎
                  </span>
                </>
              )}
            </button>
          </div>
        </form>

        {error && (
          <p
            className="mt-3 px-1 text-sm"
            style={{ color: "var(--red)" }}
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span
            className="mr-1 text-[13px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Try
          </span>
          {SUGGESTION_PILLS.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => {
                setPrompt(pill.prompt);
                inputRef.current?.focus();
              }}
              className="lens-chip"
            >
              {pill.icon}
              <span>{pill.label}</span>
            </button>
          ))}
        </div>

        <p
          className="mt-10 flex items-center gap-1.5 text-[12.5px]"
          style={{ color: "var(--muted-2)" }}
        >
          <span>Lens audits against Ley 21.719, GDPR, CCPA</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:opacity-80"
          >
            <GitHubIcon className="size-3.5" />
            source
          </a>
        </p>
      </div>
    </div>
  );
}
