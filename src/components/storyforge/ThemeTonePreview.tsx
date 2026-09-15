import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, Sparkles, ArrowLeftRight, SplitSquareHorizontal } from "lucide-react";
import type { SlideChapter } from "./StoryForgeContext";

/** Word-level LCS diff producing tokens marked as equal / added / removed. */
export type DiffTok = { type: "eq" | "add" | "rem"; text: string };
export function wordDiff(a: string, b: string): DiffTok[] {
  const A = a.split(/(\s+)/).filter(Boolean);
  const B = b.split(/(\s+)/).filter(Boolean);
  const n = A.length, m = B.length;
  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffTok[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ type: "eq", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "rem", text: A[i] }); i++; }
    else { out.push({ type: "add", text: B[j] }); j++; }
  }
  while (i < n) { out.push({ type: "rem", text: A[i++] }); }
  while (j < m) { out.push({ type: "add", text: B[j++] }); }
  return out;
}


/**
 * Live, client-side preview of how the selected theme & tone will shape the
 * storybook. Updates instantly when the user picks a different theme/tone —
 * no AI calls, no regeneration required. Purely presentational hints so the
 * user can compare options before committing to a rewrite.
 */

type ThemeStyle = {
  label: string;
  accent: string; // hsl token reference
  bgGradient: string;
  font: string;
  vocabulary: string;
  pacing: string;
  sampleOpening: (topic: string) => string;
};

