import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { consumePostLoginRedirect } from "@/lib/post-login-redirect";

/**
 * Public OAuth / magic-link callback landing page.
 *
 * Contract:
 *  - Route is unguarded (no auth wrapper).
 *  - If a `?code=` param is present (PKCE), exchange it for a session.
 *  - If the hash contains `access_token` (implicit flow), the Supabase client
 *    auto-detects it on mount; we just wait for the session.
 *  - Once a session is confirmed, read + clear the sessionStorage-based
 *    `post_login_redirect` (falling back to `/app`) and navigate.
 */

export default function AuthCallback() {
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [status, setStatus] = useState<"working" | "error">("working");
  const [message, setMessage] = useState("Finishing sign-in…");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let unsub: (() => void) | undefined;

    const go = () => {
      const target = consumePostLoginRedirect();
      navigate(target, { replace: true });
    };

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errParam = url.searchParams.get("error_description") || url.searchParams.get("error");

        if (errParam) {
          setStatus("error");
          setMessage(errParam);
          return;
        }

        // PKCE: exchange code → session.
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) {
            setStatus("error");
            setMessage(error.message);
            return;
          }
        }

        // Session may already be set (implicit hash flow, or exchange succeeded).
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          go();
          return;
        }

        // Otherwise wait briefly for onAuthStateChange to fire.
        const sub = supabase.auth.onAuthStateChange((_event, session) => {
          if (session) go();
        });
        unsub = () => sub.data.subscription.unsubscribe();

        // Give up after 10s if nothing arrives.
        setTimeout(() => {
          if (!ranRef.current) return;
          supabase.auth.getSession().then(({ data: d }) => {
            if (d.session) go();
            else {
              setStatus("error");
              setMessage("Sign-in did not complete. Please try again.");
            }
          });
        }, 10_000);
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message ?? String(e));
      }
    })();

    return () => {
      unsub?.();
    };
  }, [navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-3">
        <h1 className="text-lg font-semibold">
          {status === "working" ? "Signing you in…" : "Sign-in failed"}
        </h1>
        <p className="text-sm text-muted-foreground break-words">{message}</p>
        {status === "error" && (
          <a
            href="/auth"
            className="inline-block mt-2 text-sm underline text-primary"
          >
            Back to sign-in
          </a>
        )}
      </div>
    </main>
  );
}
