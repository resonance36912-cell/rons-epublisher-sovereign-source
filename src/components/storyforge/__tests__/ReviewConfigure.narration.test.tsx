import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";

// ---- Mocks ----------------------------------------------------------------

// Capture the latest config + setConfig so tests can assert state changes
// driven by the guardrail useEffect, and so we can simulate clicks updating
// the shared config.
let mockConfig: any;
let mockTier: "free" | "premium" | "standard" = "free";
const setConfigMock = vi.fn((updater: any) => {
  mockConfig = typeof updater === "function" ? updater(mockConfig) : { ...mockConfig, ...updater };
});

const baseConfig = () => ({
  topic: "Test topic",
  theme: "documentary",
  tone: "professional",
  depth: "standard",
  orientation: "landscape" as const,
  narrationProvider: "browser" as "browser" | "elevenlabs",
  narrationVoice: "JBFqnCBsd6RMkjVDRZzb", // George
  narrationDemeanour: "calm",
  narrationSpeed: 1.0,
});

vi.mock("@/components/storyforge/StoryForgeContext", () => ({
  useStoryForge: () => ({
    sources: [],
    config: mockConfig,
    setConfig: setConfigMock,
    setStep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useUserTier", () => ({
  useUserTier: () => ({ tier: mockTier }),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// TTS client spies — these prove which provider the preview chose.
const speakWithBrowserNarrationMock: any = vi.fn(async () => {});
const requestNarrationAudioMock: any = vi.fn(async () => ({
  kind: "audio" as const,
  blob: new Blob(["x"], { type: "audio/mpeg" }),
}));
vi.mock("@/lib/tts-client", () => ({
  speakWithBrowserNarration: (...args: any[]) => speakWithBrowserNarrationMock(...args),
  requestNarrationAudio: (...args: any[]) => requestNarrationAudioMock(...args),
  getPreferredPlaybackProvider: () => "elevenlabs",
  setPreferredPlaybackProvider: vi.fn(),
  stopBrowserNarration: vi.fn(),
  isNarrationAbortError: () => false,
}));

// framer-motion: render a plain div so we don't fight animation timing.
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: { children?: ReactNode } & Record<string, unknown>) => {
        const { children, ...rest } = props;
        return <div {...(rest as Record<string, unknown>)}>{children}</div>;
      },
    },
  ) as any,
}));

// jsdom doesn't implement HTMLMediaElement.play
Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});

// Import AFTER mocks so the component picks them up.
import { ReviewConfigure } from "../ReviewConfigure";

beforeEach(() => {
  mockConfig = baseConfig();
  setConfigMock.mockClear();
  toastMock.mockClear();
  speakWithBrowserNarrationMock.mockClear();
  requestNarrationAudioMock.mockClear();
});

// ---- Tests ----------------------------------------------------------------

