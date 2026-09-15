import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Download, Edit3, Eye, ChevronLeft, ChevronRight, FileText, Settings2, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { SlideChapter, StoryConfig } from "../StoryForgeContext";
import { ALL_PDF_FONTS, cssFontFamily, googleFontsLinkUrl } from "@/lib/pdf-fonts";

export type PdfStyleConfig = {
  coverTitleFont: string;
  coverTitleSize: number;
  coverTitleAlign: "left" | "center" | "right";
  chapterTitleFont: string;
  chapterTitleSize: number;
  chapterTitleAlign: "left" | "center" | "right";
  bodyFont: string;
  bodySize: number;
  bodyAlign: "left" | "center" | "right";
  bodyLineHeight: number;
  tocFont: string;
  tocSize: number;
};

export const DEFAULT_PDF_STYLE: PdfStyleConfig = {
  coverTitleFont: "helvetica",
  coverTitleSize: 36,
  coverTitleAlign: "center",
  chapterTitleFont: "helvetica",
  chapterTitleSize: 24,
  chapterTitleAlign: "center",
  bodyFont: "helvetica",
  bodySize: 13,
  bodyAlign: "left",
  bodyLineHeight: 6.5,
  tocFont: "helvetica",
  tocSize: 13,
};

type Props = {
  open: boolean;
  onClose: () => void;
  chapters: SlideChapter[];
  config: StoryConfig;
  referenceImage?: string | null;
  photoOnly: boolean;
  onDownload: (editedChapters: SlideChapter[], photoOnly: boolean, style: PdfStyleConfig) => void;
  onApplyEdits: (editedChapters: SlideChapter[]) => void;
};

