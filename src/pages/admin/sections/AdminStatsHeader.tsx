import { Users, FileText, Activity, Mail, HardDrive, AlertTriangle } from "lucide-react";
import { useAdmin } from "../AdminContext";
import { formatBytes } from "../types";

const STORAGE_CAP_BYTES = 1024 * 1024 * 1024; // 1 GB bucket cap
const STORAGE_WARN_RATIO = 0.8; // 80% → warn
const STORAGE_CRIT_RATIO = 0.9; // 90% → critical

export function AdminStatsHeader() {
  const { profiles, betaSignups, jobs, storageFiles, storageTotalSize } = useAdmin();
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-card border rounded-xl p-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{profiles.length}</p>
            <p className="text-sm text-muted-foreground">Total Users</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{betaSignups.length}</p>
            <p className="text-sm text-muted-foreground">Beta Signups</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{jobs.length}</p>
            <p className="text-sm text-muted-foreground">Research Jobs</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{jobs.filter((j) => j.status === "complete").length}</p>
            <p className="text-sm text-muted-foreground">Completed Jobs</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{formatBytes(storageTotalSize)}</p>
            <p className="text-sm text-muted-foreground">{storageFiles.length} Files</p>
          </div>
        </div>
      </div>

      {/* Storage Bar */}
      <div className="bg-card border rounded-xl p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Storage Usage</h2>
          </div>
          <span className="text-sm font-medium">{formatBytes(storageTotalSize)} / 1 GB</span>
        </div>
        <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.min((storageTotalSize / STORAGE_CAP_BYTES) * 100, 100)}%`,
              background: storageTotalSize > STORAGE_CRIT_RATIO * STORAGE_CAP_BYTES
                ? 'hsl(var(--destructive))'
                : storageTotalSize > 0.7 * STORAGE_CAP_BYTES
                ? 'hsl(40 95% 55%)'
                : 'hsl(var(--primary))',
            }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{storageFiles.length} files</span>
          <span>{((storageTotalSize / STORAGE_CAP_BYTES) * 100).toFixed(1)}% used</span>
        </div>

        {storageTotalSize >= STORAGE_WARN_RATIO * STORAGE_CAP_BYTES && (
          <div
            role="alert"
            className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
              storageTotalSize >= STORAGE_CRIT_RATIO * STORAGE_CAP_BYTES
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            }`}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">
                {storageTotalSize >= STORAGE_CRIT_RATIO * STORAGE_CAP_BYTES
                  ? 'Storage critical — bucket almost full'
                  : 'Storage warning — bucket above 80%'}
              </p>
              <p className="text-xs opacity-90">
                The <code className="font-mono">chapter-images</code> bucket is at{' '}
                {((storageTotalSize / STORAGE_CAP_BYTES) * 100).toFixed(1)}% of its 1 GB cap.
                New visual-book exports may start failing. Free up space by deleting
                inactive projects, or raise the bucket cap in Lovable Cloud.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

