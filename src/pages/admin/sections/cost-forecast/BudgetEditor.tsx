import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ServiceForecast } from "./types";

interface BudgetEditorProps {
  forecast: ServiceForecast;
  isEditing: boolean;
  isSaving: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (value: number) => void;
}

export function BudgetEditor({
  forecast: f,
  isEditing,
  isSaving,
  draft,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSave,
}: BudgetEditorProps) {
  const isManual = f.manualBudget !== null && f.manualBudget > 0;
  const binding90 = !isManual && f.budget90Heuristic >= f.budget30Heuristic;
  const binding30 = !isManual && !binding90;

  return (
    <div className="text-right">
      <div className="flex items-center gap-1 justify-end">
        <p className="text-[11px] text-muted-foreground">
          Budget {isManual ? (
            <span className="text-primary font-medium">(manual)</span>
          ) : (
            <span>(auto: max 1.2× 30d, 2× 90d)</span>
          )}
        </p>
        {!isEditing && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onStartEdit}
            aria-label="Edit budget"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
      {isEditing ? (
        <div className="flex items-center gap-1 mt-1 justify-end">
          <span className="text-xs text-muted-foreground">$</span>
          <input
            type="number"
            min="0"
            step="1"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            className="w-20 h-7 text-xs border rounded px-2 bg-background"
            autoFocus
            disabled={isSaving}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isSaving}
            onClick={() => {
              const v = parseFloat(draft);
              if (!isNaN(v) && v >= 0) onSave(v);
            }}
            aria-label="Save"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isSaving}
            onClick={onCancelEdit}
            aria-label="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-sm font-medium cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
                ${f.budget.toFixed(2)}
              </p>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs space-y-1.5 max-w-xs">
              {isManual ? (
                <>
                  <p className="font-semibold">Manual override: ${f.budget.toFixed(2)}/mo</p>
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    <p>Auto fallback would be: ${f.autoBudget.toFixed(2)}</p>
                    <p>· 1.2× last-30d: ${f.budget30Heuristic.toFixed(2)}</p>
                    <p>· 2× 90d-avg projected: ${f.budget90Heuristic.toFixed(2)}</p>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-semibold">Auto-budget = max of two heuristics</p>
                  <div className="space-y-0.5">
                    <p className={binding30 ? "text-primary font-medium" : "text-muted-foreground"}>
                      {binding30 ? "▸ " : "  "}1.2× last-30d spend: ${f.budget30Heuristic.toFixed(2)}
                    </p>
                    <p className={binding90 ? "text-primary font-medium" : "text-muted-foreground"}>
                      {binding90 ? "▸ " : "  "}2× 90d-avg projected: ${f.budget90Heuristic.toFixed(2)}
                    </p>
                  </div>
                  <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                    Binding: <span className="text-foreground font-medium">{binding90 ? "90d baseline" : "30d spend"}</span> protects against {binding90 ? "recent spikes" : "stale low baselines"}.
                  </p>
                </>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
