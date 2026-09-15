import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw, Loader2, Copy, Tag, Users, Ticket, AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Coupon = {
  id: string;
  code: string;
  coupon_type: string;
  discount_value: number;
  target_tier: string;
  max_redemptions: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
};

type Redemption = {
  id: string;
  coupon_id: string;
  user_id: string;
  granted_tier: string | null;
  redeemed_at: string;
};

const COUPON_TYPES = [
  { value: "free_access", label: "Free Access (100% off)" },
  { value: "percentage", label: "Percentage Discount" },
  { value: "fixed", label: "Fixed ZAR Amount" },
];

const TIERS = [
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
];

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "RES-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function AdminCouponManager({ profiles }: { profiles: { user_id: string; email: string | null; full_name: string | null }[] }) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form state
  const [newCode, setNewCode] = useState(generateCode());
  const [newType, setNewType] = useState("free_access");
  const [newValue, setNewValue] = useState("100");
  const [newTier, setNewTier] = useState("premium");
  const [newMaxUses, setNewMaxUses] = useState("10");
  const [newExpiry, setNewExpiry] = useState("");
  const [showForm, setShowForm] = useState(false);

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, rRes] = await Promise.all([
        supabase.from("coupons").select("*").order("created_at", { ascending: false }),
        supabase.from("coupon_redemptions").select("*").order("redeemed_at", { ascending: false }),
      ]);
      if (cRes.error) console.error("Coupons fetch error:", cRes.error);
      if (rRes.error) console.error("Redemptions fetch error:", rRes.error);
      const couponsData = (cRes.data || []) as Coupon[];
      const redemptionsData = (rRes.data || []) as Redemption[];
      setCoupons(couponsData);
      setRedemptions(redemptionsData);
    } catch (err) {
      console.error("Failed to load coupons:", err);
      toast.error("Failed to load coupons");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCoupons(); }, [fetchCoupons]);

  const handleCreate = async () => {
    if (!newCode.trim()) { toast.error("Code is required"); return; }
    setCreating(true);
    try {
      const payload = {
        code: newCode.toUpperCase().trim(),
        coupon_type: newType,
        discount_value: parseFloat(newValue) || 100,
        target_tier: newTier,
        max_redemptions: parseInt(newMaxUses) || 10,
        expires_at: newExpiry || null,
        active: true,
      };
      const { data, error } = await supabase
        .from("coupons")
        .insert(payload)
        .select()
        .single();
      if (error) {
        console.error("[AdminCouponManager] Create failed:", error);
        throw error;
      }
      toast.success(`Coupon ${data?.code || newCode} created`);
      setNewCode(generateCode());
      setShowForm(false);
      fetchCoupons();
    } catch (err: any) {
      const msg = err.message || "Failed to create coupon";
      if (msg.includes("duplicate")) {
        toast.error("Coupon code already exists");
      } else if (msg.includes("row-level security") || msg.includes("permission")) {
        toast.error("Permission denied — only admins can create coupons");
      } else {
        toast.error(msg);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("coupons").update({ active }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCoupons(prev => prev.map(c => c.id === id ? { ...c, active } : c));
    toast.success(active ? "Coupon activated" : "Coupon deactivated");
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("coupons").delete().eq("id", deleteId);
    if (error) { toast.error(error.message); return; }
    setCoupons(prev => prev.filter(c => c.id !== deleteId));
    setDeleteId(null);
    toast.success("Coupon deleted");
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied to clipboard");
  };

  const getRedemptionCount = (couponId: string) =>
    redemptions.filter(r => r.coupon_id === couponId).length;

  // Coupons at or above 80% of max redemptions (active only)
  const nearLimitCoupons = coupons.filter(c => {
    if (!c.active) return false;
    const used = getRedemptionCount(c.id);
    return used >= Math.ceil(c.max_redemptions * 0.8) && used < c.max_redemptions;
  });

  const maxedCoupons = coupons.filter(c => {
    const used = getRedemptionCount(c.id);
    return used >= c.max_redemptions;
  });

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      {/* Threshold alerts */}
      {(nearLimitCoupons.length > 0 || maxedCoupons.length > 0) && (
        <div className="px-6 py-3 space-y-2 border-b bg-amber-500/5">
          {nearLimitCoupons.map(c => {
            const used = getRedemptionCount(c.id);
            const pct = Math.round((used / c.max_redemptions) * 100);
            return (
              <div key={c.id} className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  <span className="font-mono font-semibold">{c.code}</span> is at {pct}% capacity ({used}/{c.max_redemptions} redeemed)
                </span>
              </div>
            );
          })}
          {maxedCoupons.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <span className="font-mono font-semibold">{c.code}</span> has reached its maximum redemptions ({c.max_redemptions}/{c.max_redemptions})
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Ticket className="w-5 h-5 text-primary" />
          <h2 className="font-display font-semibold text-lg">Coupon Management</h2>
          <Badge variant="outline" className="text-xs">{coupons.length} coupons</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchCoupons} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New Coupon
          </Button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="px-6 py-4 border-b bg-muted/10 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Coupon Code</Label>
              <div className="flex gap-2">
                <Input value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="RES-XXXXXX" className="font-mono" />
                <Button variant="outline" size="icon" onClick={() => setNewCode(generateCode())} title="Generate new code" className="h-11 w-11 sm:h-10 sm:w-10 shrink-0">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Type</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COUPON_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Target Tier</Label>
              <Select value={newTier} onValueChange={setNewTier}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {newType !== "free_access" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{newType === "percentage" ? "Discount %" : "Amount (ZAR)"}</Label>
                <Input type="number" value={newValue} onChange={e => setNewValue(e.target.value)} min="1" max={newType === "percentage" ? "100" : "9999"} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Max Redemptions</Label>
              <Input type="number" value={newMaxUses} onChange={e => setNewMaxUses(e.target.value)} min="1" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Expires (optional)</Label>
              <Input type="datetime-local" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={creating} className="gap-1.5">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Tag className="w-3.5 h-3.5" />}
              Create Coupon
            </Button>
          </div>
        </div>
      )}

      {/* Coupons List */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : coupons.length === 0 ? (
        <div className="px-6 py-12 text-center text-muted-foreground text-sm">No coupons yet. Create one to get started.</div>
      ) : (
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Code</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Tier</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground">Redeemed</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Expires</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground">Active</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {coupons.map(c => {
                const used = getRedemptionCount(c.id);
                const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                return (
                  <tr key={c.id} className={`hover:bg-muted/20 transition-colors ${isExpired ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <button onClick={() => copyCode(c.code)} className="flex items-center gap-1.5 font-mono font-semibold text-primary hover:underline" title="Copy code">
                        {c.code} <Copy className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">
                        {c.coupon_type === "free_access" ? "Free" : c.coupon_type === "percentage" ? `${c.discount_value}%` : `R${c.discount_value}`}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 capitalize">{c.target_tier}</td>
                    <td className="px-4 py-2.5 text-center">
                      {(() => {
                        const pct = c.max_redemptions > 0 ? used / c.max_redemptions : 0;
                        const isNearLimit = pct >= 0.8 && used < c.max_redemptions;
                        const isMaxed = used >= c.max_redemptions;
                        return (
                          <span className={`inline-flex items-center gap-1 ${isMaxed ? "text-destructive font-semibold" : isNearLimit ? "text-amber-600 dark:text-amber-400 font-medium" : ""}`}>
                            {(isNearLimit || isMaxed) && <AlertTriangle className="w-3 h-3 shrink-0" />}
                            {used}/{c.max_redemptions}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString("en-ZA") : "Never"}
                      {isExpired && <Badge variant="destructive" className="ml-1 text-[9px]">Expired</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Switch checked={c.active} onCheckedChange={v => handleToggle(c.id, v)} className="scale-125 sm:scale-100" />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-7 sm:w-7 text-destructive" onClick={() => setDeleteId(c.id)}>
                        <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Redemption Log */}
      {redemptions.length > 0 && (
        <div className="border-t">
          <div className="px-6 py-3 flex items-center gap-2 bg-muted/10">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Recent Redemptions ({redemptions.length})</span>
          </div>
          <div className="overflow-x-auto max-h-[250px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Coupon</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Granted Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {redemptions.slice(0, 50).map(r => {
                  const coupon = coupons.find(c => c.id === r.coupon_id);
                  const profile = profiles.find(p => p.user_id === r.user_id);
                  return (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2">{new Date(r.redeemed_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}</td>
                      <td className="px-4 py-2 truncate max-w-[160px]">{profile?.full_name || profile?.email || r.user_id.slice(0, 8)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{coupon?.code || "—"}</td>
                      <td className="px-4 py-2 capitalize">{r.granted_tier || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Coupon</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this coupon and all its redemption records.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
