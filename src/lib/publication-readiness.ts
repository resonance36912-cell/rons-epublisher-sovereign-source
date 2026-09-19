import type { SlideChapter, Source, StoryConfig } from "@/components/storyforge/StoryForgeContext";
import { validateThemeAndTone } from "@/lib/theme-tone-validator";

export type ReadinessSeverity = "critical" | "warning" | "info";
export type ReadinessCategory =
  | "source_integrity"
  | "attribution"
  | "factual_consistency"
  | "editorial_quality"
  | "structure"
  | "presentation"
  | "production";
export type ReadinessAutofix = "clean_transcript" | "split_paragraphs";

export type PublicationReadinessIssue = {
  id: string;
  category: ReadinessCategory;
  severity: ReadinessSeverity;
  title: string;
  message: string;
  suggestion: string;
  chapterId?: string;
  chapterIndex?: number;
  evidence?: string;
  autofix?: ReadinessAutofix;
};

export const READINESS_CATEGORY_LABELS: Record<ReadinessCategory, string> = {
  source_integrity: "Source integrity",
  attribution: "Attribution",
  factual_consistency: "Factual consistency",
  editorial_quality: "Editorial quality",
  structure: "Structure",
  presentation: "Presentation",
  production: "Production",
};

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function computeManuscriptRevision(chapters: SlideChapter[]): string {
  const canonical = chapters.map((ch) => [
    ch.id,
    (ch.title || "").trim(),
    (ch.body || "").replace(/\s+/g, " ").trim(),
    JSON.stringify(ch.evidenceClaims || []),
    ...(ch.references || []).map((ref) => ref.trim()),
  ].join("\u241f")).join("\u241e");
  return "rev-" + fnv1a(canonical) + "-" + chapters.length;
}

function evidenceSnippet(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match || match.index == null) return undefined;
  const start = Math.max(0, match.index - 55);
  const end = Math.min(text.length, match.index + match[0].length + 85);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

