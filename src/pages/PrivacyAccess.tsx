import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Shield, ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import { captureCurrentAsPostLoginRedirect } from "@/lib/post-login-redirect";

type Grant = {
  id: string;
  reason: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
};

const DURATIONS: { label: string; hours: number }[] = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

export default function PrivacyAccess() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hours, setHours] = useState<number>(24);
  const [reason, setReason] = useState("");

  const load = async (uid: string) => {
    const { data, error } = await supabase
      .from("support_access_grants")
      .select("id, reason, granted_at, expires_at, revoked_at")
      .eq("user_id", uid)
      .order("granted_at", { ascending: false });
    if (error) {
      toast({ title: "Could not load grants", description: error.message, variant: "destructive" });
    }
    setGrants((data || []) as Grant[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        captureCurrentAsPostLoginRedirect();
        navigate("/auth", { replace: true });
        return;
      }
      setUserId(session.user.id);
      load(session.user.id);
    });
  }, [navigate]);

  const now = Date.now();
  const isActive = (g: Grant) =>
    !g.revoked_at && new Date(g.expires_at).getTime() > now;

  const activeGrant = grants.find(isActive);

  const grant = async () => {
    if (!userId) return;
    setSubmitting(true);
    const expires = new Date(now + hours * 3600 * 1000).toISOString();
    const { error } = await supabase
      .from("support_access_grants")
      .insert({ user_id: userId, expires_at: expires, reason: reason.trim() });
    setSubmitting(false);
    if (error) {
      toast({ title: "Could not grant access", description: error.message, variant: "destructive" });
      return;
    }
    setReason("");
    toast({ title: "Support access granted", description: `Expires in ${hours}h. You can revoke at any time.` });
    load(userId);
  };

  const revoke = async (id: string) => {
    const { error } = await supabase
      .from("support_access_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast({ title: "Could not revoke", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Access revoked" });
    if (userId) load(userId);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-display text-xl font-semibold gradient-text">Privacy & Access</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/app")} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back to App
          </Button>
        </div>
      </header>

      <main className="container max-w-3xl px-6 py-10 space-y-8">
        <section className="space-y-3">
          <h1 className="text-2xl font-display font-semibold">Your content is private by default</h1>
          <p className="text-muted-foreground leading-relaxed">
            Nobody — including platform administrators — can read your projects, chapters, or
            chapter images. If you need help from support and want an admin to view your
            content, grant temporary access below. Grants are time-limited and you can revoke
            them at any moment.
          </p>
        </section>

        <section className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Grant temporary support access</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-[auto,1fr,auto] items-end">
            <div className="space-y-1.5">
              <Label htmlFor="duration">Duration</Label>
              <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
                <SelectTrigger id="duration" className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d.hours} value={String(d.hours)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason" value={reason} maxLength={200}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Support ticket #1234"
              />
            </div>
            <Button onClick={grant} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Grant access"}
            </Button>
          </div>
          {activeGrant && (
            <p className="text-sm text-muted-foreground">
              An active grant already exists. Adding another extends/overlaps coverage.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Grant history</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have never granted admin access. Your content is fully private.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {grants.map((g) => {
                const active = isActive(g);
                return (
                  <li key={g.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
                          active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        }`}>
                          {active ? "Active" : g.revoked_at ? "Revoked" : "Expired"}
                        </span>
                        <span className="text-muted-foreground truncate">{g.reason || "No reason given"}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Granted {new Date(g.granted_at).toLocaleString()} · Expires {new Date(g.expires_at).toLocaleString()}
                        {g.revoked_at ? ` · Revoked ${new Date(g.revoked_at).toLocaleString()}` : ""}
                      </p>
                    </div>
                    {active && (
                      <Button variant="outline" size="sm" onClick={() => revoke(g.id)} className="gap-1.5 shrink-0">
                        <ShieldOff className="w-4 h-4" /> Revoke
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
