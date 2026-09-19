import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FALLBACK_CREDIT_PACKS } from "@/lib/credit-packs";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Loader2, Plus, Pencil, Trash2, RefreshCw, Package, ImageIcon, Mic, AlertTriangle, Check,
  FlaskConical, ExternalLink, Copy,
} from "lucide-react";

type PackRow = {
  id: string;
  name: string;
  tagline: string;
  price_zar: number;
  image_credits: number;
  tts_credits: number;
  highlight: boolean;
  active: boolean;
  sort_order: number;
  updated_at?: string | null;
};

const EMPTY_FORM: PackRow = {
  id: "",
  name: "",
  tagline: "",
  price_zar: 0,
  image_credits: 0,
  tts_credits: 0,
  highlight: false,
  active: true,
  sort_order: 0,
};

function zar(n: number) {
  return `R${n.toLocaleString()}`;
}

type TestCheckoutState = {
  packId: string;
  packName: string;
  status: "initializing" | "awaiting_payment" | "polling" | "success" | "failed" | "error";
  reference?: string;
  authorizationUrl?: string;
  gatewayResponse?: string | null;
  paidAt?: string | null;
  amountKobo?: number | null;
  currency?: string | null;
  testMode?: boolean;
  errorMessage?: string;
  pollCount?: number;
};