function normalizeTitle(title: string): string {
  return title.toLowerCase()
    .replace(/\s*[-—:]?\s*part\s+\d+\s*$/i, "")
    .replace(/\s*[-—:]?\s*chapter\s+\d+\s*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const TRANSCRIPT_ARTIFACT_RE = /\b(good\s+(?:morning|afternoon|evening)|welcome\s+(?:back|to)|you(?:'|’)re\s+listening\s+to|thanks?\s+for\s+having\s+me|our\s+next\s+guest|joining\s+us\s+(?:today|this\s+morning)|we(?:'|’)ll\s+be\s+right\s+back)\b/i;
const SPEAKER_LABEL_RE = /^(?:host|interviewer|guest|speaker\s*\d+|q|a)\s*:\s*/im;
const TIMECODE_RE = /(?:^|\n)\s*(?:\[)?\d{1,2}:\d{2}(?::\d{2})?(?:\])?\s*/m;
const SEARCH_PLACEHOLDER_RE = /^(?:search|query|google search|youtube search)\s*[:—-]|\bsite:[^\s]+\b/i;
const INTERVIEWER_MARKER_RE = /\b(my guest|welcome to|this week(?:'|’)s episode|tell me about|joining us today|the time is exactly)\b/i;
const SENSITIVE_CONTENT_RE = /\b(killed|murdered|death|died|violence|assault|abuse|suicide|cancer|diagnosed|minor|child(?:ren)? aged?)\b/i;

function ngramCoverage(text: string, source: string, size = 8): number {
  const words = text.toLowerCase().match(/[a-z0-9'’-]+/g) || [];
  const sourceWords = source.toLowerCase().match(/[a-z0-9'’-]+/g) || [];
  if (words.length < size || sourceWords.length < size) return 0;
  const sourceGrams = new Set<string>();
  for (let i = 0; i <= sourceWords.length - size; i += 1) sourceGrams.add(sourceWords.slice(i, i + size).join(" "));
  let matched = 0;
  let total = 0;
  for (let i = 0; i <= words.length - size; i += 1) {
    total += 1;
    if (sourceGrams.has(words.slice(i, i + size).join(" "))) matched += 1;
  }
  return total ? matched / total : 0;
}

function firstPersonSentenceRatio(text: string): number {
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return 0;
  const firstPerson = sentences.filter((s) => /\b(I|me|my|mine|myself|we|our|ours|us)\b/i.test(s)).length;
  return firstPerson / sentences.length;
}

function makeIssue(
  category: ReadinessCategory,
  severity: ReadinessSeverity,
  code: string,
  title: string,
  message: string,
  suggestion: string,
  extra: Partial<PublicationReadinessIssue> = {},
): PublicationReadinessIssue {
  return {
    id: category + ":" + (extra.chapterId || "global") + ":" + code,
    category, severity, title, message, suggestion, ...extra,
  };
}

function collectMilestoneAges(chapters: SlideChapter[]) {
  const out: Array<{ age: number; chapterIndex: number; context: string }> = [];
  const patterns = [
    /\b(?:started|founded|launched|began)\b.{0,120}?\b(?:at\s+(?:the\s+)?age\s+(?:of\s+)?|at\s+)(\d{1,2})\b/gi,
    /\b(?:at\s+(?:the\s+)?age\s+(?:of\s+)?|at\s+)(\d{1,2})\b.{0,120}?\b(?:started|founded|launched|began)\b/gi,
  ];
  chapters.forEach((ch, index) => {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ch.body || ""))) {
        const age = Number(m[1]);
        if (Number.isFinite(age) && age >= 10 && age <= 99) {
          out.push({ age, chapterIndex: index + 1, context: m[0].replace(/\s+/g, " ").trim() });
        }
      }
    }
  });
  return out;
}

function collectPossibleNameVariants(chapters: SlideChapter[], topic: string) {
  const topicTokens = new Set(String(topic || "").toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 3));
  const groups = new Map<string, Set<string>>();
  const examples = new Map<string, string[]>();
  const nameRe = /\b([A-Z][a-z]{2,})\s+([A-Z][A-Za-z'’-]{2,})\b/g;
  chapters.forEach((ch) => {
    let match: RegExpExecArray | null;
    nameRe.lastIndex = 0;
    while ((match = nameRe.exec(ch.body || ""))) {
      const first = match[1];
      const full = first + " " + match[2];
      const key = first.toLowerCase();
      const variants = groups.get(key) || new Set<string>();
      variants.add(full);
      groups.set(key, variants);
      const sample = examples.get(key) || [];
      if (!sample.includes(full)) sample.push(full);
      examples.set(key, sample);
    }
  });
  return Array.from(groups.entries())
    .filter(([first, variants]) => variants.size > 1 && (topicTokens.has(first) || variants.size >= 3))
    .map(([first, variants]) => ({ first, variants: Array.from(variants), examples: examples.get(first) || [] }));
}

export function analysePublicationReadiness(
  chapters: SlideChapter[],
  sources: Source[],
  config: StoryConfig,
): PublicationReadinessIssue[] {
  const issues: PublicationReadinessIssue[] = [];
  const readySources = (sources || []).filter((s) => s.status === "ready" && !!s.content?.trim());
  const evidenceRequired = config.researchBasis !== "topic_only";

  if (evidenceRequired && readySources.length === 0) {
    issues.push(makeIssue(
      "source_integrity", "critical", "no-usable-evidence", "No usable evidence sources",
      "The manuscript is marked as evidence-grounded, but no ready source contains usable content.",
      "Return to Sources and verify at least one source before publication.",
    ));
  }

  for (const source of sources || []) {
    if (source.type === "search" && !source.url && !source.canonicalUrl) {
      issues.push(makeIssue(
        "source_integrity", "warning", "search-placeholder-" + source.id, "Search result is not a citable source",
        "“" + source.title + "” is retained as a search record without a canonical source location.",
        "Open or replace the search result with the actual article, recording, video, or document.",
        { evidence: source.title },
      ));
    }
    if ((source.type === "url" || source.type === "search") && source.status === "ready" && source.verified === false) {
      issues.push(makeIssue(
        "source_integrity", "warning", "unverified-" + source.id, "Source could not be independently verified",
        "“" + source.title + "” has extracted content but is marked unverified.",
        "Re-open the source or retain explicit attribution and an unverified-source warning.",
      ));
    }
  }

  const currentRevision = computeManuscriptRevision(chapters);
  if (config.approvedManuscriptRevision && config.approvedManuscriptRevision !== currentRevision) {
    issues.push(makeIssue(
      "production", "warning", "approval-stale", "Narration approval is out of date",
      "The manuscript changed after the revision approved for narration/audiovisual production.",
      "Review the changes and approve the current manuscript revision again before generating audiovisual output.",
    ));
  }

  if (
    config.publicationType === "autobiography"
    && config.narrativePerspective === "first_person"
    && !config.firstPersonSubjectApproved
  ) {
    issues.push(makeIssue(
      "attribution", "critical", "first-person-unapproved", "First-person autobiography requires subject approval",
      "Third-party interview material must not be silently converted into the subject’s memories or first-person voice.",
      "Obtain subject approval or switch to third-person biography/profile narration.",
    ));
  }

  const baseTitles = new Map<string, string>();
  chapters.forEach((ch, index) => {
    const body = ch.body || "";
    const base = normalizeTitle(ch.title || "");
    if (base) {
      const previous = baseTitles.get(base);
      if (previous && previous !== ch.id) {
        issues.push(makeIssue(
          "structure", "warning", "duplicate-title", "Chapter title is not editorially distinct",
          "“" + ch.title + "” repeats the same base title as an earlier chapter.",
          "Rename the chapter around its specific theme, period, or development.",
          { chapterId: ch.id, chapterIndex: index + 1, evidence: ch.title },
        ));
      } else baseTitles.set(base, ch.id);
    }

    if (/\bpart\s+\d+\s*$/i.test(ch.title || "")) {
      issues.push(makeIssue(
        "structure", "warning", "part-title", "Generic “Part N” chapter title",
        "“" + ch.title + "” describes sequence rather than content.",
        "Use a chapter heading that identifies the chapter’s actual subject or development.",
        { chapterId: ch.id, chapterIndex: index + 1, evidence: ch.title },
      ));
    }

    const transcriptMatch = body.match(TRANSCRIPT_ARTIFACT_RE) || body.match(SPEAKER_LABEL_RE) || body.match(TIMECODE_RE);
    if (transcriptMatch) {
      const matchedRe = TRANSCRIPT_ARTIFACT_RE.test(body)
        ? TRANSCRIPT_ARTIFACT_RE
        : SPEAKER_LABEL_RE.test(body) ? SPEAKER_LABEL_RE : TIMECODE_RE;
      issues.push(makeIssue(
        "editorial_quality", "critical", "transcript-artifact", "Transcript/broadcast material remains in manuscript prose",
        "The chapter still contains interview or broadcast formatting that should be transformed before publication.",
        "Apply transcript cleanup, then edit the passage into source-grounded narrative prose with explicit attribution where needed.",
        { chapterId: ch.id, chapterIndex: index + 1, evidence: evidenceSnippet(body, matchedRe), autofix: "clean_transcript" },
      ));
    }

    if (INTERVIEWER_MARKER_RE.test(body)) {
      issues.push(makeIssue(
        "editorial_quality", "critical", "interviewer-marker", "Interviewer language leaked into the chapter",
        "The manuscript contains interviewer or programme markers that are incompatible with finished narrative prose.",
        "Remove the interviewer framing or convert it into explicit attribution before publication.",
        { chapterId: ch.id, chapterIndex: index + 1, evidence: evidenceSnippet(body, INTERVIEWER_MARKER_RE) },
      ));
    }

    if (config.publicationType === "autobiography" && config.narrativePerspective === "first_person") {
      const ratio = firstPersonSentenceRatio(body);
      if (wordCount(body) >= 40 && ratio < 0.9) {
        issues.push(makeIssue(
          "attribution", "critical", "first-person-ratio", "Autobiography is not consistently first-person",
          "Only " + Math.round(ratio * 100) + "% of narrative sentences contain first-person language.",
          "Rewrite the chapter into subject-approved first-person narrative or relabel the work as biography/profile.",
          { chapterId: ch.id, chapterIndex: index + 1 },
        ));
      }
    }

    if (SENSITIVE_CONTENT_RE.test(body)) {
      issues.push(makeIssue(
        "attribution", "warning", "sensitive-content", "Sensitive third-party content requires confirmation",
        "The chapter includes death, violence, health, abuse, or minor-related material that should not pass silently into publication.",
        "Require explicit author confirmation, verify necessity and attribution, and consider anonymising third parties.",
        { chapterId: ch.id, chapterIndex: index + 1, evidence: evidenceSnippet(body, SENSITIVE_CONTENT_RE) },
      ));
    }

    const years = Array.from(body.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((match) => Number(match[1]));
    if (years.some((year, i) => i > 0 && year < years[i - 1])) {
      issues.push(makeIssue(
        "structure", "warning", "chronology-regression", "Chronology moves backwards inside the chapter",
        "Explicit calendar years appear out of order: " + years.join(" → ") + ".",
        "Confirm the intended flashback structure or reorder the dated events chronologically.",
        { chapterId: ch.id, chapterIndex: index + 1 },
      ));
    }

    for (const source of readySources) {
      const coverage = ngramCoverage(body, source.content || "");
      if (coverage > 0.6) {
        issues.push(makeIssue(
          "source_integrity", "critical", "verbatim-source-" + source.id, "Chapter is predominantly verbatim from one source",
          Math.round(coverage * 100) + "% of eight-word sequences match “" + source.title + "”.",
          "Rewrite from extracted facts and attributed quotations. A chapter over 60% verbatim from one source must not publish.",
          { chapterId: ch.id, chapterIndex: index + 1 },
        ));
        break;
      }
    }

    const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (wordCount(body) >= 180 && paragraphs.length <= 1) {
      issues.push(makeIssue(
        "presentation", "warning", "dense-block", "Long chapter is presented as one dense block",
        "This chapter contains about " + wordCount(body) + " words without meaningful paragraph breaks.",
        "Split the chapter into readable paragraphs at sentence boundaries, then review transitions.",
        { chapterId: ch.id, chapterIndex: index + 1, autofix: "split_paragraphs" },
      ));
    }

    const questionCount = (body.match(/\?/g) || []).length;
    const sentenceCount = Math.max(1, body.split(/[.!?]+/).filter(Boolean).length);
    if (questionCount >= 3 && questionCount / sentenceCount > 0.2) {
      issues.push(makeIssue(
        "attribution", "warning", "question-heavy", "Interview questions may still be embedded",
        "A high proportion of the chapter is written as questions, which may indicate interviewer text was carried into the manuscript.",
        "Verify speaker attribution and remove or explicitly attribute interviewer questions.",
        { chapterId: ch.id, chapterIndex: index + 1 },
      ));
    }

    if (evidenceRequired && (ch.references || []).length === 0) {
      issues.push(makeIssue(
        "source_integrity", "warning", "chapter-no-reference", "Chapter has no traceable source reference",
        "This chapter cannot currently be traced from the reading view back to an evidence source.",
        "Attach the source records actually used for this chapter.",
        { chapterId: ch.id, chapterIndex: index + 1 },
      ));
    }
    const badRef = (ch.references || []).find((ref) => SEARCH_PLACEHOLDER_RE.test(ref.trim()));
    if (badRef) {
      issues.push(makeIssue(
        "source_integrity", "critical", "search-reference", "Bibliography contains a search-query placeholder",
        "“" + badRef + "” is a search instruction, not an evidence source.",
        "Replace it with the creator/publisher, source title, date when known, canonical location, and relevant timestamp/section.",
        { chapterId: ch.id, chapterIndex: index + 1, evidence: badRef },
      ));
    }

    if (evidenceRequired && /Premium editorial transformation:/i.test(ch.notes || "") && !(ch.evidenceClaims?.length)) {
      issues.push(makeIssue(
        "source_integrity", "warning", "evidence-ledger-missing", "Premium chapter has no structured evidence ledger",
        "The chapter was editorially transformed, but no claim-level evidence record was returned.",
        "Regenerate or review the chapter so retained claims can be traced to source records and timestamps.",
        { chapterId: ch.id, chapterIndex: index + 1 },
      ));
    }
    for (const claim of ch.evidenceClaims || []) {
      if (claim.verificationStatus === "supported" && claim.sourceIndexes.length === 0) {
        issues.push(makeIssue(
          "source_integrity", "critical", "claim-without-source-" + (claim.id || fnv1a(claim.claim)),
          "Claim marked supported without a source",
          "A structured evidence claim is marked supported but has no source index.",
          "Attach supporting source evidence or change the verification status to unresolved.",
          { chapterId: ch.id, chapterIndex: index + 1, evidence: claim.claim },
        ));
      }
      if (claim.verificationStatus === "conflicting" || claim.verificationStatus === "unresolved") {
        issues.push(makeIssue(
          "factual_consistency", "warning", "evidence-" + claim.verificationStatus + "-" + (claim.id || fnv1a(claim.claim)),
          claim.verificationStatus === "conflicting" ? "Evidence conflict requires editorial treatment" : "Unresolved evidence claim",
          "The evidence ledger marks this claim as " + claim.verificationStatus + ".",
          claim.editorialTreatment === "omit"
            ? "Keep the claim out of publication prose unless evidence is resolved."
            : "Attribute or qualify the claim explicitly; do not silently resolve the uncertainty.",
          { chapterId: ch.id, chapterIndex: index + 1, evidence: claim.claim },
        ));
      }
    }

    for (const ref of ch.references || []) {
      const linkedSource = readySources.find((source) =>
        ref.toLowerCase().includes((source.title || "").toLowerCase())
        || (!!source.url && ref.includes(source.url))
        || (!!source.canonicalUrl && ref.includes(source.canonicalUrl))
      );
      const hasUrl = /https?:\/\//i.test(ref) || !!linkedSource?.url || !!linkedSource?.canonicalUrl;
      const hasDate = /\b(?:19|20)\d{2}\b/.test(ref) || !!linkedSource?.publishedAt;
      if (!hasUrl || !hasDate) {
        issues.push(makeIssue(
          "source_integrity", "warning", "incomplete-reference-" + fnv1a(ref), "Reference metadata is incomplete",
          "“" + ref + "” is missing " + [!hasUrl ? "a canonical URL" : "", !hasDate ? "a publication/recording date" : ""].filter(Boolean).join(" and ") + ".",
          "Store title, creator/publisher, canonical URL, publication/recording date, accessed date, and relevant timestamp/section when available.",
          { chapterId: ch.id, chapterIndex: index + 1, evidence: ref },
        ));
      }
    }

    if (config.requireStoryPageImage && !ch.imageUrl && !(ch.images && ch.images.length > 0)) {
      issues.push(makeIssue(
        "production", "critical", "required-image-missing", "Required story-page image is missing",
        "The approved book specification requires an image on every story page.",
        "Generate, upload, or explicitly change the book specification before release.",
        { chapterId: ch.id, chapterIndex: index + 1 },
      ));
    }
  });

  const relativeDateRe = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+years?\s+ago\b/i;
  chapters.forEach((ch, index) => {
    if (relativeDateRe.test(ch.body || "")) {
      issues.push(makeIssue(
        "factual_consistency", "warning", "relative-date", "Relative date needs a source-date anchor",
        "The chapter uses a relative expression such as “seven years ago”, which is ambiguous if interpreted from the eBook generation date.",
        "Interpret the phrase relative to the recording/publication date of the supporting source, or replace it with a verified calendar date.",
        { chapterId: ch.id, chapterIndex: index + 1, evidence: evidenceSnippet(ch.body || "", relativeDateRe) },
      ));
    }
  });

  for (const group of collectPossibleNameVariants(chapters, config.topic || "")) {
    issues.push(makeIssue(
      "factual_consistency", "warning", "name-variant-" + group.first, "Possible person-name inconsistency",
      "The manuscript uses multiple full-name forms sharing the same first name: " + group.variants.join(", ") + ".",
      "Check the source records before reconciling these names. Do not choose a spelling or surname automatically.",
      { evidence: group.examples.join(" · ") },
    ));
  }

  const ages = collectMilestoneAges(chapters);
  const distinctAges = Array.from(new Set(ages.map((x) => x.age)));
  if (distinctAges.length > 1) {
    const evidence = ages.slice(0, 4).map((x) => "Ch. " + x.chapterIndex + ": " + x.context).join(" · ");
    issues.push(makeIssue(
      "factual_consistency", "warning", "milestone-age-conflict", "Potential age/milestone discrepancy",
      "The manuscript links similar started/founded/launched/began milestones to multiple ages (" + distinctAges.join(", ") + ").",
      "Check whether these describe different milestones. Preserve the distinction or flag the conflict instead of choosing one automatically.",
      { evidence },
    ));
  }

  const themeTone = validateThemeAndTone(chapters, config.theme, config.tone);
  for (const item of themeTone) {
    issues.push(makeIssue(
      "editorial_quality",
      item.severity === "warning" ? "warning" : "info",
      "theme-tone-" + item.category + "-" + fnv1a(item.message),
      item.category === "theme" ? "Theme mismatch" : item.category === "tone" ? "Tone mismatch" : "Cross-chapter voice drift",
      item.message,
      "Review the passage in context; theme/tone checks are editorial signals, not factual verification.",
      {
        chapterId: item.chapterId === "global" ? undefined : item.chapterId,
        chapterIndex: item.chapterIndex > 0 ? item.chapterIndex : undefined,
        evidence: item.snippet,
      },
    ));
  }

  return issues;
}

export function unresolvedPublicationIssues(
  chapters: SlideChapter[],
  sources: Source[],
  config: StoryConfig,
): PublicationReadinessIssue[] {
  const dismissals = config.readinessDismissals || {};
  const revision = computeManuscriptRevision(chapters);
  return analysePublicationReadiness(chapters, sources, config)
    .filter((item) => !dismissals[item.id + "@" + revision]?.trim());
}

export function summarisePublicationReadiness(issues: PublicationReadinessIssue[]) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const item of issues) counts[item.severity] += 1;
  return {
    ...counts,
    publicationReady: counts.critical === 0 && counts.warning === 0,
    criticalClear: counts.critical === 0,
  };
}

export function cleanTranscriptArtifacts(text: string): string {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const cleaned = lines
    .map((line) => line
      .replace(/^\s*(?:\[)?\d{1,2}:\d{2}(?::\d{2})?(?:\])?\s*/, "")
      .replace(/^\s*(?:host|interviewer|guest|speaker\s*\d+|q|a)\s*:\s*/i, "")
      .trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(?:good\s+(?:morning|afternoon|evening)|welcome\s+(?:back|to)\b|thanks?\s+for\s+having\s+me\.?$|we(?:'|’)ll\s+be\s+right\s+back\.?$)/i.test(line)) return false;
      return true;
    });
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function splitDenseParagraphs(text: string, sentencesPerParagraph = 3): string {
  const source = String(text || "").trim();
  if (!source || /\n\s*\n/.test(source)) return source;
  const sentences = source.match(/[^.!?]+[.!?]+(?:[”"']+)?|[^.!?]+$/g)
    ?.map((s) => s.trim()).filter(Boolean) || [source];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
    paragraphs.push(sentences.slice(i, i + sentencesPerParagraph).join(" "));
  }
  return paragraphs.join("\n\n");
}

export function applyReadinessAutofix(chapter: SlideChapter, fix: ReadinessAutofix): SlideChapter {
  if (fix === "clean_transcript") return { ...chapter, body: cleanTranscriptArtifacts(chapter.body) };
  if (fix === "split_paragraphs") return { ...chapter, body: splitDenseParagraphs(chapter.body) };
  return chapter;
}

export function manuscriptApprovedForNarration(chapters: SlideChapter[], config: StoryConfig): boolean {
  return !!config.approvedManuscriptRevision
    && config.approvedManuscriptRevision === computeManuscriptRevision(chapters);
}