export const THEME_STYLES: Record<string, ThemeStyle> = {
  autobiography: {
    label: "Autobiography",
    accent: "hsl(28 80% 55%)",
    bgGradient: "linear-gradient(135deg, hsl(28 80% 55% / 0.12), hsl(14 70% 45% / 0.08))",
    font: "'Lora', Georgia, serif",
    vocabulary: "Personal, reflective, intimate first-person voice",
    pacing: "Slow, contemplative — memories unfold scene by scene",
    sampleOpening: (t) => `I still remember the first time ${t.toLowerCase() || "it"} entered my life.`,
  },
  documentary: {
    label: "Documentary",
    accent: "hsl(200 85% 50%)",
    bgGradient: "linear-gradient(135deg, hsl(200 85% 50% / 0.12), hsl(220 70% 45% / 0.08))",
    font: "'Inter', system-ui, sans-serif",
    vocabulary: "Factual, observational, evidence-led",
    pacing: "Steady, chronological — facts then implications",
    sampleOpening: (t) => `In a world increasingly shaped by ${t.toLowerCase() || "change"}, the evidence is clear.`,
  },
  scientific: {
    label: "Scientific",
    accent: "hsl(160 70% 40%)",
    bgGradient: "linear-gradient(135deg, hsl(160 70% 40% / 0.12), hsl(190 70% 40% / 0.08))",
    font: "'IBM Plex Sans', sans-serif",
    vocabulary: "Precise terminology, hypothesis-driven, citations",
    pacing: "Methodical — observation, analysis, conclusion",
    sampleOpening: (t) => `Recent research into ${t.toLowerCase() || "this domain"} reveals patterns previously overlooked.`,
  },
  fantasy: {
    label: "Fantasy",
    accent: "hsl(280 70% 60%)",
    bgGradient: "linear-gradient(135deg, hsl(280 70% 60% / 0.15), hsl(320 60% 50% / 0.10))",
    font: "'Cormorant Garamond', serif",
    vocabulary: "Mythic, evocative imagery, archaic flourishes",
    pacing: "Lyrical — long sentences with grand turning points",
    sampleOpening: (t) => `Long before the age of ${t.toLowerCase() || "men"}, in a realm scarce remembered…`,
  },
  thriller: {
    label: "Thriller",
    accent: "hsl(0 75% 50%)",
    bgGradient: "linear-gradient(135deg, hsl(0 75% 50% / 0.12), hsl(345 65% 35% / 0.10))",
    font: "'Inter', sans-serif",
    vocabulary: "Sharp, urgent, sensory — short hard verbs",
    pacing: "Fast, choppy — cliffhangers at every chapter end",
    sampleOpening: (t) => `Three seconds. That was all ${t.toLowerCase() || "she"} had left.`,
  },
  motivation: {
    label: "Motivation",
    accent: "hsl(45 95% 55%)",
    bgGradient: "linear-gradient(135deg, hsl(45 95% 55% / 0.15), hsl(25 85% 55% / 0.10))",
    font: "'Outfit', sans-serif",
    vocabulary: "Direct, second-person, action verbs",
    pacing: "Punchy — each chapter ends with a call to act",
    sampleOpening: (t) => `Imagine waking up tomorrow already mastering ${t.toLowerCase() || "your next chapter"}.`,
  },
  professional: {
    label: "Professional",
    accent: "hsl(215 60% 40%)",
    bgGradient: "linear-gradient(135deg, hsl(215 60% 40% / 0.12), hsl(220 30% 50% / 0.08))",
    font: "'IBM Plex Sans', sans-serif",
    vocabulary: "Polished business prose, frameworks, KPIs",
    pacing: "Structured — executive summary, body, takeaways",
    sampleOpening: (t) => `Organisations that master ${t.toLowerCase() || "this discipline"} consistently outperform their peers.`,
  },
  adventure: {
    label: "Adventure",
    accent: "hsl(95 55% 40%)",
    bgGradient: "linear-gradient(135deg, hsl(95 55% 40% / 0.12), hsl(35 70% 45% / 0.10))",
    font: "'Lora', serif",
    vocabulary: "Active, exploratory, geographical detail",
    pacing: "Brisk — momentum carries scene to scene",
    sampleOpening: (t) => `The trail toward ${t.toLowerCase() || "the unknown"} began where the maps ended.`,
  },
  poetic: {
    label: "Poetic",
    accent: "hsl(310 50% 55%)",
    bgGradient: "linear-gradient(135deg, hsl(310 50% 55% / 0.12), hsl(260 50% 55% / 0.10))",
    font: "'Cormorant Garamond', serif",
    vocabulary: "Metaphor-rich, sensory, rhythmic",
    pacing: "Breath-led — short lines, deliberate pauses",
    sampleOpening: (t) => `${(t || "It").charAt(0).toUpperCase() + (t || "It").slice(1)} — a word that holds the weight of an entire sky.`,
  },
  philosophical: {
    label: "Philosophical",
    accent: "hsl(240 30% 45%)",
    bgGradient: "linear-gradient(135deg, hsl(240 30% 45% / 0.12), hsl(260 30% 40% / 0.10))",
    font: "'Lora', serif",
    vocabulary: "Abstract, dialectical, question-led",
    pacing: "Reflective — propositions interrogated then refined",
    sampleOpening: (t) => `What does it truly mean to confront ${t.toLowerCase() || "the unknown"}?`,
  },
  emotional: {
    label: "Emotional",
    accent: "hsl(340 70% 55%)",
    bgGradient: "linear-gradient(135deg, hsl(340 70% 55% / 0.12), hsl(15 65% 55% / 0.10))",
    font: "'Lora', serif",
    vocabulary: "Vulnerable, sensory, heart-led",
    pacing: "Wave-like — tension, release, return",
    sampleOpening: (t) => `Some things — like ${t.toLowerCase() || "this"} — change you in ways you can never unfeel.`,
  },
};

export const TONE_STYLES: Record<string, { label: string; description: string; transform: (s: string) => string }> = {
  professional: {
    label: "Professional",
    description: "Measured, neutral register suitable for business and reports.",
    transform: (s) => s.replace(/!+/g, ".").replace(/\b(gonna|wanna)\b/gi, (m) => (m.toLowerCase() === "gonna" ? "going to" : "want to")),
  },
  conversational: {
    label: "Conversational",
    description: "Warm and approachable, as if speaking with a friend.",
    transform: (s) => s.replace(/\bdo not\b/g, "don't").replace(/\bcannot\b/g, "can't").replace(/\bit is\b/g, "it's"),
  },
  academic: {
    label: "Academic",
    description: "Formal, hedged, evidence-anchored prose.",
    transform: (s) => `Notably, ${s.charAt(0).toLowerCase()}${s.slice(1)}`,
  },
  dramatic: {
    label: "Dramatic",
    description: "High-stakes, vivid imagery, strong contrasts.",
    transform: (s) => s.replace(/\.$/, "…") + " — and nothing would ever be the same.",
  },
  inspirational: {
    label: "Inspirational",
    description: "Uplifting, forward-looking, you-focused.",
    transform: (s) => `${s} You can build on this.`,
  },
};

