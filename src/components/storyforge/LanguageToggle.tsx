import { useI18n, SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();

  return (
    <Select value={lang} onValueChange={(v) => setLang(v as any)}>
      <SelectTrigger className="w-auto gap-1.5 min-h-[44px] sm:min-h-0 sm:h-8 text-xs font-medium border-none bg-transparent hover:bg-accent px-2">
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <SelectValue>
          {SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.flag}{" "}
          {SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="max-h-[300px]">
        {SUPPORTED_LANGUAGES.map((l) => (
          <SelectItem key={l.code} value={l.code} className="text-xs">
            {l.flag} {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
