import { useState, useCallback, createContext, useContext } from "react";

export type Source = {
  id: string;
  type: "url" | "file" | "search";
  title: string;
  /** Canonical citation URL retained by the sovereign research service. */
  url?: string;
  /** Credential-free discovery/extraction provider used by Open Nova. */
  provider?: string;
  /** ISO timestamp recorded when the source content was retrieved. */
  retrievedAt?: string;
  /** SHA-256 of the extracted text for receipt/integrity checks. */
  contentHash?: string;
  /** True when Open Nova reached the public source during verification. */
  verified?: boolean;
  description?: string;
  canonicalUrl?: string;
  extractionProvider?: string;
  transcriptAvailable?: boolean;
  relevance?: "direct" | "contextual" | "unrelated" | "unassessed";
  relevanceReason?: string;
  contentAvailability?: "not_checked" | "text_extracted" | "captions_extracted" | "speech_to_text" | "metadata_only" | "failed";
  evidenceReview?: "not_reviewed" | "reviewed";
  sourceKind?: "article" | "homepage" | "video" | "channel" | "playlist" | "other";
  diagnostic?: string;
  error?: string;
  content?: string;
  status: "pending" | "processing" | "ready" | "error";
};

/** Max images allowed per chapter (Phase-A multi-image support). */
export const MAX_IMAGES_PER_CHAPTER = 4;

export type ChapterImageSource = "ai" | "upload" | "legacy";

/** Media kind for a chapter asset. Defaults to "image" when unset for back-compat. */
export type ChapterMediaKind = "image" | "video";

export type ChapterImage = {
  id: string;
  url: string;
  prompt?: string;
  source: ChapterImageSource;
  /** Optional caption rendered under the image in supported layouts. */
  caption?: string;
  /** Media kind. Omitted/undefined === "image" for back-compat with existing projects. */
  kind?: ChapterMediaKind;
  /** Optional MIME type captured at upload time — used for the <video> source type attr. */
  mimeType?: string;
};

/** How a chapter's images render in-app and (Phase-B) in exports. */
export type ChapterImageLayout = "stack" | "grid" | "hero" | "carousel";

export type SlideChapter = {
  id: string;
  title: string;
  body: string;
  imagePrompt?: string;
  diagramPrompt?: string;
  notes?: string;
  /** Primary/cover image. Kept for back-compat; mirrors images[0] when images is set. */
  imageUrl?: string;
  /** Multi-image gallery (Phase A). Up to MAX_IMAGES_PER_CHAPTER entries. */
  images?: ChapterImage[];
  /** Layout used to render the multi-image gallery in-app. */
  imageLayout?: ChapterImageLayout;
  imageLoading?: boolean;
  /** Provider that produced the current cover image ("gemini" | "pollinations" | "flux" | …). */
  imageProvider?: string;
  /** True when the current image came from a $0 provider (Pollinations / FLUX) — eligible for premium upgrade. */
  imageFreeTier?: boolean;
  /** True while a draft → premium upgrade is in flight. */
  imageUpgrading?: boolean;
  /** Provider that produced the most recent narration audio for this chapter ("elevenlabs" | "cache" | "pollinations" | "huggingface"). */
  ttsProvider?: string;
  /** True when the most recent narration came from a free provider (Pollinations / HuggingFace) — surfaced as an "Eco TTS" badge. */
  ttsFreeTier?: boolean;
  /** Correlation ID returned by the most recent generate-chapter-image call — links to api_usage_logs.metadata->>'correlation_id'. */
  imageCorrelationId?: string;
  /** Correlation ID returned by the most recent elevenlabs-tts call — links to api_usage_logs.metadata->>'correlation_id'. */
  ttsCorrelationId?: string;
  references?: string[];
  rating?: number;
  ratingComment?: string;
  autoOptimizing?: boolean;
};

/**
 * Returns a normalized list of images for a chapter.
 * Falls back to a single-element list built from the legacy `imageUrl`
 * so existing projects keep rendering with no migration step.
 */
export function getChapterImages(chapter: Pick<SlideChapter, "images" | "imageUrl" | "imagePrompt">): ChapterImage[] {
  if (chapter.images && chapter.images.length > 0) return chapter.images;
  if (chapter.imageUrl) {
    return [{
      id: "legacy",
      url: chapter.imageUrl,
      prompt: chapter.imagePrompt,
      source: "legacy",
    }];
  }
  return [];
}

