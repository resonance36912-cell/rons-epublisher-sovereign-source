import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, Sparkles, ImageIcon, Mic } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { trackEvent } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { getCreditPack } from "@/lib/credit-packs";
import { HUB_BILLING_URL, HUB_PRICING_URL, HUB_SUPPORT_URL, hubTopupUrl } from "@/lib/hub";

const FAIL_KEY = "checkout_failures";
const FAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 45000;

type Phase = "verifying" | "success" | "cancelled" | "failed";

function getRecentFailures(): number[] {
  try {
    const raw = localStorage.getItem(FAIL_KEY);
    if (!raw) return [];
    const arr: number[] = JSON.parse(raw);
    const cutoff = Date.now() - FAIL_WINDOW_MS;
    return arr.filter((t) => t > cutoff);
  } catch {
    return [];
  }
}

function recordFailure() {
  const recent = getRecentFailures();
  recent.push(Date.now());
  localStorage.setItem(FAIL_KEY, JSON.stringify(recent));
}

async function fetchCredits(userId: string) {
  const [img, tts] = await Promise.all([
    supabase.rpc("get_addon_credits_remaining", { _user_id: userId, _credit_type: "image" }),
    supabase.rpc("get_addon_credits_remaining", { _user_id: userId, _credit_type: "tts" }),
  ]);
  return {
    image: (img.data as number | null) ?? 0,
    tts: (tts.data as number | null) ?? 0,
  };
}

