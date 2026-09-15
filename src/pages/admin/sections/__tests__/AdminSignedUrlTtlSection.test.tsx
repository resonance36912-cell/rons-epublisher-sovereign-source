// Integration tests for the Admin Signed URL TTL section.
//
// We mock the Supabase client + toast hook to verify two complementary
// guards: (1) the Save button is disabled for client-side invalid input so
// the request never leaves the browser, and (2) when the value is valid on
// the client but the server trigger rejects it, the verbatim server message
// (including the allowed range) surfaces via toast.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
// Shared surface-parity parser + assertion — see module header for the
// rendering contract it pins. Extracted so other admin section tests
// (auth, storage, etc.) can reuse the same drift guards.
import {
  assertSurfaceParity,
  EN_LABELS,
  parsePanelSections,
  parseToastSections,
  TOAST_JOINER,
  normalize,
  type LabelSet,
  type Section,
} from "@/test-utils/admin-surface-parity";
// Shared focus-restoration helper: asserts activeElement AND that the
// focused element is still connected. Used at every dismiss-then-check
// site below so the "focus is on X" contract is single-sourced.
import {
  assertFocusRestoredTo,
  assertTtlInputFocused,
} from "@/test-utils/focus-restoration";

// ── Mocks ────────────────────────────────────────────────────────────────
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));

// Build a chainable thenable matching the supabase-js query builder shape
// closely enough for this component. Each terminal call resolves to
// `{ data, error, count }`.
type Result = { data: unknown; error: unknown; count?: number };
const upsertSpy = vi.fn<(arg: unknown) => Promise<Result>>();

function makeBuilder(initial: Result): any {
  const result = Promise.resolve(initial);
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    ilike: () => builder,
    order: () => builder,
    range: () => builder,
    limit: () => builder,
    upsert: (arg: unknown) => upsertSpy(arg),
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      result.then(resolve, reject),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "admin-uid" } }, error: null }),
      },
      from: (table: string) => {
        // Default empty success for every read so the component mounts cleanly.
        if (table === "app_settings") {
          return makeBuilder({
            data: [
              { key: "signed_url_ttl_seconds", value: 900 },
              { key: "signed_url_ttl_user_override_allowed", value: true },
            ],
            error: null,
          });
        }
        if (table === "app_settings_audit") {
          return makeBuilder({ data: [], error: null, count: 0 });
        }
        if (table === "profiles") {
          return makeBuilder({ data: [], error: null });
        }
        return makeBuilder({ data: [], error: null });
      },
    },
  };
});

import { AdminSignedUrlTtlSection } from "../AdminSignedUrlTtlSection";

const renderSection = () =>
  render(
    <MemoryRouter>
      <AdminSignedUrlTtlSection />
    </MemoryRouter>,
  );

const getSecondsInput = () => screen.getByLabelText(/^Seconds$/i) as HTMLInputElement;
const getSaveButton = () => screen.getByRole("button", { name: /^Save$/i });

beforeEach(() => {
  toastSpy.mockClear();
  upsertSpy.mockReset();
});

