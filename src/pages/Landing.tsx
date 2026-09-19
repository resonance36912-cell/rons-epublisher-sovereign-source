import { useState, useEffect, useRef } from "react";
import heroIllustration from "@/assets/hero-illustration.jpg";
import { Seo } from "@/components/Seo";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { BetaSignupForm } from "@/components/storyforge/BetaSignupForm";
import { LanguageToggle } from "@/components/storyforge/LanguageToggle";
import { ThemeToggle } from "@/components/storyforge/ThemeToggle";
import { useI18n } from "@/lib/i18n";
import resonanceLogo from "@/assets/resonance-logo.png";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Youtube,
  Upload,
  BookOpen,
  Mic,
  Image,
  Sparkles,
  ArrowRight,
  ArrowUpRight,
  Shield,
  Zap,
  Languages,
  Menu,
  X,
  Search,
  SlidersHorizontal,
  Wand2,
  Check,
  Star,
  HelpCircle,
  Music,
  FileOutput,
  Film,
  Share2,
  Linkedin,
  Twitter,
  Link2,
  Play,
  GraduationCap,
  Briefcase,
  Mic2,
  Church,
  Users,
  PenTool,
  AlertTriangle,
  FileText,
  Mail,
  Loader2,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* ── Editable content: drop real values here ── */
const DEMO_VIDEO_URL = "https://www.youtube-nocookie.com/embed/-1SjoH9KFVg";
// Sample eBook metadata lives in src/pages/SamplePreview.tsx — edit there to update titles, descriptions, covers, or preview/PDF/video URLs.
import { SAMPLE_PREVIEWS } from "./SamplePreview";
import { resolveWatchUrl } from "@/lib/embed-url";
import { trackEvent } from "@/lib/analytics";

/**
 * Validate + normalize the (provider, embed_url) pair before sending it to
 * analytics. Guarantees we never log empty/garbage values that would break
 * the admin filters and trend charts on the Embed Failures/Retries sections.
 *
 * Returns `null` when the inputs are unusable, in which case the caller MUST
 * skip the trackEvent call. Otherwise returns the normalized fields plus the
 * full event properties object ready to spread.
 */
import { validateEmbedEventProps } from "@/lib/embedEvents";
const SAMPLE_EBOOKS = SAMPLE_PREVIEWS.map((s) => ({
  title: s.title,
  desc: s.tagline,
  cover: s.cover ?? "",
  href: `/samples/${s.slug}`,
}));
const AUDIENCES = [
  { icon: PenTool, label: "Authors & Writers" },
  { icon: GraduationCap, label: "Educators & Students" },
  { icon: Mic2, label: "Podcasters" },
  { icon: Briefcase, label: "Businesses & Coaches" },
  { icon: Church, label: "Spiritual Creators" },
  { icon: Users, label: "Community Leaders" },
];

/* ── Floating particles ── */
function FloatingParticles() {
  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    duration: Math.random() * 8 + 6,
    delay: Math.random() * 4,
    opacity: Math.random() * 0.4 + 0.1,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-primary"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
          }}
          animate={{
            y: [0, -30, 0, 20, 0],
            x: [0, 15, -10, 5, 0],
            opacity: [p.opacity, p.opacity * 1.8, p.opacity, p.opacity * 0.6, p.opacity],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/* ── Watch Demo section ── */
const DEMO_PREVIEW_STORAGE_KEY = "resonance.demo.previewUrl";
const DEMO_SUBMIT_EMAIL = "support@resonance-podcast.com";
const SHARE_TOASTS_KEY = "resonance.demo.shareToasts";

function toEmbedUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      if (u.pathname.startsWith("/embed/")) return url;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "");
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
    if (host === "player.vimeo.com") return url;
    if (url.endsWith(".mp4") || url.endsWith(".webm")) return url;
    return null;
  } catch {
    return null;
  }
}

