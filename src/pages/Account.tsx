import { useEffect, useMemo, useState } from "react";
import { Seo } from "@/components/Seo";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, ShieldAlert, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { PlanCreditsBadge } from "@/components/PlanCreditsBadge";
import { AddonCreditsWidget } from "@/components/storyforge/visualbook/AddonCreditsWidget";
import { SubscriptionManager } from "@/components/SubscriptionManager";
import { CreditUsageHistory } from "@/components/CreditUsageHistory";
import { captureCurrentAsPostLoginRedirect } from "@/lib/post-login-redirect";

const REQUIRED_PHRASE = "DELETE MY ACCOUNT";
const COOLDOWN_SECONDS = 5;

export default function Account() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(false);

  // Multi-step safeguards
  const [ackData, setAckData] = useState(false);
  const [ackBilling, setAckBilling] = useState(false);
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [emailConfirm, setEmailConfirm] = useState("");
  const [phrase, setPhrase] = useState("");
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        captureCurrentAsPostLoginRedirect();
        navigate("/auth", { replace: true });
      } else {
        setEmail(user.email || "");
      }
    });
  }, [navigate]);

  // Reset state whenever dialog opens/closes
  useEffect(() => {
    if (open) {
      setAckData(false);
      setAckBilling(false);
      setAckIrreversible(false);
      setEmailConfirm("");
      setPhrase("");
      setCooldown(COOLDOWN_SECONDS);
      setDeleting(false);
    }
  }, [open]);

  // Cooldown countdown while dialog is open
  useEffect(() => {
    if (!open || cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [open, cooldown]);

  const allAcknowledged = ackData && ackBilling && ackIrreversible;
  const emailMatches = emailConfirm.trim().toLowerCase() === email.trim().toLowerCase() && email.length > 0;
  const phraseMatches = phrase === REQUIRED_PHRASE;
  const canDelete = useMemo(
    () => allAcknowledged && emailMatches && phraseMatches && cooldown === 0 && !deleting,
    [allAcknowledged, emailMatches, phraseMatches, cooldown, deleting]
  );

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-account", {
        body: { confirm: REQUIRED_PHRASE, email: emailConfirm.trim().toLowerCase(), acknowledged: true },
      });
      if (error) throw error;
      toast({ title: "Account deleted", description: "Your data has been permanently removed." });
      await supabase.auth.signOut();
      navigate("/", { replace: true });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Deletion failed", description: e?.message || "Please try again or contact support." });
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <Seo
        title="Account Settings — Resonance ePublisher"
        description="Manage your Resonance ePublisher account, unlocks, credit balance, and account deletion preferences."
        path="/account"
      />
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/app"><ArrowLeft className="w-4 h-4 mr-2" /> Back to app</Link>
        </Button>

        <div className="rounded-lg border bg-card p-6">
          <h1 className="text-2xl font-semibold mb-2">Account</h1>
          <p className="text-sm text-muted-foreground">Signed in as <span className="font-medium text-foreground">{email}</span></p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Plan &amp; credits</h2>
            <p className="text-sm text-muted-foreground">
              Your current unlock tier and the credits available to spend.
            </p>
          </div>
          <PlanCreditsBadge />
          <AddonCreditsWidget />
          <SubscriptionManager />
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/pricing">View all unlocks</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href="https://reson8.life/pricing" target="_blank" rel="noopener noreferrer">
                Hub pricing ↗
              </a>
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Credit usage history</h2>
            <p className="text-sm text-muted-foreground">
              Your 20 most recent generations and the plan credits each one consumed.
            </p>
          </div>
          <CreditUsageHistory />
        </div>

        <div className="rounded-lg border border-destructive/40 bg-card p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <h2 className="text-lg font-semibold">Danger zone</h2>
              <p className="text-sm text-muted-foreground">Permanently delete your account and all associated data.</p>
            </div>
          </div>

          <Alert variant="destructive">
            <AlertTitle>This cannot be undone</AlertTitle>
            <AlertDescription>
              All your projects, generated images, narration history, and personal data will be erased
              from our systems. Past purchase and credit-pack records are retained (anonymized) for
              accounting and tax compliance.
            </AlertDescription>
          </Alert>

          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2">
                <Trash2 className="w-4 h-4" /> Delete my account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-lg">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  Permanently delete your account?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Complete every step below. This is immediate and irreversible.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-4 py-2">
                {/* Step 1: Acknowledgements */}
                <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium">1. Acknowledge the consequences</p>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox checked={ackData} onCheckedChange={(v) => setAckData(v === true)} />
                    <span>All my projects, images, and narration history will be deleted.</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox checked={ackBilling} onCheckedChange={(v) => setAckBilling(v === true)} />
                    <span>Any unused credits or unlocks are forfeited and non-refundable.</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox checked={ackIrreversible} onCheckedChange={(v) => setAckIrreversible(v === true)} />
                    <span>I understand this action cannot be reversed or recovered by support.</span>
                  </label>
                </div>

                {/* Step 2: Email confirm */}
                <div className="space-y-2">
                  <Label htmlFor="email-confirm" className="text-sm font-medium">
                    2. Type your email address (<span className="font-mono">{email}</span>)
                  </Label>
                  <Input
                    id="email-confirm"
                    value={emailConfirm}
                    onChange={(e) => setEmailConfirm(e.target.value)}
                    placeholder={email}
                    autoComplete="off"
                  />
                </div>

                {/* Step 3: Phrase confirm */}
                <div className="space-y-2">
                  <Label htmlFor="phrase-confirm" className="text-sm font-medium">
                    3. Type <span className="font-mono font-semibold">{REQUIRED_PHRASE}</span>
                  </Label>
                  <Input
                    id="phrase-confirm"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder={REQUIRED_PHRASE}
                    autoComplete="off"
                  />
                </div>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={!canDelete}
                  onClick={handleDelete}
                  className="gap-2"
                >
                  {deleting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</>
                  ) : cooldown > 0 ? (
                    <>Wait {cooldown}s…</>
                  ) : (
                    <><Trash2 className="w-4 h-4" /> Delete forever</>
                  )}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </main>
  );
}