export type NarrationProvider = "browser" | "elevenlabs";

export type BgMusicTrack = {
  id: string;
  label: string;
  tier: "free" | "premium";
  url: string;
  genre: string;
};

export const BG_MUSIC_TRACKS: BgMusicTrack[] = [
  { id: "none", label: "No Music", tier: "free", url: "", genre: "" },
  { id: "gentle-piano", label: "Gentle Piano", tier: "free", url: "/audio/gentle-piano.mp3", genre: "Ambient" },
  { id: "soft-acoustic", label: "Soft Acoustic", tier: "free", url: "/audio/soft-acoustic.mp3", genre: "Acoustic" },
  { id: "lo-fi-chill", label: "Lo-Fi Chill", tier: "free", url: "/audio/lo-fi-chill.mp3", genre: "Lo-Fi" },
  { id: "cinematic-strings", label: "Cinematic Strings", tier: "premium", url: "/audio/cinematic-strings.mp3", genre: "Cinematic" },
  { id: "epic-orchestral", label: "Epic Orchestral", tier: "premium", url: "/audio/epic-orchestral.mp3", genre: "Orchestral" },
  { id: "ambient-electronic", label: "Ambient Electronic", tier: "premium", url: "/audio/ambient-electronic.mp3", genre: "Electronic" },
  { id: "jazz-lounge", label: "Jazz Lounge", tier: "premium", url: "/audio/jazz-lounge.mp3", genre: "Jazz" },
  { id: "nature-soundscape", label: "Nature Soundscape", tier: "premium", url: "/audio/nature-soundscape.mp3", genre: "Soundscape" },
];

export type BookLanguage = "en" | "af" | "zu" | "xh" | "st" | "ar";

/** Languages whose carousels should auto-advance right-to-left. */
export const RTL_BOOK_LANGUAGES: ReadonlySet<BookLanguage> = new Set<BookLanguage>(["ar"]);

export function isRtlBookLanguage(lang: BookLanguage): boolean {
  return RTL_BOOK_LANGUAGES.has(lang);
}

export type EbookDesignPreset = "classic" | "modern" | "whimsical" | "dark" | "minimalist" | "vintage" | "custom";

export type EbookFontFamily = "playfair" | "merriweather" | "lora" | "inter" | "raleway" | "cormorant" | "crimson" | "libre-baskerville";

export type EbookColorScheme = {
  id: string;
  name: string;
  bg: string;
  text: string;
  accent: string;
  chapterBg: string;
};

export type EbookLayoutStyle = "classic" | "full-bleed" | "side-by-side" | "overlay";

export const EBOOK_FONTS: { id: EbookFontFamily; label: string; category: string; cssFamily: string }[] = [
  { id: "playfair", label: "Playfair Display", category: "Serif", cssFamily: "'Playfair Display', serif" },
  { id: "merriweather", label: "Merriweather", category: "Serif", cssFamily: "'Merriweather', serif" },
  { id: "lora", label: "Lora", category: "Serif", cssFamily: "'Lora', serif" },
  { id: "libre-baskerville", label: "Libre Baskerville", category: "Serif", cssFamily: "'Libre Baskerville', serif" },
  { id: "cormorant", label: "Cormorant Garamond", category: "Serif", cssFamily: "'Cormorant Garamond', serif" },
  { id: "crimson", label: "Crimson Text", category: "Serif", cssFamily: "'Crimson Text', serif" },
  { id: "inter", label: "Inter", category: "Sans-Serif", cssFamily: "'Inter', sans-serif" },
  { id: "raleway", label: "Raleway", category: "Sans-Serif", cssFamily: "'Raleway', sans-serif" },
];

export const EBOOK_COLOR_SCHEMES: EbookColorScheme[] = [
  { id: "ivory", name: "Ivory & Ink", bg: "#FDFBF7", text: "#2C2C2C", accent: "#8B6914", chapterBg: "#F5F0E6" },
  { id: "snow", name: "Snow White", bg: "#FFFFFF", text: "#1A1A1A", accent: "#3B82F6", chapterBg: "#F8FAFC" },
  { id: "dark", name: "Dark Mode", bg: "#1A1A2E", text: "#E8E8E8", accent: "#A78BFA", chapterBg: "#16213E" },
  { id: "sepia", name: "Warm Sepia", bg: "#F4EDDD", text: "#3D2B1F", accent: "#A0522D", chapterBg: "#EDE3CF" },
  { id: "sage", name: "Sage & Cream", bg: "#F5F0E8", text: "#2D3B2D", accent: "#5A8A5C", chapterBg: "#ECE7DD" },
  { id: "midnight", name: "Midnight Blue", bg: "#0F172A", text: "#E2E8F0", accent: "#38BDF8", chapterBg: "#1E293B" },
  { id: "blush", name: "Blush Rose", bg: "#FFF5F5", text: "#4A2C2A", accent: "#E88AAB", chapterBg: "#FEF0F0" },
  { id: "forest", name: "Forest Green", bg: "#F0F5F0", text: "#1A3C2A", accent: "#2D8A4E", chapterBg: "#E5EDE5" },
];