function WatchDemoSection() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const fallbackWatchBtnRef = useRef<HTMLAnchorElement | null>(null);
  const retryBtnRef = useRef<HTMLButtonElement | null>(null);
  const fallbackOverlayRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const retryTrackedRef = useRef(false);
  const [fallbackLinkCopied, setFallbackLinkCopied] = useState(false);
  const [errorAnnouncement, setErrorAnnouncement] = useState("");

  // When the fallback overlay opens: remember the previously focused
  // element, move focus to the primary action, and broadcast an
  // assertive announcement. When it closes, restore focus.
  useEffect(() => {
    if (playerError && !playerLoading) {
      previouslyFocusedRef.current =
        (document.activeElement as HTMLElement | null) ?? null;
      setErrorAnnouncement(
        "Demo video failed to load. Use the Watch, Copy link, or Retry buttons.",
      );
      const id = window.setTimeout(() => {
        fallbackWatchBtnRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }
    // Overlay just closed — clear the live region and restore focus.
    setErrorAnnouncement("");
    const prev = previouslyFocusedRef.current;
    if (prev && document.contains(prev)) {
      prev.focus();
    }
    previouslyFocusedRef.current = null;
  }, [playerError, playerLoading]);

  // Keyboard trap: keep Tab/Shift+Tab inside the overlay; Esc retries.
  function handleOverlayKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setPlayerError(false);
      setPlayerLoading(true);
      return;
    }
    if (e.key !== "Tab") return;
    const root = fallbackOverlayRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("aria-hidden"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
  const [shareCopied, setShareCopied] = useState(false);
  const [shareToastsEnabled, setShareToastsEnabled] = useState(true);

  async function handleShare() {
    // Build the canonical deep link to this section regardless of which
    // route variant or query string the user is currently on.
    const basePath = import.meta.env.BASE_URL;
    const deepLink = `${window.location.origin}${basePath}#watch-demo`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deepLink);
      } else {
        // Fallback for older browsers / insecure contexts.
        const ta = document.createElement("textarea");
        ta.value = deepLink;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setShareCopied(true);
      if (shareToastsEnabled) {
        toast.success("Demo link copied to clipboard");
      }
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      if (shareToastsEnabled) {
        toast.error("Couldn't copy link — please copy from the address bar.");
      }
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEMO_PREVIEW_STORAGE_KEY);
      if (saved) {
        setPreviewUrl(saved);
        // Pre-fill the input so the user can see/edit the persisted URL
        // after a page refresh.
        setDraft((current) => current || saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SHARE_TOASTS_KEY);
      if (saved != null) setShareToastsEnabled(saved === "true");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SHARE_TOASTS_KEY, String(shareToastsEnabled));
    } catch {
      /* ignore */
    }
  }, [shareToastsEnabled]);

  // Smooth-scroll to this section when the user lands with the matching hash.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#watch-demo") return;
    const el = document.getElementById("watch-demo");
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Move focus for screen-reader users without showing a visible ring.
      el.focus({ preventScroll: true });
    }, 100);
    return () => window.clearTimeout(timer);
  }, []);

  const liveUrl = DEMO_VIDEO_URL || previewUrl;
  // Validate the draft URL live so the CTA stays disabled until it normalizes
  // to a real embed URL.
  const draftEmbed = toEmbedUrl(draft);
  const isDraftValid = !!draftEmbed;
  // Block re-submits while the player is still initializing the current URL.
  const submitDisabled = !isDraftValid || playerLoading;

  // Reset loading state whenever the active embed URL changes so the spinner
  // overlays the iframe until its onLoad fires (or we time out).
  useEffect(() => {
    if (!liveUrl) {
      setPlayerLoading(false);
      setPlayerError(false);
      return;
    }
    setPlayerLoading(true);
    setPlayerError(false);
    // Safety timeout — if the embed never fires onLoad (blocked, offline, etc.)
    // we surface an error instead of leaving the CTA disabled forever.
    const timer = setTimeout(() => {
      setPlayerLoading((loading) => {
        if (loading) setPlayerError(true);
        return false;
      });
    }, 12_000);
    return () => clearTimeout(timer);
  }, [liveUrl]);

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!draftEmbed) {
      toast.error("Please paste a valid YouTube, Vimeo, or .mp4 link.");
      return;
    }
    try {
      localStorage.setItem(DEMO_PREVIEW_STORAGE_KEY, draftEmbed);
    } catch {
      /* ignore */
    }
    setPreviewUrl(draftEmbed);
    setDraft(draftEmbed);
    toast.success("Preview saved — it'll reload automatically next time.");
  }

  function handleClear() {
    try {
      localStorage.removeItem(DEMO_PREVIEW_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setPreviewUrl(null);
    setDraft("");
  }

  const mailto = `mailto:${DEMO_SUBMIT_EMAIL}?subject=${encodeURIComponent(
    "Resonance ePublisher — demo walkthrough video",
  )}&body=${encodeURIComponent(
    "Hi Resonance team,\n\nHere's a walkthrough video to feature on the homepage:\n\nVideo URL: \n\nCreator name & role (optional): \n\nThanks!",
  )}`;

  return (
    <section
      id="watch-demo"
      aria-labelledby="watch-demo-heading"
      tabIndex={-1}
      className="container px-6 pb-20 scroll-mt-24 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl"
    >
      <div className="max-w-4xl mx-auto text-center space-y-3 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs text-primary">
          <Play className="w-3 h-3" aria-hidden="true" /> Walkthrough
        </div>
        <h2
          id="watch-demo-heading"
          tabIndex={-1}
          className="text-2xl md:text-3xl font-display font-bold focus:outline-none"
        >
          See Resonance ePublisher in Action
        </h2>
        <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto">
          Watch how a simple topic becomes a researched, narrated, illustrated AudioVisual eBook — ready for PDF, HTML, or ePub export.
        </p>
        <div className="flex items-center justify-center gap-3 pt-1">
          {(() => {
            const deepLink =
              typeof window !== "undefined"
                ? `${window.location.origin}${import.meta.env.BASE_URL}#watch-demo`
                : "#watch-demo";
            const shareText = "See Resonance ePublisher in action — watch the demo:";
            const emailHref = `mailto:?subject=${encodeURIComponent(
              "Watch the Resonance ePublisher demo",
            )}&body=${encodeURIComponent(`${shareText}\n\n${deepLink}`)}`;
            const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
              shareText,
            )}&url=${encodeURIComponent(deepLink)}`;
            const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
              deepLink,
            )}`;
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Share the Watch Demo section"
                    className="gap-2 text-xs text-muted-foreground hover:text-primary"
                  >
                    {shareCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" /> Link copied
                      </>
                    ) : (
                      <>
                        <Share2 className="w-3.5 h-3.5" aria-hidden="true" /> Share this demo
                      </>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="center"
                  className="w-72 p-2"
                  aria-label="Share options"
                >
                  <div className="px-2 pt-1.5 pb-2">
                    <p className="text-[11px] font-mono break-all text-muted-foreground">
                      {deepLink}
                    </p>
                  </div>
                  <div className="h-px bg-border my-1" />
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={handleShare}
                      className="flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent text-left"
                    >
                      {shareCopied ? (
                        <Check className="w-4 h-4 text-primary" aria-hidden="true" />
                      ) : (
                        <Link2 className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span>{shareCopied ? "Link copied" : "Copy link"}</span>
                    </button>
                    <a
                      href={emailHref}
                      className="flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent"
                    >
                      <Mail className="w-4 h-4" aria-hidden="true" />
                      <span>Email</span>
                    </a>
                    <a
                      href={twitterHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent"
                    >
                      <Twitter className="w-4 h-4" aria-hidden="true" />
                      <span>Share on X (Twitter)</span>
                    </a>
                    <a
                      href={linkedinHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent"
                    >
                      <Linkedin className="w-4 h-4" aria-hidden="true" />
                      <span>Share on LinkedIn</span>
                    </a>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })()}
          <div className="flex items-center gap-1.5">
            <Switch
              id="share-toasts"
              checked={shareToastsEnabled}
              onCheckedChange={setShareToastsEnabled}
              className="scale-75 origin-center"
              aria-label="Show toast notification when sharing"
            />
            <Label htmlFor="share-toasts" className="text-[11px] text-muted-foreground cursor-pointer select-none">
              Notify
            </Label>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative max-w-4xl mx-auto rounded-2xl overflow-hidden border border-border/40 shadow-2xl shadow-primary/10 aspect-video bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10"
      >
        {liveUrl ? (
          <>
            {/* Persistent live region so the embed error is announced
                even when the alertdialog itself doesn't re-trigger SR
                output (some readers only announce role=alert/aria-live). */}
            <div
              role="status"
              aria-live="assertive"
              aria-atomic="true"
              className="sr-only"
            >
              {errorAnnouncement}
            </div>
            <iframe
              key={liveUrl}
              src={liveUrl}
              title="Resonance ePublisher product walkthrough video"
              aria-label="Resonance ePublisher product walkthrough video player"
              tabIndex={0}
              loading="lazy"
              className="absolute inset-0 w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              onLoad={() => {
                setPlayerLoading(false);
                setPlayerError(false);
              }}
              onError={() => {
                setPlayerLoading(false);
                setPlayerError(true);
                retryTrackedRef.current = false;
                const { providerLabel } = resolveWatchUrl(liveUrl);
                const res = validateEmbedEventProps(providerLabel, liveUrl);
                if (res.ok === true) {
                  trackEvent("demo_video_embed_failed", { provider: res.provider, embed_url: res.embed_url });
                } else {
                  trackEvent("demo_video_embed_invalid", { source_event: "demo_video_embed_failed", reason: res.reason });
                }
              }}
            />
            {playerLoading && (
              <div
                role="status"
                aria-live="polite"
                aria-label="Loading demo video"
                className="absolute inset-0 overflow-hidden bg-gradient-to-br from-background via-primary/5 to-accent/10 animate-fade-in"
              >
                {/* Shimmer sweep */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary/10 to-transparent"
                  style={{ animationName: "shimmer" }}
                />
                <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>

                {/* Centered branded play placeholder */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-primary/30 blur-xl animate-pulse" />
                    <div className="relative w-20 h-20 rounded-full bg-primary/20 border border-primary/40 backdrop-blur-sm flex items-center justify-center">
                      <Play className="w-8 h-8 text-primary ml-1" aria-hidden="true" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Loading demo video…</span>
                  </div>
                </div>

                {/* Faux control bar */}
                <div className="absolute bottom-0 inset-x-0 p-4 flex items-center gap-3">
                  <div className="h-1.5 flex-1 rounded-full bg-muted/40 overflow-hidden">
                    <div className="h-full w-1/3 bg-primary/40 animate-pulse rounded-full" />
                  </div>
                  <div className="h-3 w-10 rounded bg-muted/40 animate-pulse" />
                </div>
                <span className="sr-only">Video player is initializing</span>
              </div>
            )}
            {playerError && !playerLoading && (() => {
              // See src/lib/embed-url.ts for the parsing rules and tests.
              const { watchUrl, providerLabel } = resolveWatchUrl(liveUrl);
              return (
                <div
                  ref={fallbackOverlayRef}
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="demo-player-error-title"
                  aria-describedby="demo-player-error-desc"
                  tabIndex={-1}
                  onKeyDown={handleOverlayKeyDown}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6 bg-background/90 backdrop-blur-sm focus:outline-none"
                >
                  <div className="w-12 h-12 rounded-full bg-destructive/15 border border-destructive/30 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                  </div>
                  <div className="space-y-1 max-w-md">
                    <p id="demo-player-error-title" className="font-display font-semibold text-base">Player couldn't load</p>
                    <p id="demo-player-error-desc" className="text-sm text-muted-foreground">
                      The video may be blocked by your network, an extension, or unavailable in your region. You can watch it directly instead.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <Button asChild size="sm" className="gap-2">
                      <a
                        ref={fallbackWatchBtnRef}
                        href={watchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        Watch on {providerLabel}
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={async () => {
                        try {
                          if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(watchUrl);
                          } else {
                            const ta = document.createElement("textarea");
                            ta.value = watchUrl;
                            ta.setAttribute("readonly", "");
                            ta.style.position = "absolute";
                            ta.style.left = "-9999px";
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand("copy");
                            document.body.removeChild(ta);
                          }
                          setFallbackLinkCopied(true);
                          if (shareToastsEnabled) toast.success("Video link copied");
                          window.setTimeout(() => setFallbackLinkCopied(false), 2000);
                        } catch {
                          toast.error("Couldn't copy the link");
                        }
                      }}
                      aria-label={fallbackLinkCopied ? "Video link copied" : "Copy video link"}
                    >
                      {fallbackLinkCopied ? (
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      {fallbackLinkCopied ? "Link copied" : "Copy link"}
                    </Button>
                    <Button
                      ref={retryBtnRef}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!retryTrackedRef.current) {
                          const res = validateEmbedEventProps(providerLabel, liveUrl);
                          if (res.ok === true) {
                            trackEvent("demo_video_embed_retry", { provider: res.provider, embed_url: res.embed_url });
                            retryTrackedRef.current = true;
                          } else {
                            trackEvent("demo_video_embed_invalid", { source_event: "demo_video_embed_retry", reason: res.reason });
                            retryTrackedRef.current = true;
                          }
                        }
                        setPlayerError(false);
                        setPlayerLoading(true);
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6">
            <div className="w-16 h-16 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center backdrop-blur-sm">
              <Play className="w-7 h-7 text-primary ml-1" />
            </div>
            <p className="font-display font-semibold text-base">
              The official walkthrough is in production
            </p>
            <p className="text-sm text-muted-foreground max-w-md">
              We're filming a full topic-to-export demo. Until then, you can preview any YouTube or Vimeo walkthrough below — or jump straight in and try it yourself.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1">
              <Link to="/auth">Try the eBook generator</Link>
            </Button>
          </div>
        )}
      </motion.div>

      {/* Helper panel below the player */}
      <div className="max-w-4xl mx-auto mt-6 grid gap-4 md:grid-cols-2">
        <form
          onSubmit={handleApply}
          className="glass-card p-4 space-y-2"
          aria-label="Preview a demo video URL on this device"
        >
          <label htmlFor="demo-url-input" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Preview a video here
          </label>
          <p className="text-xs text-muted-foreground">
            Paste a YouTube, Vimeo, or .mp4 URL to load it into the player above. Saved on this device only — handy for previewing options before we publish the official demo.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Input
              id="demo-url-input"
              type="url"
              placeholder="https://youtube.com/watch?v=…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={draft.length > 0 && !isDraftValid}
              className="flex-1"
            />
            <Button
              type="submit"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={submitDisabled}
              aria-disabled={submitDisabled}
              title={
                !draft
                  ? "Paste a YouTube, Vimeo, or .mp4 link"
                  : !isDraftValid
                    ? "Link isn't a supported YouTube, Vimeo, or .mp4 URL"
                    : playerLoading
                      ? "Player is still loading…"
                      : "Load this video into the player"
              }
            >
              {playerLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {playerLoading ? "Loading…" : "Preview"}
            </Button>
            {previewUrl && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleClear}
                disabled={playerLoading}
                className="shrink-0"
              >
                Clear
              </Button>
            )}
          </div>
          {draft.length > 0 && !isDraftValid && (
            <p className="text-[11px] text-destructive mt-1">
              Unsupported link. Use a YouTube, Vimeo, or direct .mp4/.webm URL.
            </p>
          )}
        </form>

        <div className="glass-card p-4 space-y-2 flex flex-col">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Have a walkthrough to submit?
          </span>
          <p className="text-xs text-muted-foreground flex-1">
            Created a great walkthrough of Resonance ePublisher? Send us the link and we'll review it for the official homepage demo or our community gallery.
          </p>
          <Button asChild size="sm" variant="outline" className="gap-2 mt-1 self-start">
            <a href={mailto}>
              <Mail className="w-4 h-4" /> Submit a demo video
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

const features = [
  { icon: Globe, key: "land.feat.internet" },
  { icon: Youtube, key: "land.feat.youtube" },
  { icon: Upload, key: "land.feat.upload" },
  { icon: Mic, key: "land.feat.speech" },
  { icon: BookOpen, key: "land.feat.storyboard" },
  { icon: Image, key: "land.feat.visual" },
  { icon: Sparkles, key: "land.feat.ai" },
  { icon: Music, key: "land.feat.music" },
  { icon: FileOutput, key: "land.feat.export" },
  { icon: Languages, key: "land.feat.lang" },
];

export default function Landing() {
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [demoInView, setDemoInView] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (OPEN_NOVA_LOCAL_ONLY) {
      navigate("/app", { replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/app", { replace: true });
    });
  }, [navigate]);

  // Scroll-spy: highlight the Watch Demo CTA when #watch-demo is visible.
  useEffect(() => {
    const target = document.getElementById("watch-demo");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setDemoInView(entry.isIntersecting),
      { threshold: 0.35, rootMargin: "-80px 0px -20% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Seo
        title="Resonance ePublisher — AI AudioVisual eBook Creator"
        description="Turn any topic, script, or recording into a researched, narrated, illustrated AudioVisual eBook. Export to PDF, HTML, ePub, or MP4 video."
        path="/"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              { "@type": "Question", name: "Can I create an eBook from any topic?", acceptedAnswer: { "@type": "Answer", text: "Yes. Start from a topic, idea, title, script, podcast, or educational theme and Resonance ePublisher will research and structure it for you." } },
              { "@type": "Question", name: "Can I export the final book?", acceptedAnswer: { "@type": "Answer", text: "Yes. Finished books export as PDF, HTML eBook, or ePub, with optional narrated MP4 video on Standard and Premium tiers." } },
              { "@type": "Question", name: "Does the AI research the topic for me?", acceptedAnswer: { "@type": "Answer", text: "Yes. The platform performs structured AI research, but users should verify factual, medical, legal, financial, or technical content before publishing." } },
              { "@type": "Question", name: "Can I use this for business or education?", acceptedAnswer: { "@type": "Answer", text: "Yes. Resonance ePublisher is suitable for training material, lead magnets, product guides, educational content, and creator products." } },
              { "@type": "Question", name: "Can I add narration and music?", acceptedAnswer: { "@type": "Answer", text: "Yes. Books can include voice narration plus background music for a full AudioVisual experience." } },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "VideoObject",
            name: "Resonance ePublisher walkthrough",
            description: "A short walkthrough showing how Resonance ePublisher turns a topic into a researched, narrated, illustrated AudioVisual eBook ready for PDF, HTML, or ePub export.",
            thumbnailUrl: ["https://img.youtube.com/vi/-1SjoH9KFVg/maxresdefault.jpg"],
            uploadDate: "2025-01-01",
            embedUrl: "https://www.youtube-nocookie.com/embed/-1SjoH9KFVg",
            contentUrl: "https://www.youtube.com/watch?v=-1SjoH9KFVg",
            publisher: { "@type": "Organization", name: "Resonance ePublisher", url: "https://www.resonanceonline.life/" },
          },
        ]}
      />
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-0">
            <motion.img
              src={resonanceLogo}
              alt="Resonance ePublisher"
              className="w-[50px] h-[50px] object-contain"
              animate={{ rotateY: [0, -30, 0, 30, 0], scaleX: [1, 0.85, 1, 0.85, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              style={{ perspective: 600 } as any}
            />
            <span className="font-display text-xl font-semibold tracking-tight gradient-text">
              Resonance ePublisher
            </span>
          </div>
          <div className="flex items-center gap-3">
            <nav className="hidden md:flex items-center gap-1 text-sm">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/about">{t("nav.about")}</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/contact">{t("nav.contact")}</Link>
              </Button>
              <LanguageToggle />
              <ThemeToggle />
            </nav>
            <Button variant="outline" size="sm" asChild>
              <Link to="/auth">{t("nav.signIn")}</Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>
        {/* Mobile nav */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden border-t border-border overflow-hidden"
            >
              <nav className="flex flex-col items-stretch gap-1 p-4">
                <Button variant="ghost" size="sm" asChild onClick={() => setMobileOpen(false)} className="justify-start min-h-[44px]">
                  <Link to="/about">{t("nav.about")}</Link>
                </Button>
                <Button variant="ghost" size="sm" asChild onClick={() => setMobileOpen(false)} className="justify-start min-h-[44px]">
                  <Link to="/contact">{t("nav.contact")}</Link>
                </Button>
                <div className="mt-2 pt-3 border-t border-border">
                  <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("nav.preferences") || "Preferences"}
                  </p>
                  <div className="flex flex-col items-stretch gap-1">
                    <LanguageToggle />
                    <ThemeToggle showLabel />
                  </div>
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="flex-1 flex flex-col">
      {/* Hero */}
      <section className="relative flex-1 flex flex-col items-center justify-center text-center px-6 py-16 md:py-24 overflow-hidden">
        <FloatingParticles />
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative z-10 max-w-4xl mx-auto space-y-6"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-mono uppercase tracking-[0.22em] text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Tools in tune with you
          </div>

          <h1 className="text-4xl md:text-6xl font-display font-bold leading-[0.98] tracking-tight">
            {t("land.hero1")}{" "}
            <span className="gradient-text">{t("land.hero2")}</span>
          </h1>

          <p className="text-[11px] md:text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground">
            <span style={{ color: "hsl(265 85% 65%)" }}>One Account</span>
            <span className="mx-2 text-muted-foreground/50">·</span>
            <span style={{ color: "hsl(295 90% 60%)" }}>Multiple Tools</span>
            <span className="mx-2 text-muted-foreground/50">·</span>
            <span style={{ color: "hsl(325 90% 65%)" }}>Endless Possibilities</span>
          </p>

          <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto">
            {t("land.subtitle")}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button size="lg" asChild className="gap-2 glow-primary rounded-full">
              <Link to="/auth" onClick={() => trackEvent("create_first_ebook_click", { location: "hero" })}>
                Start Free <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild className="gap-2 rounded-full">
              <a href="https://reson8.life/pricing" target="_blank" rel="noopener noreferrer">
                Compare Apps
              </a>
            </Button>
            <Button variant="secondary" size="lg" asChild className="gap-2 rounded-full">
              <a href="https://reson8.life" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("back_to_hub_click", { location: "hero" })}>
                Back to hub <ArrowUpRight className="w-4 h-4" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              asChild
              className={`gap-2 transition-all rounded-full ${
                demoInView
                  ? "border border-primary text-primary bg-primary/10 shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]"
                  : ""
              }`}
            >
              <a
                href="#watch-demo"
                aria-current={demoInView ? "true" : undefined}
                aria-label={`${t("land.cta.watchDemo")} — scroll to demo video section`}
                aria-controls="watch-demo"
                onClick={(e) => {
                  e.preventDefault();
                  trackEvent("watch_demo_click", { location: "hero" });
                  const target = document.getElementById("watch-demo");
                  if (!target) return;
                  const header = document.querySelector("header");
                  const offset = (header?.getBoundingClientRect().height ?? 64) + 16;
                  const top = target.getBoundingClientRect().top + window.scrollY - offset;
                  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  window.scrollTo({ top, behavior: prefersReduced ? "auto" : "smooth" });
                  history.replaceState(null, "", "#watch-demo");
                  const moveFocus = () => {
                    const heading = document.getElementById("watch-demo-heading");
                    const focusTarget = (heading ?? target) as HTMLElement;
                    focusTarget.focus({ preventScroll: true });
                  };
                  window.setTimeout(moveFocus, prefersReduced ? 0 : 600);
                }}
              >
                <Play className="w-4 h-4" aria-hidden="true" /> {t("land.cta.watchDemo")}
              </a>
            </Button>
          </div>

          {/* Attribute block — Resonance ePublisher = Intelligence (IQ) */}
          <div className="flex justify-center pt-2">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl px-4 py-2.5 max-w-xl">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-lg" aria-hidden="true">
                🧠
              </span>
              <div className="text-left">
                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-primary">
                  Intelligence · IQ
                </div>
                <div className="text-sm text-foreground/90">
                  The publishing brain of The Resonance — research, write, narrate, illustrate.
                </div>
              </div>
            </div>
          </div>

          {/* Trust strip */}
          <p className="text-xs text-muted-foreground/80 pt-2">
            🇿🇦 Built in South Africa · ZAR pricing · Once-off packs via The Resonance Hub · POPIA-conscious
          </p>

          {/* Hero illustration – animated floating + glow */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.3 }}
            className="relative pt-8"
          >
            <motion.div
              animate={{ y: [0, -8, 0, 6, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="relative rounded-2xl overflow-hidden border border-border/40 shadow-2xl shadow-primary/10"
            >
              <img
                src={heroIllustration}
                alt="AudioVisual eBook by Resonance ePublisher"
                width={1280}
                height={720}
                className="w-full h-auto"
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
            </motion.div>
            <motion.div
              animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.05, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-primary/20 via-accent/10 to-primary/20 blur-3xl"
            />
          </motion.div>
        </motion.div>
      </section>

      {/* Features grid with scrolling body text */}
      <section className="container px-6 pb-20">
        <h2 className="text-2xl md:text-3xl font-display font-bold text-center mb-12">
          {t("land.featTitle")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 max-w-6xl mx-auto">
          {features.map(({ icon: Icon, key }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.06, duration: 0.5 }}
              className="glass-card p-5 space-y-3 text-center group"
            >
              <div className="w-10 h-10 mx-auto rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-sm">{t(key)}</h3>
              <div className="h-16 overflow-hidden relative">
                <motion.p
                  className="text-xs text-muted-foreground leading-relaxed"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
                >
                  {t(key + ".desc")}
                </motion.p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="container px-6 pb-20">
        <h2 className="text-2xl md:text-3xl font-display font-bold text-center mb-14">
          {t("land.howTitle")}
        </h2>
        <div className="relative max-w-4xl mx-auto">
          <div className="hidden md:block absolute top-10 left-[16.67%] right-[16.67%] h-px bg-gradient-to-r from-primary/40 via-accent/40 to-primary/40" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              { icon: Search, step: 1, key: "land.how.step1" },
              { icon: SlidersHorizontal, step: 2, key: "land.how.step2" },
              { icon: Wand2, step: 3, key: "land.how.step3" },
            ].map(({ icon: Icon, step, key }, i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15, duration: 0.5 }}
                className="flex flex-col items-center text-center space-y-4"
              >
                <div className="relative">
                  <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Icon className="w-8 h-8 text-primary" />
                  </div>
                  <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                    {step}
                  </span>
                </div>
                <h3 className="font-display font-semibold text-lg">{t(key)}</h3>
                <p className="text-sm text-muted-foreground max-w-xs">{t(key + ".desc")}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Watch How It Works */}
      <WatchDemoSection />

      {/* Sample eBooks */}
      <section className="container px-6 pb-20">
        <div className="text-center mb-10 space-y-2">
          <h2 className="text-2xl md:text-3xl font-display font-bold">Example AudioVisual eBooks</h2>
          <p className="text-muted-foreground text-sm">A preview of what creators are publishing with Resonance.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {SAMPLE_EBOOKS.map((b, i) => (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
            >
              <Link
                to={b.href}
                onClick={() => trackEvent("sample_preview_click", { href: b.href, title: b.title })}
                aria-label={`Preview sample eBook: ${b.title}`}
                className="glass-card overflow-hidden group flex flex-col hover:border-primary/40 transition-colors h-full"
              >
                <div className="aspect-[3/4] bg-gradient-to-br from-primary/20 via-accent/10 to-primary/10 flex items-center justify-center relative overflow-hidden">
                  {b.cover ? (
                    <img src={b.cover} alt={b.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                  ) : (
                    <BookOpen className="w-10 h-10 text-primary/60" />
                  )}
                </div>
                <div className="p-4 space-y-1 flex-1">
                  <h3 className="font-display font-semibold text-sm leading-tight">{b.title}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2">{b.desc}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Who It's For */}
      <section className="container px-6 pb-20">
        <div className="text-center mb-10 space-y-2">
          <h2 className="text-2xl md:text-3xl font-display font-bold">Who It's For</h2>
          <p className="text-muted-foreground text-sm">An AI publishing studio for anyone with knowledge worth sharing.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 max-w-5xl mx-auto">
          {AUDIENCES.map(({ icon: Icon, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="glass-card p-4 text-center space-y-2"
            >
              <div className="w-10 h-10 mx-auto rounded-lg bg-accent/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-accent" />
              </div>
              <p className="text-xs font-medium">{label}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="container px-6 pb-20">
        <h2 className="text-2xl md:text-3xl font-display font-bold text-center mb-12">
          {t("land.testimonialsTitle")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {[1, 2, 3].map((n, i) => (
            <motion.blockquote
              key={n}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.5 }}
              className="glass-card p-6 flex flex-col gap-4"
            >
              <p className="text-sm text-muted-foreground italic leading-relaxed">
                "{t(`land.test${n}.quote`)}"
              </p>
              <footer className="mt-auto flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                  {t(`land.test${n}.name`).charAt(0)}
                </div>
                <div>
                  <div className="text-sm font-semibold">{t(`land.test${n}.name`)}</div>
                  <div className="text-xs text-muted-foreground">{t(`land.test${n}.role`)}</div>
                </div>
              </footer>
            </motion.blockquote>
          ))}
        </div>
      </section>
      {/* Free Access Promotion */}
      <motion.section
        className="container px-6 pb-20"
        onViewportEnter={() => trackEvent("promotion_view")}
        viewport={{ once: true, amount: 0.2 }}
      >
        <div className="max-w-3xl mx-auto glass-card p-8 md:p-10 text-center border-primary/25">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-primary mb-3">
            Free Access Promotion
          </p>
          <h2 className="text-2xl md:text-4xl font-display font-bold">
            Full ePublisher access is free while we establish real operating costs
          </h2>
          <p className="text-muted-foreground text-sm md:text-base mt-4 max-w-2xl mx-auto">
            No payment, pack, top-up, checkout, or subscription is required. Generation, narration,
            publishing, and export usage are measured so future pricing can be based on validated cost.
          </p>
          <Button asChild className="mt-6 rounded-full glow-primary">
            <Link to="/app" onClick={() => trackEvent("promotion_open_app_click", { source: "landing" })}>
              Open ePublisher free
            </Link>
          </Button>
        </div>
      </motion.section>

      {/* FAQ */}
      <section className="container px-6 pb-20">
        <div className="flex items-center justify-center gap-2 mb-4">
          <HelpCircle className="w-6 h-6 text-primary" />
          <h2 className="text-2xl md:text-3xl font-display font-bold text-center">
            {t("land.faqTitle")}
          </h2>
        </div>
        <Accordion type="single" collapsible className="max-w-2xl mx-auto">
          {[1, 2, 3, 4, 5].map((n) => (
            <AccordionItem key={n} value={`faq-${n}`}>
              <AccordionTrigger className="text-left text-sm font-semibold">
                {t(`land.faq${n}.q`)}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm">
                {t(`land.faq${n}.a`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* Beta Signup */}
      <BetaSignupForm />

      {/* AI & Legal Trust Block */}
      <section className="container px-6 pb-16">
        <div className="max-w-4xl mx-auto glass-card p-6 md:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display font-semibold text-lg">Responsible AI Publishing</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Resonance ePublisher uses AI to research, narrate, and illustrate your content. AI-generated material can contain inaccuracies — please verify any educational, medical, legal, spiritual, or business content before publishing or distributing it. Imagery is generated for illustrative purposes; review for copyright and likeness concerns before commercial use.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border/40">
            <Link to="/privacy" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
              <Shield className="w-4 h-4" /> Privacy Policy
            </Link>
            <Link to="/terms" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
              <FileText className="w-4 h-4" /> Terms of Use
            </Link>
            <Link to="/contact" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
              <Mail className="w-4 h-4" /> Contact Resonance
            </Link>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-t border-border py-12">
        <div className="container px-6 flex flex-wrap items-center justify-center gap-8 text-muted-foreground text-sm">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" /> {t("land.trust.secure")}
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" /> {t("land.trust.fast")}
          </div>
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-primary" /> {t("land.trust.bilingual")}
          </div>
        </div>
      </section>
      </main>

      <AppFooter />
    </div>
  );
}
