import { readFileSync } from "node:fs";
import { join } from "node:path";

export const JURISDICTIONS = ["cl", "eu", "us-ca"] as const;
export type JurisdictionId = (typeof JURISDICTIONS)[number];
export const DEFAULT_JURISDICTION: JurisdictionId = "cl";

export type Law = {
  id: JurisdictionId;
  label: string;
  shortName: string;
  text: string;
};

const LAW_FILES: Record<JurisdictionId, { label: string; shortName: string; path: string }> = {
  cl: {
    label: "Chile — Ley 21.719",
    shortName: "Ley 21.719",
    path: "laws/cl/CL-1209272.md",
  },
  eu: {
    label: "European Union — GDPR",
    shortName: "GDPR",
    path: "laws/eu/gdpr/CELEX_32016R0679_EN_TXT.md",
  },
  "us-ca": {
    label: "California — CCPA",
    shortName: "CCPA",
    path: "laws/us/ca/20260101_ccpa_statute.md",
  },
};

const LAWS: Record<JurisdictionId, Law> = (() => {
  const out = {} as Record<JurisdictionId, Law>;
  for (const id of JURISDICTIONS) {
    const meta = LAW_FILES[id];
    out[id] = {
      id,
      label: meta.label,
      shortName: meta.shortName,
      text: readFileSync(join(process.cwd(), meta.path), "utf8"),
    };
  }
  return out;
})();

export function getLaw(id: JurisdictionId): Law {
  return LAWS[id];
}

export function isJurisdiction(value: unknown): value is JurisdictionId {
  return typeof value === "string" && (JURISDICTIONS as readonly string[]).includes(value);
}

export function listJurisdictions(): Array<Pick<Law, "id" | "label" | "shortName">> {
  return JURISDICTIONS.map((id) => ({
    id,
    label: LAWS[id].label,
    shortName: LAWS[id].shortName,
  }));
}