export const EBOOK_DESIGN_PRESETS: { id: EbookDesignPreset; label: string; description: string; font: EbookFontFamily; colorSchemeId: string; layout: EbookLayoutStyle }[] = [
  { id: "classic", label: "Classic", description: "Timeless serif typography with ivory tones", font: "playfair", colorSchemeId: "ivory", layout: "classic" },
  { id: "modern", label: "Modern", description: "Clean sans-serif with crisp white", font: "inter", colorSchemeId: "snow", layout: "full-bleed" },
  { id: "whimsical", label: "Whimsical", description: "Playful serifs with blush pink accents", font: "cormorant", colorSchemeId: "blush", layout: "overlay" },
  { id: "dark", label: "Dark", description: "Elegant dark theme with purple accents", font: "raleway", colorSchemeId: "dark", layout: "full-bleed" },
  { id: "minimalist", label: "Minimalist", description: "Understated Lora with sage green", font: "lora", colorSchemeId: "sage", layout: "classic" },
  { id: "vintage", label: "Vintage", description: "Old-world sepia with classic layout", font: "libre-baskerville", colorSchemeId: "sepia", layout: "side-by-side" },
];

export type StoryConfig = {
  topic: string;
  /** Records whether generation is grounded in usable evidence or explicitly topic-only. */
  researchBasis?: "evidence" | "topic_only";
  theme: string;
  tone: string;
  depth: "summary" | "standard" | "extensive";
  orientation: "portrait" | "landscape";
  visualMode: boolean;
  imageStyle: "cinematic" | "animated";
  characterDescription: string;
  narrationVoice: string;
  narrationDemeanour: "calm" | "energetic" | "warm" | "authoritative" | "playful";
  narrationSpeed: number;
  useImageAsIs: boolean;
  narrationProvider: NarrationProvider;
  bgMusicTrackId: string;
  bgMusicVolume: number;
  bookLanguage: BookLanguage;
  ebookDesignPreset: EbookDesignPreset;
  ebookFont: EbookFontFamily;
  ebookColorSchemeId: string;
  ebookLayout: EbookLayoutStyle;
  rawPromptMode?: boolean;
  /** Exact story-page target from the approved brief. Undefined means no exact-count gate. */
  targetStoryPages?: number;
  /** Optional approved word-count range per story page. */
  storyPageMinWords?: number;
  storyPageMaxWords?: number;
  /** When true, every story page must have an approved image before book release. */
  requireStoryPageImage?: boolean;
  /** Global multi-image gap (px-equiv) used by all exporters. */
  imageGap?: number;
  /** How individual images fit their slot in HTML/preview ("cover" or "contain"). */
  imageFit?: "cover" | "contain";
  /** PDF/MP4: shrink chapter image area to leave more room for text ("compact"),
   *  or fill the page top half ("standard"), or fill the whole page ("full"). */
  imagePageFit?: "compact" | "standard" | "full";
  /** HTML eBook carousel: auto-advance through images on a timer. */
  carouselAutoplay?: boolean;
  /** Seconds between carousel advances (1–15s). Defaults to 4. */
  carouselAutoplaySec?: number;
  /** When true, autoplay cycles backwards (right-to-left) for RTL languages. */
  carouselAutoplayReverse?: boolean;
  /** Visual indicator for autoplay progress: "ring" around active dot, or thin "bar" along the bottom. */
  carouselAutoplayIndicator?: "ring" | "bar";
};

