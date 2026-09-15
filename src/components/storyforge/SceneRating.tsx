import { useState, useCallback } from "react";
import { Star, MessageSquare, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "@/lib/i18n";

interface SceneRatingProps {
  rating?: number;
  comment?: string;
  isOptimizing?: boolean;
  onRate: (rating: number, comment: string) => void;
}

export function SceneRating({ rating: savedRating, comment: savedComment, isOptimizing, onRate }: SceneRatingProps) {
  const { t } = useI18n();
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedRating, setSelectedRating] = useState(savedRating || 0);
  const [comment, setComment] = useState(savedComment || "");
  const [showComment, setShowComment] = useState(false);

  const handleStarClick = useCallback((star: number) => {
    setSelectedRating(star);
    if (star <= 3) {
      setShowComment(true);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (selectedRating === 0) return;
    onRate(selectedRating, comment.trim());
    setShowComment(false);
  }, [selectedRating, comment, onRate]);

  return (
    <div className="space-y-2 border-t border-border/30 pt-2 mt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(0)}
              onClick={() => handleStarClick(star)}
              disabled={isOptimizing}
              className="p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
            >
              <Star
                className={`w-4 h-4 transition-colors ${
                  star <= (hoveredStar || selectedRating)
                    ? star <= 3 && (hoveredStar || selectedRating) <= 3
                      ? "fill-amber-400 text-amber-400"
                      : "fill-primary text-primary"
                    : "text-muted-foreground/30"
                }`}
              />
            </button>
          ))}

          {selectedRating > 0 && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {selectedRating <= 2 ? t("rating.needsWork") : selectedRating <= 3 ? t("rating.okay") : selectedRating === 4 ? t("rating.good") : t("rating.excellent")}
            </span>
          )}
        </div>

        {isOptimizing && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[10px] text-primary flex items-center gap-1"
          >
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {t("rating.optimizing")}
          </motion.span>
        )}

        {!showComment && selectedRating > 0 && selectedRating <= 3 && !isOptimizing && (
          <button
            onClick={() => setShowComment(true)}
            className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1"
          >
            <MessageSquare className="w-3 h-3" />
            {t("rating.addComment")}
          </button>
        )}
      </div>

      <AnimatePresence>
        {showComment && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 overflow-hidden"
          >
            <Textarea
              placeholder={t("rating.commentPlaceholder")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[60px] resize-none text-xs bg-card/50"
              disabled={isOptimizing}
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1 max-w-[60%]">
                <Sparkles className="w-3 h-3 shrink-0" />
                {selectedRating <= 3
                  ? t("rating.lowRatingHint")
                  : t("rating.highRatingHint")}
              </p>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={isOptimizing || (selectedRating <= 3 && !comment.trim())}
                className="text-xs h-7 gap-1"
              >
                {selectedRating <= 3 && comment.trim() ? (
                  <>
                    <Sparkles className="w-3 h-3" /> {t("rating.submitOptimize")}
                  </>
                ) : (
                  t("rating.submit")
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {savedRating && savedComment && !showComment && (
        <p className="text-[10px] text-muted-foreground/50 italic line-clamp-1">
          💬 {savedComment}
        </p>
      )}
    </div>
  );
}
