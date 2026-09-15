import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { useI18n } from "@/lib/i18n";
import resonanceLogo from "@/assets/resonance-logo.png";
import { useState } from "react";

interface PageHeaderProps {
  /** Nav links to show besides the current page (e.g. Home, Contact) */
  links?: { to: string; label: string }[];
}

export function PageHeader({ links = [] }: PageHeaderProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const defaultLinks = [
    { to: "/", label: t("nav.home") },
    { to: "/about", label: t("nav.about") },
    { to: "/contact", label: t("nav.contact") },
  ];

  const navItems = links.length > 0 ? links : defaultLinks;

  const navContent = (
    <>
      {navItems.map((link) => (
        <Button key={link.to} variant="ghost" size="sm" asChild>
          <Link to={link.to} onClick={() => setOpen(false)}>{link.label}</Link>
        </Button>
      ))}
      <LanguageToggle />
      <ThemeToggle />
    </>
  );

  return (
    <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container flex items-center justify-between h-16 px-6">
        <Link to="/" className="flex items-center gap-1 hover:opacity-80 transition-opacity">
          <img src={resonanceLogo} alt="Resonance ePublisher" width={48} height={48} className="w-10 h-10 sm:w-12 sm:h-12 object-contain" />
          <span className="font-display text-sm sm:text-xl font-semibold tracking-tight gradient-text">Resonance ePublisher</span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-2">
          {navContent}
        </div>

        {/* Mobile */}
        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 h-11 w-11">
                <Menu className="w-5 h-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 flex flex-col gap-4 pt-10">
              <nav className="flex flex-col gap-2">
                {navContent}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