type StoryForgeState = {
  sources: Source[];
  setSources: React.Dispatch<React.SetStateAction<Source[]>>;
  chapters: SlideChapter[];
  setChapters: React.Dispatch<React.SetStateAction<SlideChapter[]>>;
  config: StoryConfig;
  setConfig: React.Dispatch<React.SetStateAction<StoryConfig>>;
  step: number;
  setStep: (s: number) => void;
  isGenerating: boolean;
  setIsGenerating: (b: boolean) => void;
  storyline: string;
  setStoryline: React.Dispatch<React.SetStateAction<string>>;
  storylineAccepted: boolean;
  setStorylineAccepted: (b: boolean) => void;
  referenceImage: string | null;
  setReferenceImage: React.Dispatch<React.SetStateAction<string | null>>;
  projectId: string | null;
  setProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  projectDirty: boolean;
  setProjectDirty: (b: boolean) => void;
  lastSavedAt: Date | null;
  setLastSavedAt: React.Dispatch<React.SetStateAction<Date | null>>;
  asIsMode: boolean;
  setAsIsMode: (b: boolean) => void;
  overallRating: number;
  setOverallRating: (r: number) => void;
};

const StoryForgeContext = createContext<StoryForgeState | null>(null);

export function useStoryForge() {
  const ctx = useContext(StoryForgeContext);
  if (!ctx) throw new Error("useStoryForge must be inside provider");
  return ctx;
}

export const DEFAULT_CONFIG: StoryConfig = {
  topic: "",
  researchBasis: "evidence",
  theme: "documentary",
  tone: "professional",
  depth: "standard",
  orientation: "landscape",
  visualMode: false,
  imageStyle: "cinematic",
  characterDescription: "",
  narrationVoice: "JBFqnCBsd6RMkjVDRZzb",
  narrationDemeanour: "calm",
  narrationSpeed: 1.0,
  useImageAsIs: false,
  narrationProvider: "browser",
  bgMusicTrackId: "none",
  bgMusicVolume: 0.3,
  bookLanguage: "en",
  ebookDesignPreset: "classic",
  ebookFont: "playfair",
  ebookColorSchemeId: "ivory",
  ebookLayout: "classic",
  imageGap: 6,
  imageFit: "cover",
  imagePageFit: "standard",
  carouselAutoplay: false,
  carouselAutoplaySec: 4,
  carouselAutoplayReverse: false,
  carouselAutoplayIndicator: "ring",
};

export function StoryForgeProvider({ children }: { children: React.ReactNode }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [chapters, setChapters] = useState<SlideChapter[]>([]);
  const [config, setConfig] = useState<StoryConfig>(DEFAULT_CONFIG);
  const [step, setStep] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [storyline, setStoryline] = useState("");
  const [storylineAccepted, setStorylineAccepted] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectDirty, setProjectDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [asIsMode, setAsIsMode] = useState(false);
  const [overallRating, setOverallRatingRaw] = useState(0);

  const setOverallRatingAndDirty = useCallback((r: number) => {
    setOverallRatingRaw(r);
    setProjectDirty(true);
  }, []);

  // Auto-dirty wrappers for state that should trigger autosave
  const setStepAndDirty = useCallback((s: number) => {
    setStep(s);
    setProjectDirty(true);
  }, []);

  const setConfigAndDirty: React.Dispatch<React.SetStateAction<StoryConfig>> = useCallback((v) => {
    setConfig(v);
    setProjectDirty(true);
  }, []);

  const setSourcesAndDirty: React.Dispatch<React.SetStateAction<Source[]>> = useCallback((v) => {
    setSources(v);
    setProjectDirty(true);
  }, []);

  const setChaptersAndDirty: React.Dispatch<React.SetStateAction<SlideChapter[]>> = useCallback((v) => {
    setChapters(v);
    setProjectDirty(true);
  }, []);

  const setStorylineAndDirty: React.Dispatch<React.SetStateAction<string>> = useCallback((v) => {
    setStoryline(v);
    setProjectDirty(true);
  }, []);

  return (
    <StoryForgeContext.Provider
      value={{
        sources, setSources: setSourcesAndDirty,
        chapters, setChapters: setChaptersAndDirty,
        config, setConfig: setConfigAndDirty,
        step, setStep: setStepAndDirty,
        isGenerating, setIsGenerating,
        storyline, setStoryline: setStorylineAndDirty,
        storylineAccepted, setStorylineAccepted,
        referenceImage, setReferenceImage,
        projectId, setProjectId,
        projectDirty, setProjectDirty,
        lastSavedAt, setLastSavedAt,
        asIsMode, setAsIsMode,
        overallRating, setOverallRating: setOverallRatingAndDirty,
      }}
    >
      {children}
    </StoryForgeContext.Provider>
  );
}
