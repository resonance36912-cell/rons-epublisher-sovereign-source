// Resonance ePublisher main page
import { lazy, Suspense, useEffect, useState } from "react";
import { Seo } from "@/components/Seo";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StoryForgeProvider, useStoryForge } from "@/components/storyforge/StoryForgeContext";
import { useAutoResumeProject } from "@/hooks/useAutoResumeProject";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { subscribeBusy } from "@/lib/busy-registry";
import { AppHeader } from "@/components/storyforge/AppHeader";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { StepIndicator } from "@/components/storyforge/StepIndicator";
import { ProviderHealthBanner } from "@/components/storyforge/ProviderHealthBanner";
import { captureCurrentAsPostLoginRedirect } from "@/lib/post-login-redirect";
import { Loader2 } from "lucide-react";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

const SourceInput = lazy(() => import("@/components/storyforge/SourceInput").then((m) => ({ default: m.SourceInput })));
const ResearchVerify = lazy(() => import("@/components/storyforge/ResearchVerify").then((m) => ({ default: m.ResearchVerify })));
const ReviewConfigure = lazy(() => import("@/components/storyforge/ReviewConfigure").then((m) => ({ default: m.ReviewConfigure })));
const StoryboardEditor = lazy(() => import("@/components/storyforge/StoryboardEditor").then((m) => ({ default: m.StoryboardEditor })));
const StorylineEditor = lazy(() => import("@/components/storyforge/StorylineEditor").then((m) => ({ default: m.StorylineEditor })));
const StoryPreview = lazy(() => import("@/components/storyforge/StoryPreview").then((m) => ({ default: m.StoryPreview })));
const VisualBook = lazy(() => import("@/components/storyforge/VisualBook").then((m) => ({ default: m.VisualBook })));

function StoryForgeApp() {
  const { step, isGenerating } = useStoryForge();
  useAutoResumeProject();

  // Subscribe to the global busy-task registry (used by exports, narration, etc.)
  const [busyCount, setBusyCount] = useState(0);
  useEffect(() => subscribeBusy(setBusyCount), []);

  // Hold a screen wake lock whenever a generation OR a long task is in flight.
  // Mobile browsers suspend background tabs when the screen turns off, which
  // would otherwise abort in-flight fetches and timers.
  useWakeLock(isGenerating || busyCount > 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Seo
        title="Workspace — Resonance ePublisher"
        description="Your AudioVisual eBook workspace. Research, structure, narrate, illustrate, and export ePubs, PDFs, and videos from any topic."
        path="/app"
      />
      <AppHeader />
      <ProviderHealthBanner />
      <main className="flex-1 container px-4 sm:px-6 pb-12 sm:pb-16">
        <StepIndicator />
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
          {step === 0 && <SourceInput />}
          {step === 1 && <ResearchVerify />}
          {step === 2 && <ReviewConfigure />}
          {step === 3 && <StoryboardEditor />}
          {step === 4 && <StorylineEditor />}
          {step === 5 && <StoryPreview />}
          {step === 6 && <VisualBook />}
        </Suspense>
      </main>
      <AppFooter />
    </div>
  );
}

export default function Index() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (OPEN_NOVA_LOCAL_ONLY) {
      setChecked(true);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        captureCurrentAsPostLoginRedirect();
        navigate("/auth", { replace: true });
      } else {
        setChecked(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        captureCurrentAsPostLoginRedirect();
        navigate("/auth", { replace: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <StoryForgeProvider>
      <StoryForgeApp />
    </StoryForgeProvider>
  );
}
