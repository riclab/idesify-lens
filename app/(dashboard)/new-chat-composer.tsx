"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  BookOpen,
  Code,
  FileText,
  Loader2,
  Scale,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { GitHubIcon } from "@/components/icons";
import { setPendingMessage } from "@/lib/pending-message";
import { apiFetch } from "@/lib/anonymous-session";

const JURISDICTIONS = [
  { id: "cl", label: "Chile — Ley 21.719" },
  { id: "eu", label: "EU — GDPR" },
  { id: "us-ca", label: "California — CCPA" },
] as const;
type JurisdictionId = (typeof JURISDICTIONS)[number]["id"];

const HEADING_PROMPTS = [
  "Audit a privacy policy",
  "Check Ley 21.719 compliance",
  "Find DPO contact details",
  "Draft an ARCO rights request",
  "Spot legal deficiencies",
];

const SUGGESTION_PILLS = [
  { label: "Audit", prompt: "Audit this privacy policy for Ley 21.719 compliance", icon: <Search className="size-3.5" /> },
  { label: "Summarize", prompt: "Summarize the data collection practices described in this policy", icon: <FileText className="size-3.5" /> },
  { label: "Explain clauses", prompt: "Explain the most surprising clauses in this policy in plain language", icon: <Code className="size-3.5" /> },
  { label: "Find contact", prompt: "Find the Data Protection Officer contact for this company", icon: <BookOpen className="size-3.5" /> },
  { label: "Draft request", prompt: "Draft a data deletion request citing the relevant law", icon: <Sparkles className="size-3.5" /> },
  { label: "Risk check", prompt: "List the riskiest data sharing practices in this policy", icon: <Zap className="size-3.5" /> },
];

export function NewChatComposer() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [jurisdiction, setJurisdiction] = useState<JurisdictionId>("cl");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headingIndex, setHeadingIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setHeadingIndex((i) => (i + 1) % HEADING_PROMPTS.length),
      4000,
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

  return (
    <div className="relative flex h-full items-center justify-center px-4 pb-4 md:px-8 md:pb-8">
      <form onSubmit={onSubmit} className="w-full max-w-2xl space-y-5">
        <h1
          key={headingIndex}
          className="animate-in fade-in slide-in-from-bottom-2 mb-6 text-center text-2xl font-medium tracking-tight duration-500 md:text-3xl"
        >
          {HEADING_PROMPTS[headingIndex]}
        </h1>

        <div className="rounded-2xl border border-border bg-muted/30 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/20">
          <textarea
            ref={textareaRef}
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Paste a privacy policy URL or describe what you'd like to audit..."
            rows={2}
            disabled={creating}
            className="max-h-[160px] min-h-[72px] w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
          />

          <div className="flex items-center justify-between px-3 py-2.5">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 pl-2.5 pr-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground">
              <Scale className="size-3.5" />
              <span className="sr-only">Jurisdiction</span>
              <select
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value as JurisdictionId)}
                disabled={creating}
                className="cursor-pointer appearance-none bg-transparent pr-2 outline-none disabled:opacity-50"
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              aria-label="Send message"
              disabled={!prompt.trim() || creating}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-30"
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>

        {error && <p className="px-1 text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {SUGGESTION_PILLS.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => {
                setPrompt(pill.prompt);
                textareaRef.current?.focus();
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"
            >
              {pill.icon}
              {pill.label}
            </button>
          ))}
        </div>
      </form>

      <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-muted-foreground/40">
        Idesify Lens &middot; Privacy policy auditor &middot;{" "}
        <a
          href="https://github.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="align-middle transition-colors hover:text-muted-foreground"
        >
          <GitHubIcon className="inline size-4 align-middle" />
        </a>
      </p>
    </div>
  );
}
