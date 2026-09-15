import { useStoryForge } from "./StoryForgeContext";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRef, useEffect } from "react";

const STEP_KEYS = [
  { labelKey: "step.topic", descKey: "step.topicDesc" },
  { labelKey: "step.research", descKey: "step.researchDesc" },
  { labelKey: "step.configure", descKey: "step.configureDesc" },
  { labelKey: "step.generate", descKey: "step.generateDesc" },
  { labelKey: "step.storyline", descKey: "step.storylineDesc" },
  { labelKey: "step.storybook", descKey: "step.storybookDesc" },
  { labelKey: "step.visualbook", descKey: "step.visualbookDesc" },
];

export function StepIndicator() {
  const { step, setStep } = useStoryForge();
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active step on mobile — scroll ONLY the indicator strip,
  // never the page (scrollIntoView would scroll all ancestors).
  useEffect(() => {
    const container = scrollRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    const target =
      active.offsetLeft - container.clientWidth / 2 + active.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [step]);

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-1 py-6 sm:py-8 sm:justify-center overflow-x-auto scrollbar-hide px-4 sm:px-0 -mx-4 sm:mx-0"
    >
      {STEP_KEYS.map((s, i) => (
        <div
          key={i}
          className="flex items-center shrink-0"
          ref={i === step ? activeRef : undefined}
        >
          <div className="flex flex-col items-center gap-1.5">
            <div
              onClick={() => i <= step && setStep(i)}
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-colors duration-300 ${i <= step ? "cursor-pointer" : ""} ${
                i < step
                  ? "bg-primary text-primary-foreground"
                  : i === step
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : i + 1}
            </div>
            <div className="text-center max-w-[72px] sm:max-w-[120px]">
              <p className={`text-[10px] sm:text-xs font-medium leading-tight ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>
                {t(s.labelKey)}
              </p>
            </div>
          </div>
          {i < STEP_KEYS.length - 1 && (
            <div
              className={`w-8 sm:w-16 h-px mx-1 sm:mx-2 mb-5 transition-colors duration-300 ${
                i < step ? "bg-primary" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
