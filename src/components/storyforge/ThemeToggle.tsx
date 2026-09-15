import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export function ThemeToggle({ showLabel = false }: { showLabel?: boolean } = {}) {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("resonance-theme") !== "light";
    }
    return true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.remove("light");
      localStorage.setItem("resonance-theme", "dark");
    } else {
      root.classList.add("light");
      localStorage.setItem("resonance-theme", "light");
    }
  }, [isDark]);

  // Apply saved theme on mount
  useEffect(() => {
    if (localStorage.getItem("resonance-theme") === "light") {
      document.documentElement.classList.add("light");
    }
  }, []);

  const label = isDark ? "Light mode" : "Dark mode";
  const Icon = isDark ? Sun : Moon;

  if (showLabel) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsDark((prev) => !prev)}
        className="min-h-[44px] sm:min-h-0 justify-start gap-2 w-full sm:w-auto"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="text-sm">{label}</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setIsDark((prev) => !prev)}
      className="h-11 w-11 sm:h-8 sm:w-8 shrink-0"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon className="w-3.5 h-3.5" />
    </Button>
  );
}
