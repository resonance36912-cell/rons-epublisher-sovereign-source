import { memo } from "react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

type Props = {
  onClose: () => void;
};

export const ShortcutHints = memo(function ShortcutHints({ onClose }: Props) {
  const { t } = useI18n();

  const shortcuts = [
    { key: "← →", label: t("visual.shortcutArrows") },
    { key: "⇧ ← →", label: "Jump to previous / next chapter" },
    { key: "Space", label: t("visual.shortcutSpace") },
    { key: "+ / −", label: t("visual.shortcutZoom") },
    { key: "D", label: t("visual.shortcutDownload") },
    { key: "F", label: t("visual.shortcutFullscreen") },
    { key: "Esc", label: t("visual.shortcutEsc") },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.3 }}
      className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="bg-card/90 backdrop-blur-md border border-border rounded-xl px-8 py-6 shadow-2xl max-w-sm pointer-events-auto"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <h4 className="text-sm font-semibold text-foreground mb-3 text-center">{t("visual.shortcutsTitle")}</h4>
        <div className="space-y-2 text-xs text-muted-foreground">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex justify-between gap-6">
              <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{s.key}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
});
