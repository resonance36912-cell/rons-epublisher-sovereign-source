// Verifies the *actual* rendered toast (not the spy) is exposed to
// assistive tech with an appropriate live-region role and that its
// accessible text — parsed via the same shared helper as the inline
// panel — stays in lock-step with the persistent error panel.
//
// All other test files in this folder mock `@/hooks/use-toast` to a
// pure spy so they can assert wording on the call payload. That setup
// is great for label drift but cannot prove that the toast's DOM is
// actually announced. This file deliberately leaves the toast hook
// real and mounts <Toaster /> so the rendered live region is
// inspectable.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  assertSurfaceParity,
  EN_LABELS,
  parsePanelSections,
  parseToastSections,
  normalize,
} from "@/test-utils/admin-surface-parity";

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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "admin-uid" } }, error: null }),
    },
    from: (table: string) => {
      if (table === "app_settings") {
        return makeBuilder({
          data: [
            { key: "signed_url_ttl_seconds", value: 900 },
            { key: "signed_url_ttl_user_override_allowed", value: true },
          ],
          error: null,
        });
      }
      if (table === "app_settings_audit") return makeBuilder({ data: [], error: null, count: 0 });
      return makeBuilder({ data: [], error: null });
    },
  },
}));

import { AdminSignedUrlTtlSection } from "../AdminSignedUrlTtlSection";
import { Toaster } from "@/components/ui/toaster";

const renderWithToaster = () =>
  render(
    <MemoryRouter>
      <AdminSignedUrlTtlSection />
      <Toaster />
    </MemoryRouter>,
  );

beforeEach(() => {
  upsertSpy.mockReset();
  cleanup();
});

describe("AdminSignedUrlTtlSection — toast a11y parity with inline panel", () => {
  it("toast is announced via a live region and its accessible text matches the inline panel", async () => {
    const error = {
      message: "signed_url_ttl_seconds out of range (got 30)",
      hint: "Allowed range is 60s (1 min) to 3600s (1 hour).",
      details: "Failing row contains (signed_url_ttl_seconds, 30).",
      code: "23514",
    };
    upsertSpy.mockResolvedValue({ data: null, error });

    const user = userEvent.setup();
    renderWithToaster();
    const input = (await screen.findByLabelText(/^Seconds$/i)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("900"));
    await user.clear(input);
    await user.type(input, "1200");
    const save = screen.getByRole("button", { name: /^Save$/i });
    await waitFor(() => expect(save).not.toBeDisabled());
    await user.click(save);
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));

    // 1. The inline panel exists and renders as role="alert".
    const panel = await screen.findByRole("alert");
    expect(panel.id).toBe("ttl-seconds-server-error");

    // 2. The toast renders into the DOM (not just the spy). Find the toast
    //    title element, then walk up to the Radix Toast root that carries
    //    the live-region attributes.
    const toastTitle = await screen.findByText("Failed to save");
    const toastRoot = toastTitle.closest("[role='status'], [role='alert']") as HTMLElement | null;
    expect(toastRoot).not.toBeNull();

    // 3. The toast root is a real live region. Radix Toast emits one of
    //    {status, alert} with {polite, assertive} depending on `type`
    //    (foreground default → status/polite for sonner-style behaviour).
    //    Accept either pairing — the contract is "is a live region",
    //    not "uses this exact pairing".
    const role = toastRoot!.getAttribute("role");
    const live = toastRoot!.getAttribute("aria-live");
    expect(["status", "alert"]).toContain(role);
    expect(["polite", "assertive", "off"]).toContain(live);
    // `aria-atomic` should be present so SR clients announce the whole
    // toast (title + description) as a single utterance rather than just
    // the changed text node.
    expect(toastRoot!.getAttribute("aria-atomic")).toBe("true");

    // 4. Parse both surfaces from accessible text and assert parity. We
    //    extract the toast's description text (the part after the title)
    //    so the parser sees the same MESSAGE / HINT / DETAILS / SQLSTATE
    //    payload the panel emits.
    const titleEl = within(toastRoot!).getByText("Failed to save");
    // The ToastDescription sibling holds the body. It's the next element
    // in the title's parent grid.
    const descEl = titleEl.parentElement?.querySelector(
      ":scope > :not(:first-child)",
    ) as HTMLElement | null;
    expect(descEl).not.toBeNull();
    const toastAccessibleText = normalize(descEl!.textContent ?? "");

    // 5. Sanity: every localized section label is present in the toast
    //    accessible text (proves the description wasn't stripped or
    //    rendered as an icon-only summary).
    for (const token of [EN_LABELS.hint, EN_LABELS.details, EN_LABELS.code]) {
      expect(toastAccessibleText).toContain(token);
    }

    // 6. Structured parity — same parser, same assertion the inline panel
    //    self-tests use. Any drift surfaces as a per-section diff rather
    //    than a vague string mismatch.
    const { panelSections, toastSections } = assertSurfaceParity(
      toastAccessibleText,
      panel,
    );
    expect(panelSections.map((s) => s.body)).toEqual(
      toastSections.map((s) => s.body),
    );
    expect(toastSections.find((s) => s.label === "MESSAGE")?.body).toBe(error.message);
    expect(toastSections.find((s) => s.label === "HINT")?.body).toBe(error.hint);
    expect(toastSections.find((s) => s.label === "DETAILS")?.body).toBe(error.details);
    expect(toastSections.find((s) => s.label === "SQLSTATE")?.body).toBe(error.code);

    // 7. Cross-check the panel side directly so future refactors can't
    //    accidentally pass parity by emptying both sides.
    const directPanelSections = parsePanelSections(panel, EN_LABELS);
    expect(directPanelSections).toEqual(panelSections);
    const directToastSections = parseToastSections(toastAccessibleText, EN_LABELS);
    expect(directToastSections).toEqual(toastSections);
  });
});
