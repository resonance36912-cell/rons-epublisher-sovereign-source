/**
 * Test harness route — mounts <ReviewConfigure /> in isolation so Playwright
 * can verify narration gating without traversing auth, sources, and research.
 *
 * Only registered in dev builds (gated in App.tsx). Drives the user tier via
 * a global override and accepts query params:
 *   ?tier=free|premium               (defaults to free)
 *   ?provider=browser|elevenlabs     (defaults to browser)
 *   ?voice=<elevenlabs voice id>     (defaults to George)
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { StoryForgeProvider, useStoryForge } from "@/components/storyforge/StoryForgeContext";
import { ReviewConfigure } from "@/components/storyforge/ReviewConfigure";
import type { UserTier } from "@/hooks/useUserTier";

function ConfigSeeder({
  provider,
  voice,
  onReady,
}: {
  provider: "browser" | "elevenlabs";
  voice: string;
  onReady: () => void;
}) {
  const { setConfig } = useStoryForge();
  useEffect(() => {
    setConfig((c) => ({ ...c, narrationProvider: provider, narrationVoice: voice }));
    // Microtask delay so React commits the seeded config before the test reads.
    queueMicrotask(onReady);
  }, [setConfig, provider, voice, onReady]);
  return null;
}

export default function NarrationTestHarness() {
  const [params] = useSearchParams();
  const tier = (params.get("tier") || "free") as UserTier;
  const provider = (params.get("provider") || "browser") as "browser" | "elevenlabs";
  const voice = params.get("voice") || "JBFqnCBsd6RMkjVDRZzb";
  const [ready, setReady] = useState(false);

  // Install the tier override BEFORE children render so useUserTier picks it up.
  useEffect(() => {
    (globalThis as Record<string, unknown>).__LOVABLE_TIER_OVERRIDE__ = tier;
    return () => {
      delete (globalThis as Record<string, unknown>).__LOVABLE_TIER_OVERRIDE__;
    };
  }, [tier]);

  return (
    <div data-testid="narration-harness" data-tier={tier} data-ready={ready ? "true" : "false"}>
      <StoryForgeProvider>
        <ConfigSeeder provider={provider} voice={voice} onReady={() => setReady(true)} />
        <div className="container px-4 py-8">
          <ReviewConfigure />
        </div>
      </StoryForgeProvider>
    </div>
  );
}
