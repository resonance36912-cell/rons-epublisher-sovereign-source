import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, Play, Download, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { Seo } from "@/components/Seo";
import { trackEvent } from "@/lib/analytics";
import coverDiagnostics from "@/assets/sample-cover-diagnostics.jpg";
import coverUniverse from "@/assets/sample-cover-universe.jpg";
import coverFounder from "@/assets/sample-cover-founder.jpg";
import coverAutomate from "@/assets/sample-cover-automate.jpg";

type Sample = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  chapters: number;
  duration: string;
  cover?: string;
  /** External preview link (e.g. published HTML eBook). Leave empty to hide. */
  previewUrl?: string;
  /** Direct PDF download. Leave empty to hide. */
  pdfUrl?: string;
  /** YouTube/Vimeo embed URL. Leave empty to hide. */
  videoEmbedUrl?: string;
};

export const SAMPLE_PREVIEWS: Sample[] = [
  {
    slug: "the-vision-of-diagnostics",
    title: "The Vision of Diagnostics",
    tagline: "How modern diagnostics are reshaping global healthcare.",
    description:
      "A researched audiovisual journey through the science, business, and human stories behind point-of-care diagnostics — from rapid antigen tests to AI-powered triage. Built entirely with Resonance ePublisher.",
    chapters: 12,
    duration: "~38 min",
    cover: coverDiagnostics,
  },
  {
    slug: "the-secrets-of-the-universe",
    title: "The Secrets of the Universe",
    tagline: "A cinematic journey through cosmology and discovery.",
    description:
      "From the Big Bang to dark matter, this AudioVisual eBook turns dense astrophysics into a guided narrative with cinematic imagery, layered narration, and an ambient score.",
    chapters: 15,
    duration: "~52 min",
    cover: coverUniverse,
  },
  {
    slug: "ashley-uys-story",
    title: "Ashley Uys — A Founder's Story",
    tagline: "From Cape Town lab bench to international biotech.",
    description:
      "A personal narrative AudioVisual eBook chronicling the founding of Medical Diagnostech, the Resonance ecosystem, and the lessons learned along the way.",
    chapters: 10,
    duration: "~32 min",
    cover: coverFounder,
  },
  {
    slug: "automate-your-life",
    title: "How to Automate Your Life",
    tagline: "Practical AI workflows for creators and small business.",
    description:
      "A hands-on guide turning everyday tasks into automated AI flows — content creation, scheduling, research, publishing. Every chapter includes a narrated walkthrough.",
    chapters: 8,
    duration: "~25 min",
    cover: coverAutomate,
  },
];

export default function SamplePreview() {
  const { slug } = useParams<{ slug: string }>();
  const sample = SAMPLE_PREVIEWS.find((s) => s.slug === slug);

  if (!sample) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Seo
          title="Sample not found — Resonance ePublisher"
          description="The sample AudioVisual eBook you requested could not be found. Browse other samples on the Resonance ePublisher homepage."
          path={`/samples/${slug ?? ""}`}
        />
        <div className="container max-w-3xl px-6 py-16 flex-1 text-center space-y-6">
          <h1 className="text-3xl font-display font-bold">Sample not found</h1>
          <p className="text-muted-foreground">
            We couldn't find that sample eBook. Browse the homepage to see what's available.
          </p>
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Seo
        title={`${sample.title} — Resonance ePublisher`}
        description={sample.tagline}
        path={`/samples/${sample.slug}`}
        type="article"
        image={sample.cover}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          name: sample.title,
          headline: sample.title,
          description: sample.description,
          ...(sample.cover ? { image: `https://www.resonanceonline.life${sample.cover.startsWith("/") ? "" : "/"}${sample.cover}` } : {}),
          url: `https://www.resonanceonline.life/samples/${sample.slug}`,
          author: { "@type": "Organization", name: "Resonance ePublisher" },
          publisher: { "@type": "Organization", name: "Resonance ePublisher", url: "https://www.resonanceonline.life/" },
        }}
      />
      <div className="container max-w-4xl px-6 py-12 flex-1 space-y-10">
        <Button variant="ghost" asChild className="gap-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>
        </Button>

        {/* Header */}
        <header className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs text-primary">
            <Sparkles className="w-3 h-3" /> Sample AudioVisual eBook
          </div>
          <h1 className="text-3xl md:text-5xl font-display font-bold leading-tight">{sample.title}</h1>
          <p className="text-lg text-muted-foreground">{sample.tagline}</p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2">
            <span className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" /> {sample.chapters} chapters
            </span>
            <span className="flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> {sample.duration} narrated
            </span>
          </div>
        </header>

        {/* Cover / video */}
        <div className="relative aspect-video rounded-2xl overflow-hidden border border-border/40 shadow-2xl shadow-primary/10 bg-gradient-to-br from-primary/15 via-accent/10 to-primary/10">
          {sample.videoEmbedUrl ? (
            <iframe
              src={sample.videoEmbedUrl}
              title={`${sample.title} preview`}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : sample.cover ? (
            <img src={sample.cover} alt={sample.title} className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <BookOpen className="w-16 h-16 text-primary/50" />
            </div>
          )}
        </div>

        {/* Description */}
        <section className="space-y-4">
          <h2 className="text-xl font-display font-semibold">About this eBook</h2>
          <p className="text-muted-foreground leading-relaxed">{sample.description}</p>
        </section>

        {/* Actions */}
        <section className="flex flex-wrap gap-3 pt-2">
          {sample.previewUrl && (
            <Button asChild className="gap-2 glow-primary">
              <a
                href={sample.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent("export_html_click", { slug: sample.slug, location: "sample_preview" })}
              >
                <ExternalLink className="w-4 h-4" /> Open full preview
              </a>
            </Button>
          )}
          {sample.pdfUrl && (
            <Button asChild variant="outline" className="gap-2">
              <a
                href={sample.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent("export_pdf_click", { slug: sample.slug, location: "sample_preview" })}
              >
                <Download className="w-4 h-4" /> Download PDF
              </a>
            </Button>
          )}
          <Button asChild variant={sample.previewUrl ? "ghost" : "default"} className="gap-2">
            <Link to="/auth" onClick={() => trackEvent("create_first_ebook_click", { location: "sample_preview", slug: sample.slug })}>Create your own eBook</Link>
          </Button>
        </section>

        {!sample.previewUrl && !sample.pdfUrl && !sample.videoEmbedUrl && (
          <p className="text-xs text-muted-foreground italic pt-2 border-t border-border/40">
            Full preview coming soon — this AudioVisual eBook is being prepared for public release.
          </p>
        )}
      </div>
      <AppFooter />
    </div>
  );
}
