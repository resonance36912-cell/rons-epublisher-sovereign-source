import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "../AdminContext";
import { TIER_ORDER, TIER_META } from "../types";

export function AdminTierQuotasSection() {
  const {
    tierInputs, setTierInputs, tierPresetsLoading, tierPresetsSaving,
    fetchTierPresets, saveTierPresets,
  } = useAdmin();

  return (
    <div className="bg-muted/20 border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Per-plan daily quotas</h3>
          <p className="text-xs text-muted-foreground">Set how many image generations and premium narration calls each plan tier can use per day.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={fetchTierPresets} disabled={tierPresetsLoading || tierPresetsSaving}>
          <RefreshCw className={`w-3.5 h-3.5 ${tierPresetsLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Plan</th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground text-xs">Images / day</th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground text-xs">TTS / day</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {TIER_ORDER.map((tier) => {
              const meta = TIER_META[tier];
              const TierIcon = meta.icon;
              const imgKey = `${tier}:generate-chapter-image`;
              const ttsKey = `${tier}:elevenlabs-tts`;
              return (
                <tr key={tier} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <TierIcon className={`w-4 h-4 ${meta.color}`} />
                      <span className="font-medium text-xs">{meta.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={tierInputs[imgKey] ?? ""}
                      onChange={(e) => setTierInputs((p) => ({ ...p, [imgKey]: Number(e.target.value) || 0 }))}
                      className="w-20 h-7 text-xs border rounded px-2 bg-background text-center mx-auto"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={tierInputs[ttsKey] ?? ""}
                      onChange={(e) => setTierInputs((p) => ({ ...p, [ttsKey]: Number(e.target.value) || 0 }))}
                      className="w-20 h-7 text-xs border rounded px-2 bg-background text-center mx-auto"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" className="text-xs" onClick={fetchTierPresets} disabled={tierPresetsSaving || tierPresetsLoading}>
          Reset
        </Button>
        <Button size="sm" className="text-xs gap-1.5" onClick={saveTierPresets} disabled={tierPresetsSaving || tierPresetsLoading}>
          {tierPresetsSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Save tier quotas
        </Button>
      </div>
    </div>
  );
}