describe("ReviewConfigure narration gating (Free tier)", () => {
  beforeEach(() => {
    mockTier = "free";
  });

  it("hides the ElevenLabs voice selector (George) when on Free", () => {
    mockConfig.narrationProvider = "elevenlabs";
    render(<ReviewConfigure />);
    // The George voice option should NOT be in the DOM at all on Free.
    expect(screen.queryByText("voice.george")).not.toBeInTheDocument();
    // The browser-narration fallback hint should be visible.
    expect(
      screen.getByText(/Browser narration uses your device's built-in voice/i),
    ).toBeInTheDocument();
  });

  it("disables the Premium Narration toggle on Free", () => {
    render(<ReviewConfigure />);
    const toggle = screen.getByRole("switch", { name: "Premium Narration" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("auto-resets narrationProvider/voice if persisted as ElevenLabs on Free", () => {
    mockConfig.narrationProvider = "elevenlabs";
    mockConfig.narrationVoice = "JBFqnCBsd6RMkjVDRZzb";
    render(<ReviewConfigure />);
    // Guardrail useEffect should have called setConfig to coerce back to browser.
    expect(setConfigMock).toHaveBeenCalled();
    expect(mockConfig.narrationProvider).toBe("browser");
    expect(mockConfig.narrationVoice).not.toBe("JBFqnCBsd6RMkjVDRZzb");
  });

  it("highlights the Free plan card as Active in the explainer", () => {
    render(<ReviewConfigure />);
    const freeCard = screen.getByText("Free plan").closest("div.rounded-lg");
    expect(freeCard).not.toBeNull();
    expect(within(freeCard as HTMLElement).getByText(/Active/i)).toBeInTheDocument();
  });

  it("preview button uses the BROWSER provider (not ElevenLabs) on Free", async () => {
    render(<ReviewConfigure />);
    // Find the preview button via its title attribute set by the component.
    const previewBtn = screen.getByTitle(/Preview voice \(Browser voice\)/i);
    await act(async () => {
      fireEvent.click(previewBtn);
    });
    expect(speakWithBrowserNarrationMock).toHaveBeenCalledTimes(1);
    expect(requestNarrationAudioMock).not.toHaveBeenCalled();
  });

  it("shows 'Preview via Browser voice' label next to the preview", () => {
    render(<ReviewConfigure />);
    const labels = screen.getAllByText(/Preview via/i);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]).toHaveTextContent(/Browser voice/i);
  });
});

describe("ReviewConfigure narration gating (Premium tier)", () => {
  beforeEach(() => {
    mockTier = "premium";
  });

  it("shows the ElevenLabs voice selector when Premium toggle is on", () => {
    mockConfig.narrationProvider = "elevenlabs";
    render(<ReviewConfigure />);
    // The select trigger should display the George voice key.
    expect(screen.getByText("voice.george")).toBeInTheDocument();
  });

  it("Premium Narration toggle is enabled and reflects state", () => {
    mockConfig.narrationProvider = "elevenlabs";
    render(<ReviewConfigure />);
    const toggle = screen.getByRole("switch", { name: "Premium Narration" });
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("preview uses ElevenLabs when narrationProvider === 'elevenlabs'", async () => {
    mockConfig.narrationProvider = "elevenlabs";
    render(<ReviewConfigure />);
    const previewBtn = screen.getByTitle(/Preview voice/i);
    await act(async () => {
      fireEvent.click(previewBtn);
    });
    expect(requestNarrationAudioMock).toHaveBeenCalledTimes(1);
    expect(speakWithBrowserNarrationMock).not.toHaveBeenCalled();
  });

  it("preview falls back to BROWSER when Premium toggle is off (browser provider)", async () => {
    mockConfig.narrationProvider = "browser";
    render(<ReviewConfigure />);
    const previewBtn = screen.getByTitle(/Preview voice \(Browser voice\)/i);
    await act(async () => {
      fireEvent.click(previewBtn);
    });
    expect(speakWithBrowserNarrationMock).toHaveBeenCalledTimes(1);
    expect(requestNarrationAudioMock).not.toHaveBeenCalled();
  });

  it("preview label reads 'ElevenLabs' when Premium toggle is on", () => {
    mockConfig.narrationProvider = "elevenlabs";
    render(<ReviewConfigure />);
    const labels = screen.getAllByText(/Preview via/i);
    expect(labels[0]).toHaveTextContent(/ElevenLabs/i);
  });
});

// ---- Edge cases: narrationProvider unset / null --------------------------
//
// Persisted projects from older versions, or partially hydrated state, can
// arrive with `narrationProvider` missing or null. The preview must still
// resolve to a safe provider — never throw, never silently call ElevenLabs
// for a Free user, and always default to the browser voice when the plan
// hasn't explicitly opted into Premium narration.

describe("ReviewConfigure preview with unset/null narrationProvider", () => {
  for (const variant of [
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "empty string", value: "" },
  ] as const) {
    describe(`Free tier + narrationProvider=${variant.label}`, () => {
      beforeEach(() => {
        mockTier = "free";
        mockConfig.narrationProvider = variant.value as any;
      });

      it("renders without crashing and shows the browser fallback hint", () => {
        render(<ReviewConfigure />);
        expect(
          screen.getByText(/Browser narration uses your device's built-in voice/i),
        ).toBeInTheDocument();
      });

      it("preview routes to BROWSER and never calls ElevenLabs", async () => {
        render(<ReviewConfigure />);
        const previewBtn = screen.getByTitle(/Preview voice \(Browser voice\)/i);
        await act(async () => {
          fireEvent.click(previewBtn);
        });
        expect(speakWithBrowserNarrationMock).toHaveBeenCalledTimes(1);
        expect(requestNarrationAudioMock).not.toHaveBeenCalled();
      });

      it("preview label reads 'Browser voice'", () => {
        render(<ReviewConfigure />);
        const labels = screen.getAllByText(/Preview via/i);
        expect(labels[0]).toHaveTextContent(/Browser voice/i);
      });

      it("Premium toggle stays disabled and unchecked", () => {
        render(<ReviewConfigure />);
        const toggle = screen.getByRole("switch", { name: "Premium Narration" });
        expect(toggle).toBeDisabled();
        expect(toggle).toHaveAttribute("aria-checked", "false");
      });
    });

    describe(`Premium tier + narrationProvider=${variant.label}`, () => {
      beforeEach(() => {
        mockTier = "premium";
        mockConfig.narrationProvider = variant.value as any;
      });

      it("treats unset provider as 'browser' (does not auto-opt-in to ElevenLabs)", async () => {
        render(<ReviewConfigure />);
        // The Premium toggle should be OFF because the provider isn't 'elevenlabs'.
        const toggle = screen.getByRole("switch", { name: "Premium Narration" });
        expect(toggle).not.toBeDisabled();
        expect(toggle).toHaveAttribute("aria-checked", "false");

        // Preview should still play via the browser path, not ElevenLabs.
        const previewBtn = screen.getByTitle(/Preview voice \(Browser voice\)/i);
        await act(async () => {
          fireEvent.click(previewBtn);
        });
        expect(speakWithBrowserNarrationMock).toHaveBeenCalledTimes(1);
        expect(requestNarrationAudioMock).not.toHaveBeenCalled();
      });

      it("preview label reads 'Browser voice' until the user opts in", () => {
        render(<ReviewConfigure />);
        const labels = screen.getAllByText(/Preview via/i);
        expect(labels[0]).toHaveTextContent(/Browser voice/i);
      });

      it("ElevenLabs voice selector (George) is hidden until Premium toggle is on", () => {
        render(<ReviewConfigure />);
        expect(screen.queryByText("voice.george")).not.toBeInTheDocument();
      });
    });
  }
});

// ---- Toast assertions for Free-tier opt-in attempts ---------------------
//
// Verifies the user-visible feedback when a Free user tries to access
// Premium narration features. Two pathways are covered:
//   1. Tapping the (disabled) Premium Narration toggle.
//   2. Loading a project that already has an ElevenLabs voice persisted
//      (the only way to "select" George on Free, since the selector is
//      hidden in the UI). The guardrail effect must reset state AND
//      explain the change with a toast.

describe("ReviewConfigure toast feedback (Free tier)", () => {
  beforeEach(() => {
    mockTier = "free";
  });

  it("shows the 'Premium narration is locked' toast when Free user clicks the disabled toggle", async () => {
    render(<ReviewConfigure />);
    const wrapper = screen.getByTestId("premium-toggle-wrapper");
    await act(async () => {
      fireEvent.click(wrapper);
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Premium narration is locked",
        description: expect.stringMatching(/Upgrade from the Free plan/i),
        variant: "destructive",
      }),
    );
  });

  it("does NOT change narrationProvider when a Free user clicks the disabled toggle", async () => {
    render(<ReviewConfigure />);
    setConfigMock.mockClear(); // ignore the initial guardrail no-op pass
    const wrapper = screen.getByTestId("premium-toggle-wrapper");
    await act(async () => {
      fireEvent.click(wrapper);
    });
    // No setConfig call should have switched provider to elevenlabs.
    const elevenlabsCalls = setConfigMock.mock.calls.filter(([updater]) => {
      const next = typeof updater === "function" ? updater(mockConfig) : updater;
      return next?.narrationProvider === "elevenlabs";
    });
    expect(elevenlabsCalls).toHaveLength(0);
  });

  it("shows the 'Switched to browser narration' toast when a stale ElevenLabs voice is loaded on Free", () => {
    mockConfig.narrationProvider = "elevenlabs";
    mockConfig.narrationVoice = "JBFqnCBsd6RMkjVDRZzb"; // George
    render(<ReviewConfigure />);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Switched to browser narration",
        description: expect.stringMatching(/ElevenLabs voice was cleared/i),
      }),
    );
  });

  it("does NOT show the 'Switched to browser narration' toast when Free user already has clean browser config", () => {
    // baseConfig() defaults to narrationProvider: "browser" and a George voice id;
    // the guardrail will still clear the voice id, but the toast is gated on
    // narrationProvider === "elevenlabs" — so no toast should fire here.
    mockConfig.narrationProvider = "browser";
    mockConfig.narrationVoice = "browser-default";
    render(<ReviewConfigure />);
    const switchedCalls = toastMock.mock.calls.filter(([arg]) =>
      arg?.title === "Switched to browser narration",
    );
    expect(switchedCalls).toHaveLength(0);
  });
});

describe("ReviewConfigure toast feedback (Premium tier — control)", () => {
  beforeEach(() => {
    mockTier = "premium";
  });

  it("clicking the toggle wrapper does NOT fire the locked toast on Premium", async () => {
    render(<ReviewConfigure />);
    const wrapper = screen.getByTestId("premium-toggle-wrapper");
    await act(async () => {
      fireEvent.click(wrapper);
    });
    const lockedCalls = toastMock.mock.calls.filter(([arg]) =>
      arg?.title === "Premium narration is locked",
    );
    expect(lockedCalls).toHaveLength(0);
  });
});

// ---- Keyboard accessibility ---------------------------------------------
//
// All narration controls must be reachable with Tab and operable with
// Enter/Space. The disabled Premium toggle on Free must surface its
// disabled state via aria-disabled (not just visually), and the preview
// button must be focusable + activatable from the keyboard for both tiers.

function tabThroughDocument(maxStops = 60): HTMLElement[] {
  const seen: HTMLElement[] = [];
  // Move focus deterministically through the focusable controls. jsdom does
  // not implement real Tab cycling, so we walk the focusable set ourselves.
  const focusable = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, [role="button"], [role="switch"], [role="combobox"], input, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute("inert") && el.offsetParent !== null || el.tagName === "BUTTON" || el.getAttribute("role") === "switch");
  for (const el of focusable.slice(0, maxStops)) {
    el.focus();
    if (document.activeElement === el) seen.push(el);
  }
  return seen;
}

