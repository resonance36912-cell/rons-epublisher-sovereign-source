import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardrail tests for the eBook narration export contract.
 *
 * Background: A previous bug embedded silent WebM blobs into the exported
 * HTML when ElevenLabs was unavailable, because `synthesizeBrowserTtsBlob()`
 * recorded `speechSynthesis` via MediaStreamDestination — which captures only
 * silence on every major browser. The fix:
 *   1. On ElevenLabs failure/quota, return an empty Blob (no fake <audio>).
 *   2. Always emit `data-body="..."` on every chapter.
 *   3. The exported player falls back to live SpeechSynthesisUtterance when
 *      no <audio> tag is present for the current chapter.
 *
 * These tests pin those invariants so the silent-narration regression
 * cannot return without an explicit code change here.
 */

const SOURCE = readFileSync(
  resolve(__dirname, "../useVisualBookExports.ts"),
  "utf8",
);

describe("eBook export narration contract", () => {
  it("does NOT call synthesizeBrowserTtsBlob in the ElevenLabs fallback branch", () => {
    // The fallback used to call synthesizeBrowserTtsBlob and embed the result.
    // Now the only legal use of that helper is the primary browser-TTS path.
    const start = SOURCE.indexOf("isQuotaOrFallback");
    const raw = SOURCE.slice(start, SOURCE.indexOf("throw err;", start));
    // Strip line and block comments so historical references in explanatory
    // comments don't trip the regression check.
    const fallbackBlock = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(fallbackBlock).not.toMatch(/synthesizeBrowserTtsBlob\(/);
    expect(fallbackBlock).toMatch(/new Blob\(\[\], \{ type: "audio\/webm" \}\)/);
  });

  it("emits a data-body attribute on every chapter", () => {
    // bodyAttr must be unconditional (no `hasRealAudio ? … : …` around it).
    expect(SOURCE).toMatch(
      /const bodyAttr = ` data-body="\$\{escapeHtml\(ch\.body\)\.replace\(\/\\n\/g, " "\)\}"`/,
    );
    // And it must be interpolated into the chapter <div> markup.
    const chaptersHtmlSection = SOURCE.slice(
      SOURCE.indexOf("const chaptersHtml = chapterData.map"),
      SOURCE.indexOf("}).join(\"\\n\");", SOURCE.indexOf("chapterData.map")),
    );
    const bodyAttrUsages = chaptersHtmlSection.match(/\$\{bodyAttr\}/g) ?? [];
    expect(bodyAttrUsages.length).toBeGreaterThanOrEqual(3); // default + side + overlay
  });

  it("only emits <audio> when real audio bytes exist", () => {
    expect(SOURCE).toMatch(
      /const hasRealAudio = !useBrowserTts && !!ch\.audioDataUri;/,
    );
    expect(SOURCE).toMatch(
      /const audioTag = hasRealAudio \? `<audio id="audio\$\{i\}"/,
    );
    // Falsy branch must produce empty string, not a placeholder audio tag.
    expect(SOURCE).toMatch(/hasRealAudio \? `<audio[^`]+` : ""/);
  });

  it("ships a hybrid player that falls back to SpeechSynthesisUtterance", () => {
    expect(SOURCE).toMatch(/new SpeechSynthesisUtterance\(text\)/);
    // toggleAudio must branch on whether an <audio> element exists.
    expect(SOURCE).toMatch(/if\(a&&a\.src\)\{playRecorded\(a\)\}else\{playLive\(\)\}/);
    // getBody reads data-body first, with chapter-body textContent as a safety net.
    expect(SOURCE).toMatch(/ch\.getAttribute\('data-body'\)/);
  });

  it("counts live-speech chapters and surfaces an honest toast message", () => {
    expect(SOURCE).toMatch(/let liveSpeechChaptersCount = 0;/);
    expect(SOURCE).toMatch(/if \(!hasRealAudio\) liveSpeechChaptersCount\+\+;/);
    // Three distinct user-facing messages depending on coverage.
    expect(SOURCE).toMatch(/Premium narration was unavailable/);
    expect(SOURCE).toMatch(/have embedded premium narration; /);
    expect(SOURCE).toMatch(/embedded narration\. Open the HTML file/);
  });
});
