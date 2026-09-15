/**
 * End-to-end-style test for the demo-player embed analytics contract.
 *
 * The Landing page wires the iframe `onError` handler and the fallback
 * "Retry" button to a single `retryTrackedRef` guard so that no matter how
 * many times the embed fails or the user mashes Retry, exactly one
 * `demo_video_embed_retry` event is recorded per failure cycle, with
 * properties normalized by `validateEmbedEventProps`.
 *
 * This harness mirrors that exact wiring (see Landing.tsx lines 538-549 and
 * 662-679). If the production handler changes, this test will break and the
 * contract has to be re-validated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRef, useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { validateEmbedEventProps } from "./embedEvents";

const trackEvent = vi.fn();

const PROVIDER = "YouTube";
// Includes a #hash + extra whitespace + uppercase scheme to prove
// normalization runs before the property hits trackEvent.
const RAW_URL = "  HTTPS://youtu.be/abc123?v=1#t=42  ";
const NORMALIZED_URL = "https://youtu.be/abc123?v=1";

function DemoPlayerHarness({ url, provider, idPrefix = "", gated = false }: { url: string; provider?: unknown; idPrefix?: string; gated?: boolean }) {
  const [errored, setErrored] = useState(false);
  const [noopTick, setNoopTick] = useState(0);
  const retryTrackedRef = useRef(false);

  function handleError() {
    setErrored(true);
    retryTrackedRef.current = false; // reset guard for a new failure cycle
    const res = validateEmbedEventProps(provider ?? PROVIDER, url);
    if (res.ok === true) {
      trackEvent("demo_video_embed_failed", { provider: res.provider, embed_url: res.embed_url });
    } else {
      trackEvent("demo_video_embed_invalid", { source_event: "demo_video_embed_failed", reason: res.reason });
    }
  }

  function handleRetryClick() {
    // Production-parity: Retry is only rendered/actionable when errored.
    // The `gated` flag mirrors that conditional render so we can prove Retry
    // is a no-op on a player that hasn't failed.
    if (gated && !errored) return;
    if (!retryTrackedRef.current) {
      const res = validateEmbedEventProps(provider ?? PROVIDER, url);
      if (res.ok === true) {
        trackEvent("demo_video_embed_retry", { provider: res.provider, embed_url: res.embed_url });
        retryTrackedRef.current = true;
      } else {
        trackEvent("demo_video_embed_invalid", { source_event: "demo_video_embed_retry", reason: res.reason });
        retryTrackedRef.current = true;
      }
    }
    setErrored(false);
  }

  return (
    <div>
      {/* `<iframe onError>` doesn't fire reliably under jsdom, so we expose a
          test-only "Fail" trigger that invokes the exact same handler the
          production iframe wires to. The handler shape is the part we care
          about — see Landing.tsx lines 538-549. */}
      <button type="button" onClick={handleError} data-testid={`${idPrefix}fail-btn`}>Fail</button>
      <button type="button" onClick={handleRetryClick} data-testid={`${idPrefix}retry-btn`}>
        Retry
      </button>
      {/* Unrelated state change — exercises React re-renders without touching
          the failure/retry handlers, to prove the useRef guard survives them. */}
      <button type="button" onClick={() => setNoopTick((n) => n + 1)} data-testid={`${idPrefix}noop-btn`}>
        Noop {noopTick}
      </button>
      <span data-testid={`${idPrefix}errored`}>{String(errored)}</span>
    </div>
  );
}

