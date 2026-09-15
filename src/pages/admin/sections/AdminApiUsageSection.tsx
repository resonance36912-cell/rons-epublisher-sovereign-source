import { Loader2, RefreshCw, BarChart3, Headphones, Globe, Flame, Zap, HardDrive, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAdmin } from "../AdminContext";
import { formatBytes } from "../types";
import { AdminTierQuotasSection } from "./AdminTierQuotasSection";
import { RequestIdBadge } from "@/components/storyforge/RequestIdBadge";

export function AdminApiUsageSection() {
  const {
    apiUsage, apiUsageLoading, fetchApiUsage,
    storageFiles, storageTotalSize, storageRequestId, storageLoading, setStorageLoading,
    fetchStorage, setConfirmDeleteAll,
  } = useAdmin();

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">API Usage & Service Providers</h2>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={fetchApiUsage} disabled={apiUsageLoading}>
          <RefreshCw className={`w-3.5 h-3.5 ${apiUsageLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      {apiUsageLoading && !apiUsage ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : !apiUsage ? (
        <div className="text-center text-muted-foreground py-12">No API data loaded</div>
      ) : (
        <div className="p-6 space-y-6">
          {/* ElevenLabs */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Headphones className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">ElevenLabs (TTS / Narration)</h3>
              {apiUsage.elevenlabs?.tier && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium uppercase">{apiUsage.elevenlabs.tier}</span>
              )}
              {apiUsage.elevenlabs?.status && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  apiUsage.elevenlabs.status === "active" ? "bg-green-500/15 text-green-600" : "bg-yellow-500/15 text-yellow-600"
                }`}>{apiUsage.elevenlabs.status}</span>
              )}
            </div>
            {apiUsage.elevenlabs?.error ? (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{apiUsage.elevenlabs.error}</div>
            ) : apiUsage.elevenlabs?.configured ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Character Usage</span>
                    <span className="font-medium">
                      {(apiUsage.elevenlabs.characterCount ?? 0).toLocaleString()} / {(apiUsage.elevenlabs.characterLimit ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <Progress value={apiUsage.elevenlabs.characterUsagePercent ?? 0} className="h-2.5" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{apiUsage.elevenlabs.characterUsagePercent ?? 0}% used</span>
                    {apiUsage.elevenlabs.nextCharacterCountResetUnix && (
                      <span>Resets {new Date(apiUsage.elevenlabs.nextCharacterCountResetUnix * 1000).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-muted/40 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold">{apiUsage.elevenlabs.voiceCount ?? 0}</p>
                    <p className="text-[11px] text-muted-foreground">Voice Slots Used</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold">{apiUsage.elevenlabs.voiceLimit ?? 0}</p>
                    <p className="text-[11px] text-muted-foreground">Voice Limit</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold">{((apiUsage.elevenlabs.characterLimit ?? 0) - (apiUsage.elevenlabs.characterCount ?? 0)).toLocaleString()}</p>
                    <p className="text-[11px] text-muted-foreground">Credits Remaining</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold">
                      {apiUsage.elevenlabs.nextInvoiceAmount != null
                        ? `${apiUsage.elevenlabs.currency === "usd" ? "$" : ""}${apiUsage.elevenlabs.nextInvoiceAmount.toFixed(2)}`
                        : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Next Invoice</p>
                  </div>
                </div>
                {apiUsage.elevenlabs.userName && (
                  <p className="text-xs text-muted-foreground">Account: {apiUsage.elevenlabs.userName}</p>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">Not configured</div>
            )}
          </div>

          {/* Other Services */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-muted/20 border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Tavily (Web Search)</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  apiUsage.tavily?.configured ? "bg-green-500/15 text-green-600" : "bg-muted text-muted-foreground"
                }`}>{apiUsage.tavily?.configured ? "Active" : "Not Set"}</span>
              </div>
              {apiUsage.tavily?.error && !apiUsage.tavily.configured && (
                <p className="text-xs text-muted-foreground">{apiUsage.tavily.error}</p>
              )}
              {apiUsage.tavily?.note && (
                <p className="text-xs text-muted-foreground">{apiUsage.tavily.note}</p>
              )}
            </div>

            <div className="bg-muted/20 border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Firecrawl (Web Scraping)</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  apiUsage.firecrawl?.configured ? "bg-green-500/15 text-green-600" : "bg-muted text-muted-foreground"
                }`}>{apiUsage.firecrawl?.configured ? "Active" : "Not Set"}</span>
              </div>
              {apiUsage.firecrawl?.error && !apiUsage.firecrawl.configured && (
                <p className="text-xs text-muted-foreground">{apiUsage.firecrawl.error}</p>
              )}
              {apiUsage.firecrawl?.note && (
                <p className="text-xs text-muted-foreground">{apiUsage.firecrawl.note}</p>
              )}
            </div>
          </div>

          {/* Lovable AI Gateway */}
          <div className="bg-muted/20 border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Lovable AI Gateway (Image & Text Generation)</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-500/15 text-green-600">Active</span>
            </div>
            <p className="text-xs text-muted-foreground">Managed by Lovable Cloud — usage included in your plan. Powers chapter image generation, storyboard AI, and text rewriting.</p>
          </div>

          <AdminTierQuotasSection />

          {/* API-Generated Storage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">API-Generated Storage</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{storageFiles.length} files · {formatBytes(storageTotalSize)}</span>
              </div>
              <div className="flex items-center gap-2">
                {storageRequestId && (
                  <RequestIdBadge requestId={storageRequestId} label="Last list" />
                )}
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7" onClick={fetchStorage} disabled={storageLoading}>
                  <RefreshCw className={`w-3 h-3 ${storageLoading ? "animate-spin" : ""}`} /> Refresh
                </Button>
                {storageFiles.length > 0 && (
                  <Button variant="destructive" size="sm" className="gap-1.5 text-xs h-7" onClick={() => setConfirmDeleteAll(true)} disabled={storageLoading}>
                    <Trash2 className="w-3 h-3" /> Purge All ({storageFiles.length})
                  </Button>
                )}
              </div>
            </div>
            {(() => {
              const imageFiles = storageFiles.filter(f => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f.name));
              const audioFiles = storageFiles.filter(f => /\.(mp3|wav|webm|ogg|m4a)$/i.test(f.name));
              const otherFiles = storageFiles.filter(f => !imageFiles.includes(f) && !audioFiles.includes(f));
              const imageSize = imageFiles.reduce((s, f) => s + f.size, 0);
              const audioSize = audioFiles.reduce((s, f) => s + f.size, 0);
              const otherSize = otherFiles.reduce((s, f) => s + f.size, 0);
              const categories = [
                { label: "AI-Generated Images", icon: <Zap className="w-3.5 h-3.5 text-primary" />, count: imageFiles.length, size: imageSize, files: imageFiles },
                { label: "Narration Audio", icon: <Headphones className="w-3.5 h-3.5 text-primary" />, count: audioFiles.length, size: audioSize, files: audioFiles },
                { label: "Other", icon: <FileText className="w-3.5 h-3.5 text-muted-foreground" />, count: otherFiles.length, size: otherSize, files: otherFiles },
              ].filter(c => c.count > 0);

              if (categories.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-4">No API-generated files in storage</p>;
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {categories.map((cat) => (
                    <div key={cat.label} className="bg-muted/20 border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {cat.icon}
                          <span className="text-xs font-medium">{cat.label}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                          disabled={storageLoading}
                          onClick={async () => {
                            if (!confirm(`Delete all ${cat.count} ${cat.label.toLowerCase()} files (${formatBytes(cat.size)})?`)) return;
                            setStorageLoading(true);
                            try {
                              const paths = cat.files.map(f => f.path);
                              for (let i = 0; i < paths.length; i += 100) {
                                const batch = paths.slice(i, i + 100);
                                const res = await supabase.functions.invoke("admin-storage", { body: { action: "delete", paths: batch } });
                                if (res.error) throw new Error(res.error.message);
                              }
                              toast.success(`Deleted ${cat.count} ${cat.label.toLowerCase()} files`);
                              fetchStorage();
                            } catch (err: any) {
                              toast.error("Delete failed: " + err.message);
                              setStorageLoading(false);
                            }
                          }}
                        >
                          <Trash2 className="w-2.5 h-2.5" /> Delete
                        </Button>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-lg font-bold">{cat.count}</span>
                        <span className="text-xs text-muted-foreground">{formatBytes(cat.size)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {apiUsage.timestamp && (
            <p className="text-[11px] text-muted-foreground text-right">Last refreshed: {new Date(apiUsage.timestamp).toLocaleString()}</p>
          )}
        </div>
      )}
    </div>
  );
}
