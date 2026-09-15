import { Loader2, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAdmin } from "../AdminContext";

export function AdminTablesSection() {
  const { profiles, setProfiles, jobs, setJobs, betaSignups, setBetaSignups, loading } = useAdmin();

  return (
    <>
      {/* Beta Signups */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Beta Signups</h2>
          <div className="flex items-center gap-2">
            {betaSignups.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={async () => {
                  if (!confirm(`Delete ALL ${betaSignups.length} beta signups? This cannot be undone.`)) return;
                  const { error } = await supabase.from("beta_signups").delete().neq("id", "00000000-0000-0000-0000-000000000000");
                  if (error) {
                    toast.error("Failed to delete signups");
                  } else {
                    const count = betaSignups.length;
                    setBetaSignups([]);
                    toast.success(`All ${count} signups deleted`);
                  }
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete All
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={betaSignups.length === 0}
              onClick={() => {
                const csv = ["Email,Signed Up"]
                  .concat(betaSignups.map((s) => `${s.email},${new Date(s.created_at).toISOString()}`))
                  .join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `beta-signups-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : betaSignups.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No beta signups yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">#</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {betaSignups.map((s, i) => (
                  <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3 text-muted-foreground">{i + 1}</td>
                    <td className="px-6 py-3">{s.email}</td>
                    <td className="px-6 py-3 text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Users */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Registered Users</h2>
            {profiles.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={async () => {
                  if (!confirm(`Delete ALL ${profiles.length} user profiles? This cannot be undone.`)) return;
                  const { error } = await supabase.from("profiles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
                  if (error) {
                    toast.error("Failed to delete profiles");
                  } else {
                    const count = profiles.length;
                    setProfiles([]);
                    toast.success(`All ${count} profiles deleted`);
                  }
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete All
              </Button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3">{p.full_name || "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{p.email || "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Jobs */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent Research Jobs</h2>
            {jobs.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={async () => {
                  if (!confirm(`Delete ALL ${jobs.length} research jobs? This cannot be undone.`)) return;
                  const { error } = await supabase.from("research_jobs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
                  if (error) {
                    toast.error("Failed to delete jobs");
                  } else {
                    setJobs([]);
                    toast.success(`All ${jobs.length} jobs deleted`);
                  }
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete All
              </Button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Topic</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Progress</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3 font-medium max-w-[300px] truncate">{j.topic}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        j.status === "complete" ? "bg-green-500/10 text-green-600" :
                        j.status === "failed" ? "bg-red-500/10 text-red-600" :
                        "bg-yellow-500/10 text-yellow-600"
                      }`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">{j.progress}%</td>
                    <td className="px-6 py-3 text-muted-foreground">{new Date(j.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={async () => {
                          if (!confirm(`Delete research job "${j.topic}"?`)) return;
                          const { error } = await supabase.from("research_jobs").delete().eq("id", j.id);
                          if (error) {
                            toast.error("Failed to delete job");
                          } else {
                            setJobs((prev) => prev.filter((job) => job.id !== j.id));
                            toast.success("Job deleted");
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
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