export function excerpt(text: string, max = 240): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

export function ThemeTonePreview({
  theme,
  tone,
  topic,
  chapters,
}: {
  theme: string;
  tone: string;
  topic: string;
  chapters: SlideChapter[];
}) {
  const themeStyle = THEME_STYLES[theme] || THEME_STYLES.documentary;
  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.professional;

  const [viewMode, setViewMode] = useState<"diff" | "split">("diff");
  const [intensity, setIntensity] = useState<number>(100); // 0–100 %

  const samples = useMemo(() => {
    const list = chapters.length ? chapters : [{ title: "Chapter One", body: "" } as SlideChapter];
    const ratio = Math.max(0, Math.min(1, intensity / 100));
    return list.map((ch, idx) => {
      const baseBody = ch?.body?.trim() || themeStyle.sampleOpening(topic || ch?.title || "your subject");
      const opening = themeStyle.sampleOpening(topic || ch?.title || "your subject");
      const before = excerpt(baseBody, 200);
      const fullAfter = toneStyle.transform(before);
      const fullDiff = wordDiff(before, fullAfter);

      // Count change "ops" — a removal+addition pair counts as one op; lone add or rem also one.
      // Walk diff, group consecutive rem/add runs as a single op.
      type Op = { remStart: number; remEnd: number; addStart: number; addEnd: number };
      const ops: Op[] = [];
      let i = 0;
      while (i < fullDiff.length) {
        if (fullDiff[i].type === "eq") { i++; continue; }
        const remStart = i;
        while (i < fullDiff.length && fullDiff[i].type === "rem") i++;
        const remEnd = i;
        const addStart = i;
        while (i < fullDiff.length && fullDiff[i].type === "add") i++;
        const addEnd = i;
        ops.push({ remStart, remEnd, addStart, addEnd });
      }
      const applyCount = Math.round(ops.length * ratio);
      const applied = new Set<number>();
      for (let k = 0; k < applyCount; k++) applied.add(k);

      // Rebuild text & diff respecting intensity
      const outParts: string[] = [];
      const partialDiff: DiffTok[] = [];
      let cursor = 0;
      ops.forEach((op, k) => {
        // emit any equal tokens between cursor and op.remStart
        for (let t = cursor; t < op.remStart; t++) {
          outParts.push(fullDiff[t].text);
          partialDiff.push(fullDiff[t]);
        }
        if (applied.has(k)) {
          // skip rems, emit adds
          for (let t = op.remStart; t < op.remEnd; t++) partialDiff.push(fullDiff[t]);
          for (let t = op.addStart; t < op.addEnd; t++) {
            outParts.push(fullDiff[t].text);
            partialDiff.push(fullDiff[t]);
          }
        } else {
          // keep original rems, drop adds
          for (let t = op.remStart; t < op.remEnd; t++) {
            outParts.push(fullDiff[t].text);
            partialDiff.push({ type: "eq", text: fullDiff[t].text });
          }
        }
        cursor = op.addEnd;
      });
      for (let t = cursor; t < fullDiff.length; t++) {
        outParts.push(fullDiff[t].text);
        partialDiff.push(fullDiff[t]);
      }

      return {
        idx,
        title: ch?.title || `Chapter ${idx + 1}`,
        opening,
        before,
        after: outParts.join(""),
        diff: partialDiff,
        totalOps: ops.length,
        appliedOps: applyCount,
      };
    });
  }, [chapters, topic, themeStyle, toneStyle, intensity]);

  // Unique key forces a subtle re-animation whenever theme/tone changes.
  const animKey = `${theme}::${tone}`;

  return (
    <div className="rounded-xl border bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Eye className="w-3.5 h-3.5" />
          Live style preview
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="w-3 h-3 text-primary" />
          Updates as you change Theme or Tone
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={animKey}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="p-5 space-y-4"
          style={{ background: themeStyle.bgGradient }}
        >
          {/* Descriptor row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-background/70 backdrop-blur-sm border p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: themeStyle.accent }}
                  aria-hidden
                />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Theme</span>
                <span className="text-xs font-semibold ml-auto">{themeStyle.label}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Vocabulary:</span> {themeStyle.vocabulary}
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground mt-1">
                <span className="font-medium text-foreground">Pacing:</span> {themeStyle.pacing}
              </p>
            </div>
            <div className="rounded-lg bg-background/70 backdrop-blur-sm border p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" aria-hidden />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Tone</span>
                <span className="text-xs font-semibold ml-auto">{toneStyle.label}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{toneStyle.description}</p>
            </div>
          </div>

          {/* View mode toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Before vs after across {samples.length} chapter{samples.length === 1 ? "" : "s"}
            </span>
            <div className="inline-flex rounded-md border bg-background/60 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setViewMode("diff")}
                className={`px-2 py-1 rounded-sm inline-flex items-center gap-1 transition-colors ${
                  viewMode === "diff" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"
                }`}
              >
                <ArrowLeftRight className="w-3 h-3" /> Inline diff
              </button>
              <button
                type="button"
                onClick={() => setViewMode("split")}
                className={`px-2 py-1 rounded-sm inline-flex items-center gap-1 transition-colors ${
                  viewMode === "split" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"
                }`}
              >
                <SplitSquareHorizontal className="w-3 h-3" /> Side-by-side
              </button>
            </div>
          </div>

          {/* Intensity slider */}
          <div className="rounded-lg border bg-background/60 px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="tone-intensity" className="text-[11px] font-medium text-foreground inline-flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" style={{ color: themeStyle.accent }} />
                Preview intensity
              </label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {intensity}% · {samples[0]?.appliedOps ?? 0}/{samples[0]?.totalOps ?? 0} edits
              </span>
            </div>
            <input
              id="tone-intensity"
              type="range"
              min={0}
              max={100}
              step={5}
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-muted accent-primary"
              style={{ accentColor: themeStyle.accent }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>Original</span>
              <span>Subtle</span>
              <span>Balanced</span>
              <span>Full {toneStyle.label}</span>
            </div>
          </div>


          {/* Per-chapter sample list rendered with theme styling */}
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {samples.map((s) => (
              <div
                key={s.idx}
                className="rounded-lg bg-background/85 backdrop-blur-sm border-l-4 px-5 py-4 shadow-sm"
                style={{ borderLeftColor: themeStyle.accent, fontFamily: themeStyle.font }}
              >
                <div
                  className="text-[10px] uppercase tracking-[0.2em] mb-1.5 font-semibold"
                  style={{ color: themeStyle.accent }}
                >
                  Sample · Chapter {s.idx + 1}
                </div>
                <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: themeStyle.font }}>
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed text-foreground/90 italic mb-3">
                  {s.opening}
                </p>

                {viewMode === "split" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-md border border-dashed bg-muted/30 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
                        Before · Original
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/75">{s.before}</p>
                    </div>
                    <div
                      className="rounded-md border p-3"
                      style={{ borderColor: themeStyle.accent + "55", background: themeStyle.accent + "0d" }}
                    >
                      <div
                        className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold"
                        style={{ color: themeStyle.accent }}
                      >
                        After · {themeStyle.label} / {toneStyle.label}
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/90">{s.after}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border bg-background/60 p-3">
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
                      <span>Inline diff</span>
                      <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                        <span className="inline-block w-2 h-2 rounded-sm bg-destructive/30 border border-destructive/40" />
                        removed
                      </span>
                      <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                        <span
                          className="inline-block w-2 h-2 rounded-sm border"
                          style={{ background: themeStyle.accent + "33", borderColor: themeStyle.accent + "66" }}
                        />
                        added
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
                      {s.diff.map((tok, i) => {
                        if (tok.type === "eq") return <span key={i}>{tok.text}</span>;
                        if (tok.type === "rem")
                          return (
                            <span
                              key={i}
                              className="bg-destructive/15 text-destructive/90 line-through rounded-sm px-0.5"
                            >
                              {tok.text}
                            </span>
                          );
                        return (
                          <span
                            key={i}
                            className="rounded-sm px-0.5"
                            style={{ background: themeStyle.accent + "26", color: themeStyle.accent }}
                          >
                            {tok.text}
                          </span>
                        );
                      })}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            This is a stylistic preview only. Click <span className="font-medium text-foreground">Rewrite all chapters</span> to apply the new theme &amp; tone to the full storybook.
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
