import { useMemo, useState } from "react";
import { Star, BookOpen, TrendingUp, AlertTriangle, Award } from "lucide-react";
import { motion } from "framer-motion";
import type { SlideChapter } from "./StoryForgeContext";

type Props = {
  chapters: SlideChapter[];
  overallRating?: number;
  onOverallRatingChange?: (rating: number) => void;
};

function StarDisplay({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => {
        const filled = i < Math.floor(value);
        const half = !filled && i < value;
        return (
          <Star
            key={i}
            className={`w-5 h-5 transition-colors ${
              filled
                ? "fill-primary text-primary"
                : half
                ? "fill-primary/50 text-primary"
                : "text-muted-foreground/20"
            }`}
          />
        );
      })}
    </div>
  );
}

function InteractiveStars({
  value,
  onChange,
  max = 5,
}: {
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {Array.from({ length: max }, (_, i) => {
        const idx = i + 1;
        const active = hover > 0 ? idx <= hover : idx <= value;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(idx === value ? 0 : idx)}
            onMouseEnter={() => setHover(idx)}
            className="p-0 bg-transparent border-0 cursor-pointer transition-transform hover:scale-110"
          >
            <Star
              className={`w-6 h-6 transition-colors ${
                active ? "fill-primary text-primary" : "text-muted-foreground/30 hover:text-muted-foreground/50"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

export function OverallBookRating({ chapters, overallRating, onOverallRatingChange }: Props) {
  const stats = useMemo(() => {
    const rated = chapters.filter((c) => c.rating && c.rating > 0);
    const withImages = chapters.filter((c) => c.imageUrl);
    const withBody = chapters.filter((c) => c.body?.trim());

    const sum = rated.reduce((s, c) => s + (c.rating || 0), 0);
    const chapterAvg = rated.length > 0 ? sum / rated.length : 0;
    const coverage = Math.round((rated.length / chapters.length) * 100);

    const breakdown = {
      excellent: rated.filter((c) => c.rating === 5).length,
      good: rated.filter((c) => c.rating === 4).length,
      okay: rated.filter((c) => c.rating === 3).length,
      needsWork: rated.filter((c) => (c.rating || 0) <= 2).length,
    };

    // Use explicit overall rating if set, otherwise fall back to chapter average
    const displayRating = overallRating && overallRating > 0 ? overallRating : chapterAvg;

    const label =
      displayRating >= 4.5
        ? "Outstanding"
        : displayRating >= 4
        ? "Great"
        : displayRating >= 3
        ? "Good"
        : displayRating >= 2
        ? "Needs improvement"
        : displayRating > 0
        ? "Early stage"
        : "Not yet rated";

    return {
      chapterAvg,
      displayRating,
      rated: rated.length,
      total: chapters.length,
      withImages: withImages.length,
      withBody: withBody.length,
      coverage,
      label,
      breakdown,
    };
  }, [chapters, overallRating]);

  const completeness = useMemo(() => {
    const scores: { label: string; value: number; icon: React.ReactNode }[] = [];
    const bodyPct = stats.total > 0 ? Math.round((stats.withBody / stats.total) * 100) : 0;
    const imgPct = stats.total > 0 ? Math.round((stats.withImages / stats.total) * 100) : 0;

    scores.push({ label: "Content", value: bodyPct, icon: <BookOpen className="w-3 h-3" /> });
    scores.push({ label: "Images", value: imgPct, icon: <TrendingUp className="w-3 h-3" /> });
    scores.push({ label: "Rated", value: stats.coverage, icon: <Star className="w-3 h-3" /> });

    return scores;
  }, [stats]);

  const hasManualRating = overallRating && overallRating > 0;
  const hasChapterRatings = stats.rated > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Overall eBook Rating</span>
        </div>
        {stats.displayRating > 0 && (
          <span className="text-lg font-bold text-foreground">{stats.displayRating.toFixed(1)}</span>
        )}
      </div>

      {/* Direct overall rating */}
      {onOverallRatingChange && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <InteractiveStars
              value={overallRating ?? 0}
              onChange={onOverallRatingChange}
            />
            <span className={`text-xs font-medium ${
              stats.displayRating >= 4 ? "text-primary" : stats.displayRating >= 3 ? "text-foreground" : stats.displayRating > 0 ? "text-amber-500" : "text-muted-foreground"
            }`}>
              {stats.label}
            </span>
          </div>
          {!hasManualRating && hasChapterRatings && (
            <p className="text-[10px] text-muted-foreground">
              Showing chapter average ({stats.chapterAvg.toFixed(1)}). Click stars above to set your own overall rating.
            </p>
          )}
          {hasManualRating && hasChapterRatings && (
            <p className="text-[10px] text-muted-foreground">
              Your rating: {overallRating}★ · Chapter avg: {stats.chapterAvg.toFixed(1)}★
            </p>
          )}
          {!hasManualRating && !hasChapterRatings && (
            <p className="text-[10px] text-muted-foreground">
              Rate your eBook overall, or rate individual chapters below.
            </p>
          )}
        </div>
      )}

      {/* Read-only stars (no callback) */}
      {!onOverallRatingChange && (
        <div className="flex items-center gap-3">
          <StarDisplay value={stats.displayRating} />
          <span className={`text-xs font-medium ${
            stats.displayRating >= 4 ? "text-primary" : stats.displayRating >= 3 ? "text-foreground" : stats.displayRating > 0 ? "text-amber-500" : "text-muted-foreground"
          }`}>
            {stats.label}
          </span>
        </div>
      )}

      {/* Breakdown bars */}
      {hasChapterRatings && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "★5", count: stats.breakdown.excellent, color: "bg-primary" },
            { label: "★4", count: stats.breakdown.good, color: "bg-primary/70" },
            { label: "★3", count: stats.breakdown.okay, color: "bg-amber-500/70" },
            { label: "★1-2", count: stats.breakdown.needsWork, color: "bg-destructive/60" },
          ].map((b) => (
            <div key={b.label} className="text-center space-y-1">
              <div className="text-[10px] text-muted-foreground">{b.label}</div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${b.color} transition-all`}
                  style={{ width: `${stats.rated > 0 ? (b.count / stats.rated) * 100 : 0}%` }}
                />
              </div>
              <div className="text-[10px] font-medium text-foreground">{b.count}</div>
            </div>
          ))}
        </div>
      )}

      {/* Completeness meters */}
      <div className="flex items-center gap-4 pt-1 border-t border-border/30">
        {completeness.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">{item.icon}</span>
            <span className="text-muted-foreground">{item.label}</span>
            <span className={`font-semibold ${item.value >= 80 ? "text-primary" : item.value >= 50 ? "text-foreground" : "text-muted-foreground"}`}>
              {item.value}%
            </span>
          </div>
        ))}
      </div>

      {/* Tip */}
      {hasChapterRatings && stats.breakdown.needsWork > 0 && (
        <div className="flex items-start gap-2 text-[10px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
          <span>{stats.breakdown.needsWork} chapter{stats.breakdown.needsWork > 1 ? "s" : ""} rated low — add feedback to auto-improve them.</span>
        </div>
      )}
    </motion.div>
  );
}
