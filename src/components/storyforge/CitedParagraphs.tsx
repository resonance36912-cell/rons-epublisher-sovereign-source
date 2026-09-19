import { useMemo, type CSSProperties } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ExternalLink, BookOpen } from "lucide-react";
import type { Source } from "./StoryForgeContext";

type Props = {
  body: string;
  references?: string[];
  sources: Source[];
  className?: string;
  style?: CSSProperties;
};

/**
 * Find a snippet inside `content` that best matches the paragraph.
 * Heuristic: take the first 6 words of the paragraph and locate them
 * (case-insensitive) inside the source content. Return ~180 chars of
 * surrounding context. Falls back to the leading 280 chars of the source.
 */
function findSnippet(paragraph: string, content?: string): { snippet: string; matched: boolean } | null {
  if (!content || !content.trim()) return null;
  const clean = content.replace(/\s+/g, " ").trim();
  const words = paragraph.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return { snippet: clean.slice(0, 280) + (clean.length > 280 ? "…" : ""), matched: false };

  // Try progressively shorter probes (6, 4, 3 words) for a stronger match.
  for (const probeLen of [6, 4, 3]) {
    if (words.length < probeLen) continue;
    const probe = words.slice(0, probeLen).join(" ").toLowerCase();
    const haystack = clean.toLowerCase();
    const idx = haystack.indexOf(probe);
    if (idx >= 0) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(clean.length, idx + probe.length + 180);
      return {
        snippet: (start > 0 ? "…" : "") + clean.slice(start, end) + (end < clean.length ? "…" : ""),
        matched: true,
      };
    }
  }
  return { snippet: clean.slice(0, 280) + (clean.length > 280 ? "…" : ""), matched: false };
}

function isUrl(s: string) {
  return /^https?:\/\//i.test(s);
}

function resolveSource(ref: string, sources: Source[]): Source | undefined {
  const r = ref.trim().toLowerCase();
  return (
    sources.find((s) => s.title?.trim().toLowerCase() === r) ||
    sources.find((s) => s.title && r.includes(s.title.trim().toLowerCase())) ||
    sources.find((s) => s.title && s.title.trim().toLowerCase().includes(r)) ||
    (isUrl(ref) ? sources.find((s) => s.id === ref || s.title?.includes(ref)) : undefined)
  );
}

export function CitedParagraphs({ body, references, sources, className, style }: Props) {
  const paragraphs = useMemo(
    () => body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    [body]
  );

  // Resolve once per render.
  const refSources = useMemo(() => {
    if (!references || references.length === 0) return [];
    return references.map((ref, i) => ({
      index: i + 1,
      label: ref,
      source: resolveSource(ref, sources),
    }));
  }, [references, sources]);

  if (paragraphs.length === 0) {
    return <div className={className} style={style}>{body}</div>;
  }

  return (
    <div className={className} style={style}>
      {paragraphs.map((p, pi) => (
        <p key={pi} className="whitespace-pre-wrap">
          {p}
          {refSources.length > 0 && (
            <span className="inline-flex items-baseline gap-0.5 ml-1 align-baseline">
              {refSources.map(({ index, label, source }) => {
                const snip = findSnippet(p, source?.content);
                const inlineUrl = label.match(/https?:\/\/[^\s·)]+/i)?.[0];
                const url = source?.canonicalUrl || source?.url || (source && isUrl(source.title) ? source.title : undefined) || inlineUrl || (isUrl(label) ? label : undefined);
                return (
                  <Popover key={index}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Citation ${index}: ${source?.title || label}`}
                        className="text-[10px] font-semibold leading-none align-super px-1 py-0.5 rounded text-primary hover:bg-primary/15 hover:text-primary transition-colors border border-primary/30 hover:border-primary/60 cursor-pointer"
                      >
                        [{index}]
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="start"
                      className="w-80 max-w-[90vw] text-xs space-y-2 p-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-start gap-2">
                        <BookOpen className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                        <div className="space-y-1 min-w-0">
                          <div className="font-semibold text-foreground/90 break-words">
                            {source?.title || label}
                          </div>
                          {source && (
                            <>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {source.type === "url" ? "Web source" : source.type === "file" ? "Uploaded file" : "Search result"}
                                {snip?.matched ? " · matched" : snip ? " · excerpt" : ""}
                                {source.verified === false ? " · unverified" : source.verified ? " · verified retrieval" : ""}
                              </div>
                              {(source.creator || source.publishedAt || source.relevantTimestamp) && (
                                <div className="text-[10px] text-muted-foreground leading-relaxed">
                                  {[source.creator, source.publishedAt, source.relevantTimestamp ? `time/section: ${source.relevantTimestamp}` : undefined]
                                    .filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {snip ? (
                        <blockquote className="text-foreground/75 leading-relaxed border-l-2 border-primary/40 pl-2 italic">
                          {snip.snippet}
                        </blockquote>
                      ) : (
                        <p className="text-muted-foreground italic">
                          No excerpt available — original source content was not retained.
                        </p>
                      )}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Open source <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </PopoverContent>
                  </Popover>
                );
              })}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}