export function AdminCreditPacksManager() {
  const [rows, setRows] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PackRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testCheckout, setTestCheckout] = useState<TestCheckoutState | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("credit_packs")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error("Could not load credit packs", { description: error.message });
      setRows([]);
    } else {
      setRows((data as PackRow[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const drift = useMemo(() => {
    // Compare DB vs client fallback list for the shared ids.
    const findings: string[] = [];
    for (const fb of FALLBACK_CREDIT_PACKS) {
      const dbRow = rows.find((r) => r.id === fb.id);
      if (!dbRow) {
        findings.push(`Fallback pack "${fb.id}" is missing from the DB catalog.`);
        continue;
      }
      if (dbRow.price_zar !== fb.priceZAR) {
        findings.push(`${fb.id}: DB price ${zar(dbRow.price_zar)} ≠ fallback ${zar(fb.priceZAR)}.`);
      }
      if (dbRow.image_credits !== fb.imageCredits) {
        findings.push(`${fb.id}: DB image credits ${dbRow.image_credits} ≠ fallback ${fb.imageCredits}.`);
      }
      if (dbRow.tts_credits !== fb.ttsCredits) {
        findings.push(`${fb.id}: DB TTS credits ${dbRow.tts_credits} ≠ fallback ${fb.ttsCredits}.`);
      }
    }
    return findings;
  }, [rows]);

  const startCreate = () => {
    setEditing({ ...EMPTY_FORM, sort_order: (rows[rows.length - 1]?.sort_order ?? 0) + 10 });
    setCreating(true);
  };

  const startEdit = (row: PackRow) => {
    setEditing({ ...row });
    setCreating(false);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.id.match(/^[a-z0-9_]+$/i)) {
      toast.error("Pack id must be alphanumeric / underscore only.");
      return;
    }
    if (!editing.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    setSaving(true);
    const payload = {
      id: editing.id.trim(),
      name: editing.name.trim(),
      tagline: editing.tagline ?? "",
      price_zar: Math.max(0, Math.round(editing.price_zar)),
      image_credits: Math.max(0, Math.round(editing.image_credits)),
      tts_credits: Math.max(0, Math.round(editing.tts_credits)),
      highlight: editing.highlight,
      active: editing.active,
      sort_order: Math.round(editing.sort_order),
    };
    const { error } = creating
      ? await supabase.from("credit_packs").insert(payload)
      : await supabase.from("credit_packs").update(payload).eq("id", payload.id);

    setSaving(false);
    if (error) {
      toast.error(creating ? "Could not create pack" : "Could not update pack", {
        description: error.message,
      });
      return;
    }
    toast.success(creating ? "Pack created" : "Pack updated");
    setEditing(null);
    setCreating(false);
    await load();
  };

  const remove = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("credit_packs").delete().eq("id", deleteId);
    if (error) {
      toast.error("Delete failed", { description: error.message });
    } else {
      toast.success("Pack deleted");
      await load();
    }
    setDeleteId(null);
  };

  const startTestCheckout = async (row: PackRow) => {
    if (FREE_PROMOTION_ACTIVE) {
      toast.message("Payment test checkout is disabled during the free-access promotion.");
      return;
    }
    setTestCheckout({
      packId: row.id,
      packName: row.name,
      status: "initializing",
    });
    try {
      const callbackUrl = `${window.location.origin}/checkout/return`;
      const { data, error } = await supabase.functions.invoke("paystack-checkout-init", {
        body: { pack_id: row.id, callback_url: callbackUrl },
      });
      if (error) throw error;
      const ref = (data as any)?.reference as string | undefined;
      const url = (data as any)?.authorization_url as string | undefined;
      if (!ref || !url) throw new Error("Missing reference or authorization_url in response");

      // Open Paystack in a new tab so the admin panel keeps polling.
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* popup blocked — admin can click the link in the dialog */
      }

      setTestCheckout({
        packId: row.id,
        packName: row.name,
        status: "awaiting_payment",
        reference: ref,
        authorizationUrl: url,
        pollCount: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start test checkout";
      toast.error("Test checkout failed", { description: message });
      setTestCheckout({
        packId: row.id,
        packName: row.name,
        status: "error",
        errorMessage: message,
      });
    }
  };

  // Poll verify while dialog is in an active state.
  useEffect(() => {
    if (!testCheckout?.reference) return;
    if (testCheckout.status !== "awaiting_payment" && testCheckout.status !== "polling") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("paystack-verify-transaction", {
          body: { reference: testCheckout.reference },
        });
        if (cancelled) return;
        if (error) throw error;
        const d = data as any;
        const status = d?.status as string;
        const next: TestCheckoutState = {
          ...testCheckout,
          status:
            status === "success" ? "success"
            : status === "failed" || status === "abandoned" ? "failed"
            : "polling",
          gatewayResponse: d?.gateway_response ?? null,
          paidAt: d?.paid_at ?? null,
          amountKobo: d?.amount_kobo ?? null,
          currency: d?.currency ?? null,
          testMode: !!d?.test_mode,
          pollCount: (testCheckout.pollCount ?? 0) + 1,
        };
        setTestCheckout(next);
      } catch (err) {
        if (cancelled) return;
        setTestCheckout((prev) =>
          prev
            ? {
                ...prev,
                status: "polling",
                pollCount: (prev.pollCount ?? 0) + 1,
                errorMessage: err instanceof Error ? err.message : "Verify request failed",
              }
            : prev,
        );
      }
    };

    const timer = setTimeout(poll, testCheckout.status === "awaiting_payment" ? 4000 : 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [testCheckout]);



  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Package className="w-5 h-5 text-primary mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold">Credit packs</h2>
            <p className="text-sm text-muted-foreground">
              Server-authoritative catalog used by Paystack checkout &amp; the webhook.
              Changes here propagate to the pricing page immediately.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={startCreate}>
            <Plus className="w-4 h-4 mr-2" /> New pack
          </Button>
        </div>
      </div>

      {drift.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4" />
            Drift vs client fallback catalog ({drift.length})
          </div>
          <ul className="mt-2 list-disc list-inside text-amber-700/90 dark:text-amber-300/90 space-y-0.5">
            {drift.map((d) => (<li key={d}>{d}</li>))}
          </ul>
          <p className="text-xs text-amber-700/70 dark:text-amber-300/70 mt-2">
            Fallback lives in <code>src/lib/credit-packs.ts</code>. Update it after intentional catalog changes so offline / edge-fallback stays accurate.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading catalog…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No credit packs yet — click <strong>New pack</strong> to create one.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`rounded-lg border p-4 space-y-3 ${
                row.active ? "bg-card" : "bg-muted/40 opacity-70"
              } ${row.highlight ? "border-primary" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{row.name}</h3>
                    {row.highlight && <Badge variant="default">Most popular</Badge>}
                    {!row.active && <Badge variant="outline">Hidden</Badge>}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">{row.id}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold">{zar(row.price_zar)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">once-off</div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">{row.tagline || <em className="text-muted-foreground/60">No tagline</em>}</p>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                  <span className="tabular-nums font-medium">{row.image_credits}</span>
                  <span className="text-muted-foreground text-xs">images</span>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
                  <Mic className="w-4 h-4 text-muted-foreground" />
                  <span className="tabular-nums font-medium">{row.tts_credits.toLocaleString()}</span>
                  <span className="text-muted-foreground text-xs">chars</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-muted-foreground">sort: {row.sort_order}</span>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => startTestCheckout(row)}
                    disabled={!row.active || testCheckout?.status === "initializing"}
                    title={row.active ? "Fire a Paystack test-mode checkout for this pack" : "Activate the pack to test checkout"}
                  >
                    <FlaskConical className="w-3.5 h-3.5 mr-1" /> Test checkout
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  <AlertDialog open={deleteId === row.id} onOpenChange={(o) => !o && setDeleteId(null)}>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteId(row.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete "{row.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The pack will disappear from the pricing page immediately. Existing purchases and credits are untouched.
                          Consider toggling <strong>Active</strong> off instead to preserve history.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={remove}
                        >
                          Delete pack
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setCreating(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{creating ? "Create credit pack" : `Edit ${editing?.name || "pack"}`}</DialogTitle>
            <DialogDescription>
              Pack id is the stable checkout key (e.g. <code>pack_creator</code>). It cannot be changed after creation.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pack-id">Pack id</Label>
                  <Input
                    id="pack-id"
                    value={editing.id}
                    onChange={(e) => setEditing({ ...editing, id: e.target.value })}
                    disabled={!creating}
                    placeholder="pack_creator"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pack-sort">Sort order</Label>
                  <Input
                    id="pack-sort"
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pack-name">Name</Label>
                <Input
                  id="pack-name"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pack-tagline">Tagline</Label>
                <Textarea
                  id="pack-tagline"
                  rows={2}
                  value={editing.tagline}
                  onChange={(e) => setEditing({ ...editing, tagline: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pack-price">Price (ZAR)</Label>
                  <Input
                    id="pack-price"
                    type="number"
                    min={0}
                    value={editing.price_zar}
                    onChange={(e) => setEditing({ ...editing, price_zar: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pack-img">Image credits</Label>
                  <Input
                    id="pack-img"
                    type="number"
                    min={0}
                    value={editing.image_credits}
                    onChange={(e) => setEditing({ ...editing, image_credits: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pack-tts">TTS chars</Label>
                  <Input
                    id="pack-tts"
                    type="number"
                    min={0}
                    value={editing.tts_credits}
                    onChange={(e) => setEditing({ ...editing, tts_credits: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Highlight as "Most popular"</div>
                  <div className="text-xs text-muted-foreground">Only one pack should typically be highlighted.</div>
                </div>
                <Switch
                  checked={editing.highlight}
                  onCheckedChange={(v) => setEditing({ ...editing, highlight: v })}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">Hidden packs stay in DB but disappear from pricing.</div>
                </div>
                <Switch
                  checked={editing.active}
                  onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                />
              </div>

              {/* Live preview */}
              <div className="rounded-lg border border-dashed p-3 bg-muted/30">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Preview</div>
                <div className={`rounded-lg border p-4 ${editing.highlight ? "border-primary" : "border-border"} bg-card`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold">{editing.name || "Untitled pack"}</h4>
                    {editing.highlight && <Badge>Most popular</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{editing.tagline || "—"}</p>
                  <div className="mt-2 text-2xl font-extrabold">{zar(editing.price_zar)}</div>
                  <ul className="mt-2 space-y-1 text-xs">
                    <li className="flex items-center gap-1.5"><Check className="w-3 h-3 text-primary" />{editing.image_credits} premium AI images</li>
                    <li className="flex items-center gap-1.5"><Check className="w-3 h-3 text-primary" />{(editing.tts_credits / 1000).toFixed(0)}k narration characters</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setCreating(false); }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : creating ? "Create pack" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!testCheckout}
        onOpenChange={(o) => { if (!o) setTestCheckout(null); }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-primary" />
              Test checkout — {testCheckout?.packName}
            </DialogTitle>
            <DialogDescription>
              Fires a real Paystack transaction using your configured secret key. Use a Paystack test card
              (e.g. <code>4084 0840 8408 4081</code>, CVV <code>408</code>, expiry any future date, PIN <code>0000</code>, OTP <code>123456</code>).
            </DialogDescription>
          </DialogHeader>

          {testCheckout && (
            <div className="space-y-3 text-sm">
              {testCheckout.status === "initializing" && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Initializing transaction…
                </div>
              )}

              {testCheckout.reference && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Reference</div>
                      <code className="text-xs break-all">{testCheckout.reference}</code>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(testCheckout.reference!);
                        toast.success("Reference copied");
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {testCheckout.testMode !== undefined && (
                    <Badge variant={testCheckout.testMode ? "outline" : "default"}>
                      {testCheckout.testMode ? "TEST mode" : "LIVE mode"}
                    </Badge>
                  )}
                </div>
              )}

              {testCheckout.authorizationUrl && testCheckout.status !== "success" && (
                <a
                  href={testCheckout.authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Reopen Paystack checkout
                </a>
              )}

              {(testCheckout.status === "awaiting_payment" || testCheckout.status === "polling") && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Polling Paystack for status
                  {testCheckout.pollCount ? <span className="text-xs">({testCheckout.pollCount})</span> : null}
                </div>
              )}

              {testCheckout.status === "success" && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                    <Check className="w-4 h-4" /> Payment successful
                  </div>
                  {testCheckout.amountKobo != null && testCheckout.currency && (
                    <div className="text-xs text-muted-foreground">
                      {testCheckout.currency.toUpperCase()} {(testCheckout.amountKobo / 100).toLocaleString()}
                      {testCheckout.paidAt ? ` · ${new Date(testCheckout.paidAt).toLocaleString()}` : ""}
                    </div>
                  )}
                  {testCheckout.gatewayResponse && (
                    <div className="text-xs text-muted-foreground">{testCheckout.gatewayResponse}</div>
                  )}
                </div>
              )}

              {testCheckout.status === "failed" && (
                <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-medium">
                    <AlertTriangle className="w-4 h-4" /> Payment failed or abandoned
                  </div>
                  {testCheckout.gatewayResponse && (
                    <div className="text-xs text-muted-foreground">{testCheckout.gatewayResponse}</div>
                  )}
                </div>
              )}

              {testCheckout.status === "error" && (
                <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-rose-600 dark:text-rose-400">
                  {testCheckout.errorMessage ?? "Unknown error"}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestCheckout(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
