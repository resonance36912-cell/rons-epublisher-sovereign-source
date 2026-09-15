import { Home, LogIn, LogOut, Shield, Menu, User as UserIcon } from "lucide-react";
import resonanceLogo from "@/assets/resonance-logo.png";
import { useStoryForge } from "./StoryForgeContext";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useIsAdmin } from "@/hooks/use-admin";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useI18n } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ProjectManager } from "./ProjectManager";
import { ResonanceLogo } from "@/components/brand/ResonanceLogo";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

export function AppHeader() {
  const { step, setStep } = useStoryForge();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAdmin } = useIsAdmin();
  const { t } = useI18n();

  useEffect(() => {
    if (OPEN_NOVA_LOCAL_ONLY) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const navLinks = (isMobile = false) => (
    <>
      {step > 0 && (
        <Button variant="ghost" size="sm" onClick={() => { setStep(0); setMobileOpen(false); }} className="gap-1.5 justify-start">
          <Home className="w-4 h-4" /> {t("nav.home")}
        </Button>
      )}
      <Button variant="ghost" size="sm" asChild className={isMobile ? "justify-start min-h-[44px]" : undefined}>
        <Link to="/about" onClick={() => setMobileOpen(false)}>{t("nav.about")}</Link>
      </Button>
      <Button variant="ghost" size="sm" asChild className={isMobile ? "justify-start min-h-[44px]" : undefined}>
        <Link to="/contact" onClick={() => setMobileOpen(false)}>{t("nav.contact")}</Link>
      </Button>
      <Button variant="ghost" size="sm" asChild className={isMobile ? "justify-start min-h-[44px]" : undefined}>
        <a href="http://192.168.1.50:4173/pricing" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>
          Pricing
        </a>
      </Button>
      <Button variant="ghost" size="sm" asChild className={isMobile ? "justify-start min-h-[44px]" : undefined}>
        <a href="http://192.168.1.50:4173/#updates" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>
          Updates
        </a>
      </Button>
      <Button variant="ghost" size="sm" asChild className={isMobile ? "justify-start min-h-[44px] text-primary" : "text-primary"}>
        <a href="http://192.168.1.50:4173" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>
          Part of The Resonance Hub ↗
        </a>
      </Button>
      {!isMobile && (
        <>
          <LanguageToggle />
          <ThemeToggle />
        </>
      )}
    </>
  );

  const preferencesSection = (
    <div className="border-t border-border pt-3 mt-1">
      <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("nav.preferences") || "Preferences"}
      </p>
      <div className="flex flex-col items-stretch gap-1">
        <LanguageToggle />
        <ThemeToggle showLabel />
      </div>
    </div>
  );

  const authSection = OPEN_NOVA_LOCAL_ONLY ? (
    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 px-2">Sovereign local</span>
  ) : user ? (
    <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
      {isAdmin && (
        <Button variant="ghost" size="sm" asChild className="gap-1.5 justify-start">
          <Link to="/admin/login" onClick={() => setMobileOpen(false)}><Shield className="w-4 h-4" /> {t("nav.admin")}</Link>
        </Button>
      )}
      <span className="text-xs text-muted-foreground truncate max-w-[180px]">{user.email}</span>
      <Button variant="ghost" size="sm" asChild className="gap-1.5 justify-start">
        <Link to="/account" onClick={() => setMobileOpen(false)}><UserIcon className="w-4 h-4" /> Account</Link>
      </Button>
      <Button variant="ghost" size="sm" onClick={() => { handleSignOut(); setMobileOpen(false); }} className="gap-1.5 justify-start">
        <LogOut className="w-4 h-4" /> {t("nav.signOut")}
      </Button>
    </div>
  ) : (
    <Button variant="outline" size="sm" asChild className="gap-1.5">
      <Link to="/auth" onClick={() => setMobileOpen(false)}><LogIn className="w-4 h-4" /> {t("nav.signIn")}</Link>
    </Button>
  );

  return (
    <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container flex items-center justify-between h-14 sm:h-16 px-4 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => setStep(0)}
            className="flex items-center gap-0 hover:opacity-80 transition-opacity min-w-0"
          >
            <motion.div
              className="w-8 h-8 sm:w-[70px] sm:h-[70px] flex items-center justify-center shrink-0"
              style={{ perspective: 600 }}
            >
              <motion.img
                src={resonanceLogo}
                alt="Resonance ePublisher"
                width={70}
                height={70}
                className="w-8 h-8 sm:w-[70px] sm:h-[70px] object-contain"
                animate={{
                  rotateY: [0, -30, 0, 30, 0],
                  scaleX: [1, 0.85, 1, 0.85, 1],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </motion.div>
            <motion.span
              className="font-display text-xs sm:text-xl font-semibold tracking-tight gradient-text leading-none truncate"
              animate={{
                opacity: [1, 0.7, 1],
                letterSpacing: ["0em", "0.04em", "0em"],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              Resonance ePublisher
            </motion.span>
          </button>
        </div>

        {/* Desktop nav */}
        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="http://192.168.1.50:4173"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity border-r border-border pr-3 mr-1"
            aria-label="The Resonance Hub"
          >
            <ResonanceLogo height={20} invert />
          </a>
          <nav className="flex items-center gap-1 text-sm">
            {navLinks(false)}
          </nav>
          <div className="relative">
            <ProjectManager />
          </div>
          {authSection}
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center gap-1">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 h-11 w-11">
                <Menu className="w-5 h-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 flex flex-col gap-4 pt-10">
              <div className="flex items-center justify-center pb-2 border-b border-border">
                <ResonanceLogo height={28} />
              </div>
              <nav className="flex flex-col items-stretch gap-2">
                {navLinks(true)}
              </nav>

              {preferencesSection}

              {/* Project manager in mobile menu */}
              <div className="border-t border-border pt-3">
                <div className="relative">
                  <ProjectManager />
                </div>
              </div>

              <div className="border-t border-border pt-3">
                {authSection}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
