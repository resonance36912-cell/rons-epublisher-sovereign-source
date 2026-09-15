import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Sparkles, Loader2, Check } from "lucide-react";
import { motion } from "framer-motion";
import { trackEvent } from "@/lib/analytics";

export function BetaSignupForm() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast({ title: t("beta.invalidEmail"), variant: "destructive" });
      return;
    }

    setLoading(true);
    trackEvent("signup_started", { source: "beta_form" });
    try {
      const { error } = await supabase
        .from("beta_signups")
        .insert({ email: trimmed });

      if (error) {
        if (error.code === "23505") {
          // duplicate
          toast({ title: t("beta.alreadySignedUp") });
          setSuccess(true);
          trackEvent("signup_completed", { source: "beta_form", duplicate: true });
        } else {
          throw error;
        }
      } else {
        setSuccess(true);
        toast({ title: t("beta.success") });
        trackEvent("signup_completed", { source: "beta_form", duplicate: false });
      }
    } catch (err: any) {
      toast({ title: t("beta.error"), description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="container px-6 pb-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="max-w-xl mx-auto glass-card p-8 text-center space-y-5"
      >
        <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center">
          <Mail className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-xl md:text-2xl font-display font-bold">
          {t("beta.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("beta.subtitle")}
        </p>

        {success ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center justify-center gap-2 text-primary font-semibold py-3"
          >
            <Check className="w-5 h-5" />
            {t("beta.confirmed")}
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <Input
              type="email"
              placeholder={t("beta.placeholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
              required
              disabled={loading}
            />
            <Button type="submit" disabled={loading} className="gap-2 glow-primary whitespace-nowrap">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {t("beta.cta")}
            </Button>
          </form>
        )}
      </motion.div>
    </section>
  );
}
