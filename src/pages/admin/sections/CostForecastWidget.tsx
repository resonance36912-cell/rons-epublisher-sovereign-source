import { useMemo, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useAdmin } from "../AdminContext";
import { ForecastCard } from "./cost-forecast/ForecastCard";
import { buildForecast } from "./cost-forecast/forecast-math";
import { SERVICES } from "./cost-forecast/types";
import { useServiceBudgets } from "./cost-forecast/useServiceBudgets";

export function CostForecastWidget() {
  const { usageLogs } = useAdmin();
  const { budgets, saveBudget, saving } = useServiceBudgets();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");

  const forecasts = useMemo(
    () => SERVICES.map((s) => buildForecast(usageLogs, s.key, s.label, budgets[s.key] ?? null)),
    [usageLogs, budgets],
  );

  const totalProjected = forecasts.reduce((s, f) => s + f.projected, 0);
  const totalBudget = forecasts.reduce((s, f) => s + f.budget, 0);
  const flagged = forecasts.filter((f) => f.overBudgetPct > 20);

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Cost Forecast (next 30d)</h2>
        <span className="text-xs text-muted-foreground ml-auto">
          Projected total: <span className="font-semibold text-foreground">${totalProjected.toFixed(2)}</span>
          <span className="mx-1.5 opacity-50">/</span>
          budget <span className="font-medium">${totalBudget.toFixed(2)}</span>
        </span>
      </div>

      {flagged.length > 0 && (
        <div className="px-6 py-2.5 bg-destructive/10 border-b border-destructive/30 flex items-center gap-2 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <span className="text-destructive font-medium">
            {flagged.length} service{flagged.length > 1 ? "s" : ""} trending {">"}20% over budget:
          </span>
          <span className="text-destructive/90">
            {flagged.map((f) => `${f.label} (+${f.overBudgetPct.toFixed(0)}%)`).join(", ")}
          </span>
        </div>
      )}

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {forecasts.map((f) => (
          <ForecastCard
            key={f.key}
            forecast={f}
            isEditing={editing === f.key}
            isSaving={saving === f.key}
            draft={draft}
            onDraftChange={setDraft}
            onStartEdit={() => {
              setDraft(f.budget.toFixed(2));
              setEditing(f.key);
            }}
            onCancelEdit={() => setEditing(null)}
            onSave={async (v) => {
              const ok = await saveBudget(f.key, v);
              if (ok) setEditing(null);
            }}
          />
        ))}
      </div>

      <div className="px-6 py-3 border-t bg-muted/20 text-[11px] text-muted-foreground">
        Forecast = (7d run-rate × 0.7 + 30d run-rate × 0.3) × 30. Auto-budget = max(1.2× last-30d spend, 2× 90d-average projected) so a single-week spike won't falsely flag a service. Click the pencil to set a manual override. Services trending {">"}20% over budget are flagged in red.
      </div>
    </div>
  );
}