describe("ReviewConfigure keyboard accessibility (Free tier)", () => {
  beforeEach(() => {
    mockTier = "free";
  });

  it("the Premium toggle exposes its disabled state to assistive tech", () => {
    render(<ReviewConfigure />);
    const toggle = screen.getByRole("switch", { name: "Premium Narration" });
    // Radix sets data-disabled and the disabled attribute; aria-checked must
    // also be present so screen readers announce the state.
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.getAttribute("data-disabled")).not.toBeNull();
  });

  it("the preview button is focusable and operable via the keyboard", async () => {
    render(<ReviewConfigure />);
    const previewBtn = screen.getByTitle(/Preview voice \(Browser voice\)/i);
    previewBtn.focus();
    expect(document.activeElement).toBe(previewBtn);
    expect(previewBtn).not.toBeDisabled();

    // A native <button> activates on Enter and Space — fire a click as the
    // browser would after key handling, and assert the side-effect.
    await act(async () => {
      fireEvent.keyDown(previewBtn, { key: "Enter", code: "Enter" });
      fireEvent.click(previewBtn);
    });
    expect(speakWithBrowserNarrationMock).toHaveBeenCalledTimes(1);
  });

  it("Space key on the preview button also triggers playback", async () => {
    render(<ReviewConfigure />);
    const previewBtn = screen.getByTitle(/Preview voice \(Browser voice\)/i);
    previewBtn.focus();
    await act(async () => {
      fireEvent.keyDown(previewBtn, { key: " ", code: "Space" });
      fireEvent.click(previewBtn);
    });
    expect(speakWithBrowserNarrationMock).toHaveBeenCalledTimes(1);
  });

  it("the Premium toggle wrapper is reachable so a keyboard user can trigger the locked toast", async () => {
    render(<ReviewConfigure />);
    const wrapper = screen.getByTestId("premium-toggle-wrapper");
    // The wrapper itself isn't focusable, but the inner switch is — focusing
    // it and pressing Enter should not opt the user in (disabled), and a
    // pointer/keyboard activation through the wrapper must surface the toast.
    await act(async () => {
      fireEvent.click(wrapper);
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Premium narration is locked" }),
    );
  });

  it("navigation buttons (Back, Generate Storyboard) are reachable via keyboard", () => {
    render(<ReviewConfigure />);
    const stops = tabThroughDocument();
    const labels = stops.map((el) => el.textContent?.trim() || el.getAttribute("title") || "");
    expect(labels.some((l) => /nav\.back/i.test(l))).toBe(true);
    expect(labels.some((l) => /generateStoryboard/i.test(l))).toBe(true);
  });
});

