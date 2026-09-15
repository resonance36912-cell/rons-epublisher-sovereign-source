import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, RefreshCw, Loader2, ImageIcon, Mic, ArrowUpDown, Search } from "lucide-react";
import { toast } from "sonner";

type Profile = { user_id: string; email: string | null; full_name: string | null };

type AddonCreditRow = {
  id: string;
  user_id: string;
  credit_type: "image" | "tts" | string;
  credits_total: number;
  credits_used: number;
  source: string;
  expires_at: string | null;
  created_at: string;
};

type UserCreditSummary = {
  userId: string;
  name: string;
  email: string | null;
  imageRemaining: number;
  imageUsed: number;
  ttsRemaining: number;
  ttsUsed: number;
  totalRemaining: number; // image + tts (chars normalized to "units": images count as 1, tts as 1 char)
  rows: AddonCreditRow[];
};

type SortKey = "remaining" | "imageRemaining" | "ttsRemaining" | "name";

function fmt(n: number) {
  return n.toLocaleString();
}

function isExpired(row: AddonCreditRow): boolean {
  return !!row.expires_at && new Date(row.expires_at) <= new Date();
}

export function AdminAddonCreditsPanel({ profiles }: { profiles: Profile[] }) {
  const [rows, setRows] = useState<AddonCreditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("remaining");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchCredits = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("addon_credits")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data as AddonCreditRow[]) || []);
    } catch (err: any) {
      toast.error("Failed to load add-on credits: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  const summaries = useMemo<UserCreditSummary[]>(() => {
    const byUser = new Map<string, AddonCreditRow[]>();
    for (const r of rows) {
      const arr = byUser.get(r.user_id) || [];
      arr.push(r);
      byUser.set(r.user_id, arr);
    }
    const list: UserCreditSummary[] = [];
    for (const [userId, userRows] of byUser) {
      let imageRemaining = 0, imageUsed = 0, ttsRemaining = 0, ttsUsed = 0;
      for (const r of userRows) {
        const expired = isExpired(r);
        const remaining = expired ? 0 : Math.max(0, r.credits_total - r.credits_used);
        if (r.credit_type === "image") {
          imageRemaining += remaining;
          imageUsed += r.credits_used;
        } else if (r.credit_type === "tts") {
          ttsRemaining += remaining;
          ttsUsed += r.credits_used;
        }
      }
      const profile = profiles.find(p => p.user_id === userId);
      list.push({
        userId,
        name: profile?.full_name || profile?.email || userId.slice(0, 8) + "…",
        email: profile?.email ?? null,
        imageRemaining,
        imageUsed,
        ttsRemaining,
        ttsUsed,
        totalRemaining: imageRemaining + ttsRemaining,
        rows: userRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      });
    }
    return list;
  }, [rows, profiles]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = summaries;
    if (q) {
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        s.userId.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name": return a.name.localeCompare(b.name) * dir;
        case "imageRemaining": return (a.imageRemaining - b.imageRemaining) * dir;
        case "ttsRemaining": return (a.ttsRemaining - b.ttsRemaining) * dir;
        case "remaining":
        default: return (a.totalRemaining - b.totalRemaining) * dir;
      }
    });
  }, [summaries, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const totals = useMemo(() => {
    let imgRem = 0, imgUsed = 0, ttsRem = 0, ttsUsed = 0;
    for (const s of summaries) {
      imgRem += s.imageRemaining; imgUsed += s.imageUsed;
      ttsRem += s.ttsRemaining; ttsUsed += s.ttsUsed;
    }
    return { imgRem, imgUsed, ttsRem, ttsUsed, users: summaries.length };
  }, [summaries]);

  const toggleExpand = (userId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Add-on Credit Balances</h2>
          <span className="text-xs text-muted-foreground">
            {totals.users} user{totals.users === 1 ? "" : "s"} with credits
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user…"
              className="h-8 pl-8 text-xs w-48"
            />
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchCredits} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Images remaining</div>
            <div className="font-semibold tabular-nums">{fmt(totals.imgRem)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Images used</div>
            <div className="font-semibold tabular-nums">{fmt(totals.imgUsed)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">TTS chars remaining</div>
            <div className="font-semibold tabular-nums">{fmt(totals.ttsRem)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-muted-foreground" />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">TTS chars used</div>
            <div className="font-semibold tabular-nums">{fmt(totals.ttsUsed)}</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="px-6 py-12 text-center text-muted-foreground text-sm">
          {search ? "No users match your search." : "No add-on credits issued yet."}
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium">
                  <button onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-foreground">
                    User <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  <button onClick={() => toggleSort("imageRemaining")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Images left <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">Img used</th>
                <th className="text-right px-4 py-2 font-medium">
                  <button onClick={() => toggleSort("ttsRemaining")} className="inline-flex items-center gap-1 hover:text-foreground">
                    TTS chars left <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-right px-4 py-2 font-medium">TTS used</th>
                <th className="text-right px-4 py-2 font-medium">
                  <button onClick={() => toggleSort("remaining")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Total left <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="text-left px-4 py-2 font-medium">History</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredSorted.map((s) => {
                const isOpen = expanded.has(s.userId);
                return (
                  <>
                    <tr key={s.userId} className="hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <div className="font-medium truncate max-w-[260px]" title={s.email || s.userId}>{s.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{s.userId.slice(0, 8)}…</div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(s.imageRemaining)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmt(s.imageUsed)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(s.ttsRemaining)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmt(s.ttsUsed)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmt(s.totalRemaining)}</td>
                      <td className="px-4 py-2">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleExpand(s.userId)}>
                          {isOpen ? "Hide" : `View ${s.rows.length}`}
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={s.userId + ":rows"} className="bg-muted/10">
                        <td colSpan={7} className="px-4 py-3">
                          <table className="w-full text-xs">
                            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              <tr>
                                <th className="text-left py-1 font-medium">Type</th>
                                <th className="text-right py-1 font-medium">Total</th>
                                <th className="text-right py-1 font-medium">Used</th>
                                <th className="text-right py-1 font-medium">Remaining</th>
                                <th className="text-left py-1 font-medium pl-4">Source</th>
                                <th className="text-left py-1 font-medium">Issued</th>
                                <th className="text-left py-1 font-medium">Expires</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {s.rows.map((r) => {
                                const expired = isExpired(r);
                                const remaining = Math.max(0, r.credits_total - r.credits_used);
                                return (
                                  <tr key={r.id}>
                                    <td className="py-1.5">
                                      <span className="inline-flex items-center gap-1">
                                        {r.credit_type === "image"
                                          ? <ImageIcon className="w-3 h-3 text-muted-foreground" />
                                          : <Mic className="w-3 h-3 text-muted-foreground" />}
                                        {r.credit_type}
                                      </span>
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums">{fmt(r.credits_total)}</td>
                                    <td className="py-1.5 text-right tabular-nums">{fmt(r.credits_used)}</td>
                                    <td className={`py-1.5 text-right tabular-nums ${expired ? "line-through text-muted-foreground" : ""}`}>
                                      {fmt(remaining)}
                                    </td>
                                    <td className="py-1.5 pl-4 text-muted-foreground">{r.source}</td>
                                    <td className="py-1.5 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                                    <td className="py-1.5 text-muted-foreground">
                                      {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}
                                      {expired && <span className="ml-1 text-destructive">(expired)</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
