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
  { id: "cl", flag: "🇨🇱", code: "CL", law: "Ley 21.719", readonly: false },
  { id: "eu", flag: "🇪🇺", code: "EU", law: "GDPR", readonly: true },
  { id: "us-ca", flag: "🇺🇸", code: "US-CA", law: "CCPA", readonly: true },
  { id: "br", flag: "🇧🇷", code: "BR", law: "LGPD", readonly: true },
] as const;
type JurisdictionId = Exclude<
  (typeof JURISDICTIONS)[number]["id"],
  "br" | "eu" | "us-ca"
>;

const MAX_PROMPT_HEIGHT = 160;

function resizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_PROMPT_HEIGHT)}px`;
  el.style.overflow = el.scrollHeight > MAX_PROMPT_HEIGHT ? "auto" : "hidden";
}

const HEADING_PROMPTS = [
  ["Audita una", "política", "de privacidad"],
  ["Revisa el", "cumplimiento", "de la Ley 21.719"],
  ["Encuentra el", "contacto", "del DPO"],
  ["Redacta una", "solicitud", "ARCO"],
  ["Detecta", "deficiencias", "legales"],
] as const;

const SUGGESTION_PILLS = [
  {
    label: "Auditar Evil Corp",
    prompt:
      "Audita la política de privacidad de Evil Corp en https://evil-corp.nilify.com/ e identifica incumplimientos concretos, citando la norma aplicable y fragmentos de la política.",
    icon: <Search className="size-3.5" />,
  },
  {
    label: "Auditar Mercado Libre",
    prompt:
      "Busca y audita la política de privacidad de Mercado Libre Chile. Revisa bases legales, transferencias internacionales, derechos ARCO y plazos de respuesta.",
    icon: <FileText className="size-3.5" />,
  },
  {
    label: "Auditar Uber",
    prompt:
      "Audita la política de privacidad de Uber para usuarios en Chile y señala riesgos sobre geolocalización, perfilamiento, retención y compartición con terceros.",
    icon: <Code className="size-3.5" />,
  },
  {
    label: "Pedir acceso",
    prompt:
      "Redacta una solicitud de acceso a mis datos personales para Spotify, pidiendo categorías de datos, finalidades, destinatarios, origen y plazo de conservación.",
    icon: <BookOpen className="size-3.5" />,
  },
  {
    label: "Eliminar datos",
    prompt:
      "Redacta una solicitud para eliminar mi cuenta y mis datos personales de Instagram, incluyendo revocación de consentimiento y oposición a marketing.",
    icon: <Sparkles className="size-3.5" />,
  },
  {
    label: "Opt-out CCPA",
    prompt:
      "Redacta una solicitud CCPA para The New York Times: no vender ni compartir mis datos, limitar datos sensibles y confirmar el cumplimiento por escrito.",
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

  useEffect(() => {
    if (inputRef.current) resizeTextarea(inputRef.current);
  }, [prompt]);

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
            (body as { error?: string }).error ?? "No se pudo crear la sesión",
          );
          return;
        }
        const data = (await res.json()) as { id: string };
        setPrompt("");
        setPendingMessage(data.id, trimmed);
        router.push(`/chat/${data.id}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "No se pudo crear la sesión",
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
            aria-label="Indicador de estado activo"
          >
            <span className="live-dot" />
            <span style={{ color: "var(--ink-2)" }}>
              Idesify - Lens · auditor de privacidad
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
              placeholder="Pega una URL o describe qué quieres auditar…"
              rows={1}
              disabled={creating}
              className="lens-search-input"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                resizeTextarea(e.currentTarget);
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
              <span className="sr-only">Jurisdicción</span>
              <select
                value={jurisdiction}
                onChange={(e) => {
                  const selected = JURISDICTIONS.find(
                    (j) => j.id === e.target.value,
                  );
                  if (selected && !selected.readonly) {
                    setJurisdiction(selected.id);
                  }
                }}
                disabled={creating}
                className="absolute inset-0 cursor-pointer opacity-0"
                style={{ width: "100%" }}
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j.id} value={j.id} disabled={j.readonly}>
                    {j.flag} {j.code} — {j.law}
                    {j.readonly ? " — próximamente" : ""}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              aria-label="Ejecutar auditoría"
              disabled={!prompt.trim() || creating}
              className="lens-audit-btn"
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <span>Auditar</span>
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
            Prueba
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
          <span>Idesify - Lens audita según Ley 21.719, GDPR y CCPA</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:opacity-80"
          >
            <GitHubIcon className="size-3.5" />
            código
          </a>
        </p>
      </div>
    </div>
  );
}
