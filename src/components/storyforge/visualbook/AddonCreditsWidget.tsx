import { useEffect, useRef, useState } from "react";
import { ImageIcon, Mic, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ADDON_CREDITS_CHANGED } from "@/lib/addon-credits-events";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION } from "@/lib/promotion";

type Credits = { image: number; tts: number };

// Low-credit thresholds (~10% of a single pack: 25 imgs / 50k chars)
const IMAGE_LOW_THRESHOLD = 3;
const TTS_LOW_THRESHOLD = 5000;

function fmt(n: number) {
  return n.toLocaleString();
}

export function AddonCreditsWidget() {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Track which low-credit warnings we've already fired this session, per type.
  // Reset when balance climbs back above threshold so a fresh purchase re-arms.
  const warnedRef = useRef<{ image: boolean; tts: boolean }>({ image: false, tts: false });

  const maybeWarn = (next: Credits) => {
    // Image: warn once when 0 < remaining < threshold
    if (next.image > 0 && next.image < IMAGE_LOW_THRESHOLD) {
      if (!warnedRef.current.image) {
        warnedRef.current.image = true;
        toast.warning("Image credits running low", {
          description: `Only ${next.image} image credit${next.image === 1 ? "" : "s"} left. Top up to keep generating.`,
          action: { label: "Buy more", onClick: () => navigate("/pricing") },
          duration: 8000,
        });
      }
    } else if (next.image >= IMAGE_LOW_THRESHOLD) {
      warnedRef.current.image = false; // re-arm
    }

    if (next.tts > 0 && next.tts < TTS_LOW_THRESHOLD) {
      if (!warnedRef.current.tts) {
        warnedRef.current.tts = true;
        toast.warning("Premium narration credits low", {
          description: `Only ${fmt(next.tts)} characters left (~${Math.round(next.tts / 1000)}k). Top up to keep narrating.`,
          action: { label: "Buy more", onClick: () => navigate("/pricing") },
          duration: 8000,
        });
      }
    } else if (next.tts >= TTS_LOW_THRESHOLD) {
      warnedRef.current.tts = false;
    }
  };

  const fetchCredits = async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;
      if (!userId) {
        setCredits({ image: 0, tts: 0 });
        return;
      }
      const [imgRes, ttsRes] = await Promise.all([
        supabase.rpc("get_addon_credits_remaining", { _user_id: userId, _credit_type: "image" }),
        supabase.rpc("get_addon_credits_remaining", { _user_id: userId, _credit_type: "tts" }),
      ]);
      const next: Credits = {
        image: (imgRes.data as number) ?? 0,
        tts: (ttsRes.data as number) ?? 0,
      };
      setCredits(next);
      maybeWarn(next);
    } catch {
      setCredits({ image: 0, tts: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (FREE_PROMOTION_ACTIVE) return;
    fetchCredits();
    // Debounce rapid bursts (e.g. batch narration) into one refresh.
    let t: number | undefined;
    const onChange = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => fetchCredits(), 600);
    };
    window.addEventListener(ADDON_CREDITS_CHANGED, onChange);
    return () => {
      window.removeEventListener(ADDON_CREDITS_CHANGED, onChange);
      if (t) window.clearTimeout(t);
    };
  }, []);

  const hasAny = (credits?.image ?? 0) > 0 || (credits?.tts ?? 0) > 0;

  if (FREE_PROMOTION_ACTIVE) {
    return (
      <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 text-xs">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <span className="font-medium text-foreground">{FREE_PROMOTION.shortLabel}</span>
        <span className="text-muted-foreground">Image and narration top-ups are not required during promotional access.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 text-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-foreground font-medium">Add-on credits</span>
          {!loading && !hasAny && (
            <span className="text-[10px] text-muted-foreground">
              No top-ups yet
            </span>
          )}
        </div>
        <button
          onClick={fetchCredits}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh credits"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <ImageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground truncate">Images</span>
              <span className="tabular-nums font-medium ml-auto">
                {loading ? "…" : fmt(credits?.image ?? 0)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium">Image add-on credits</p>
            <p>{fmt(credits?.image ?? 0)} chapter images remaining</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Used after baseline tier quota is exhausted.
            </p>
          </TooltipContent>
        </Tooltip>

        <div className="hidden sm:block w-px h-4 bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Mic className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground truncate">Premium narration</span>
              <span className="tabular-nums font-medium ml-auto">
                {loading ? "…" : `${fmt(credits?.tts ?? 0)} chars`}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium">Premium narration credits</p>
            <p>{fmt(credits?.tts ?? 0)} characters remaining</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              ~50,000 characters ≈ 1 Standard eBook.
            </p>
          </TooltipContent>
        </Tooltip>

        <Button
          asChild
          size="sm"
          variant={hasAny ? "outline" : "default"}
          className="h-7 px-2.5 text-[11px] gap-1 shrink-0"
        >
          <Link to="/pricing">
            <Plus className="w-3 h-3" />
            Buy more
          </Link>
        </Button>
      </div>
    </div>
  );
}
