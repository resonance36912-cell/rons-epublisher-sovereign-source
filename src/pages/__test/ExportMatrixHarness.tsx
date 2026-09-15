/**
 * Test harness route — exercises the export-format matrix
 * (PDF, HTML, MP4 with narration, MP4 without narration) across
 * free / standard / premium tiers without traversing real billing,
 * AI generation, or storage. Tier-gating rules mirror production:
 *
 *   PDF                 → all tiers
 *   HTML                → all tiers
 *   MP4 (no narration)  → standard and premium
 *   MP4 (with narration)→ premium only
 *
 * Each "export" button synthesizes a tiny in-memory blob and
 * triggers the same anchor-download codepath the real exports use,
 * so Playwright's page.waitForEvent("download") sees a real download.
 *
 * Failure modes (?error=…) mirror production guard messages so
 * E2E can verify graceful errors without faking AI failures:
 *   missing-storyboard → "No storyboard found. Generate a story before exporting."
 *   in-progress        → "A generation is in progress. Please wait for it to finish."
 *   tier-gated         → format-specific upgrade prompts
 *
 * Only registered in dev builds (gated in App.tsx).
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

type Tier = "free" | "standard" | "premium";
type Format = "pdf" | "html" | "mp4" | "mp4-narrated";
type ErrorMode = "none" | "missing-storyboard" | "in-progress";

const MIME: Record<Format, string> = {
  pdf: "application/pdf",
  html: "text/html",
  mp4: "video/mp4",
  "mp4-narrated": "video/mp4",
};

const FILENAME: Record<Format, string> = {
  pdf: "resonance-ebook.pdf",
  html: "resonance-ebook.html",
  mp4: "resonance-ebook.mp4",
  "mp4-narrated": "resonance-ebook-narrated.mp4",
};

const TIER_GATE_MESSAGE: Record<Format, string> = {
  pdf: "",
  html: "",
  mp4: "Video export requires the Standard or Premium plan.",
  "mp4-narrated": "Narrated video export requires the Premium plan.",
};

const ERROR_MESSAGES: Record<Exclude<ErrorMode, "none">, string> = {
  "missing-storyboard": "No storyboard found. Generate a story before exporting.",
  "in-progress": "A generation is in progress. Please wait for it to finish.",
};

// Production gating contract — kept in sync with useVisualBookExports.
function isTierAllowed(tier: Tier, format: Format): boolean {
  if (format === "pdf" || format === "html") return true;
  if (format === "mp4") return tier === "standard" || tier === "premium";
  if (format === "mp4-narrated") return tier === "premium";
  return false;
}

function buildBlob(format: Format): Blob {
  const payload = `resonance-test-export:${format}:${Date.now()}`;
  if (format === "pdf") {
    return new Blob([`%PDF-1.4\n${payload}\n%%EOF`], { type: MIME[format] });
  }
  if (format === "html") {
    return new Blob(
      [`<!doctype html><title>Resonance</title><p>${payload}</p>`],
      { type: MIME[format] },
    );
  }
  const ftyp = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
    0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
  ]);
  return new Blob([ftyp, payload], { type: MIME[format] });
}

function triggerDownload(format: Format) {
  const blob = buildBlob(format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = FILENAME[format];
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportMatrixHarness() {
  const [params] = useSearchParams();
  const tier = (params.get("tier") || "free") as Tier;
  const errorMode = (params.get("error") || "none") as ErrorMode;
  const [lastError, setLastError] = useState<string>("");
  const [lastMime, setLastMime] = useState<string>("");
  const [lastFilename, setLastFilename] = useState<string>("");

  const buttons = useMemo(
    () =>
      (["pdf", "html", "mp4", "mp4-narrated"] as Format[]).map((format) => {
        const tierOk = isTierAllowed(tier, format);
        // When a non-tier error is active, no format can export.
        const allowed = tierOk && errorMode === "none";
        const handleClick = () => {
          if (!tierOk) {
            setLastError(TIER_GATE_MESSAGE[format]);
            return;
          }
          if (errorMode !== "none") {
            setLastError(ERROR_MESSAGES[errorMode]);
            return;
          }
          setLastError("");
          setLastMime(MIME[format]);
          setLastFilename(FILENAME[format]);
          triggerDownload(format);
        };
        return (
          <button
            key={format}
            type="button"
            data-testid={`export-${format}`}
            data-allowed={allowed ? "true" : "false"}
            data-tier-allowed={tierOk ? "true" : "false"}
            // Tier-gated buttons stay disabled (matches prod). Other-error
            // buttons stay clickable so the error message can surface.
            disabled={!tierOk}
            onClick={handleClick}
            className="px-4 py-2 m-2 rounded border disabled:opacity-50"
          >
            Export {format}
          </button>
        );
      }),
    [tier, errorMode],
  );

  return (
    <div
      data-testid="export-matrix-harness"
      data-tier={tier}
      data-error-mode={errorMode}
      data-last-mime={lastMime}
      data-last-filename={lastFilename}
      data-ready="true"
      className="container px-4 py-8"
    >
      <h1 className="text-xl font-semibold mb-4">Export matrix harness</h1>
      <p className="text-sm text-muted-foreground mb-2">Tier: {tier}</p>
      <p className="text-sm text-muted-foreground mb-4">Error mode: {errorMode}</p>
      <div>{buttons}</div>
      {/* Tier-gated reasons rendered up front so screen-readers + tests
          can read them without clicking. */}
      <ul data-testid="tier-gate-reasons" className="mt-4 text-sm">
        {(["mp4", "mp4-narrated"] as Format[]).map((f) =>
          !isTierAllowed(tier, f) ? (
            <li key={f} data-testid={`tier-gate-${f}`} role="note">
              {TIER_GATE_MESSAGE[f]}
            </li>
          ) : null,
        )}
      </ul>
      {lastError && (
        <div
          data-testid="export-error"
          role="alert"
          className="mt-4 p-3 rounded border border-destructive text-destructive"
        >
          {lastError}
        </div>
      )}
    </div>
  );
}
