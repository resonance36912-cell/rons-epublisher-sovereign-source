import type { Source } from "@/components/storyforge/StoryForgeContext";

export const RESEARCH_SOURCE_LIMIT = Math.max(
  1,
  Number(import.meta.env.VITE_OPEN_NOVA_RESEARCH_MAX_SOURCES || 12) || 12,
);
export const RESEARCH_DENYLIST_VERSION = "2026-09-12-v1";

export type RelevanceClass = "direct" | "contextual" | "unrelated" | "unassessed";
export type ReviewGroup = "recommended" | "needs_review" | "excluded";
export type ContentAvailability = "not_checked" | "text_extracted" | "captions_extracted" | "speech_to_text" | "metadata_only" | "failed";
export type SourceKind = "article" | "homepage" | "video" | "channel" | "playlist" | "other";

export type DiscoverySourceInput = {
  url: string;
  title: string;
  description?: string;
  type?: "web" | "youtube";
  selected?: boolean;
  provider?: string;
  query?: string;
  originatingQuery?: string;
};

export type QualifiedDiscoverySource = DiscoverySourceInput & {
  description: string;
  type: "web" | "youtube";
  canonicalUrl: string;
  domain: string;
  sourceKind: SourceKind;
  relevance: RelevanceClass;
  relevanceReason: string;
  reviewGroup: ReviewGroup;
  contentAvailability: ContentAvailability;
  score: number;
  selected: boolean;
};
const GENERIC_TERMS = new Set([
  "the", "of", "and", "in", "on", "for", "to", "from", "about", "a", "an",
  "history", "historical", "people", "person", "community", "communities",
  "story", "stories", "overview", "guide", "introduction", "documentary",
]);

const DENIED_HOSTS = new Set([
  "history.google.com",
  "accounts.google.com",
  "myactivity.google.com",
]);

const GENERIC_TITLES = new Set([
  "history",
  "welcome to my activity",
  "my activity",
]);

function normaliseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function distinctiveTerms(topic: string): string[] {
  return Array.from(new Set(
    normaliseText(topic).split(/\s+/).filter((term) => term.length > 2 && !GENERIC_TERMS.has(term)),
  ));
}

