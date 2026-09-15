import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Upload, Loader2, Trash2, ArrowLeft, ArrowRight, Star,
  LayoutGrid, Layers, Image as ImageIcon, GalleryHorizontalEnd,
} from "lucide-react";
import { generateChapterImage } from "@/lib/storyforge-api";
import { deleteChapterImagesFromBucket } from "@/lib/project-storage";
import { useStoryForge, getChapterImages, MAX_IMAGES_PER_CHAPTER } from "../StoryForgeContext";
import type { SlideChapter, ChapterImage, ChapterImageLayout } from "../StoryForgeContext";
import { UPLOAD_LIMITS, AiInputTooLargeError, assertMaxFileSize } from "@/lib/ai-input-limits";
import { oversizedToast } from "../AiOversizedBanner";

type Props = {
  chapter: SlideChapter;
  onUpdate: (updates: Partial<SlideChapter>) => void;
};

const LAYOUTS: { id: ChapterImageLayout; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "stack", label: "Stack", icon: Layers },
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "hero", label: "Hero", icon: ImageIcon },
  { id: "carousel", label: "Carousel", icon: GalleryHorizontalEnd },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function ChapterImagesEditor({ chapter, onUpdate }: Props) {
  const { config, referenceImage } = useStoryForge();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const images = getChapterImages(chapter);
  const layout = chapter.imageLayout ?? "stack";
  const atCap = images.length >= MAX_IMAGES_PER_CHAPTER;

  const commit = (next: ChapterImage[]) => {
    // Keep `imageUrl` in sync with the cover (first image) for back-compat
    // with all existing exports & generation paths.
    const cover = next[0]?.url;
    onUpdate({ images: next, imageUrl: cover });
  };

  const handleAiGenerate = async () => {
    if (atCap) return;
    if (!chapter.imagePrompt) {
      toast({ title: "No image prompt", description: "Add an image prompt to this chapter first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const result = await generateChapterImage(
        chapter.id,
        chapter.imagePrompt,
        referenceImage || undefined,
        config.imageStyle,
        !referenceImage ? config.characterDescription : undefined,
        undefined,
        undefined,
        config.rawPromptMode,
      );
      commit([
        ...images,
        {
          id: `ai-${Date.now()}`,
          url: result.imageUrl,
          prompt: chapter.imagePrompt,
          source: "ai",
        },
      ]);
      toast({ title: "Image added" });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES_PER_CHAPTER - images.length;
    const accepted = Array.from(files).slice(0, room);
    if (accepted.length < files.length) {
      toast({ title: `Only ${room} more file${room === 1 ? "" : "s"} allowed`, description: `Max ${MAX_IMAGES_PER_CHAPTER} per chapter.` });
    }
    try {
      const next = [...images];
      for (const f of accepted) {
        const isVideo = f.type.startsWith("video/");
        try {
          assertMaxFileSize(
            isVideo ? "chapter video" : "chapter image",
            f,
            isVideo ? UPLOAD_LIMITS.chapterVideoBytes : UPLOAD_LIMITS.chapterImageBytes,
          );
        } catch (err) {
          if (err instanceof AiInputTooLargeError) {
            toast(oversizedToast(err, "Upload rejected"));
            continue;
          }
          throw err;
        }
        const dataUrl = await fileToDataUrl(f);
        next.push({
          id: `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          url: dataUrl,
          source: "upload",
          caption: f.name.replace(/\.[^.]+$/, ""),
          kind: isVideo ? "video" : "image",
          mimeType: f.type || undefined,
        });
      }
      commit(next);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (atCap) return;
    handleUpload(e.dataTransfer.files);
  }, [atCap, handleUpload]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...images];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    commit(next);
  };

  const setCover = (idx: number) => {
    if (idx === 0) return;
    const next = [...images];
    const [pick] = next.splice(idx, 1);
    next.unshift(pick);
    commit(next);
  };

  const remove = (idx: number) => {
    const removed = images[idx];
    const next = images.filter((_, i) => i !== idx);
    commit(next);
    // Fire-and-forget: drop the underlying object from the bucket so it
    // doesn't accumulate as an orphan. Skips data:/blob: (not yet uploaded).
    if (removed?.url) void deleteChapterImagesFromBucket([removed.url]);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Images ({images.length}/{MAX_IMAGES_PER_CHAPTER})
        </p>
        <div className="flex items-center gap-1">
          {LAYOUTS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onUpdate({ imageLayout: id })}
              title={`${label} layout`}
              className={`p-1.5 rounded-md transition-colors ${
                layout === id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </div>

      {images.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {images.map((img, idx) => (
            <li key={img.id} className="relative group rounded-md overflow-hidden border border-border/40 bg-background">
              <div className="aspect-square">
                {img.kind === "video" ? (
                  <video
                    src={img.url}
                    controls
                    preload="metadata"
                    className="w-full h-full object-cover bg-black"
                  />
                ) : (
                  <img src={img.url} alt={img.caption || `Image ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              {idx === 0 && (
                <span className="absolute top-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary text-primary-foreground">
                  <Star className="w-2.5 h-2.5" /> Cover
                </span>
              )}
              <span className="absolute bottom-1 left-1 px-1 rounded text-[9px] font-medium bg-background/80 text-foreground">
                {img.kind === "video" ? "Video" : img.source === "ai" ? "AI" : img.source === "upload" ? "Uploaded" : "Original"}
              </span>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-background/70 flex items-center justify-center gap-1">
                <button
                  type="button"
                  title="Move left"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="p-1 rounded bg-card border border-border/40 disabled:opacity-30"
                >
                  <ArrowLeft className="w-3 h-3" />
                </button>
                {idx !== 0 && (
                  <button
                    type="button"
                    title="Set as cover"
                    onClick={() => setCover(idx)}
                    className="p-1 rounded bg-card border border-border/40"
                  >
                    <Star className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  title="Remove"
                  onClick={() => remove(idx)}
                  className="p-1 rounded bg-destructive text-destructive-foreground"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title="Move right"
                  onClick={() => move(idx, 1)}
                  disabled={idx === images.length - 1}
                  className="p-1 rounded bg-card border border-border/40 disabled:opacity-30"
                >
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed transition-colors p-2 -m-2 ${
          dragActive
            ? "border-primary bg-primary/10"
            : "border-transparent hover:border-border/40"
        }`}
      >
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="text-xs h-7 gap-1"
            disabled={atCap || generating || !chapter.imagePrompt}
            onClick={handleAiGenerate}
          >
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            AI image
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="text-xs h-7 gap-1"
            disabled={atCap}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="w-3 h-3" /> Upload
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          {atCap && (
            <span className="text-[10px] text-muted-foreground italic">Max {MAX_IMAGES_PER_CHAPTER} reached</span>
          )}
        </div>
        {dragActive && (
          <p className="text-[10px] text-primary pt-1 font-medium">Drop files here to upload</p>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        First image is the cover. The chosen layout previews here and in the gallery; PDF / video / HTML exports follow in the next phase.
      </p>
    </div>
  );
}
