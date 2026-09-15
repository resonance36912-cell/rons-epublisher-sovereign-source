import { Link } from "react-router-dom";
import { Mail, Phone, MessageCircle, Youtube, Facebook } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";
import { ResonanceFooter } from "@/components/brand/ResonanceFooter";

export function AppFooter() {
  const { t } = useI18n();

  return (
    <footer className="border-t bg-card/50 mt-auto">
      <div className="container px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Quick Links */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">{t("footer.quickLinks")}</h4>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <Link to="/" className="hover:text-foreground transition-colors">{t("nav.home")}</Link>
              <Link to="/about" className="hover:text-foreground transition-colors">{t("nav.about")}</Link>
              <Link to="/contact" className="hover:text-foreground transition-colors">{t("nav.contact")}</Link>
              <Link to="/auth" className="hover:text-foreground transition-colors">{t("nav.signIn")}</Link>
            </div>
            <LanguageToggle />
          </div>

          {/* Legal */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">{t("footer.legal")}</h4>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <Link to="/terms" className="hover:text-foreground transition-colors">{t("footer.termsOfService")}</Link>
              <Link to="/privacy" className="hover:text-foreground transition-colors">{t("footer.privacyPolicy")}</Link>
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">{t("nav.contact")}</h4>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <a href="mailto:support@resonance-podcast.com" className="flex items-center gap-2 hover:text-foreground transition-colors">
                <Mail className="w-3.5 h-3.5" /> support@resonance-podcast.com
              </a>
              <a href="tel:+27832615492" className="flex items-center gap-2 hover:text-foreground transition-colors">
                <Phone className="w-3.5 h-3.5" /> +27 83 261 5492
              </a>
              <a href="https://wa.me/27832615492" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground transition-colors">
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </a>
            </div>
            <div className="flex gap-3 pt-1">
              <a href="https://youtube.com/@resonance36912" target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="text-muted-foreground hover:text-foreground transition-colors">
                <Youtube className="w-4 h-4" />
              </a>
              <a href="https://facebook.com/TheResonancePodcast" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="text-muted-foreground hover:text-foreground transition-colors">
                <Facebook className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
      {/* Shared brand footer (logo, cross-app nav, copyright) */}
      <ResonanceFooter />
    </footer>
  );
}