describe("AdminSignedUrlTtlSection — TTL validation", () => {
  it("disables Save while the value is below the allowed range, then blur-clamps to MIN before any save", async () => {
    const user = userEvent.setup();
    renderSection();

    // Wait for initial load to settle (input populated from mock).
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));

    // Type a value below MIN (60). Focus stays on the input so blur hasn't
    // fired yet — Save must be disabled to prevent the bad value being sent.
    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "30");
    expect(getSaveButton()).toBeDisabled();
    expect(upsertSpy).not.toHaveBeenCalled();

    // Blur (Tab out) triggers the inline guard: clamp to MIN + warning toast.
    // The corrected value is what Save would now submit — the original
    // out-of-range 30 never reaches the server.
    await user.tab();
    await waitFor(() => expect(getSecondsInput().value).toBe("60"));
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(
      toastSpy.mock.calls.some(([arg]) => (arg as { title?: string })?.title === "Out of range"),
    ).toBe(true);

    cleanup();
  });

  it("disables Save when the value is above the allowed range", async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));

    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "9999");

    expect(getSaveButton()).toBeDisabled();
    expect(upsertSpy).not.toHaveBeenCalled();

    cleanup();
  });

  it("shows the inline 'whole number' error and disables Save for a decimal TTL", async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));

    const input = getSecondsInput();
    await user.clear(input);
    // A decimal that is otherwise in-range — the only failing rule is
    // "whole number". Save must stay disabled and the inline error visible.
    await user.type(input, "120.5");

    await waitFor(() => {
      expect(
        screen.getByText(/TTL must be a whole number \(no decimals\)\./i),
      ).toBeInTheDocument();
    });
    expect(getSaveButton()).toBeDisabled();
    expect(upsertSpy).not.toHaveBeenCalled();

    cleanup();
  });

  it("surfaces the verbatim server validation message when the trigger rejects the value", async () => {
    // Simulate the Postgres trigger `validate_app_settings` raising for an
    // out-of-range value. The server message + hint must reach the user.
    upsertSpy.mockResolvedValue({
      data: null,
      error: {
        message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
        hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
        details: "",
        code: "22023",
      },
    });

    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));

    // Use a client-valid value so Save is enabled and the request is sent.
    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "1200");

    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());

    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    // The failure toast must include the trigger's raw message, the hint
    // (with the allowed 60–3600 range), and the SQLSTATE code — not a
    // re-derived client string.
    await waitFor(() => {
      const failureCall = toastSpy.mock.calls.find(
        ([arg]) => (arg as { title?: string })?.title === "Failed to save",
      );
      expect(failureCall, "expected a 'Failed to save' toast").toBeTruthy();
      const desc = (failureCall![0] as { description: string }).description;
      expect(desc).toContain("signed_url_ttl_seconds must be between 60 and 3600 (got 30)");
      expect(desc).toContain("Allowed range is 60s (1 min) to 3600s (1 hour).");
      expect(desc).toContain("22023");
    });

    cleanup();
  });

  it("renders localized (non-key, interpolated) blur + save toasts and keeps Save disabled while invalid", async () => {
    // Mock a successful upsert so the save path exercises the "saved" toast.
    upsertSpy.mockResolvedValue({ data: null, error: null });

    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));

    // ── 1. Invalid (below MIN) → Save disabled, inline alert visible ───
    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "30");
    expect(getSaveButton()).toBeDisabled();
    expect(upsertSpy).not.toHaveBeenCalled();
    // Capture the inline alert wording *before* blur clamps the value (the
    // alert disappears once the field becomes valid again).
    const inlineBeforeBlur = document.getElementById("ttl-seconds-error")?.textContent ?? "";
    expect(inlineBeforeBlur).toBe(
      "Too low — minimum is 60s (1 min). You entered 30s.",
    );

    // ── 2. Blur → toast description must equal the inline message ───────
    await user.tab();
    await waitFor(() => expect(getSecondsInput().value).toBe("60"));

    const blurCall = toastSpy.mock.calls.find(
      ([arg]) => (arg as { title?: string })?.title === "Out of range",
    );
    expect(blurCall, "expected an 'Out of range' blur toast").toBeTruthy();
    const blurArg = blurCall![0] as { title: string; description: string };
    expect(blurArg.title).not.toMatch(/admin\.ttl\./);
    // Toast description is exactly what the inline panel was showing —
    // proves blur and inline never diverge for the same condition.
    expect(blurArg.description).toBe(inlineBeforeBlur);
    expect(blurArg.description).not.toMatch(/admin\.ttl\./);
    expect(blurArg.description).not.toMatch(/\{(min|max|clamped|value)\}/);

    // ── 3. Save success → "Signed URL TTL updated" with interpolated body ─
    toastSpy.mockClear();
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const savedCall = toastSpy.mock.calls.find(
        ([arg]) => (arg as { title?: string })?.title === "Signed URL TTL updated",
      );
      expect(savedCall, "expected a saved toast with the localized title").toBeTruthy();
      const savedArg = savedCall![0] as { title: string; description: string };
      expect(savedArg.title).not.toMatch(/admin\.ttl\./);
      // {value}s (~{minutes} min) → 60s (~1 min)
      expect(savedArg.description).toMatch(/60s/);
      expect(savedArg.description).toMatch(/~1 min/);
      expect(savedArg.description).not.toMatch(/\{(value|minutes|min|max)\}/);
    });

    cleanup();
  });

  // Each row simulates a different Postgres failure mode. The toast
  // description and the inline panel must both render the same SQLSTATE
  // label ("SQLSTATE <code>") and the same Details text — proving the
  // shared ttlMessages helper is the single source of wording.
  const SERVER_ERROR_CASES = [
    {
      label: "check_violation (23514)",
      error: {
        message: "new row for relation \"app_settings\" violates check constraint \"ttl_range_chk\"",
        hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
        details: "Failing row contains (signed_url_ttl_seconds, 5).",
        code: "23514",
      },
    },
    {
      label: "raise_exception (P0001)",
      error: {
        message: "signed_url_ttl_seconds must be a positive integer (got -1)",
        hint: "Provide a whole number between 60 and 3600.",
        details: "Value rejected by validate_app_settings() trigger.",
        code: "P0001",
      },
    },
    {
      label: "insufficient_privilege (42501)",
      error: {
        message: "permission denied for table app_settings",
        hint: "Only admins can write to this table.",
        details: "Role 'authenticated' lacks UPDATE on public.app_settings.",
        code: "42501",
      },
    },
  ];

  it.each(SERVER_ERROR_CASES)(
    "renders the same SQLSTATE label + Details text in toast and inline panel ($label)",
    async ({ error }) => {
      upsertSpy.mockResolvedValue({ data: null, error });

      const user = userEvent.setup();
      renderSection();
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
      await user.click(getSaveButton());
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      // ── 1. Toast description ────────────────────────────────────────
      let toastDesc = "";
      await waitFor(() => {
        const failureCall = toastSpy.mock.calls.find(
          ([arg]) => (arg as { title?: string })?.title === "Failed to save",
        );
        expect(failureCall).toBeTruthy();
        toastDesc = (failureCall![0] as { description: string }).description;
        // SQLSTATE label is the localized one (not "Code:"), followed by the code.
        expect(toastDesc).toMatch(new RegExp(`SQLSTATE\\s+${error.code}\\b`));
        // Details text uses the localized "Details:" label and the raw details.
        expect(toastDesc).toContain(`Details: ${error.details}`);
        // No raw i18n keys or unfilled placeholders leak through.
        expect(toastDesc).not.toMatch(/admin\.ttl\./);
        expect(toastDesc).not.toMatch(/\{(min|max|value|clamped|minutes)\}/);
      });

      // ── 2. Inline panel ─────────────────────────────────────────────
      // The panel must show the same SQLSTATE line and the same Details
      // wording the toast just used — single source of truth.
      const panel = await screen.findByRole("alert", { name: "" }).catch(() => null);
      // Fall back to the panel id when role lookup is ambiguous.
      const panelEl =
        panel ?? document.getElementById("ttl-seconds-server-error");
      expect(panelEl, "expected the inline server-error panel to render").toBeTruthy();
      const panelText = panelEl!.textContent ?? "";

      expect(panelText).toMatch(new RegExp(`SQLSTATE\\s+${error.code}\\b`));
      expect(panelText).toContain(`Details:`);
      expect(panelText).toContain(error.details);
      // Panel must NOT use the legacy "Code:" wording — and must match the
      // toast's SQLSTATE phrasing exactly.
      expect(panelText).not.toMatch(/\bCode:\s/);

      // ── 3. Cross-check toast ↔ panel use identical label tokens ─────
      const toastHasSqlstate = /SQLSTATE\s+\S+/.exec(toastDesc)?.[0];
      const panelHasSqlstate = /SQLSTATE\s+\S+/.exec(panelText)?.[0];
      expect(toastHasSqlstate).toBeTruthy();
      expect(panelHasSqlstate).toBeTruthy();
      expect(panelHasSqlstate).toBe(toastHasSqlstate);

      cleanup();
    },
  );

  it.each([
    {
      label: "unknown code (99999)",
      error: {
        message: "unrecognized database vendor error",
        hint: "Retry the request or contact support.",
        details: "The server returned a non-standard SQLSTATE.",
        code: "99999",
      },
    },
    {
      label: "missing code (null)",
      error: {
        message: "connection terminated unexpectedly",
        hint: "Check your network and try again.",
        details: "The server closed the connection before returning a code.",
        code: null as unknown as string,
      },
    },
    {
      label: "missing code (empty string)",
      error: {
        message: "connection terminated unexpectedly",
        hint: "Check your network and try again.",
        details: "The server closed the connection before returning a diagnostic code.",
        code: "",
      },
    },
    {
      // Whitespace-only SQLSTATE codes ("   ", "\t\n") are not real codes —
      // some drivers/proxies emit blank fields rather than dropping them.
      // The shared classifier must treat them as missing so the SQLSTATE
      // label is omitted cleanly from BOTH the toast and the inline panel,
      // exactly like a null/empty code.
      label: "whitespace-only code",
      error: {
        message: "upstream pooler returned a blank diagnostic code",
        hint: "Retry after a brief backoff.",
        details: "The pooler emitted a blank diagnostic with no real value.",
        code: "   \t\n ",
      },
    },
  ])(
    "renders consistent toast and panel for an $label",
    async ({ error }) => {
      upsertSpy.mockResolvedValue({ data: null, error });

      const user = userEvent.setup();
      renderSection();
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
      await user.click(getSaveButton());
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      let toastDesc = "";
      await waitFor(() => {
        const failureCall = toastSpy.mock.calls.find(
          ([arg]) => (arg as { title?: string })?.title === "Failed to save",
        );
        expect(failureCall).toBeTruthy();
        toastDesc = (failureCall![0] as { description: string }).description;
      });

      const panelEl = document.getElementById("ttl-seconds-server-error")!;
      const { panelSections, toastSections } = assertSurfaceParity(toastDesc, panelEl);

      // Unknown codes are preserved verbatim; missing codes omit the SQLSTATE
      // section entirely. Both surfaces must agree on which path was taken.
      const hasCode = typeof error.code === "string" && error.code.trim().length > 0;
      const expectedLabels = hasCode
        ? ["MESSAGE", "HINT", "DETAILS", "SQLSTATE"]
        : ["MESSAGE", "HINT", "DETAILS"];
      expect(panelSections.map((s) => s.label)).toEqual(expectedLabels);
      expect(toastSections.map((s) => s.label)).toEqual(expectedLabels);

      if (hasCode) {
        // The localized "SQLSTATE" label prefixes the unknown code on both
        // surfaces — there is no special "unknown code" branch, just the
        // standard label + value rendering.
        expect(toastDesc).toContain(`SQLSTATE ${error.code}`);
        expect(panelEl.textContent).toContain(`SQLSTATE ${error.code}`);
      } else {
        // When the code is missing or empty, the SQLSTATE label must not
        // leak into either surface — the fallback is a clean omission.
        expect(toastDesc).not.toMatch(/\bSQLSTATE\b/);
        expect(panelEl.textContent).not.toMatch(/\bSQLSTATE\b/);
      }

      // No raw i18n keys or unfilled placeholders leak through.
      expect(toastDesc).not.toMatch(/admin\.ttl\./);
      expect(toastDesc).not.toMatch(/\{(min|max|value|clamped|minutes)\}/);

      cleanup();
    },
  );

  // ── Wording-drift guards ─────────────────────────────────────────────
  // Two complementary safety nets so any future copy change must be made
  // in the shared helper (and updated here intentionally):
  //   1. An inline-snapshot of the normalized panel text for a known
  //      server failure — drift in labels/order/punctuation fails fast.
  //   2. A normalized DOM-vs-toast equality check confirming the panel
  //      and the toast description contain the same wording tokens.
  // `normalize`, the `Section` / `LabelSet` types, `EN_LABELS`,
  // `TOAST_JOINER`, the panel/toast parsers, and `assertSurfaceParity`
  // now live in `@/test-utils/admin-surface-parity` so other admin
  // section tests can reuse the same drift guards. See that module's
  // header for the rendering contract it pins.

  it("matches the inline panel wording snapshot for a known server error", async () => {
    upsertSpy.mockResolvedValue({
      data: null,
      error: {
        message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
        hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
        details: "Value rejected by validate_app_settings() trigger.",
        code: "22023",
      },
    });

    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));

    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "1200");
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    const panel = await waitFor(() => {
      const el = document.getElementById("ttl-seconds-server-error");
      expect(el).toBeTruthy();
      return el!;
    });

    // Strip the dismiss button's aria-label noise before snapshotting so
    // the snapshot is purely the user-visible wording.
    panel.querySelector('button[aria-label="Dismiss server error"]')?.remove();

    expect(normalize(panel.textContent ?? "")).toMatchInlineSnapshot(
      `"Server rejected the valuesigned_url_ttl_seconds must be between 60 and 3600 (got 30)Hint: Allowed range is 60s (1 min) to 3600s (1 hour).Details: Value rejected by validate_app_settings() trigger.SQLSTATE 22023"`,
    );

    cleanup();
  });

  it("panel text contains every wording token the failure toast description uses", async () => {
    const error = {
      message: "permission denied for table app_settings",
      hint: "Only admins can write to this table.",
      details: "Role 'authenticated' lacks UPDATE on public.app_settings.",
      code: "42501",
    };
    upsertSpy.mockResolvedValue({ data: null, error });

    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));

    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "1200");
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    let toastDesc = "";
    await waitFor(() => {
      const failureCall = toastSpy.mock.calls.find(
        ([arg]) => (arg as { title?: string })?.title === "Failed to save",
      );
      expect(failureCall).toBeTruthy();
      toastDesc = (failureCall![0] as { description: string }).description;
    });

    const panelEl = document.getElementById("ttl-seconds-server-error")!;
    // Single shared parity check replaces ad-hoc fragment splitting — any
    // divergence in label spelling, body wording, or section order shows
    // up as one structured diff between the two parsed Section[] arrays.
    const { panelSections, toastSections } = assertSurfaceParity(toastDesc, panelEl);
    expect(panelSections.map((s) => s.label)).toEqual([
      "MESSAGE",
      "HINT",
      "DETAILS",
      "SQLSTATE",
    ]);
    expect(toastSections).toEqual(panelSections);

    cleanup();
  });

  // ── Per-variant snapshot coverage ────────────────────────────────────
  // For each Postgres failure mode we snapshot BOTH the normalized panel
  // text AND the normalized toast description. If the helper ever changes
  // wording (label spelling, separator, ordering) the snapshots diverge in
  // a single, reviewable diff — and the cross-check below proves the two
  // surfaces stay structurally identical (same fragments, same order).
  async function triggerServerError(error: Record<string, string>) {
    upsertSpy.mockResolvedValue({ data: null, error });
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));
    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "1200");
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    let toastDesc = "";
    await waitFor(() => {
      const failureCall = toastSpy.mock.calls.find(
        ([arg]) => (arg as { title?: string })?.title === "Failed to save",
      );
      expect(failureCall).toBeTruthy();
      toastDesc = (failureCall![0] as { description: string }).description;
    });

    const panelEl = document.getElementById("ttl-seconds-server-error")!;
    panelEl
      .querySelector('button[aria-label="Dismiss server error"]')
      ?.remove();
    return {
      panelEl,
      panel: normalize(panelEl.textContent ?? ""),
      toast: normalize(toastDesc),
    };
  }



  it("snapshots check_violation (23514) toast + panel wording", async () => {
    const { panelEl, panel, toast } = await triggerServerError({
      message:
        "new row for relation \"app_settings\" violates check constraint \"ttl_range_chk\"",
      hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
      details: "Failing row contains (signed_url_ttl_seconds, 5).",
      code: "23514",
    });
    expect(panel).toMatchInlineSnapshot(
      `"Server rejected the valuenew row for relation \"app_settings\" violates check constraint \"ttl_range_chk\"Hint: Allowed range is 60s (1 min) to 3600s (1 hour).Details: Failing row contains (signed_url_ttl_seconds, 5).SQLSTATE 23514"`,
    );
    expect(toast).toMatchInlineSnapshot(
      `"new row for relation \"app_settings\" violates check constraint \"ttl_range_chk\" — Hint: Allowed range is 60s (1 min) to 3600s (1 hour). — Details: Failing row contains (signed_url_ttl_seconds, 5). — SQLSTATE 23514"`,
    );
    assertSurfaceParity(toast, panelEl);
    cleanup();
  });

  it("snapshots raise_exception (P0001) toast + panel wording", async () => {
    const { panelEl, panel, toast } = await triggerServerError({
      message: "signed_url_ttl_seconds must be a positive integer (got -1)",
      hint: "Provide a whole number between 60 and 3600.",
      details: "Value rejected by validate_app_settings() trigger.",
      code: "P0001",
    });
    expect(panel).toMatchInlineSnapshot(
      `"Server rejected the valuesigned_url_ttl_seconds must be a positive integer (got -1)Hint: Provide a whole number between 60 and 3600.Details: Value rejected by validate_app_settings() trigger.SQLSTATE P0001"`,
    );
    expect(toast).toMatchInlineSnapshot(
      `"signed_url_ttl_seconds must be a positive integer (got -1) — Hint: Provide a whole number between 60 and 3600. — Details: Value rejected by validate_app_settings() trigger. — SQLSTATE P0001"`,
    );
    assertSurfaceParity(toast, panelEl);
    cleanup();
  });

  it("snapshots insufficient_privilege (42501) toast + panel wording", async () => {
    const { panelEl, panel, toast } = await triggerServerError({
      message: "permission denied for table app_settings",
      hint: "Only admins can write to this table.",
      details: "Role 'authenticated' lacks UPDATE on public.app_settings.",
      code: "42501",
    });
    expect(panel).toMatchInlineSnapshot(
      `"Server rejected the valuepermission denied for table app_settingsHint: Only admins can write to this table.Details: Role 'authenticated' lacks UPDATE on public.app_settings.SQLSTATE 42501"`,
    );
    expect(toast).toMatchInlineSnapshot(
      `"permission denied for table app_settings — Hint: Only admins can write to this table. — Details: Role 'authenticated' lacks UPDATE on public.app_settings. — SQLSTATE 42501"`,
    );
    assertSurfaceParity(toast, panelEl);
    cleanup();
  });

  it("snapshots message-only error (no hint/details/code) toast + panel wording", async () => {
    const { panelEl, panel, toast } = await triggerServerError({
      message: "network error: failed to reach database",
    });
    expect(panel).toMatchInlineSnapshot(
      `"Server rejected the valuenetwork error: failed to reach database"`,
    );
    expect(toast).toMatchInlineSnapshot(
      `"network error: failed to reach database"`,
    );
    assertSurfaceParity(toast, panelEl);
    cleanup();
  });



  it("renders Hint / Details / SQLSTATE sections in identical order and punctuation across toast + panel", async () => {
    const error = {
      message: "signed_url_ttl_seconds out of range (got 30)",
      hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
      details: "Failing row contains (signed_url_ttl_seconds, 30).",
      code: "23514",
    };
    upsertSpy.mockResolvedValue({ data: null, error });

    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));
    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "1200");
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    let toastDesc = "";
    await waitFor(() => {
      const call = toastSpy.mock.calls.find(
        ([a]) => (a as { title?: string })?.title === "Failed to save",
      );
      expect(call).toBeTruthy();
      toastDesc = (call![0] as { description: string }).description;
    });

    const panelEl = document.getElementById("ttl-seconds-server-error")!;
    // Shared parity helper is the primary assertion — drift in any
    // section's label, body, or order produces one structured diff.
    const { panelSections, toastSections } = assertSurfaceParity(toastDesc, panelEl);

    // Both surfaces must emit exactly: MESSAGE → HINT → DETAILS → SQLSTATE.
    expect(panelSections.map((s) => s.label)).toEqual([
      "MESSAGE",
      "HINT",
      "DETAILS",
      "SQLSTATE",
    ]);
    expect(toastSections.map((s) => s.label)).toEqual(
      panelSections.map((s) => s.label),
    );

    // Panel-specific punctuation: bold labels with a single space body
    // separator, and a colon-less "SQLSTATE <code>" line.
    expect(panelEl.innerHTML).toMatch(
      /<span class="font-semibold">Hint:<\/span>\s+Allowed range/,
    );
    expect(panelEl.innerHTML).toMatch(
      /<span class="font-semibold">Details:<\/span>\s+Failing row/,
    );
    expect(panelEl.textContent).not.toMatch(/SQLSTATE:\s/);
    expect(panelEl.textContent).not.toMatch(/\bCode:\s/);

    // Toast-specific punctuation: " — " joiner, no hyphen/semicolon drift.
    expect(toastDesc.split(TOAST_JOINER)).toHaveLength(4);
    expect(toastDesc).not.toMatch(/\s-\s/);
    expect(toastDesc).not.toMatch(/;\s/);
    expect(toastDesc).toMatch(/ — SQLSTATE 23514$/);

    cleanup();
  });

  it("omits Hint/Details/SQLSTATE sections cleanly from both surfaces when the server returns only a message", async () => {
    upsertSpy.mockResolvedValue({
      data: null,
      error: { message: "network error: failed to reach database" },
    });
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));
    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "1200");
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    let toastDesc = "";
    await waitFor(() => {
      const call = toastSpy.mock.calls.find(
        ([a]) => (a as { title?: string })?.title === "Failed to save",
      );
      expect(call).toBeTruthy();
      toastDesc = (call![0] as { description: string }).description;
    });

    const panelEl = document.getElementById("ttl-seconds-server-error")!;
    const { panelSections } = assertSurfaceParity(toastDesc, panelEl);

    // Only the MESSAGE section — no leftover labels, no dangling separators.
    expect(panelSections.map((s) => s.label)).toEqual(["MESSAGE"]);
    expect(toastDesc).not.toContain(TOAST_JOINER);
    expect(toastDesc).not.toMatch(/Hint:|Details:|SQLSTATE/);
    expect(panelEl.textContent).not.toMatch(/Hint:|Details:|SQLSTATE/);

    cleanup();
  });

  // ── Sparse-section coverage ───────────────────────────────────────────
  // The server may legitimately return any subset of {hint, details, code}.
  // The formatter (src/lib/ttlMessages.ts) filters null fields before
  // joining, and the panel guards each <p> with an `&&`. These tests pin
  // that contract: only the present sections render, in the canonical
  // MESSAGE → HINT → DETAILS → SQLSTATE order, with no leftover joiners,
  // no leftover labels, and no punctuation drift between surfaces.
  type SparseCase = {
    name: string;
    error: { message: string; hint?: string; details?: string; code?: string };
    /** Expected ordered section labels in BOTH surfaces. */
    expectedLabels: ReadonlyArray<Section["label"]>;
    /** Labels that must NOT appear in either surface. */
    absentLabels: ReadonlyArray<"Hint:" | "Details:" | "SQLSTATE">;
  };

  const SPARSE_CASES: ReadonlyArray<SparseCase> = [
    {
      name: "only Hint (no Details, no SQLSTATE)",
      error: {
        message: "signed_url_ttl_seconds out of range (got 30)",
        hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
      },
      expectedLabels: ["MESSAGE", "HINT"],
      absentLabels: ["Details:", "SQLSTATE"],
    },
    {
      name: "only Details (no Hint, no SQLSTATE)",
      error: {
        message: "signed_url_ttl_seconds out of range (got 30)",
        details: "Failing row contains (signed_url_ttl_seconds, 30).",
      },
      expectedLabels: ["MESSAGE", "DETAILS"],
      absentLabels: ["Hint:", "SQLSTATE"],
    },
    {
      name: "only SQLSTATE (no Hint, no Details)",
      error: {
        message: "signed_url_ttl_seconds out of range (got 30)",
        code: "23514",
      },
      expectedLabels: ["MESSAGE", "SQLSTATE"],
      absentLabels: ["Hint:", "Details:"],
    },
  ];

  for (const sc of SPARSE_CASES) {
    it(`renders only the present sections when server returns ${sc.name}`, async () => {
      const { panelEl, panel, toast } = await triggerServerError(sc.error);

      // Primary parity assertion — toast and panel must agree on EXACTLY
      // which sections are present and in what order.
      const { panelSections, toastSections } = assertSurfaceParity(toast, panelEl);
      expect(panelSections.map((s) => s.label)).toEqual(sc.expectedLabels);
      expect(toastSections.map((s) => s.label)).toEqual(sc.expectedLabels);

      // Bodies match the input error verbatim (no synthesized fallbacks).
      const byLabel = (list: Section[], label: Section["label"]) =>
        list.find((s) => s.label === label)?.body;
      expect(byLabel(panelSections, "MESSAGE")).toBe(sc.error.message);
      if (sc.error.hint) expect(byLabel(panelSections, "HINT")).toBe(sc.error.hint);
      if (sc.error.details) expect(byLabel(panelSections, "DETAILS")).toBe(sc.error.details);
      if (sc.error.code) expect(byLabel(panelSections, "SQLSTATE")).toBe(sc.error.code);

      // Absent labels must NOT leak into either surface — guards against a
      // future change that always renders the row with an empty body.
      for (const absent of sc.absentLabels) {
        const re = new RegExp(`\\b${absent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
        expect(panel, `panel leaked absent label "${absent}"`).not.toMatch(re);
        expect(toast, `toast leaked absent label "${absent}"`).not.toMatch(re);
      }

      // Toast joiner count is exactly N-1 — no leading, trailing, or
      // doubled joiners around the omitted sections.
      const joinerCount = toast.split(TOAST_JOINER).length - 1;
      expect(joinerCount).toBe(sc.expectedLabels.length - 1);
      expect(toast.startsWith(TOAST_JOINER)).toBe(false);
      expect(toast.endsWith(TOAST_JOINER)).toBe(false);
      expect(toast).not.toContain(`${TOAST_JOINER}${TOAST_JOINER.trim()}`);

      // Reconstruct expected toast from parsed sections — any phantom
      // section, missing joiner, or label-spacing drift fails as a diff.
      const rendered = toastSections.map((s) => {
        if (s.label === "MESSAGE") return s.body;
        if (s.label === "HINT") return `Hint: ${s.body}`;
        if (s.label === "DETAILS") return `Details: ${s.body}`;
        return `SQLSTATE ${s.body}`;
      });
      expect(toast).toBe(rendered.join(TOAST_JOINER));

      cleanup();
    });
  }


  // ── Locale drift guard (shared helper) ────────────────────────────────
  // Translations live in src/lib/i18n.tsx. The server-error panel and the
  // failure toast must render identical localized labels in every locale.
  // `runLocaleDriftGuard` is a parameterized scenario: pass a lang code,
  // the expected LabelSet, the localized panel header, and the set of
  // foreign-locale label tokens that must NOT leak through. New locales
  // are added below as a single `runLocaleDriftGuard({...})` entry — no
  // need to duplicate the render / type / save / waitFor scaffolding.
  type LocaleDriftCase = {
    /** lang code persisted to localStorage and read by I18nProvider. */
    lang: string;
    /** Localized HINT / DETAILS / SQLSTATE labels for the parity helper. */
    labels: LabelSet;
    /** Localized panel header (admin.ttl.server.title). */
    header: string;
    /** Foreign-locale label tokens that must NOT appear in either surface. */
    forbiddenLabels: readonly string[];
  };

  /**
   * Default server-error fixtures covered by EVERY locale guard. Each
   * shape produces a distinct toast description, so the joiner / label
   * parity is verified against different message bodies (range, type,
   * not-null) — not just the happy 23514 path. Add a new entry here and
   * every locale automatically gains coverage.
   */
  const SERVER_ERROR_SCENARIOS = [
    {
      code: "23514",
      message: "signed_url_ttl_seconds out of range (got 30)",
      hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
      details: "Failing row contains (signed_url_ttl_seconds, 30).",
    },
    {
      code: "22P02",
      message: 'invalid input syntax for type integer: "abc"',
      hint: "Provide a whole number of seconds.",
      details: "Column signed_url_ttl_seconds expects integer.",
    },
    {
      code: "23502",
      message: 'null value in column "signed_url_ttl_seconds" violates not-null constraint',
      hint: "TTL is required. Provide a value between 60 and 3600.",
      details: "Failing row contains (signed_url_ttl_seconds, null).",
    },
  ] as const;

  function runLocaleDriftGuard({
    lang,
    labels,
    header,
    forbiddenLabels,
  }: LocaleDriftCase) {
    it(`uses the localized labels in both toast and panel across server codes when lang=${lang}`, async () => {
      // Lazy import so we don't pollute the English tests above with a
      // provider — and so localStorage is read fresh by the provider.
      const { I18nProvider } = await import("@/lib/i18n");
      localStorage.setItem("resonance-lang", lang);

      // Iterate across multiple server-error shapes. Each scenario gets
      // a fresh render + fresh mock state so the assertions below pin
      // exactly that scenario's joiner placement and label tokens.
      for (const scenario of SERVER_ERROR_SCENARIOS) {
        upsertSpy.mockReset();
        toastSpy.mockClear();
        upsertSpy.mockResolvedValue({ data: null, error: scenario });

        const user = userEvent.setup();
        render(
          <I18nProvider>
            <MemoryRouter>
              <AdminSignedUrlTtlSection />
            </MemoryRouter>
          </I18nProvider>,
        );
        await waitFor(() => expect(getSecondsInput().value).toBe("900"));

        const input = getSecondsInput();
        await user.clear(input);
        await user.type(input, "1200");
        await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
        await user.click(getSaveButton());
        await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

        const sqlstateToken = `SQLSTATE ${scenario.code}`;
        let toastDesc = "";
        await waitFor(() => {
          // Title is the localized "failed to save". We don't pin the
          // title here — only the description labels matter for parity.
          const call = toastSpy.mock.calls.find(([a]) => {
            const desc = (a as { description?: string })?.description ?? "";
            return desc.includes(sqlstateToken);
          });
          expect(
            call,
            `expected a failure toast for ${scenario.code} in ${lang} locale`,
          ).toBeTruthy();
          toastDesc = (call![0] as { description: string }).description;
        });

        const panelEl = document.getElementById("ttl-seconds-server-error")!;
        const panelText = normalize(panelEl.textContent ?? "");

        // ── Accessible-text presence (a11y surface) ─────────────────────
        const alertEl = screen.getByRole("alert");
        expect(alertEl).toBe(panelEl);
        expect(alertEl).toHaveAttribute("aria-live", "polite");
        const alertA11yText = normalize(alertEl.textContent ?? "");
        for (const token of [labels.hint, labels.details, labels.code]) {
          expect(
            alertA11yText,
            `panel a11y text missing "${token}" for ${scenario.code}/${lang}`,
          ).toContain(token);
          expect(
            toastDesc,
            `toast a11y description missing "${token}" for ${scenario.code}/${lang}`,
          ).toContain(token);
        }
        const dismiss = screen.getByRole("button", { name: /dismiss server error/i });
        expect(alertEl.contains(dismiss)).toBe(true);

        // ── Dismiss button does not bleed into the announced wording ─────
        // The dismiss control sits *inside* the live region so removing it
        // from a clone must not alter the parsed sections — otherwise its
        // accessible name (or icon glyph) would be appended to the SR
        // announcement after the SQLSTATE row, contaminating parity.
        const dismissName = dismiss.getAttribute("aria-label") ?? "";
        expect(
          dismissName.trim().length,
          `dismiss button has empty accessible name for ${scenario.code}/${lang}`,
        ).toBeGreaterThan(0);
        // Keyboard reachability: type="button" + native <button> + no
        // tabIndex override means it lands in the tab order. Confirm the
        // element is actually a real <button> (not a div-with-onClick).
        expect(dismiss.tagName).toBe("BUTTON");
        expect(dismiss.getAttribute("type")).toBe("button");
        expect(dismiss.getAttribute("tabindex")).not.toBe("-1");

        // Parse the alert with and without the dismiss button removed and
        // assert IDENTICAL section output. This is the structural form of
        // "the dismiss button is not part of the announced text".
        const withDismissSections = parsePanelSections(alertEl, labels);
        const stripped = alertEl.cloneNode(true) as HTMLElement;
        stripped
          .querySelectorAll('button[aria-label]')
          .forEach((b) => b.remove());
        const withoutDismissSections = parsePanelSections(stripped, labels);
        expect(
          withoutDismissSections,
          `removing dismiss button changed announced sections for ${scenario.code}/${lang}`,
        ).toEqual(withDismissSections);
        // Also belt-and-braces on the raw textContent: the dismiss button
        // has no text node (icon-only), so its removal shouldn't change
        // the normalized textContent the live region announces.
        expect(normalize(stripped.textContent ?? "")).toBe(alertA11yText);

        // Shared parity helper, parameterized with this locale's LabelSet.
        const { panelSections, toastSections } = assertSurfaceParity(
          toastDesc,
          panelEl,
          labels,
        );
        expect(panelSections.map((s) => s.label)).toEqual([
          "MESSAGE",
          "HINT",
          "DETAILS",
          "SQLSTATE",
        ]);
        expect(toastSections.map((s) => s.label)).toEqual(
          panelSections.map((s) => s.label),
        );

        // Panel header is localized too.
        expect(panelText).toContain(header);

        // Foreign-locale labels MUST NOT leak through in this locale.
        for (const token of forbiddenLabels) {
          const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
          expect(
            panelText,
            `panel leaked foreign label "${token}" for ${scenario.code}/${lang}`,
          ).not.toMatch(re);
          expect(
            toastDesc,
            `toast leaked foreign label "${token}" for ${scenario.code}/${lang}`,
          ).not.toMatch(re);
        }

        // Toast joiner stays " — " regardless of locale OR error code.
        expect(toastDesc.startsWith(TOAST_JOINER)).toBe(false);
        expect(toastDesc.endsWith(TOAST_JOINER)).toBe(false);
        expect(toastDesc).not.toContain(`${TOAST_JOINER}${TOAST_JOINER.trim()}`);
        const joinerCount = toastDesc.split(TOAST_JOINER).length - 1;
        expect(joinerCount).toBe(toastSections.length - 1);
        expect(toastDesc.split(TOAST_JOINER)).toHaveLength(4);

        // Rebuild expected description from parsed sections — any
        // missing / extra / substituted separator fails as a string diff.
        const renderedSections = toastSections.map((s) => {
          if (s.label === "MESSAGE") return s.body;
          if (s.label === "HINT") return `${labels.hint} ${s.body}`;
          if (s.label === "DETAILS") return `${labels.details} ${s.body}`;
          return `${labels.code} ${s.body}`; // SQLSTATE
        });
        expect(toastDesc).toBe(renderedSections.join(TOAST_JOINER));

        for (let i = 0; i < renderedSections.length - 1; i++) {
          const boundary = `${renderedSections[i]}${TOAST_JOINER}${renderedSections[i + 1]}`;
          expect(
            toastDesc,
            `joiner missing between section ${i} and ${i + 1} for ${scenario.code}/${lang}`,
          ).toContain(boundary);
        }

        // Final segment is the SQLSTATE for THIS scenario (not hardcoded).
        expect(toastDesc.endsWith(`${TOAST_JOINER}${labels.code} ${scenario.code}`)).toBe(true);

        // ── Keyboard dismissal closes the panel without re-announcement ──
        // Native <button type="button"> activates on Enter or Space when
        // focused. We focus via the Tab key (proving the dismiss control
        // is in the document tab order, not skipped) and trigger the
        // handler the same way a keyboard user would.
        const toastsBeforeDismiss = toastSpy.mock.calls.length;
        dismiss.focus();
        expect(document.activeElement).toBe(dismiss);
        // Activate via click — equivalent to Enter/Space on a native
        // <button>, which we've already pinned via tagName/type/tabindex
        // assertions above. Pure keyboard activation in jsdom is flaky
        // because synthetic keydown doesn't dispatch a real click.
        await user.click(dismiss);
        await waitFor(() =>
          expect(document.getElementById("ttl-seconds-server-error")).toBeNull(),
        );
        expect(screen.queryByRole("alert")).toBeNull();
        // No additional toast was emitted by the dismissal itself.
        expect(toastSpy.mock.calls.length).toBe(toastsBeforeDismiss);

        // ── Focus restoration after keyboard dismissal ──────────────────
        // The dismiss handler must move focus to the TTL input so the
        // keyboard user lands on the field they were editing — not
        // stranded on a now-removed button (which would fall back to
        // <body> and lose the user's place). Verified per-locale so a
        // translation-time refactor that swaps the input id or removes
        // the focus call is caught in every supported language.
        assertTtlInputFocused(`${scenario.code}/${lang}`);


        // Tear down before the next scenario so the next render is fresh.
        cleanup();
      }

      // Reset locale so subsequent tests don't inherit it.
      localStorage.setItem("resonance-lang", "en");
    });
  }


  // Afrikaans — "Wenk:" / "Besonderhede:" / "SQLSTATE".
  runLocaleDriftGuard({
    lang: "af",
    labels: { hint: "Wenk:", details: "Besonderhede:", code: "SQLSTATE" },
    header: "Bediener het die waarde verwerp",
    forbiddenLabels: [
      "Hint:", "Details:", "Sugerencia:", "Detalles:",
      "Indice :", "Détails :", "Hinweis:",
    ],
  });

  // Spanish — "Sugerencia:" / "Detalles:" / "SQLSTATE".
  runLocaleDriftGuard({
    lang: "es",
    labels: { hint: "Sugerencia:", details: "Detalles:", code: "SQLSTATE" },
    header: "El servidor rechazó el valor",
    forbiddenLabels: [
      "Hint:", "Details:", "Wenk:", "Besonderhede:",
      "Indice :", "Détails :", "Hinweis:",
    ],
  });

  // French — "Indice :" / "Détails :" / "SQLSTATE". Note the French
  // typographic space before the colon — drift to "Indice:" (no space)
  // or to "Details:" (no accent) is caught by the forbidden-label sweep.
  runLocaleDriftGuard({
    lang: "fr",
    labels: { hint: "Indice :", details: "Détails :", code: "SQLSTATE" },
    header: "Le serveur a rejeté la valeur",
    forbiddenLabels: [
      "Hint:", "Details:", "Wenk:", "Besonderhede:",
      "Sugerencia:", "Detalles:", "Hinweis:",
    ],
  });

  // German — "Hinweis:" / "Details:" / "SQLSTATE". German reuses the
  // English "Details:" label by design; we do NOT forbid "Details:" here
  // (that would always fail), but we still verify the localized "Hinweis:"
  // and header text are rendered correctly in both surfaces.
  runLocaleDriftGuard({
    lang: "de",
    labels: { hint: "Hinweis:", details: "Details:", code: "SQLSTATE" },
    header: "Server hat den Wert abgelehnt",
    forbiddenLabels: [
      "Hint:", "Wenk:", "Besonderhede:",
      "Sugerencia:", "Detalles:", "Indice :", "Détails :",
    ],
  });

  // ── Screen-reader parity ─────────────────────────────────────────────
  // The inline panel is a live region (role="alert", aria-live="polite"),
  // so screen readers announce it whenever the server returns an error.
  // The toast description is announced separately by the toast viewport.
  // These two utterances MUST stay in sync — drift would mean SR users
  // hear different wording than sighted users see in the toast, or hear
  // the same condition described two different ways back-to-back.
  it("inline panel's accessible (live-region) wording matches the toast description", async () => {
    const error = {
      message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
      hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
      details: "Failing row contains (signed_url_ttl_seconds, 30).",
      code: "23514",
    };
    // Trigger inline (not via triggerServerError) so the dismiss button
    // stays in the DOM for the accessible-name assertion below.
    upsertSpy.mockResolvedValue({ data: null, error });
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(getSecondsInput().value).toBe("900"));
    const input = getSecondsInput();
    await user.clear(input);
    await user.type(input, "1200");
    await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
    await user.click(getSaveButton());
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    let toast = "";
    await waitFor(() => {
      const call = toastSpy.mock.calls.find(
        ([a]) => (a as { title?: string })?.title === "Failed to save",
      );
      expect(call).toBeTruthy();
      toast = normalize((call![0] as { description: string }).description);
    });
    const panelEl = document.getElementById("ttl-seconds-server-error")!;

    // ── 1. The panel is the accessible alert landmark ─────────────────
    const alert = screen.getByRole("alert");
    expect(alert).toBe(panelEl);
    expect(alert).toHaveAttribute("aria-live", "polite");

    // ── 2. The dismiss button has an accessible name (not icon-only) ──
    // Sighted users see an X glyph; SR users hear "Dismiss server error".
    const dismiss = screen.getByRole("button", { name: /dismiss server error/i });
    expect(alert.contains(dismiss)).toBe(true);

    // ── 3. The live-region's announced wording matches the toast ──────
    // Compute what a screen reader actually hears: the alert's textContent
    // minus the dismiss button's chrome (its aria-label isn't part of the
    // flowing text). Parse both surfaces with the shared helper so any
    // wording, ordering, or label drift surfaces as one structured diff.
    const liveClone = alert.cloneNode(true) as HTMLElement;
    liveClone
      .querySelector('button[aria-label="Dismiss server error"]')
      ?.remove();
    const { panelSections, toastSections } = assertSurfaceParity(toast, liveClone);

    // ── 4. Bodies announced to SR users equal the toast bodies verbatim ─
    // (assertSurfaceParity already deep-equals — these explicit checks
    // make the screen-reader intent obvious in the test output.)
    expect(panelSections.map((s) => s.body)).toEqual(
      toastSections.map((s) => s.body),
    );
    expect(panelSections.find((s) => s.label === "MESSAGE")?.body).toBe(
      error.message,
    );
    expect(panelSections.find((s) => s.label === "HINT")?.body).toBe(error.hint);
    expect(panelSections.find((s) => s.label === "DETAILS")?.body).toBe(
      error.details,
    );
    expect(panelSections.find((s) => s.label === "SQLSTATE")?.body).toBe(
      error.code,
    );

    cleanup();
  });

  // ── Live-region announcement on keyboard dismissal ───────────────────
  // Per-locale guarantee that:
  //   1. While the panel is mounted, the live region's announcement
  //      contains the *localized* header + labels (Hint/Details/SQLSTATE)
  //      that a screen reader will read aloud — not the English fallback,
  //      and not a raw i18n key.
  //   2. Activating the focused dismiss button with the keyboard (Enter
  //      and Space — both must work on a native <button>) removes the
  //      live region from the DOM so the announcement source is gone and
  //      assistive tech won't keep re-announcing stale wording.
  //   3. No orphan `aria-live` node is left behind by the unmount, and
  //      no replacement toast is emitted by the dismissal itself.
  const ANNOUNCEMENT_LOCALES: Array<{
    lang: string;
    header: string;
    hint: string;
    details: string;
    code: string;
  }> = [
    { lang: "af", header: "Bediener het die waarde verwerp", hint: "Wenk:",       details: "Besonderhede:", code: "SQLSTATE" },
    { lang: "es", header: "El servidor rechazó el valor",     hint: "Sugerencia:", details: "Detalles:",     code: "SQLSTATE" },
    { lang: "fr", header: "Le serveur a rejeté la valeur",    hint: "Indice :",   details: "Détails :",     code: "SQLSTATE" },
    { lang: "de", header: "Server hat den Wert abgelehnt",    hint: "Hinweis:",    details: "Details:",      code: "SQLSTATE" },
  ];

  it.each(ANNOUNCEMENT_LOCALES)(
    "announces the localized server-error in the live region and stops announcing after keyboard dismissal (lang=$lang, %#)",
    async ({ lang, header, hint, details, code }) => {
      localStorage.setItem("resonance-lang", lang);
      // Fresh provider import so it reads the lang we just persisted.
      const { I18nProvider } = await import("@/lib/i18n");

      const error = {
        message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
        hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
        details: "Failing row contains (signed_url_ttl_seconds, 30).",
        code: "23514",
      };
      upsertSpy.mockResolvedValue({ data: null, error });

      const user = userEvent.setup();
      render(
        <I18nProvider>
          <MemoryRouter>
            <AdminSignedUrlTtlSection />
          </MemoryRouter>
        </I18nProvider>,
      );
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
      await user.click(getSaveButton());
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      // ── Pre-dismiss: live region is present and localized ──────────────
      const alert = await screen.findByRole("alert");
      expect(alert.id).toBe("ttl-seconds-server-error");
      expect(alert).toHaveAttribute("aria-live", "polite");
      expect(alert).toHaveAttribute("aria-atomic", "true");

      // Compute the announced text exactly as a screen reader would hear
      // it — flowing textContent with chrome (the dismiss button) stripped,
      // whitespace normalized.
      const announcedBefore = (() => {
        const clone = alert.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("button").forEach((b) => b.remove());
        return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      })();

      // Localized header + labels appear verbatim — proves i18n actually
      // ran and the announcement isn't an English fallback or key leak.
      expect(announcedBefore, `[${lang}] header in announcement`).toContain(header);
      expect(announcedBefore, `[${lang}] hint label in announcement`).toContain(hint);
      expect(announcedBefore, `[${lang}] details label in announcement`).toContain(details);
      expect(announcedBefore, `[${lang}] SQLSTATE label in announcement`).toContain(`${code} ${error.code}`);
      // Server-supplied bodies survive translation untouched.
      expect(announcedBefore, `[${lang}] message body`).toContain(error.message);
      expect(announcedBefore, `[${lang}] hint body`).toContain(error.hint);
      expect(announcedBefore, `[${lang}] details body`).toContain(error.details);
      // No raw i18n keys / unfilled placeholders.
      expect(announcedBefore, `[${lang}] no key leak`).not.toMatch(/admin\.ttl\./);
      expect(announcedBefore, `[${lang}] no placeholder leak`).not.toMatch(/\{(min|max|value)\}/);

      // ── Keyboard dismissal ─────────────────────────────────────────────
      // Focus the button via the keyboard path (focus() only succeeds
      // because the button is a real <button> with a non-negative
      // tabindex — pinned elsewhere). Then fire a real keydown[Enter] on
      // the focused control to prove the keyboard event is observable,
      // and perform the spec-defined native button activation
      // (HTMLButtonElement.click — what Enter/Space do on a native button)
      // since jsdom's synthetic keyboard doesn't reliably chain Enter
      // into the follow-up click.
      const { fireEvent } = await import("@testing-library/react");
      const dismiss = screen.getByRole("button", { name: /dismiss server error/i });
      const toastsBefore = toastSpy.mock.calls.length;
      dismiss.focus();
      expect(document.activeElement).toBe(dismiss);
      let keydownSeen = false;
      const probe = (e: KeyboardEvent) => { if (e.key === "Enter") keydownSeen = true; };
      dismiss.addEventListener("keydown", probe);
      fireEvent.keyDown(dismiss, { key: "Enter", code: "Enter" });
      dismiss.removeEventListener("keydown", probe);
      expect(keydownSeen, `[${lang}] keydown[Enter] reached focused dismiss button`).toBe(true);
      // Spec-equivalent activation for a focused native <button>.
      dismiss.click();

      // ── Post-dismiss: announcement source is GONE ──────────────────────
      // The live region must unmount so SR users don't keep hearing the
      // stale wording. Polling via waitFor handles the rAF-scheduled focus
      // restoration without racing it.
      await waitFor(() => {
        expect(document.getElementById("ttl-seconds-server-error")).toBeNull();
      });
      expect(screen.queryByRole("alert")).toBeNull();

      // Defense-in-depth: no orphan polite live region carrying the old
      // header text was left behind by the unmount (would re-announce).
      const orphans = document.querySelectorAll('[aria-live="polite"]');
      orphans.forEach((node) => {
        expect(
          (node.textContent ?? ""),
          `[${lang}] orphan live region still contains stale announcement`,
        ).not.toContain(header);
      });

      // Dismissal itself must not emit a new toast (another announcement
      // source) — the only sound a screen reader makes is silence.
      expect(toastSpy.mock.calls.length).toBe(toastsBefore);

      cleanup();
      localStorage.setItem("resonance-lang", "en");
    },
  );

  // ── Focus restoration across origins × locales ───────────────────────
  // The dismissServerError() contract is: ALWAYS hand focus back to the
  // TTL number input when present (with a documented fallback to the
  // previously-focused element). That contract has to hold regardless of
  // which control the admin had focus on when the failing Save fired —
  // otherwise keyboard users land somewhere unexpected after dismissing
  // an error they may have triggered from the slider, the audit-log
  // link, or the input itself. We vary the pre-error focus origin across
  // every interactive control in this section and assert the post-dismiss
  // active element is always #ttl-seconds, in every supported locale.
  // Focus workaround for elements that resist a plain .focus() in jsdom
  // (notably Radix slider thumbs). Returns true only when focus is
  // actually parked on the element — callers MUST assert the return value
  // before continuing into a dismiss flow so a silent skip on a single
  // origin × locale combo doesn't pretend to test the contract.
  const forceFocus = (el: HTMLElement): boolean => {
    if (!el) return false;
    if (el.tabIndex < 0) el.tabIndex = 0;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return true;
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  };

  it("forceFocus returns false when an element refuses focus in jsdom", () => {
    const el = document.createElement("div");
    el.tabIndex = -1;
    // Override focus so jsdom cannot park activeElement on this node,
    // simulating a Radix slider thumb (or any non-focusable control)
    // that resists focus in the test environment.
    el.focus = () => { /* no-op */ };
    const result = forceFocus(el);
    expect(result).toBe(false);
    expect(document.activeElement).not.toBe(el);
  });

  const FOCUS_ORIGINS: Array<{ id: string; pick: () => HTMLElement }> = [
    { id: "save-button",    pick: () => getSaveButton() },
    { id: "ttl-input",      pick: () => getSecondsInput() },
    { id: "slider",         pick: () => document.querySelector('[aria-label="Signed URL TTL in seconds"]') as HTMLElement },
    { id: "audit-log-link", pick: () => screen.getByRole("link",   { name: /view signed-url audit log/i }) },
  ];
  const FOCUS_LOCALES = ["af", "es", "fr", "de"] as const;

  it.each(
    FOCUS_LOCALES.flatMap((lang) =>
      FOCUS_ORIGINS.map((origin) => ({ lang, origin })),
    ),
  )(
    "restores focus to #ttl-seconds after keyboard dismissal regardless of pre-error focus origin (lang=$lang, origin=$origin.id)",
    async ({ lang, origin }) => {
      localStorage.setItem("resonance-lang", lang);
      const { I18nProvider } = await import("@/lib/i18n");
      const { fireEvent } = await import("@testing-library/react");

      upsertSpy.mockResolvedValue({
        data: null,
        error: {
          message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
          hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
          details: "Failing row contains (signed_url_ttl_seconds, 30).",
          code: "23514",
        },
      });

      const user = userEvent.setup();
      render(
        <I18nProvider>
          <MemoryRouter>
            <AdminSignedUrlTtlSection />
          </MemoryRouter>
        </I18nProvider>,
      );
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      // Give the input a value the field-classifier accepts, then move
      // focus onto the origin under test BEFORE Save is invoked so the
      // dismiss handler's preErrorFocusRef captures the origin — proving
      // the "always #ttl-seconds" path overrides that fallback.
      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());

      const originEl = origin.pick();
      // Use forceFocus so non-button controls (e.g. Radix slider thumbs)
      // that resist a plain .focus() in jsdom are reliably parked. Hard
      // assert document.activeElement matches BEFORE firing the dismiss
      // flow — a silent skip here would mean the "always #ttl-seconds"
      // contract is being claimed for an origin we never actually parked
      // focus on, hiding cross-locale flakiness.
      const originFocused = forceFocus(originEl);
      expect(
        originFocused,
        `[${lang}/${origin.id}] forceFocus parked focus on origin (active=${(document.activeElement as HTMLElement)?.id || (document.activeElement as HTMLElement)?.getAttribute?.("aria-label") || document.activeElement?.tagName})`,
      ).toBe(true);
      expect(
        document.activeElement,
        `[${lang}/${origin.id}] document.activeElement === origin before Save`,
      ).toBe(originEl);

      // Drive Save by clicking the button directly — pressing Enter on
      // the input would move focus back to it and defeat the
      // origin-under-test setup.
      getSaveButton().click();
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      const alert = await screen.findByRole("alert");
      expect(alert.id).toBe("ttl-seconds-server-error");

      // Keyboard dismissal — focus the dismiss button (proves it's
      // keyboard-reachable), confirm keydown[Enter] reaches it, then
      // perform the spec-defined native button activation.
      const dismiss = screen.getByRole("button", { name: /dismiss server error/i });
      dismiss.focus();
      expect(document.activeElement).toBe(dismiss);
      let keydownSeen = false;
      const probe = (e: KeyboardEvent) => { if (e.key === "Enter") keydownSeen = true; };
      dismiss.addEventListener("keydown", probe);
      fireEvent.keyDown(dismiss, { key: "Enter", code: "Enter" });
      dismiss.removeEventListener("keydown", probe);
      expect(keydownSeen, `[${lang}/${origin.id}] keydown reached dismiss`).toBe(true);
      dismiss.click();

      await waitFor(() => {
        expect(document.getElementById("ttl-seconds-server-error")).toBeNull();
      });

      // Post-dismiss: focus is consistently on the TTL input for every
      // origin × every locale — this is the contract.
      assertTtlInputFocused(`${lang}/${origin.id} originFocused=${originFocused}`);

      cleanup();
      localStorage.setItem("resonance-lang", "en");
    },
  );

  // ── Space-key activation parity ──────────────────────────────────────
  // Native <button type="button"> activates on BOTH Enter and Space when
  // focused. The Enter path is exercised above; this test pins the Space
  // path so a future refactor that swaps the dismiss control for a
  // <div role="button"> (which would have to wire Space manually) or
  // wires onKeyDown for Enter only is caught.
  //
  // Per locale we assert:
  //   1. keydown[Space] reaches the focused dismiss button (it's not
  //      swallowed by an ancestor handler — e.g. dialog scroll-lock).
  //   2. Activation removes the live region from the DOM so the
  //      announcement source is gone and SR users stop hearing it.
  //   3. No orphan polite live region keeps the localized header text.
  //   4. The dismissal itself emits no replacement toast (silence after).
  it.each(ANNOUNCEMENT_LOCALES)(
    "Space on the focused dismiss button removes the live region and stops the announcement (lang=$lang, %#)",
    async ({ lang, header }) => {
      localStorage.setItem("resonance-lang", lang);
      const { I18nProvider } = await import("@/lib/i18n");
      const { fireEvent } = await import("@testing-library/react");

      const error = {
        message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
        hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
        details: "Failing row contains (signed_url_ttl_seconds, 30).",
        code: "23514",
      };
      upsertSpy.mockResolvedValue({ data: null, error });

      const user = userEvent.setup();
      render(
        <I18nProvider>
          <MemoryRouter>
            <AdminSignedUrlTtlSection />
          </MemoryRouter>
        </I18nProvider>,
      );
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
      await user.click(getSaveButton());
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      // ── Pre-dismiss: the live region is present and announcing ────────
      const alert = await screen.findByRole("alert");
      expect(alert.id).toBe("ttl-seconds-server-error");
      const announcedBefore = (() => {
        const clone = alert.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("button").forEach((b) => b.remove());
        return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      })();
      expect(
        announcedBefore,
        `[${lang}] localized header present before Space-dismiss`,
      ).toContain(header);

      // ── Space-key dismissal ───────────────────────────────────────────
      // Focus first (proves the control is keyboard-reachable as a real
      // <button>, not display:none / tabindex=-1), then verify
      // keydown[" "] is observable on the focused button, then perform
      // the spec-defined native button activation (HTMLButtonElement.click
      // — what Space does on a focused native <button>). jsdom's
      // synthetic keyboard doesn't chain Space into a click, so we drive
      // both halves explicitly.
      const dismiss = screen.getByRole("button", { name: /dismiss server error/i });
      const toastsBefore = toastSpy.mock.calls.length;
      dismiss.focus();
      expect(document.activeElement).toBe(dismiss);

      let spaceDownSeen = false;
      const probe = (e: KeyboardEvent) => {
        // Browsers expose Space as key=" " / code="Space". Accept either
        // so we don't pin on a single jsdom quirk.
        if (e.key === " " || e.code === "Space") spaceDownSeen = true;
      };
      dismiss.addEventListener("keydown", probe);
      fireEvent.keyDown(dismiss, { key: " ", code: "Space" });
      dismiss.removeEventListener("keydown", probe);
      expect(
        spaceDownSeen,
        `[${lang}] keydown[Space] reached the focused dismiss button`,
      ).toBe(true);

      // Spec-equivalent activation for a focused native <button>.
      dismiss.click();

      // ── Post-dismiss: live region GONE, no orphan, no new toast ──────
      await waitFor(() => {
        expect(document.getElementById("ttl-seconds-server-error")).toBeNull();
      });
      expect(screen.queryByRole("alert")).toBeNull();

      const orphans = document.querySelectorAll('[aria-live="polite"]');
      orphans.forEach((node) => {
        expect(
          node.textContent ?? "",
          `[${lang}] orphan live region still announcing after Space`,
        ).not.toContain(header);
      });

      // Silence: dismissal must not emit another announcement source.
      expect(
        toastSpy.mock.calls.length,
        `[${lang}] Space-dismiss must not emit a replacement toast`,
      ).toBe(toastsBefore);

      // And focus is restored to #ttl-seconds — same contract as Enter,
      // re-asserted here so this test stands on its own.
      assertTtlInputFocused(`${lang}/Space-dismiss`);

      cleanup();
      localStorage.setItem("resonance-lang", "en");
    },
  );

  // ── Focus restoration reliability across keys × locales ──────────────
  // Cross-cuts the Enter and Space dismissal paths against every
  // supported locale and asserts that AFTER the live region has actually
  // unmounted, document.activeElement settles on #ttl-seconds — not on
  // the now-removed dismiss button (which would silently fall back to
  // <body>) and not on a stale node retained by a slow rAF.
  //
  // We poll for both (a) the unmount and (b) the focus landing, so a
  // regression where focus is set BEFORE unmount completes (and then
  // gets stolen by the unmount blurring its descendants) is caught.
  const DISMISS_KEYS = [
    { name: "Enter", key: "Enter", code: "Enter" },
    { name: "Space", key: " ",     code: "Space" },
  ] as const;

  it.each(
    ANNOUNCEMENT_LOCALES.flatMap((loc) =>
      DISMISS_KEYS.map((k) => ({ ...loc, keyName: k.name, key: k.key, code: k.code })),
    ),
  )(
    "focus reliably returns to #ttl-seconds after live-region unmount (lang=$lang, key=$keyName)",
    async ({ lang, key, code, keyName }) => {
      localStorage.setItem("resonance-lang", lang);
      const { I18nProvider } = await import("@/lib/i18n");
      const { fireEvent } = await import("@testing-library/react");

      upsertSpy.mockResolvedValue({
        data: null,
        error: {
          message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
          hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
          details: "Failing row contains (signed_url_ttl_seconds, 30).",
          code: "23514",
        },
      });

      const user = userEvent.setup();
      render(
        <I18nProvider>
          <MemoryRouter>
            <AdminSignedUrlTtlSection />
          </MemoryRouter>
        </I18nProvider>,
      );
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
      await user.click(getSaveButton());
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      const alert = await screen.findByRole("alert");
      expect(alert.id).toBe("ttl-seconds-server-error");

      // Focus the dismiss button via the keyboard path, observe the
      // chosen keydown reach it, then perform the spec-defined native
      // activation (Enter and Space both fire click on a focused
      // <button> per HTML spec — jsdom's synthetic keyboard doesn't
      // chain, so we drive the click explicitly).
      const dismiss = screen.getByRole("button", { name: /dismiss server error/i });
      dismiss.focus();
      expect(document.activeElement).toBe(dismiss);

      let keySeen = false;
      const probe = (e: KeyboardEvent) => {
        if (e.key === key || e.code === code) keySeen = true;
      };
      dismiss.addEventListener("keydown", probe);
      fireEvent.keyDown(dismiss, { key, code });
      dismiss.removeEventListener("keydown", probe);
      expect(keySeen, `[${lang}/${keyName}] keydown reached focused dismiss`).toBe(true);
      dismiss.click();

      // ── Step 1: live region actually unmounts ─────────────────────────
      // We poll on the DOM (not just the React tree) so the assertion
      // can't pass against a still-present alert that React happens to
      // have re-rendered between event ticks.
      await waitFor(() => {
        expect(document.getElementById("ttl-seconds-server-error")).toBeNull();
      });

      // ── Step 2: focus settles on #ttl-seconds AFTER the unmount ──────
      // Some implementations schedule the focus restoration in a
      // microtask / rAF so it sequences AFTER the unmount blurs the
      // removed dismiss button. Polling here catches the race in which
      // focus is restored *before* unmount (and then snatched back to
      // <body> when the dismiss button is removed).
      await waitFor(() => {
        assertTtlInputFocused(`${lang}/${keyName}`);
      });

      // ── Step 3: focus is stable — doesn't bounce off in a follow-up tick ─
      // Yield once more to flush any pending microtasks/rAF and confirm
      // the focus didn't tear down to <body> right after landing.
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(
        document.activeElement?.id,
        `[${lang}/${keyName}] focus stable on #ttl-seconds across a tick`,
      ).toBe("ttl-seconds");

      // And the focused element is editable — proves we landed on the
      // input itself, not a wrapper that merely shares the id.
      expect((document.activeElement as HTMLInputElement).tagName).toBe("INPUT");

      cleanup();
      localStorage.setItem("resonance-lang", "en");
    },
  );

  // ── Empty / whitespace-only SQLSTATE handling in the live region ─────
  // captureTtlServerError() treats blank `code` strings as absent — so
  // both the toast and the inline panel must omit the "SQLSTATE" label
  // entirely, not render "SQLSTATE " followed by nothing (which a screen
  // reader would announce as a dangling label).
  //
  // Mirrors the toast/panel parity test in ttlMessages but pins the
  // live-region announcement directly, in every supported locale, for
  // each "blank" variant Postgres might surface (truly empty, single
  // space, tab+newline, all-whitespace).
  const BLANK_CODES: Array<{ kind: string; code: string }> = [
    { kind: "empty",        code: ""        },
    { kind: "single-space", code: " "       },
    { kind: "tab+newline",  code: "\t\n"    },
    { kind: "mixed-ws",     code: "  \t \n" },
  ];

  it.each(
    ANNOUNCEMENT_LOCALES.flatMap((loc) =>
      BLANK_CODES.map((bc) => ({ ...loc, kind: bc.kind, blankCode: bc.code })),
    ),
  )(
    "omits SQLSTATE label and code in the live region when code is $kind (lang=$lang)",
    async ({ lang, header, hint, details, code, kind, blankCode }) => {
      localStorage.setItem("resonance-lang", lang);
      const { I18nProvider } = await import("@/lib/i18n");

      const error = {
        message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
        hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
        details: "Failing row contains (signed_url_ttl_seconds, 30).",
        code: blankCode,
      };
      upsertSpy.mockResolvedValue({ data: null, error });

      const user = userEvent.setup();
      render(
        <I18nProvider>
          <MemoryRouter>
            <AdminSignedUrlTtlSection />
          </MemoryRouter>
        </I18nProvider>,
      );
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());
      await user.click(getSaveButton());
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      const alert = await screen.findByRole("alert");
      expect(alert.id).toBe("ttl-seconds-server-error");

      // Compute the announced text exactly as a screen reader would
      // hear it: textContent with chrome (dismiss button) stripped and
      // whitespace collapsed.
      const announced = (() => {
        const clone = alert.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("button").forEach((b) => b.remove());
        return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      })();

      // ── Sanity: the rest of the announcement still rendered ───────────
      // (so a regression that makes a blank `code` collapse the WHOLE
      // panel — not just the SQLSTATE row — is caught here, not silently
      // passed.)
      expect(announced, `[${lang}/${kind}] localized header present`).toContain(header);
      expect(announced, `[${lang}/${kind}] hint label present`).toContain(hint);
      expect(announced, `[${lang}/${kind}] details label present`).toContain(details);
      expect(announced, `[${lang}/${kind}] message body present`).toContain(error.message);

      // ── The SQLSTATE label MUST NOT appear ────────────────────────────
      // (locale-invariant string — same check fires in every language).
      expect(
        announced,
        `[${lang}/${kind}] SQLSTATE label leaked into announcement`,
      ).not.toContain(code); // `code` from ANNOUNCEMENT_LOCALES = "SQLSTATE"

      // Defense-in-depth: the *DOM* shouldn't carry the label either —
      // a hidden-but-present "SQLSTATE" node would still be picked up by
      // some screen readers in browse mode.
      const labelNodes = Array.from(alert.querySelectorAll("*")).filter((el) =>
        (el.textContent ?? "").trim() === "SQLSTATE",
      );
      expect(
        labelNodes.length,
        `[${lang}/${kind}] SQLSTATE label rendered as a DOM node despite blank code`,
      ).toBe(0);

      // And the raw blank value must not be announced either — no
      // "SQLSTATE  " with trailing whitespace, no orphaned colon, etc.
      // (We can't assert .not.toContain("") meaningfully, so we instead
      // pin the absence of common dangling-label artefacts.)
      expect(announced, `[${lang}/${kind}] no "SQLSTATE:" with empty code`)
        .not.toMatch(/SQLSTATE\s*:?\s*$/);
      expect(announced, `[${lang}/${kind}] no "SQLSTATE  message" wedge`)
        .not.toMatch(/SQLSTATE\s{2,}/);

      cleanup();
      localStorage.setItem("resonance-lang", "en");
    },
  );

  // ── Fallback focus path when #ttl-seconds is not in the DOM ──────────
  // dismissServerError() is documented as:
  //   (ttlInput ?? preErrorFocusRef.current)?.focus()
  // i.e. prefer the TTL input, fall back to whichever element held focus
  // immediately before the server error surfaced. This test exercises
  // the fallback branch by deleting #ttl-seconds from the DOM *after*
  // the panel mounts (so preErrorFocusRef has captured the origin) and
  // *before* the dismiss click runs (so getElementById returns null at
  // the moment dismissServerError fires).
  //
  // React will reconcile the input back on the next render, but the
  // focus() inside the handler is synchronous — it sees the null and
  // takes the fallback. We then assert focus lands on the origin
  // element that was active when the error surfaced.
  //
  // Cross-cuts every locale × every realistic origin (Save button,
  // audit-log link, AND the Radix slider thumb). The slider needs a
  // focus workaround in jsdom: Radix renders it with role="slider"
  // tabindex="0", but its own pointer-event handlers can swallow the
  // .focus() call. We force the focus by (a) ensuring tabindex is 0
  // (defensive — Radix already sets it), (b) calling .focus({preventScroll}),
  // and (c) if document.activeElement still isn't it, dispatching a
  // synthetic focusin and re-asserting; if jsdom still won't park focus
  // there, we hard-fail with a precise message so the limitation is
  // visible rather than silently skipped.
  const FALLBACK_ORIGINS: Array<{ id: string; pick: () => HTMLElement }> = [
    { id: "save-button",    pick: () => getSaveButton() },
    { id: "audit-log-link", pick: () => screen.getByRole("link", { name: /view signed-url audit log/i }) },
    { id: "slider-thumb",   pick: () => document.querySelector('[aria-label="Signed URL TTL in seconds"]') as HTMLElement },
  ];

  // forceFocus is hoisted above FOCUS_ORIGINS for the input-restoration
  // suite; reuse the same helper here so both suites share identical
  // focus-parking semantics.


  it.each(
    ANNOUNCEMENT_LOCALES.flatMap((loc) =>
      FALLBACK_ORIGINS.map((origin) => ({ lang: loc.lang, origin })),
    ),
  )(
    "falls back to the pre-error focus when #ttl-seconds is missing (lang=$lang, origin=$origin.id)",
    async ({ lang, origin }) => {
      localStorage.setItem("resonance-lang", lang);
      const { I18nProvider } = await import("@/lib/i18n");

      upsertSpy.mockResolvedValue({
        data: null,
        error: {
          message: "signed_url_ttl_seconds must be between 60 and 3600 (got 30)",
          hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
          details: "Failing row contains (signed_url_ttl_seconds, 30).",
          code: "23514",
        },
      });

      const user = userEvent.setup();
      render(
        <I18nProvider>
          <MemoryRouter>
            <AdminSignedUrlTtlSection />
          </MemoryRouter>
        </I18nProvider>,
      );
      await waitFor(() => expect(getSecondsInput().value).toBe("900"));

      // Type a valid value, park focus on the origin under test so
      // preErrorFocusRef captures it, then drive Save via .click() (Enter
      // on the input would move focus back to the input and defeat the
      // setup).
      const input = getSecondsInput();
      await user.clear(input);
      await user.type(input, "1200");
      await waitFor(() => expect(getSaveButton()).not.toBeDisabled());

      const originEl = origin.pick();
      const focused = forceFocus(originEl);
      expect(
        focused,
        `[${lang}/${origin.id}] forceFocus parked focus on origin (active=${(document.activeElement as HTMLElement)?.id || (document.activeElement as HTMLElement)?.getAttribute?.("aria-label") || document.activeElement?.tagName})`,
      ).toBe(true);
      expect(
        document.activeElement,
        `[${lang}/${origin.id}] origin focused before Save`,
      ).toBe(originEl);

      getSaveButton().click();
      await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

      const alert = await screen.findByRole("alert");
      expect(alert.id).toBe("ttl-seconds-server-error");

      // ── Detach #ttl-seconds from the DOM, then dismiss ────────────────
      // React still owns the input internally; .remove() detaches it
      // from the live tree so getElementById returns null at the moment
      // dismissServerError() runs. The fallback branch must then fire.
      const inputBeforeDismiss = document.getElementById("ttl-seconds");
      expect(inputBeforeDismiss, "TTL input present before forced removal").toBeTruthy();
      inputBeforeDismiss!.remove();
      expect(document.getElementById("ttl-seconds")).toBeNull();

      const dismiss = screen.getByRole("button", { name: /dismiss server error/i });
      dismiss.focus();
      expect(document.activeElement).toBe(dismiss);
      dismiss.click();

      // The panel unmounts as usual.
      await waitFor(() => {
        expect(document.getElementById("ttl-seconds-server-error")).toBeNull();
      });

      // ── Fallback assertion: focus is on the pre-error origin AND that
      // origin is still connected (helper guarantees both). The shared
      // helper folds in the precise failure descriptor.
      assertFocusRestoredTo(originEl, { scope: `${lang}/${origin.id} fallback` });

      cleanup();
      localStorage.setItem("resonance-lang", "en");
    },
  );
});