export default function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");
  const reference = searchParams.get("reference") || searchParams.get("trxref");
  const packIdParam = searchParams.get("pack");
  const queryClient = useQueryClient();

  // Legacy PayFast statuses still supported
  const legacyCancelled = status === "cancelled" || status === "cancel";
  const legacyComplete = status === "complete";

  const [phase, setPhase] = useState<Phase>(
    legacyCancelled ? "cancelled" : legacyComplete ? "success" : reference ? "verifying" : "failed",
  );
  const [creditsBefore, setCreditsBefore] = useState<{ image: number; tts: number } | null>(null);
  const [creditsAfter, setCreditsAfter] = useState<{ image: number; tts: number } | null>(null);
  const [packId, setPackId] = useState<string | null>(packIdParam);
  const startedRef = useRef(false);

  const failCount = useMemo(() => {
    if (phase !== "failed" && phase !== "cancelled") return 0;
    return getRecentFailures().length + 1;
  }, [phase]);

  // Poll DB for the webhook-granted purchase/credits
  useEffect(() => {
    if (phase !== "verifying" || !reference || startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const started = Date.now();

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        setPhase("failed");
        return;
      }

      const before = await fetchCredits(userId);
      if (cancelled) return;
      setCreditsBefore(before);

      while (!cancelled && Date.now() - started < POLL_MAX_MS) {
        // Look for the purchase row created by the webhook
        const { data: purchase } = await supabase
          .from("purchases")
          .select("price_id, product_id")
          .like("stripe_session_id", `paystack_${reference}%`)
          .limit(1)
          .maybeSingle();

        if (purchase) {
          const after = await fetchCredits(userId);
          if (cancelled) return;
          setCreditsAfter(after);
          setPackId(purchase.price_id || purchase.product_id || packIdParam);
          setPhase("success");
          // Kick every entitlement-derived cache so the rest of the app sees
          // the new tier/credits immediately (no 5-min stale wait, no reload).
          queryClient.invalidateQueries({ queryKey: ["purchases"] });
          queryClient.invalidateQueries({ queryKey: ["hub-entitlement"] });
          queryClient.invalidateQueries({ queryKey: ["plan-credits"] });
          queryClient.invalidateQueries({ queryKey: ["addon-credits"] });
          trackEvent("checkout_completed", { status: "complete", reference, provider: "paystack" });
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      if (!cancelled) {
        // Timed out — webhook hasn't landed. Not necessarily a failure.
        setPhase("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, reference, packIdParam, queryClient]);

  // Legacy success tracking + failure toasts
  useEffect(() => {
    if (phase === "success" && legacyComplete) {
      trackEvent("checkout_completed", { status: "complete" });
    }
    if (phase === "failed" || phase === "cancelled") {
      trackEvent("checkout_returned_unsuccessful", {
        status: phase,
        reference: reference ?? undefined,
      });
      recordFailure();
      if (failCount >= 3) {
        toast.error("Multiple failed checkout attempts detected", {
          description: "If you're having trouble, please contact support or try a different payment method.",
          duration: 8000,
        });
      } else if (failCount === 2) {
        toast.warning("Second failed checkout attempt", {
          description: "Please double-check your payment details before trying again.",
          duration: 6000,
        });
      }
    }
  }, [phase, legacyComplete, failCount, reference]);

  const pack = packId ? getCreditPack(packId) : null;
  const imageDelta =
    creditsBefore && creditsAfter ? Math.max(0, creditsAfter.image - creditsBefore.image) : null;
  const ttsDelta =
    creditsBefore && creditsAfter ? Math.max(0, creditsAfter.tts - creditsBefore.tts) : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-md w-full mx-auto p-8">
        {phase === "verifying" && (
          <>
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Confirming your payment…</h1>
            <p className="text-muted-foreground">
              Paystack is notifying us. This usually takes a few seconds.
            </p>
            {reference && (
              <p className="text-xs text-muted-foreground mt-4 font-mono">Ref: {reference}</p>
            )}
          </>
        )}

        {phase === "success" && (
          <>
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Payment Successful!</h1>
            <p className="text-muted-foreground mb-6">
              {pack
                ? `Your ${pack.name} is now active on your account.`
                : "Thank you for your purchase. Your credits have been added to your account."}
            </p>

            {(creditsAfter || pack) && (
              <div className="bg-muted/40 border border-border rounded-lg p-4 mb-6 text-left">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Credits added
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <ImageIcon className="w-4 h-4" /> Image credits
                    </span>
                    <span className="font-mono text-foreground">
                      {imageDelta !== null ? `+${imageDelta}` : pack ? `+${pack.imageCredits}` : "—"}
                      {creditsAfter && (
                        <span className="text-muted-foreground ml-2">
                          (now {creditsAfter.image})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Mic className="w-4 h-4" /> Narration characters
                    </span>
                    <span className="font-mono text-foreground">
                      {ttsDelta !== null
                        ? `+${ttsDelta.toLocaleString()}`
                        : pack
                        ? `+${pack.ttsCredits.toLocaleString()}`
                        : "—"}
                      {creditsAfter && (
                        <span className="text-muted-foreground ml-2">
                          (now {creditsAfter.tts.toLocaleString()})
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-center flex-wrap">
              <Link
                to="/app"
                className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                Start Creating
              </Link>
              <Link
                to="/account"
                className="inline-block px-6 py-3 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors"
              >
                View Account
              </Link>
            </div>

            <p className="text-xs text-muted-foreground mt-6">
              Official receipt, purchase history & support are on The Resonance Hub.
            </p>
            <div className="flex flex-wrap gap-4 justify-center mt-2 text-xs">
              <a href={HUB_BILLING_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                View receipt on hub <ArrowUpRight className="w-3 h-3" />
              </a>
              <a href={HUB_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                Hub support <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
          </>
        )}

        {(phase === "failed" || phase === "cancelled") && (
          <>
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {phase === "cancelled" ? "Payment Cancelled" : "Payment Not Confirmed"}
            </h1>
            <p className="text-muted-foreground mb-4">
              {phase === "cancelled"
                ? "You cancelled the checkout. No charges were made."
                : reference
                ? "We haven't received confirmation from Paystack yet. If you were charged, your credits will appear shortly — you can refresh this page or check your account."
                : "We couldn't process your payment. Please check your details and try again."}
            </p>

            {reference && (
              <p className="text-xs text-muted-foreground mb-4 font-mono">Ref: {reference}</p>
            )}

            {failCount >= 3 && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-6 text-sm text-destructive text-left">
                <p className="font-medium mb-1">Multiple failed attempts detected</p>
                <p className="text-destructive/80">
                  You've had {failCount} unsuccessful checkout attempts in the last 24 hours.
                  Reach out via{" "}
                  <a href={HUB_SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                    Resonance Hub support
                  </a>
                  {" "}for help.
                </p>
              </div>
            )}

            <div className="flex gap-3 justify-center flex-wrap">
              <a
                href={hubTopupUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                Try again on hub <ArrowUpRight className="w-4 h-4" />
              </a>
              <Link
                to="/account"
                className="inline-block px-6 py-3 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors"
              >
                Check Account
              </Link>
            </div>

            <p className="text-xs text-muted-foreground mt-6">
              All checkout is handled by The Resonance Hub.{" "}
              <a href={HUB_PRICING_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                View hub pricing <ArrowUpRight className="w-3 h-3" />
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