function AlignToggle({ value, onChange }: { value: "left" | "center" | "right"; onChange: (v: "left" | "center" | "right") => void }) {
  const items: { v: "left" | "center" | "right"; icon: typeof AlignLeft }[] = [
    { v: "left", icon: AlignLeft },
    { v: "center", icon: AlignCenter },
    { v: "right", icon: AlignRight },
  ];
  return (
    <div className="flex border border-border/50 rounded-md overflow-hidden">
      {items.map(({ v, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`p-1.5 transition-colors ${value === v ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
}

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 text-xs w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALL_PDF_FONTS.map((f) => (
          <SelectItem key={f.value} value={f.value} className="text-xs" style={{ fontFamily: f.cssFamily }}>
            {f.label}{f.isGoogle ? " ✦" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PdfPreviewModal({
  open,
  onClose,
  chapters,
  config,
  referenceImage,
  photoOnly,
  onDownload,
  onApplyEdits,
}: Props) {
  const [editedChapters, setEditedChapters] = useState<SlideChapter[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasEdits, setHasEdits] = useState(false);
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [style, setStyle] = useState<PdfStyleConfig>({ ...DEFAULT_PDF_STYLE });

  // Inject Google Fonts CSS link for preview
  useEffect(() => {
    const linkId = "pdf-preview-google-fonts";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = googleFontsLinkUrl();
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setEditedChapters(chapters.map((ch) => ({ ...ch })));
      setEditingIndex(null);
      setCurrentPage(0);
      setHasEdits(false);
    }
  }, [open, chapters]);

  const totalPages = 2 + editedChapters.length;
  const coverImage = referenceImage || chapters.find((c) => c.imageUrl)?.imageUrl;

  const updateChapter = useCallback((index: number, field: "title" | "body", value: string) => {
    setEditedChapters((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setHasEdits(true);
  }, []);

  const updateStyle = useCallback(<K extends keyof PdfStyleConfig>(key: K, value: PdfStyleConfig[K]) => {
    setStyle((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleDownload = () => {
    if (hasEdits) onApplyEdits(editedChapters);
    onDownload(editedChapters, photoOnly, style);
    onClose();
  };

  const goPrev = () => setCurrentPage((p) => Math.max(0, p - 1));
  const goNext = () => setCurrentPage((p) => Math.min(totalPages - 1, p + 1));

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (editingIndex !== null) return;
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, editingIndex, totalPages]);

  const alignCSS = (a: "left" | "center" | "right") => a;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl h-[92vh] p-0 gap-0 overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card/50">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-foreground">PDF Preview</h3>
            <span className="text-xs text-muted-foreground">
              Page {currentPage + 1} of {totalPages}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showStylePanel ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowStylePanel(!showStylePanel)}
              className="gap-1.5"
            >
              <Settings2 className="w-4 h-4" />
              Style
            </Button>
            {hasEdits && (
              <span className="text-xs text-primary font-medium px-2 py-0.5 bg-primary/10 rounded-full">
                Edits pending
              </span>
            )}
            <Button onClick={handleDownload} className="gap-2" size="sm">
              <Download className="w-4 h-4" />
              Download PDF
            </Button>
          </div>
        </div>

        {/* Page navigation */}
        <div className="flex items-center justify-center gap-3 py-2 border-b border-border/40 bg-card/30">
          <Button variant="ghost" size="sm" onClick={goPrev} disabled={currentPage === 0}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentPage ? "bg-primary w-5" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
              />
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={goNext} disabled={currentPage === totalPages - 1}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Style panel */}
          {showStylePanel && (
            <div className="w-[240px] border-r border-border/50 bg-card/30 overflow-y-auto p-3 flex flex-col gap-4 shrink-0">
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Typography</h4>

              {/* Cover Title */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">Cover Title</p>
                <FontSelect value={style.coverTitleFont} onChange={(v) => updateStyle("coverTitleFont", v)} />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-8 shrink-0">{style.coverTitleSize}pt</span>
                  <Slider min={20} max={56} step={2} value={[style.coverTitleSize]} onValueChange={([v]) => updateStyle("coverTitleSize", v)} className="flex-1" />
                </div>
                <AlignToggle value={style.coverTitleAlign} onChange={(v) => updateStyle("coverTitleAlign", v)} />
              </div>

              {/* Chapter Title */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">Chapter Title</p>
                <FontSelect value={style.chapterTitleFont} onChange={(v) => updateStyle("chapterTitleFont", v)} />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-8 shrink-0">{style.chapterTitleSize}pt</span>
                  <Slider min={14} max={40} step={1} value={[style.chapterTitleSize]} onValueChange={([v]) => updateStyle("chapterTitleSize", v)} className="flex-1" />
                </div>
                <AlignToggle value={style.chapterTitleAlign} onChange={(v) => updateStyle("chapterTitleAlign", v)} />
              </div>

              {/* Body Text */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">Body Text</p>
                <FontSelect value={style.bodyFont} onChange={(v) => updateStyle("bodyFont", v)} />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-8 shrink-0">{style.bodySize}pt</span>
                  <Slider min={8} max={22} step={1} value={[style.bodySize]} onValueChange={([v]) => updateStyle("bodySize", v)} className="flex-1" />
                </div>
                <AlignToggle value={style.bodyAlign} onChange={(v) => updateStyle("bodyAlign", v)} />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-8 shrink-0">LH</span>
                  <Slider min={4} max={12} step={0.5} value={[style.bodyLineHeight]} onValueChange={([v]) => updateStyle("bodyLineHeight", v)} className="flex-1" />
                  <span className="text-[10px] text-muted-foreground">{style.bodyLineHeight}mm</span>
                </div>
              </div>

              {/* TOC */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">Table of Contents</p>
                <FontSelect value={style.tocFont} onChange={(v) => updateStyle("tocFont", v)} />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-8 shrink-0">{style.tocSize}pt</span>
                  <Slider min={8} max={22} step={1} value={[style.tocSize]} onValueChange={([v]) => updateStyle("tocSize", v)} className="flex-1" />
                </div>
              </div>

              <Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => setStyle({ ...DEFAULT_PDF_STYLE })}>
                Reset to defaults
              </Button>
            </div>
          )}

          {/* Preview area */}
          <ScrollArea className="flex-1">
            <div className="flex justify-center p-6">
              <div
                className="relative w-full max-w-[900px] rounded-lg shadow-2xl overflow-hidden"
                style={{ aspectRatio: "297 / 210", background: "rgb(26, 26, 46)" }}
              >
                {/* Cover page */}
                {currentPage === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-10">
                    {coverImage && (
                      <img src={coverImage} alt="Cover" className="absolute inset-0 w-full h-full object-cover opacity-30 blur-sm" />
                    )}
                    <div className="relative z-10 flex flex-col items-center gap-4 w-full">
                      <h1
                        className="font-bold w-full"
                        style={{
                          color: "#e2b97f",
                          fontFamily: cssFontFamily(style.coverTitleFont),
                          fontSize: `${Math.round(style.coverTitleSize * 0.75)}px`,
                          textAlign: alignCSS(style.coverTitleAlign),
                        }}
                      >
                        {config.topic || "Storybook"}
                      </h1>
                      <p className="text-base" style={{ color: "#8899aa", textAlign: alignCSS(style.coverTitleAlign) }}>
                        A {config.tone} {config.theme} storybook
                      </p>
                      <p className="text-sm" style={{ color: "#8899aa" }}>
                        {editedChapters.length} chapters
                      </p>
                    </div>
                  </div>
                )}

                {/* TOC page */}
                {currentPage === 1 && (
                  <div className="absolute inset-0 p-10 overflow-auto">
                    <h2 className="text-2xl font-bold text-center mb-2" style={{ color: "#e2b97f" }}>
                      Table of Contents
                    </h2>
                    <div className="w-20 h-px mx-auto mb-6" style={{ background: "#e2b97f" }} />
                    <div className="space-y-2 max-w-md mx-auto">
                      {editedChapters.map((ch, i) => (
                        <div
                          key={ch.id}
                          className="flex gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setCurrentPage(i + 2)}
                        >
                          <span
                            className="font-mono"
                            style={{ color: "#8899aa", fontFamily: cssFontFamily(style.tocFont), fontSize: `${style.tocSize}px` }}
                          >
                            {i + 1}.
                          </span>
                          <span style={{ color: "#dcdcdc", fontFamily: cssFontFamily(style.tocFont), fontSize: `${style.tocSize}px` }}>
                            {ch.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chapter pages */}
                {currentPage >= 2 && (() => {
                  const chIdx = currentPage - 2;
                  const ch = editedChapters[chIdx];
                  if (!ch) return null;
                  const isEditing = editingIndex === chIdx;

                  return (
                    <div className="absolute inset-0 flex flex-col overflow-auto">
                      {ch.imageUrl && !photoOnly && (
                        <div className="relative" style={{ height: "60%" }}>
                          <img src={ch.imageUrl} alt={ch.title} className="w-full h-full object-cover" />
                        </div>
                      )}
                      {ch.imageUrl && photoOnly && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <img src={ch.imageUrl} alt={ch.title} className="max-w-full max-h-full object-contain" />
                          <p className="absolute bottom-4 left-0 right-0 text-center text-sm" style={{ color: "#c8c8c8" }}>
                            {chIdx + 1}. {ch.title}
                          </p>
                        </div>
                      )}

                      {!photoOnly && (
                        <div className="flex-1 px-8 py-4 relative">
                          <button
                            onClick={() => setEditingIndex(isEditing ? null : chIdx)}
                            className="absolute top-2 right-4 z-10 flex items-center gap-1 px-2 py-1 rounded text-xs transition-all"
                            style={{
                              background: isEditing ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.08)",
                              color: isEditing ? "#a78bfa" : "#8899aa",
                              border: `1px solid ${isEditing ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.1)"}`,
                            }}
                          >
                            {isEditing ? <Eye className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                            {isEditing ? "Preview" : "Edit"}
                          </button>

                          <p className="text-xs text-center mb-1" style={{ color: "#8899aa" }}>
                            Chapter {chIdx + 1} of {editedChapters.length}
                          </p>

                          {isEditing ? (
                            <Input
                              value={ch.title}
                              onChange={(e) => updateChapter(chIdx, "title", e.target.value)}
                              className="text-xl font-bold mb-2 bg-transparent border-primary/30"
                              style={{
                                color: "#f0d5a8",
                                fontFamily: cssFontFamily(style.chapterTitleFont),
                                fontSize: `${Math.round(style.chapterTitleSize * 0.7)}px`,
                                textAlign: alignCSS(style.chapterTitleAlign),
                              }}
                            />
                          ) : (
                            <h2
                              className="font-bold mb-2"
                              style={{
                                color: "#f0d5a8",
                                fontFamily: cssFontFamily(style.chapterTitleFont),
                                fontSize: `${Math.round(style.chapterTitleSize * 0.7)}px`,
                                textAlign: alignCSS(style.chapterTitleAlign),
                              }}
                            >
                              {ch.title}
                            </h2>
                          )}

                          {isEditing ? (
                            <Textarea
                              value={ch.body}
                              onChange={(e) => updateChapter(chIdx, "body", e.target.value)}
                              className="min-h-[120px] leading-relaxed bg-transparent border-primary/30 resize-y"
                              style={{
                                color: "#d2d2d2",
                                fontFamily: cssFontFamily(style.bodyFont),
                                fontSize: `${style.bodySize}px`,
                                textAlign: alignCSS(style.bodyAlign),
                                lineHeight: `${style.bodyLineHeight * 0.3}em`,
                              }}
                            />
                          ) : (
                            <p
                              className="whitespace-pre-wrap"
                              style={{
                                color: "#d2d2d2",
                                fontFamily: cssFontFamily(style.bodyFont),
                                fontSize: `${style.bodySize}px`,
                                textAlign: alignCSS(style.bodyAlign),
                                lineHeight: `${style.bodyLineHeight * 0.3}em`,
                              }}
                            >
                              {ch.body}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {currentPage > 0 && (
                  <span
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs"
                    style={{ color: "#646478" }}
                  >
                    {currentPage}
                  </span>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
