import { AlertTriangle, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { BudgetEditor } from "./BudgetEditor";
import { Sparkline } from "./Sparkline";
import type { ServiceForecast } from "./types";

interface ForecastCardProps {
  forecast: ServiceForecast;
  isEditing: boolean;
  isSaving: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (value: number | null) => void;
}

export function ForecastCard({
  forecast: f,
  isEditing,
  isSaving,
  draft,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSave,
}: ForecastCardProps) {
  const trendingUp = f.trendPct > 0;
  const isFlagged = f.overBudgetPct > 20;
  const noData = f.spend30d === 0 && f.spend7d === 0;
  const budgetUtil = Math.min(150, Math.max(0, (f.projected / f.budget) * 100));
  const isManual = f.manualBudget !== null && f.manualBudget > 0;

  return (
    <div
      className={`border rounded-lg p-4 space-y-3 ${
        isFlagged ? "border-destructive/40 bg-destructive/5" : "bg-muted/10"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{f.label}</p>
          <p className="text-[11px] text-muted-foreground">
            7d: ${f.spend7d.toFixed(2)} · 30d: ${f.spend30d.toFixed(2)}
          </p>
        </div>
        {!noData && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
              trendingUp ? "bg-amber-500/15 text-amber-600" : "bg-green-500/15 text-green-600"
            }`}
          >
            {trendingUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {f.trendPct >= 0 ? "+" : ""}
            {f.trendPct.toFixed(0)}%
          </span>
        )}
      </div>

      {noData ? (
        <p className="text-xs text-muted-foreground italic py-2">No usage in the last 30 days.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Projected (next 30d)</p>
              <p className={`text-2xl font-bold ${isFlagged ? "text-destructive" : ""}`}>
                ${f.projected.toFixed(2)}
              </p>
            </div>
            <BudgetEditor
              forecast={f}
              isEditing={isEditing}
              isSaving={isSaving}
              draft={draft}
              onDraftChange={onDraftChange}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSave={(v) => onSave(v)}
            />
          </div>

          <div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isFlagged
                    ? "bg-destructive"
                    : f.overBudgetPct > 0
                    ? "bg-amber-500"
                    : "bg-green-500"
                }`}
                style={{ width: `${Math.min(100, budgetUtil)}%` }}
              />
            </div>
            <div className="flex items-baseline justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground">
                Run-rate: ${f.rate7d.toFixed(3)}/d (7d) vs ${f.rate30d.toFixed(3)}/d (30d)
              </span>
              <span
                className={`text-[11px] font-semibold ${
                  isFlagged ? "text-destructive" : f.overBudgetPct > 0 ? "text-amber-600" : "text-green-600"
                }`}
              >
                {f.overBudgetPct >= 0 ? "+" : ""}
                {f.overBudgetPct.toFixed(0)}% vs budget
              </span>
            </div>
          </div>

          <Sparkline data={f.daily14} flagged={isFlagged} />

          {isManual && !isEditing && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onSave(null)}
              disabled={isSaving}
            >
              <RotateCcw className="w-3 h-3" />
              Revert to auto-budget (${f.autoBudget.toFixed(2)})
            </button>
          )}

          {isFlagged && (
            <div className="flex items-start gap-1.5 text-[11px] text-destructive bg-destructive/10 rounded-md p-2">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Trending <strong>{f.overBudgetPct.toFixed(0)}%</strong> over budget. Consider demoting this provider via the Primary Provider toggle above.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
