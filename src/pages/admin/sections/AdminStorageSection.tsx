import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "../AdminContext";
import { formatBytes } from "../types";

export function AdminStorageSection() {
  const {
    profiles, storageFiles, storageTotalSize, storageLoading, deletingPaths,
    fetchStorage, handleDeleteFile, setConfirmDeleteAll,
  } = useAdmin();

  return (
    <>
      {/* Storage by User */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold">Storage by User</h2>
        </div>
        {storageLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (() => {
          const userMap = new Map<string, { size: number; count: number }>();
          storageFiles.forEach((f) => {
            const userId = f.path.split("/")[0] || "unknown";
            const entry = userMap.get(userId) || { size: 0, count: 0 };
            entry.size += f.size;
            entry.count += 1;
            userMap.set(userId, entry);
          });
          const sorted = Array.from(userMap.entries()).sort((a, b) => b[1].size - a[1].size);
          const maxSize = sorted.length > 0 ? sorted[0][1].size : 1;

          if (sorted.length === 0) {
            return <div className="text-center text-muted-foreground py-8">No storage data</div>;
          }

          return (
            <div className="p-6 space-y-3">
              {sorted.map(([userId, { size, count }]) => {
                const profile = profiles.find((p) => p.user_id === userId);
                const label = profile?.email || profile?.full_name || userId.slice(0, 8) + "…";
                return (
                  <div key={userId} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate max-w-[300px]" title={userId}>{label}</span>
                      <span className="text-muted-foreground shrink-0 ml-2">{formatBytes(size)} · {count} files</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.max((size / maxSize) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Storage Files */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Storage Files</h2>
            <span className="text-xs text-muted-foreground">({formatBytes(storageTotalSize)} total)</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={fetchStorage} disabled={storageLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${storageLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            {storageFiles.length > 0 && (
              <Button variant="destructive" size="sm" className="gap-1.5 text-xs" onClick={() => setConfirmDeleteAll(true)} disabled={storageLoading}>
                <Trash2 className="w-3.5 h-3.5" /> Delete All ({storageFiles.length})
              </Button>
            )}
          </div>
        </div>
        {storageLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : storageFiles.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No files in storage</div>
        ) : (
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">File Path</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Size</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Created</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {storageFiles.map((f) => (
                  <tr key={f.path} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3 font-mono text-xs max-w-[400px] truncate" title={f.path}>{f.path}</td>
                    <td className="px-6 py-3 text-muted-foreground">{formatBytes(f.size)}</td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {f.created_at ? new Date(f.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-6 py-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteFile(f.path)}
                        disabled={deletingPaths.has(f.path)}
                      >
                        {deletingPaths.has(f.path) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
