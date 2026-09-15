import { useState } from "react";
import { Maximize2, Minimize2, Settings2, Download, FileText, Presentation, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import type { FormatPrefs, PresentationDeck } from "@/lib/presentation-export";
import { exportStoryPreviewPdf, exportStoryPreviewPptx } from "@/lib/presentation-export";

type Props = {
  prefs: FormatPrefs;
  onPrefsChange: (p: FormatPrefs) => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
  deck: PresentationDeck;
};

const ALIGN_OPTIONS: FormatPrefs["textAlign"][] = ["left", "center", "justify"];
const BG_OPTIONS: { value: FormatPrefs["background"]; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "cream", label: "Cream" },
  { value: "dark", label: "Dark" },
];

export function PresentationControls({ prefs, onPrefsChange, onFullscreen, isFullscreen, deck }: Props) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState<"pdf" | "pptx" | null>(null);

  const update = <K extends keyof FormatPrefs>(key: K, value: FormatPrefs[K]) =>
    onPrefsChange({ ...prefs, [key]: value });

  const runExport = async (kind: "pdf" | "pptx") => {
    setExporting(kind);
    try {
      if (kind === "pdf") await exportStoryPreviewPdf(deck, prefs);
      else await exportStoryPreviewPptx(deck, prefs);
      toast({ title: `${kind.toUpperCase()} exported`, description: `${deck.chapters.length + 1}+ slides downloaded.` });
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap justify-center">
      {/* Format popover */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 h-8">
            <Settings2 className="w-3.5 h-3.5" /> Format
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs flex justify-between">
              Font size <span className="text-muted-foreground">{Math.round(prefs.fontScale * 100)}%</span>
            </Label>
            <Slider min={0.85} max={1.4} step={0.05} value={[prefs.fontScale]}
              onValueChange={(v) => update("fontScale", v[0])} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex justify-between">
              Line height <span className="text-muted-foreground">{prefs.lineHeight.toFixed(1)}</span>
            </Label>
            <Slider min={1.4} max={2.2} step={0.1} value={[prefs.lineHeight]}
              onValueChange={(v) => update("lineHeight", v[0])} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex justify-between">
              Content width <span className="text-muted-foreground">{prefs.bodyMaxWidth}px</span>
            </Label>
            <Slider min={480} max={960} step={20} value={[prefs.bodyMaxWidth]}
              onValueChange={(v) => update("bodyMaxWidth", v[0])} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Text alignment</Label>
            <div className="grid grid-cols-3 gap-1">
              {ALIGN_OPTIONS.map((a) => (
                <Button key={a} type="button" size="sm" variant={prefs.textAlign === a ? "default" : "outline"}
                  className="h-7 text-xs capitalize" onClick={() => update("textAlign", a)}>{a}</Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Background</Label>
            <div className="grid grid-cols-3 gap-1">
              {BG_OPTIONS.map((b) => (
                <Button key={b.value} type="button" size="sm"
                  variant={prefs.background === b.value ? "default" : "outline"}
                  className="h-7 text-xs" onClick={() => update("background", b.value)}>{b.label}</Button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Export menu */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={!!exporting}>
            {exporting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Download className="w-3.5 h-3.5" />}
            Export deck
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <button
            className="w-full flex items-center gap-2 text-sm px-2 py-2 rounded hover:bg-accent disabled:opacity-50 text-left"
            onClick={() => runExport("pdf")} disabled={!!exporting}
          >
            <FileText className="w-4 h-4" /> PDF (landscape A4)
          </button>
          <button
            className="w-full flex items-center gap-2 text-sm px-2 py-2 rounded hover:bg-accent disabled:opacity-50 text-left"
            onClick={() => runExport("pptx")} disabled={!!exporting}
          >
            <Presentation className="w-4 h-4" /> PowerPoint (.pptx)
          </button>
        </PopoverContent>
      </Popover>

      {/* Fullscreen */}
      <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={onFullscreen}>
        {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        {isFullscreen ? "Exit fullscreen" : "Present"}
      </Button>
    </div>
  );
}