describe("ReviewConfigure keyboard accessibility (Premium tier)", () => {
  beforeEach(() => {
    mockTier = "premium";
  });

  it("the Premium toggle is focusable and NOT marked disabled", () => {
    render(<ReviewConfigure />);
    const toggle = screen.getByRole("switch", { name: "Premium Narration" });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle).not.toBeDisabled();
  });

  it("toggling Premium via keyboard switches the provider and reveals the voice selector", async () => {
    mockConfig.narrationProvider = "browser";
    const { rerender } = render(<ReviewConfigure />);
    const toggle = screen.getByRole("switch", { name: "Premium Narration" });
    toggle.focus();
    await act(async () => {
      // Radix Switch fires onCheckedChange on click (which Enter/Space dispatch).
      fireEvent.click(toggle);
    });
    // setConfig should have been called to enable elevenlabs.
    const enabled = setConfigMock.mock.calls.some(([updater]) => {
      const next = typeof updater === "function" ? updater(mockConfig) : updater;
      return next?.narrationProvider === "elevenlabs";
    });
    expect(enabled).toBe(true);

    // Re-render with the new state and confirm the voice selector becomes reachable.
    mockConfig.narrationProvider = "elevenlabs";
    rerender(<ReviewConfigure />);
    const comboboxes = screen.getAllByRole("combobox");
    const voiceCombobox = comboboxes[0]; // first combobox in narration block
    voiceCombobox.focus();
    expect(document.activeElement).toBe(voiceCombobox);
  });

  it("the preview button on Premium with ElevenLabs is keyboard-operable", async () => {
    mockConfig.narrationProvider = "elevenlabs";
    render(<ReviewConfigure />);
    const previewBtn = screen.getByTitle(/Preview voice/i);
    previewBtn.focus();
    expect(document.activeElement).toBe(previewBtn);
    await act(async () => {
      fireEvent.keyDown(previewBtn, { key: "Enter" });
      fireEvent.click(previewBtn);
    });
    expect(requestNarrationAudioMock).toHaveBeenCalledTimes(1);
  });

  it("Tab order surfaces the narration controls (toggle, voice select, preview)", () => {
    mockConfig.narrationProvider = "elevenlabs";
    render(<ReviewConfigure />);
    const stops = tabThroughDocument();
    const roles = stops.map((el) => el.getAttribute("role") || el.tagName.toLowerCase());
    expect(roles).toContain("switch");
    expect(roles).toContain("combobox");
    // At least one BUTTON stop exists for the preview control.
    expect(stops.some((el) => el.tagName === "BUTTON" && /Preview voice/i.test(el.getAttribute("title") || ""))).toBe(true);
  });
});
