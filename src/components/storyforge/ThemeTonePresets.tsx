import { useEffect, useState } from "react";
import { Bookmark, Plus, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

/**
 * Named Theme + Tone presets, persisted to localStorage so the user can
 * quickly recall favourite combinations across sessions.
 */

export type ThemeTonePreset = {
  id: string;
  name: string;
  theme: string;
  tone: string;
  createdAt: number;
};

const STORAGE_KEY = "resonance.themeTonePresets.v1";

function loadPresets(): ThemeTonePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePresets(list: ThemeTonePreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
}

export function ThemeTonePresets({
  theme,
  tone,
  onApply,
}: {
  theme: string;
  tone: string;
  onApply: (theme: string, tone: string) => void;
}) {
  const [presets, setPresets] = useState<ThemeTonePreset[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const persist = (next: ThemeTonePreset[]) => {
    setPresets(next);
    savePresets(next);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Name required", description: "Give your preset a short name first.", variant: "destructive" });
      return;
    }
    if (presets.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: "Name already in use", description: "Choose a different name or delete the existing preset.", variant: "destructive" });
      return;
    }
    const preset: ThemeTonePreset = {
      id: crypto.randomUUID(),
      name: trimmed,
      theme,
      tone,
      createdAt: Date.now(),
    };
    persist([preset, ...presets]);
    setName("");
    setNaming(false);
    toast({ title: "Preset saved", description: `"${trimmed}" stored locally.` });
  };

  const handleDelete = (id: string) => {
    const target = presets.find((p) => p.id === id);
    persist(presets.filter((p) => p.id !== id));
    if (target) toast({ title: "Preset removed", description: `"${target.name}" deleted.` });
  };

  const handleApply = (p: ThemeTonePreset) => {
    onApply(p.theme, p.tone);
    toast({ title: "Preset applied", description: `${p.name} · ${p.theme} / ${p.tone}` });
  };

  const isActive = (p: ThemeTonePreset) => p.theme === theme && p.tone === tone;

  return (
    <div className="rounded-xl border bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Bookmark className="w-3.5 h-3.5" />
          Saved presets {presets.length > 0 && <span className="text-foreground">({presets.length})</span>}
        </div>
        {!naming ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => {
              setName(`${theme} · ${tone}`);
              setNaming(true);
            }}
          >
            <Plus className="w-3 h-3" /> Save current
          </Button>
        ) : (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setNaming(false); setName(""); }
              }}
              placeholder="Preset name"
              className="h-7 text-xs w-40"
            />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSave} aria-label="Save preset">
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => { setNaming(false); setName(""); }}
              aria-label="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {presets.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          No presets yet. Pick a theme &amp; tone you love, then click <span className="font-medium text-foreground">Save current</span>.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = isActive(p);
            return (
              <div
                key={p.id}
                className={`group inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-0.5 text-[11px] transition-colors ${
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-background/60 hover:bg-accent/40"
                }`}
              >
                <button
                  type="button"
                  className="font-medium"
                  onClick={() => handleApply(p)}
                  title={`Apply ${p.theme} / ${p.tone}`}
                >
                  {p.name}
                </button>
                <span className="text-muted-foreground/70 text-[10px]">
                  {p.theme.slice(0, 4)}/{p.tone.slice(0, 4)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(p.id)}
                  className="ml-0.5 p-0.5 rounded-full opacity-50 group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive transition"
                  aria-label={`Delete preset ${p.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