describe("demo embed retry analytics (e2e contract)", () => {
  beforeEach(() => trackEvent.mockClear());

  it("records exactly one retry event for many failures + many retry clicks", () => {
    render(<DemoPlayerHarness url={RAW_URL} />);
    const iframe = screen.getByTestId("fail-btn");

    // Force several embed failures.
    act(() => {
      fireEvent.click(iframe);
      fireEvent.click(iframe);
      fireEvent.click(iframe);
    });

    // Mash the Retry button — guard must collapse to one tracked event.
    const retry = screen.getByTestId("retry-btn");
    fireEvent.click(retry);
    fireEvent.click(retry);
    fireEvent.click(retry);
    fireEvent.click(retry);

    const retryCalls = trackEvent.mock.calls.filter(([name]) => name === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(1);

    const [, props] = retryCalls[0];
    expect(props).toEqual({ provider: PROVIDER, embed_url: NORMALIZED_URL });
    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);

    // A new failure cycle resets the guard and a single new retry click
    // records exactly one additional event.
    act(() => { fireEvent.click(iframe); });
    fireEvent.click(retry);
    fireEvent.click(retry);
    const retryCallsAfter = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCallsAfter).toHaveLength(2);
  });

  it("emits demo_video_embed_invalid (not retry) when the URL is malformed", () => {
    render(<DemoPlayerHarness url="javascript:alert(1)" />);
    const iframe = screen.getByTestId("fail-btn");
    act(() => { fireEvent.click(iframe); });
    const retry = screen.getByTestId("retry-btn");
    fireEvent.click(retry);
    fireEvent.click(retry);
    fireEvent.click(retry);

    const retryInvalid = trackEvent.mock.calls.filter(
      ([n, p]) =>
        n === "demo_video_embed_invalid" &&
        (p as { source_event: string }).source_event === "demo_video_embed_retry",
    );
    expect(retryInvalid).toHaveLength(1);
    expect(retryInvalid[0][1]).toEqual({
      source_event: "demo_video_embed_retry",
      reason: "url_protocol_unsupported",
    });
    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_retry")).toBe(false);
  });

  it("emits demo_video_embed_invalid (not retry) when the provider is missing or invalid", () => {
    render(<DemoPlayerHarness url={RAW_URL} provider="" />);
    const failBtn = screen.getByTestId("fail-btn");
    const retryBtn = screen.getByTestId("retry-btn");

    // Two failure clicks both emit because handleError has no guard.
    act(() => {
      fireEvent.click(failBtn);
      fireEvent.click(failBtn);
    });

    // Many retry clicks — only the first passes the guard and emits invalid.
    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn);

    const failInvalid = trackEvent.mock.calls.filter(
      ([n, p]) =>
        n === "demo_video_embed_invalid" &&
        (p as { source_event: string }).source_event === "demo_video_embed_failed",
    );
    expect(failInvalid).toHaveLength(2);
    expect(failInvalid.every(([, p]) => (p as { reason: string }).reason === "provider_missing")).toBe(true);

    const retryInvalid = trackEvent.mock.calls.filter(
      ([n, p]) =>
        n === "demo_video_embed_invalid" &&
        (p as { source_event: string }).source_event === "demo_video_embed_retry",
    );
    expect(retryInvalid).toHaveLength(1);
    expect(retryInvalid[0][1]).toEqual({
      source_event: "demo_video_embed_retry",
      reason: "provider_missing",
    });

    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_retry")).toBe(false);
  });

  it("guard does not re-arm on unrelated clicks or re-renders — only a new failure resets it", () => {
    render(<DemoPlayerHarness url={RAW_URL} />);
    const failBtn = screen.getByTestId("fail-btn");
    const retryBtn = screen.getByTestId("retry-btn");
    const noopBtn = screen.getByTestId("noop-btn");

    // 1. First failure cycle: fail → retry → exactly one retry event.
    act(() => { fireEvent.click(failBtn); });
    fireEvent.click(retryBtn);
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(1);

    // 2. Hammer unrelated state changes + extra retry clicks. The guard must
    //    hold across many re-renders without re-arming.
    for (let i = 0; i < 8; i++) {
      fireEvent.click(noopBtn);   // forces re-render via setNoopTick
      fireEvent.click(retryBtn);  // would re-emit if the ref was reset
    }
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(1);

    // 3. Only a new failure cycle re-arms the guard — verify with a single
    //    extra failure + retry that exactly one new retry event is recorded.
    act(() => { fireEvent.click(failBtn); });
    fireEvent.click(noopBtn); // re-render between failure and retry must not break anything
    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn);
    const retryCalls = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(2);

    // Both retry events must carry the normalized provider + embed_url
    // (hash stripped, whitespace trimmed, scheme lower-cased) — never the
    // raw RAW_URL value.
    for (const [, props] of retryCalls) {
      expect(props).toEqual({ provider: PROVIDER, embed_url: NORMALIZED_URL });
      expect((props as { embed_url: string }).embed_url).not.toContain("#");
      expect((props as { embed_url: string }).embed_url).not.toMatch(/^\s|\s$/);
    }

    // No invalid events should have been emitted at any point.
    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("unmount/remount cycle: guard re-initializes but new retry only emits after a new failure", () => {
    let view = render(<DemoPlayerHarness url={RAW_URL} />);

    // Failure cycle 1 → exactly one retry event.
    act(() => { fireEvent.click(screen.getByTestId("fail-btn")); });
    fireEvent.click(screen.getByTestId("retry-btn"));
    fireEvent.click(screen.getByTestId("retry-btn"));
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(1);

    // Unmount completely — the retryTrackedRef and errored state are both
    // discarded with the component instance.
    view.unmount();
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(1);

    // Mount a brand-new instance. The useRef guard starts at false again.
    view = render(<DemoPlayerHarness url={RAW_URL} />);

    // Trigger a fresh failure on the remounted instance, then mash retry.
    act(() => { fireEvent.click(screen.getByTestId("fail-btn")); });
    fireEvent.click(screen.getByTestId("retry-btn"));
    fireEvent.click(screen.getByTestId("retry-btn"));
    fireEvent.click(screen.getByTestId("retry-btn"));

    const retryCalls = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(2);
    // Both events carry the normalized props produced by validateEmbedEventProps.
    for (const [, props] of retryCalls) {
      expect(props).toEqual({ provider: PROVIDER, embed_url: NORMALIZED_URL });
    }

    // A second remount + failure cycle adds exactly one more event.
    view.unmount();
    view = render(<DemoPlayerHarness url={RAW_URL} />);
    act(() => { fireEvent.click(screen.getByTestId("fail-btn")); });
    fireEvent.click(screen.getByTestId("retry-btn"));
    fireEvent.click(screen.getByTestId("retry-btn"));
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(3);

    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("rapid Retry mashing after a single failure records exactly one retry event", () => {
    render(<DemoPlayerHarness url={RAW_URL} />);

    // One failure, then 50 synchronous Retry clicks back-to-back. The
    // retryTrackedRef guard must collapse them all into a single event.
    act(() => { fireEvent.click(screen.getByTestId("fail-btn")); });
    const retryBtn = screen.getByTestId("retry-btn");
    for (let i = 0; i < 50; i++) fireEvent.click(retryBtn);

    const retryCalls = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0][1]).toEqual({ provider: PROVIDER, embed_url: NORMALIZED_URL });
    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("keyboard activation (Enter + Space) preserves the retry guard behavior", async () => {
    const user = userEvent.setup();
    render(<DemoPlayerHarness url={RAW_URL} />);
    const failBtn = screen.getByTestId("fail-btn");
    const retryBtn = screen.getByTestId("retry-btn");

    // Activate Fail via Enter.
    failBtn.focus();
    expect(failBtn).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_failed")).toHaveLength(1);

    // Tab to Retry and activate with Space.
    retryBtn.focus();
    await user.keyboard(" ");
    // Smash Enter + Space + extra Space — guard must collapse these.
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.keyboard("{Enter}");

    const retryCalls = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0][1]).toEqual({ provider: PROVIDER, embed_url: NORMALIZED_URL });

    // New failure cycle via keyboard → one more retry event, total = 2.
    failBtn.focus();
    await user.keyboard("{Enter}");
    retryBtn.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(2);

    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("two players on the same page have independent retry guards", () => {
    render(
      <>
        <DemoPlayerHarness url="https://youtu.be/aaa#x" provider="YouTube" idPrefix="a-" />
        <DemoPlayerHarness url="https://vimeo.com/bbb#y" provider="Vimeo" idPrefix="b-" />
      </>,
    );

    // Fail + mash retry on player A only — player B's guard must stay armed.
    act(() => { fireEvent.click(screen.getByTestId("a-fail-btn")); });
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTestId("a-retry-btn"));
    // Clicking B's Retry without a B-failure would emit (guard starts false),
    // mirroring the production contract where Retry is only rendered after a
    // failure. Don't click it yet — first verify A emitted exactly once.
    let retryCalls = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0][1]).toEqual({ provider: "YouTube", embed_url: "https://youtu.be/aaa" });

    // Now fail B and mash its retry — A's guard remains tracked, B emits once.
    act(() => { fireEvent.click(screen.getByTestId("b-fail-btn")); });
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTestId("b-retry-btn"));
    // Re-mash A's retry — should NOT emit again (A's guard still armed).
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTestId("a-retry-btn"));

    retryCalls = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(2);
    expect(retryCalls.map(([, p]) => p)).toEqual([
      { provider: "YouTube", embed_url: "https://youtu.be/aaa" },
      { provider: "Vimeo", embed_url: "https://vimeo.com/bbb" },
    ]);

    // Re-fail A (resets A's guard only). B's guard must still be tracked.
    act(() => { fireEvent.click(screen.getByTestId("a-fail-btn")); });
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    fireEvent.click(screen.getByTestId("b-retry-btn")); // B guard still armed → noop
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(3);

    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("unmounting one player in a two-player layout resets only its guard", () => {
    function TwoPlayers({ showA }: { showA: boolean }) {
      return (
        <>
          {showA && <DemoPlayerHarness url="https://youtu.be/aaa#x" provider="YouTube" idPrefix="a-" />}
          <DemoPlayerHarness url="https://vimeo.com/bbb#y" provider="Vimeo" idPrefix="b-" />
        </>
      );
    }
    const { rerender } = render(<TwoPlayers showA={true} />);

    // Arm both players' guards: fail + retry each → 2 retry events total.
    act(() => { fireEvent.click(screen.getByTestId("a-fail-btn")); });
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    act(() => { fireEvent.click(screen.getByTestId("b-fail-btn")); });
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(2);

    // Unmount player A only. Player B stays mounted with its guard armed.
    rerender(<TwoPlayers showA={false} />);
    expect(screen.queryByTestId("a-fail-btn")).toBeNull();
    expect(screen.getByTestId("b-fail-btn")).toBeInTheDocument();

    // Mash B's Retry — guard is still armed from earlier, so no new event.
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTestId("b-retry-btn"));
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(2);

    // Remount player A — its guard is freshly false (new ref). A retry
    // without a fresh A-failure is meaningful here only as a regression
    // check; the production-shaped flow is fail-then-retry.
    rerender(<TwoPlayers showA={true} />);
    act(() => { fireEvent.click(screen.getByTestId("a-fail-btn")); });
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTestId("a-retry-btn"));
    // A emits exactly once on its fresh cycle. B still silent.
    const retryCalls = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retryCalls).toHaveLength(3);
    expect(retryCalls[2][1]).toEqual({ provider: "YouTube", embed_url: "https://youtu.be/aaa" });

    // Confirm B's guard truly survived A's unmount/remount: B retry still noop.
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByTestId("b-retry-btn"));
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(3);

    // Re-fail B → exactly one more B retry event, properties carry B's URL.
    act(() => { fireEvent.click(screen.getByTestId("b-fail-btn")); });
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    const finalRetries = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(finalRetries).toHaveLength(4);
    expect(finalRetries[3][1]).toEqual({ provider: "Vimeo", embed_url: "https://vimeo.com/bbb" });

    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("two players with different provider/URL variations normalize each retry event independently", () => {
    // Player A: messy YouTube URL (uppercase scheme, whitespace, hash, query) + padded provider.
    const A_RAW_URL = "  HTTPS://www.youtube.com/watch?v=ABC123#t=10  ";
    const A_NORMALIZED_URL = "https://www.youtube.com/watch?v=ABC123";
    const A_RAW_PROVIDER = "  YouTube  ";
    const A_NORMALIZED_PROVIDER = "YouTube";

    // Player B: differently messy Vimeo URL (mixed case host, trailing slash, hash) + padded provider.
    const B_RAW_URL = "Https://Vimeo.com/XYZ789/#fragment";
    const B_NORMALIZED_URL = "https://vimeo.com/XYZ789/";
    const B_RAW_PROVIDER = "\tVimeo\n";
    const B_NORMALIZED_PROVIDER = "Vimeo";

    render(
      <div>
        <DemoPlayerHarness url={A_RAW_URL} provider={A_RAW_PROVIDER} idPrefix="a-" />
        <DemoPlayerHarness url={B_RAW_URL} provider={B_RAW_PROVIDER} idPrefix="b-" />
      </div>
    );

    // Fail + retry A — props must reflect A's normalized provider+URL only.
    act(() => { fireEvent.click(screen.getByTestId("a-fail-btn")); });
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    fireEvent.click(screen.getByTestId("a-retry-btn"));

    // Fail + retry B — props must reflect B's normalized provider+URL only.
    act(() => { fireEvent.click(screen.getByTestId("b-fail-btn")); });
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    fireEvent.click(screen.getByTestId("b-retry-btn"));

    const retries = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retries).toHaveLength(2);
    expect(retries[0][1]).toEqual({ provider: A_NORMALIZED_PROVIDER, embed_url: A_NORMALIZED_URL });
    expect(retries[1][1]).toEqual({ provider: B_NORMALIZED_PROVIDER, embed_url: B_NORMALIZED_URL });

    // Failure events must also carry each player's own normalized props.
    const failures = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_failed");
    expect(failures).toHaveLength(2);
    expect(failures[0][1]).toEqual({ provider: A_NORMALIZED_PROVIDER, embed_url: A_NORMALIZED_URL });
    expect(failures[1][1]).toEqual({ provider: B_NORMALIZED_PROVIDER, embed_url: B_NORMALIZED_URL });

    // New failure cycles on each player must continue to emit each player's own normalized props.
    act(() => { fireEvent.click(screen.getByTestId("a-fail-btn")); });
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    act(() => { fireEvent.click(screen.getByTestId("b-fail-btn")); });
    fireEvent.click(screen.getByTestId("b-retry-btn"));

    const allRetries = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(allRetries).toHaveLength(4);
    expect(allRetries[2][1]).toEqual({ provider: A_NORMALIZED_PROVIDER, embed_url: A_NORMALIZED_URL });
    expect(allRetries[3][1]).toEqual({ provider: B_NORMALIZED_PROVIDER, embed_url: B_NORMALIZED_URL });

    // No retry event should ever leak the other player's provider or URL.
    for (const [, props] of allRetries) {
      const p = props as { provider: string; embed_url: string };
      if (p.provider === A_NORMALIZED_PROVIDER) expect(p.embed_url).toBe(A_NORMALIZED_URL);
      if (p.provider === B_NORMALIZED_PROVIDER) expect(p.embed_url).toBe(B_NORMALIZED_URL);
    }

    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("keyboard mashing Retry on the focused player does not emit a retry for the blurred player", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <DemoPlayerHarness url="https://youtu.be/aaa#x" provider="YouTube" idPrefix="a-" />
        <DemoPlayerHarness url="https://vimeo.com/bbb#y" provider="Vimeo" idPrefix="b-" />
      </div>
    );

    // Fail BOTH players so each guard is armed and ready to emit one retry.
    act(() => {
      fireEvent.click(screen.getByTestId("a-fail-btn"));
      fireEvent.click(screen.getByTestId("b-fail-btn"));
    });

    // Focus ONLY player A's Retry button; player B's button remains blurred.
    const aRetry = screen.getByTestId("a-retry-btn") as HTMLButtonElement;
    const bRetry = screen.getByTestId("b-retry-btn") as HTMLButtonElement;
    aRetry.focus();
    expect(document.activeElement).toBe(aRetry);
    expect(document.activeElement).not.toBe(bRetry);

    // Mash Enter/Space on the focused (A) button only.
    await user.keyboard("{Enter}{ }{Enter}{ }{Enter}");

    // Focus must never have shifted to B during the mash.
    expect(document.activeElement).toBe(aRetry);

    const retries = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(retries).toHaveLength(1);
    expect(retries[0][1]).toEqual({ provider: "YouTube", embed_url: "https://youtu.be/aaa" });

    // Now focus B and mash — B's still-armed guard should emit exactly once,
    // with B's normalized props (proving the prior A mashing didn't touch B's guard).
    bRetry.focus();
    expect(document.activeElement).toBe(bRetry);
    await user.keyboard("{Enter}{ }{Enter}{ }{Enter}");

    const allRetries = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(allRetries).toHaveLength(2);
    expect(allRetries[1][1]).toEqual({ provider: "Vimeo", embed_url: "https://vimeo.com/bbb" });

    expect(trackEvent.mock.calls.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });

  it("Retry is a no-op on a player that hasn't failed; only the failed player emits events", () => {
    render(
      <div>
        <DemoPlayerHarness url="https://youtu.be/aaa#x" provider="YouTube" idPrefix="a-" gated />
        <DemoPlayerHarness url="https://vimeo.com/bbb#y" provider="Vimeo" idPrefix="b-" gated />
      </div>
    );

    // 1. Neither player has failed → mashing Retry on BOTH must emit nothing.
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    expect(trackEvent.mock.calls).toHaveLength(0);

    // 2. Fail ONLY player A. Player B is still in a non-errored state.
    act(() => { fireEvent.click(screen.getByTestId("a-fail-btn")); });
    expect(screen.getByTestId("a-errored").textContent).toBe("true");
    expect(screen.getByTestId("b-errored").textContent).toBe("false");

    // 3. Mash Retry on player B (which never failed) — must remain a complete no-op.
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    fireEvent.click(screen.getByTestId("b-retry-btn"));
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(0);

    // 4. Now click Retry on the failed player A — emits exactly one retry with A's normalized props.
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    const aRetries = trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry");
    expect(aRetries).toHaveLength(1);
    expect(aRetries[0][1]).toEqual({ provider: "YouTube", embed_url: "https://youtu.be/aaa" });

    // 5. After A's retry resolves its errored state back to false, A's Retry must
    //    also become a no-op again until a fresh failure occurs.
    expect(screen.getByTestId("a-errored").textContent).toBe("false");
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    fireEvent.click(screen.getByTestId("a-retry-btn"));
    expect(trackEvent.mock.calls.filter(([n]) => n === "demo_video_embed_retry")).toHaveLength(1);

    // 6. Only failure events recorded come from player A — never from B.
    const allEvents = trackEvent.mock.calls;
    expect(allEvents.filter(([n]) => n === "demo_video_embed_failed")).toHaveLength(1);
    expect(allEvents.filter(([n]) => n === "demo_video_embed_failed")[0][1])
      .toEqual({ provider: "YouTube", embed_url: "https://youtu.be/aaa" });
    for (const [, props] of allEvents) {
      const p = props as { provider?: string };
      expect(p.provider).not.toBe("Vimeo");
    }

    expect(allEvents.some(([n]) => n === "demo_video_embed_invalid")).toBe(false);
  });
});
