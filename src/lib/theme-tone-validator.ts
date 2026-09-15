/**
 * Heuristic theme & tone validator.
 *
 * Scans every chapter body against a small lexicon of words / patterns that
 * strongly clash with the selected `theme` and `tone`. Also flags chapters
 * that are statistical outliers in casualness or sentence rhythm — a soft
 * signal that the voice has drifted across the storybook.
 *
 * Pure, deterministic, client-side. No AI calls.
 */

import type { SlideChapter } from "@/components/storyforge/StoryForgeContext";

export type ValidationSeverity = "warning" | "info";

export type ValidationIssue = {
  /** Chapter id, or "global" for cross-chapter issues. */
  chapterId: string;
  chapterIndex: number; // 1-based for display; -1 for global
  chapterTitle: string;
  severity: ValidationSeverity;
  category: "theme" | "tone" | "consistency";
  message: string;
  /** Optional matched snippet for context. */
  snippet?: string;
};

type Lexicon = {
  /** Words/phrases that clash with this theme. Lowercase, matched as whole-words. */
  clashes: string[];
};

const THEME_CLASHES: Record<string, Lexicon> = {
  fantasy: { clashes: ["data shows", "research indicates", "peer-reviewed", "p-value", "regression", "kpi", "roi", "stakeholder"] },
  scientific: { clashes: ["magic", "wizard", "dragon", "spell", "enchanted", "fairy", "prophecy", "destiny"] },
  documentary: { clashes: ["magic", "wizard", "dragon", "spell", "fairy tale", "once upon a time"] },
  professional: { clashes: ["lol", "omg", "wtf", "magic", "dragon", "wizard", "fairy"] },
  autobiography: { clashes: ["fictional", "made-up", "imaginary character"] },
  thriller: { clashes: ["peaceful afternoon", "gentle breeze", "carefree", "lighthearted"] },
  motivation: { clashes: ["hopeless", "pointless", "give up", "futile", "doomed"] },
  poetic: { clashes: ["kpi", "roi", "stakeholder", "deliverable", "synergy"] },
  philosophical: { clashes: ["lol", "omg", "kpi", "deliverable"] },
  emotional: { clashes: ["kpi", "roi", "stakeholder", "deliverable", "synergy"] },
  adventure: { clashes: ["peer-reviewed", "regression analysis", "p-value"] },
};

const TONE_CLASHES: Record<string, Lexicon> = {
  professional: { clashes: ["lol", "omg", "wtf", "lmao", "kinda", "gonna", "wanna", "ya know", "sorta"] },
  academic: { clashes: ["lol", "omg", "wtf", "lmao", "kinda", "gonna", "wanna", "super cool", "awesome", "hella"] },
  conversational: { clashes: ["heretofore", "notwithstanding", "aforementioned", "hereinafter", "wherewithal"] },
  dramatic: { clashes: ["meh", "whatever", "okay i guess", "no big deal"] },
  inspirational: { clashes: ["hopeless", "give up", "pointless", "futile", "worthless"] },
};

/** Casual lexical markers used for the cross-chapter consistency check. */
const CASUAL_MARKERS = [
  "lol", "omg", "wtf", "lmao", "kinda", "gonna", "wanna", "yeah",
  "okay", "ok", "sorta", "stuff", "things", "awesome", "cool",
];

function wholeWordRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // For multi-word phrases, fall back to substring match (still case-insensitive).
  if (/\s/.test(phrase)) return new RegExp(escaped, "i");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function matchSnippet(body: string, regex: RegExp): string | undefined {
  const m = body.match(regex);
  if (!m) return undefined;
  const idx = m.index ?? 0;
  const start = Math.max(0, idx - 25);
  const end = Math.min(body.length, idx + m[0].length + 25);
  let s = body.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < body.length) s = s + "…";
  return s;
}