function containsTerm(text: string, term: string): boolean {
  return text.includes(term) || (term.endsWith("s") ? text.includes(term.slice(0, -1)) : text.includes(`${term}s`));
}
export function canonicalizeResearchUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    if ((url.hostname === "youtu.be" || url.hostname.endsWith("youtube.com")) && url.searchParams.get("v")) {
      return `https://www.youtube.com/watch?v=${url.searchParams.get("v")}`;
    }
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    const query = url.searchParams.toString();
    return `${url.protocol}//${url.hostname.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return raw.trim();
  }
}

function classifySourceKind(urlText: string): SourceKind {
  try {
    const url = new URL(urlText);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if (host === "youtu.be") return "video";
    if (host.endsWith("youtube.com")) {
      if (path === "/watch" || /^\/shorts\/[^/]+/.test(path)) return "video";
      if (/^\/(?:@|channel\/|c\/|user\/)/.test(path)) return "channel";
      if (path === "/playlist") return "playlist";
    }
    if (!path) return "homepage";
    return "article";
  } catch {
    return "other";
  }
}
function scoreCandidate(topic: string, source: DiscoverySourceInput) {
  const terms = distinctiveTerms(topic);
  const title = normaliseText(source.title || "");
  const description = normaliseText(source.description || "");
  const urlText = normaliseText(source.url || "");
  const phrase = terms.join(" ");
  let score = 0;
  let hits = 0;
  let titleHits = 0;
  for (const term of terms) {
    const titleHit = containsTerm(title, term);
    const descHit = containsTerm(description, term);
    const urlHit = containsTerm(urlText, term);
    if (titleHit || descHit || urlHit) hits += 1;
    if (titleHit) { score += 4; titleHits += 1; }
    if (descHit) score += 2;
    if (urlHit) score += 1;
  }
  const phraseHit = !!phrase && (title.includes(phrase) || description.includes(phrase) || urlText.includes(phrase));
  if (phrase && title.includes(phrase)) score += 6;
  else if (phrase && description.includes(phrase)) score += 3;
  return { score, hits, titleHits, phraseHit, terms };
}

function domainOf(urlText: string): string {
  try { return new URL(urlText).hostname.toLowerCase(); } catch { return ""; }
}

function exclusionReason(source: DiscoverySourceInput, kind: SourceKind): string | null {
  const host = domainOf(source.url);
  const title = normaliseText(source.title || "");
  if (DENIED_HOSTS.has(host) || /(^|\.)accounts\./.test(host)) return "Account/login page is not usable research evidence";
  if (kind === "channel" || kind === "playlist") return "YouTube channel/playlist is not an extractable evidence item";
  if (GENERIC_TITLES.has(title)) return "Generic result does not identify the requested subject";
  return null;
}
export function qualifyDiscoverySources(
  topic: string,
  inputs: DiscoverySourceInput[],
  maxSelected = RESEARCH_SOURCE_LIMIT,
): QualifiedDiscoverySource[] {
  const seen = new Set<string>();
  const qualified: QualifiedDiscoverySource[] = [];
  for (const input of inputs || []) {
    const canonicalUrl = canonicalizeResearchUrl(input.url);
    if (!canonicalUrl || seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    const sourceKind = classifySourceKind(canonicalUrl);
    const hardReason = exclusionReason(input, sourceKind);
    const { score, hits, titleHits, phraseHit, terms } = scoreCandidate(topic, input);
    let relevance: RelevanceClass = "unrelated";
    let reviewGroup: ReviewGroup = "excluded";
    let relevanceReason = hardReason || "No distinctive topic term appears in the title, snippet, or URL";
    if (!hardReason && sourceKind === "homepage") {
      relevance = hits > 0 ? "contextual" : "unassessed";
      reviewGroup = "needs_review";
      relevanceReason = "Homepage or landing page is a discovery lead; locate a specific topical article before using it as evidence";
    } else if (!hardReason && hits > 0) {
      relevance = phraseHit || (terms.length > 0 && titleHits === terms.length) ? "direct" : "contextual";
      if (relevance === "direct") {
        reviewGroup = "recommended";
        relevanceReason = `Direct topic match (${hits}/${Math.max(terms.length, 1)} distinctive terms)`;
      } else {
        reviewGroup = "needs_review";
        relevanceReason = `Contextual match (${hits}/${Math.max(terms.length, 1)} distinctive terms)`;
      }
    }
    const candidateDomain = domainOf(canonicalUrl);
    const type = candidateDomain === "youtu.be" || candidateDomain.endsWith("youtube.com") ? "youtube" : "web";
    qualified.push({ ...input, description: input.description || "", type, canonicalUrl,
      domain: domainOf(canonicalUrl), sourceKind, relevance, relevanceReason, reviewGroup,
      contentAvailability: "not_checked", score, selected: false });
  }
  qualified.sort((a, b) => {
    const rank = { recommended: 0, needs_review: 1, excluded: 2 } as const;
    return rank[a.reviewGroup] - rank[b.reviewGroup] || b.score - a.score || a.title.localeCompare(b.title);
  });
  let selected = 0;
  return qualified.map((source) => {
    const shouldSelect = source.reviewGroup === "recommended" && selected < maxSelected;
    if (shouldSelect) selected += 1;
    return { ...source, selected: shouldSelect };
  });
}
const PROMO_RE = /(patreon|subscribe|comment section|like and share|my last video|today,? we'?re going to|i'?m (?:also )?going to|thanks\.?$)/i;
const DIAGNOSTIC_RE = /^open nova note:/i;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function cleanExtractedParagraphs(topic: string, raw: string): { text: string; indexLike: boolean } {
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .filter((p) => !DIAGNOSTIC_RE.test(p))
    .filter((p) => !(/^https?:\/\/\S+$/i.test(p)))
    .filter((p) => !(p.length < 500 && PROMO_RE.test(p)));
  const teaserCount = blocks.filter((p) => /(?:\.\.\.|…)\s*$/.test(p) || words(p) < 30).length;
  const indexLike = blocks.length > 6 && teaserCount / Math.max(blocks.length, 1) > 0.4;
  const terms = distinctiveTerms(topic);
  if (!terms.length || !blocks.length) return { text: blocks.join("\n\n"), indexLike };
  const matches = blocks.map((p) => {
    const n = normaliseText(p);
    return terms.some((term) => containsTerm(n, term));
  });
  if (!matches.some(Boolean)) return { text: "", indexLike };
  const kept = blocks.filter((_p, i) => matches[i] || matches[i - 1] || matches[i + 1]);
  return { text: kept.join("\n\n"), indexLike };
}

function discoveryForSource(source: Source, discovered: QualifiedDiscoverySource[]) {
  const key = canonicalizeResearchUrl(source.canonicalUrl || source.url || "");
  if (key) {
    const byUrl = discovered.find((item) => item.canonicalUrl === key);
    if (byUrl) return byUrl;
  }

  const titleKey = normaliseText(source.title || "");
  if (!titleKey) return undefined;
  const titleMatches = discovered.filter((item) => normaliseText(item.title || "") === titleKey);
  return titleMatches.length === 1 ? titleMatches[0] : undefined;
}

export function repairMissingSourceCitations(
  sources: Source[],
  discovered: QualifiedDiscoverySource[],
): { sources: Source[]; repairedCount: number } {
  let repairedCount = 0;
  const repaired = (sources || []).map((source) => {
    if (source.type !== "search" || source.url || source.canonicalUrl) return source;
    const discovery = discoveryForSource(source, discovered);
    if (!discovery?.canonicalUrl) return source;
    repairedCount += 1;
    return {
      ...source,
      url: discovery.url,
      canonicalUrl: discovery.canonicalUrl,
      provider: source.provider || discovery.provider,
      description: source.description || discovery.description,
      relevance: source.relevance || discovery.relevance,
      relevanceReason: source.relevanceReason || discovery.relevanceReason,
      sourceKind: source.sourceKind || discovery.sourceKind,
    };
  });
  return { sources: repaired, repairedCount };
}

export function normaliseExtractedSources(
  topic: string,
  sources: Source[],
  discovered: QualifiedDiscoverySource[] = [],
  requestedUrls: string[] = [],
): Source[] {
  const positionalUrls = requestedUrls.length === (sources || []).length
    ? requestedUrls.map(canonicalizeResearchUrl)
    : [];
  return (sources || []).map((source, index) => {
    const discovery = discoveryForSource(source, discovered);
    const recoveredUrl = canonicalizeResearchUrl(
      source.canonicalUrl
      || source.url
      || discovery?.canonicalUrl
      || discovery?.url
      || positionalUrls[index]
      || "",
    );
    const base = {
      ...source,
      url: source.url || discovery?.url || positionalUrls[index] || recoveredUrl || undefined,
      canonicalUrl: recoveredUrl || undefined,
      provider: source.provider || discovery?.provider,
      description: source.description || discovery?.description,
      relevance: discovery?.relevance || source.relevance || "unassessed",
      relevanceReason: discovery?.relevanceReason || source.relevanceReason,
      evidenceReview: source.evidenceReview || "not_reviewed",
      sourceKind: discovery?.sourceKind || source.sourceKind,
    } as Source;
    if (source.status === "error") {
      return { ...base, contentAvailability: "failed" as const };
    }
    if (source.transcriptAvailable === false || /youtube-public-metadata/i.test(source.extractionProvider || "")) {
      return {
        ...base,
        status: "error" as const,
        content: undefined,
        contentAvailability: "metadata_only" as const,
        diagnostic: "Video metadata was available, but no usable public caption track was extracted.",
      };
    }
    const cleaned = cleanExtractedParagraphs(topic, source.content || "");
    if (cleaned.indexLike) {
      return {
        ...base,
        status: "error" as const,
        content: undefined,
        contentAvailability: "failed" as const,
        diagnostic: "Listing/index-page extraction was rejected because teaser-like blocks dominated the page.",
      };
    }
    const wordCount = words(cleaned.text);
    if (!cleaned.text || wordCount < 40) {
      return {
        ...base,
        status: "error" as const,
        content: undefined,
        contentAvailability: "failed" as const,
        diagnostic: "Extraction did not yield enough on-topic text for meaningful review.",
      };
    }
    if (wordCount < 150) {
      return {
        ...base,
        content: cleaned.text,
        status: "processing" as const,
        contentAvailability: (source.contentAvailability === "speech_to_text" || /rons-local-whisper-youtube/i.test(source.extractionProvider || ""))
          ? "speech_to_text" as const
          : source.transcriptAvailable === true ? "captions_extracted" as const : "text_extracted" as const,
        diagnostic: `Short topical extract (${wordCount} words): manual review is required before generation.`,
      };
    }
    return {
      ...base,
      content: cleaned.text,
      status: "ready" as const,
      contentAvailability: (source.contentAvailability === "speech_to_text" || /rons-local-whisper-youtube/i.test(source.extractionProvider || ""))
          ? "speech_to_text" as const
          : source.transcriptAvailable === true ? "captions_extracted" as const : "text_extracted" as const,
    };
  });
}

export function sourceQualitySummary(sources: QualifiedDiscoverySource[]) {
  return {
    discovered: sources.length,
    selected: sources.filter((s) => s.selected).length,
    recommended: sources.filter((s) => s.reviewGroup === "recommended").length,
    needsReview: sources.filter((s) => s.reviewGroup === "needs_review").length,
    excluded: sources.filter((s) => s.reviewGroup === "excluded").length,
  };
}