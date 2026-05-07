"use client";

import { useEffect, useState } from "react";
import { CL_EXCERPTS, type LawExcerpt } from "@/lib/law-excerpts";

const ROTATE_MS = 9000;
const FADE_MS = 400;

export function LawTicker({
  excerpts = CL_EXCERPTS,
  jurisdictionLabel = "Ley 21.719",
}: {
  excerpts?: LawExcerpt[];
  jurisdictionLabel?: string;
}) {
  const [index, setIndex] = useState(() =>
    excerpts.length > 0 ? Math.floor(Math.random() * excerpts.length) : 0,
  );
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (excerpts.length <= 1) return;
    const interval = setInterval(() => {
      setVisible(false);
      const swap = setTimeout(() => {
        setIndex((i) => (i + 1) % excerpts.length);
        setVisible(true);
      }, FADE_MS);
      return () => clearTimeout(swap);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, [excerpts.length]);

  if (excerpts.length === 0) return null;
  const current = excerpts[index];

  return (
    <div
      className="lens-panel mt-3 px-4 py-3"
      role="note"
      aria-label="Mientras analizamos"
      style={{ background: "var(--secondary)" }}
    >
      <div
        className="mb-1.5 text-[10.5px] uppercase tracking-[0.1em]"
        style={{ color: "var(--muted-foreground)", fontWeight: 500 }}
      >
        Mientras analizamos · {jurisdictionLabel}
      </div>
      <div
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease-out`,
        }}
      >
        <p
          className="text-[13.5px] leading-snug"
          style={{ color: "var(--foreground)" }}
        >
          {current.text}
        </p>
        <p
          className="lens-cite mt-1.5"
          style={{ fontSize: 11, color: "var(--muted-foreground)" }}
        >
          {current.cite}
        </p>
      </div>
    </div>
  );
}