function casualScore(body: string): number {
  if (!body) return 0;
  const words = body.toLowerCase().split(/\W+/).filter(Boolean);
  if (words.length === 0) return 0;
  let hits = 0;
  for (const w of words) if (CASUAL_MARKERS.includes(w)) hits++;
  // exclamations contribute mildly
  const exclamations = (body.match(/!/g) || []).length;
  return (hits + exclamations * 0.5) / words.length;
}

function avgSentenceLen(body: string): number {
  const sentences = body.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return 0;
  const wc = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  return wc.reduce((a, b) => a + b, 0) / wc.length;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function validateThemeAndTone(
  chapters: SlideChapter[],
  theme: string,
  tone: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!chapters || chapters.length === 0) return issues;

  const themeLex = THEME_CLASHES[theme];
  const toneLex = TONE_CLASHES[tone];

  chapters.forEach((ch, i) => {
    const body = `${ch.title || ""} ${ch.body || ""}`;
    if (!body.trim()) {
      issues.push({
        chapterId: ch.id, chapterIndex: i + 1, chapterTitle: ch.title || `Chapter ${i + 1}`,
        severity: "warning", category: "consistency",
        message: "Chapter is empty — preview will skip it.",
      });
      return;
    }

    if (themeLex) {
      for (const phrase of themeLex.clashes) {
        const re = wholeWordRegex(phrase);
        if (re.test(body)) {
          issues.push({
            chapterId: ch.id, chapterIndex: i + 1, chapterTitle: ch.title || `Chapter ${i + 1}`,
            severity: "warning", category: "theme",
            message: `Contains "${phrase}" — clashes with the "${theme}" theme.`,
            snippet: matchSnippet(body, re),
          });
        }
      }
    }

    if (toneLex) {
      for (const phrase of toneLex.clashes) {
        const re = wholeWordRegex(phrase);
        if (re.test(body)) {
          issues.push({
            chapterId: ch.id, chapterIndex: i + 1, chapterTitle: ch.title || `Chapter ${i + 1}`,
            severity: "warning", category: "tone",
            message: `Contains "${phrase}" — feels off for a "${tone}" tone.`,
            snippet: matchSnippet(body, re),
          });
        }
      }
    }
  });

  // ── Cross-chapter consistency: outliers in casual-ness / sentence length ──
  if (chapters.length >= 3) {
    const casualScores = chapters.map((c) => casualScore(c.body || ""));
    const sentenceLens = chapters.map((c) => avgSentenceLen(c.body || ""));
    const medCasual = median(casualScores);
    const medLen = median(sentenceLens);

    chapters.forEach((ch, i) => {
      if (casualScores[i] > Math.max(0.025, medCasual * 3) && casualScores[i] > 0.01) {
        issues.push({
          chapterId: ch.id, chapterIndex: i + 1, chapterTitle: ch.title || `Chapter ${i + 1}`,
          severity: "info", category: "consistency",
          message: "Notably more casual than the rest of the storybook.",
        });
      }
      if (medLen > 0 && (sentenceLens[i] < medLen * 0.5 || sentenceLens[i] > medLen * 1.8)) {
        issues.push({
          chapterId: ch.id, chapterIndex: i + 1, chapterTitle: ch.title || `Chapter ${i + 1}`,
          severity: "info", category: "consistency",
          message: `Sentence rhythm differs from the rest (~${sentenceLens[i].toFixed(0)} vs ~${medLen.toFixed(0)} words/sentence).`,
        });
      }
    });
  }

  return issues;
}

export function summariseIssues(issues: ValidationIssue[]): {
  warningCount: number;
  infoCount: number;
  affectedChapterIds: Set<string>;
} {
  const affected = new Set<string>();
  let w = 0, n = 0;
  for (const i of issues) {
    affected.add(i.chapterId);
    if (i.severity === "warning") w++;
    else n++;
  }
  return { warningCount: w, infoCount: n, affectedChapterIds: affected };
}
