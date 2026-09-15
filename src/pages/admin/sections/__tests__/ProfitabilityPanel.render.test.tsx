import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { computeProfitability, type ProfitabilityInput } from "../profitabilityMath";
import { makeProfitabilityFixture } from "./fixtures/profitabilityFixture";

// ---------- Large realistic fixture (500 users, mixed SKUs, cost outliers) ----------
const FIXTURE = makeProfitabilityFixture({ seed: 20260703, totalUsers: 500 });

// ---------- Supabase mock ----------
function makeBuilder<T>(data: T[]) {
  const result = Promise.resolve({ data, error: null });
  const builder = {
    select: () => builder,
    gte: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      result.then(resolve, reject),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "profiles") return makeBuilder(FIXTURE.profiles);
      if (table === "purchases") return makeBuilder(FIXTURE.purchases);
      if (table === "api_usage_logs") return makeBuilder(FIXTURE.logs);
      return makeBuilder<never>([]);
    },
  },
}));

import { ProfitabilityPanel } from "../ProfitabilityPanel";

const DEFAULT_FX = 18.5;
const fmt = (n: number) => `R${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const normalizeRenderedText = (value: string | null | undefined) =>
  String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

function expectRowHasText(row: Element, expected: string) {
  const target = normalizeRenderedText(expected);
  const found = Array.from(row.querySelectorAll("td")).some(
    (cell) => normalizeRenderedText(cell.textContent) === target,
  );
  expect(found).toBe(true);
}

function expectedRows(fx: number) {
  const input: ProfitabilityInput = {
    profiles: FIXTURE.profiles,
    purchases: FIXTURE.purchases,
    logs: FIXTURE.logs,
    fxUsdToZar: fx,
    now: FIXTURE.now,
  };
  return computeProfitability(input);
}

const TIER_LABELS = { free: "Free", standard: "Standard", premium: "Premium" } as const;

async function getTierRow(tier: keyof typeof TIER_LABELS) {
  const cell = await screen.findByText(TIER_LABELS[tier]);
  const tr = cell.closest("tr");
  if (!tr) throw new Error(`no <tr> for ${tier}`);
  return tr;
}

beforeEach(() => cleanup());

describe("ProfitabilityPanel — render parity with computeProfitability (large fixture)", () => {
  it("has a fixture with realistic scale and shape", () => {
    // Sanity guards so a future regression in the generator surfaces here first.
    expect(FIXTURE.profiles.length).toBe(500);
    expect(FIXTURE.purchases.length).toBeGreaterThan(150);
    expect(FIXTURE.logs.some((l) => l.user_id === null)).toBe(true); // orphan logs present
    expect(FIXTURE.logs.some((l) => (l.cost_estimate ?? 0) > 15)).toBe(true); // cost outlier present

    const rows = expectedRows(DEFAULT_FX);
    const paying = rows.filter((r) => r.tier !== "free").reduce((a, r) => a + r.users, 0);
    expect(paying).toBeGreaterThan(80); // ~32% of 500
    expect(rows.find((r) => r.tier === "premium")!.users).toBeGreaterThan(0);
    expect(rows.find((r) => r.tier === "standard")!.users).toBeGreaterThan(0);
  });

  it("renders per-tier values matching the pure math for every tier", async () => {
    render(<ProfitabilityPanel />);
    await screen.findByRole("table");

    for (const r of expectedRows(DEFAULT_FX)) {
      const tr = await getTierRow(r.tier);
      const utils = within(tr);
      const cells = tr.querySelectorAll("td");
      expect(cells[1].textContent).toBe(String(r.users));
      expectRowHasText(tr, fmt(r.revenueZar));
      expectRowHasText(tr, fmt(r.costZar));
      expectRowHasText(tr, fmt(r.payfastZar));
      expectRowHasText(tr, fmt(r.costPerUserZar));
      expectRowHasText(tr, fmt(r.marginZar));
      if (r.revenueZar > 0) {
        expect(utils.getByText(`${r.marginPct.toFixed(1)}%`)).toBeInTheDocument();
      } else {
        expect(utils.getByText("—")).toBeInTheDocument();
      }
    }
  });

  it("renders totals card values matching the summed rows", async () => {
    render(<ProfitabilityPanel />);
    await screen.findByRole("table");

    const rows = expectedRows(DEFAULT_FX);
    const totalUsers = rows.reduce((a, r) => a + r.users, 0);
    const totalRevenue = rows.reduce((a, r) => a + r.revenueZar, 0);
    const totalCost = rows.reduce((a, r) => a + r.costZar + r.payfastZar, 0);
    const totalMargin = totalRevenue - totalCost;

    const findStat = (label: string) => {
      const labelEl = screen
        .getAllByText(label)
        .find((el) => el.className.includes("text-[11px]"));
      if (!labelEl?.parentElement) throw new Error(`no stat card for ${label}`);
      return labelEl.parentElement.querySelector("p")?.textContent ?? "";
    };

    expect(findStat("Users")).toBe(String(totalUsers));
    expect(findStat("Revenue (30d)")).toBe(fmt(totalRevenue));
    expect(findStat("Cost (API + fees)")).toBe(fmt(totalCost));
    expect(findStat("Net Margin")).toBe(fmt(totalMargin));
  });

  it("recomputes every cost, payfast and margin cell for every tier when FX changes", async () => {
    render(<ProfitabilityPanel />);
    await screen.findByRole("table");

    // Baseline snapshot at default FX.
    const baseline = expectedRows(DEFAULT_FX);
    for (const r of baseline) {
      const tr = await getTierRow(r.tier);
      expectRowHasText(tr, fmt(r.costZar));
    }

    // Two distinct FX rates so we prove the panel re-renders on each change,
    // not that it happened to match a stale value.
    for (const fxRate of [25, 12.5]) {
      const fxInput = screen.getByLabelText(/USD.*ZAR/i);
      fireEvent.change(fxInput, { target: { value: String(fxRate) } });

      const after = expectedRows(fxRate);

      // Sanity: at these FX rates every paid tier's cost/margin must differ from baseline.
      for (const r of after.filter((row) => row.tier !== "free" && row.costZar > 0)) {
        const prev = baseline.find((b) => b.tier === r.tier)!;
        expect(r.costZar).not.toBeCloseTo(prev.costZar, 2);
        expect(r.marginZar).not.toBeCloseTo(prev.marginZar, 2);
      }

      await waitFor(() => {
        for (const r of after) {
          const tr = screen.getByText(TIER_LABELS[r.tier]).closest("tr")!;
          const utils = within(tr);
          // Cost / user
          expectRowHasText(tr, fmt(r.costPerUserZar));
          // API Cost
          expectRowHasText(tr, fmt(r.costZar));
          // Payfast (unchanged by FX but still asserted to guard against re-render bugs)
          expectRowHasText(tr, fmt(r.payfastZar));
          // Margin
          expectRowHasText(tr, fmt(r.marginZar));
          // Margin %
          if (r.revenueZar > 0) {
            expect(utils.getByText(`${r.marginPct.toFixed(1)}%`)).toBeInTheDocument();
          }
        }
      });

      // Totals card also updates for the new FX.
      const rows = after;
      const totalCost = rows.reduce((a, x) => a + x.costZar + x.payfastZar, 0);
      const totalRevenue = rows.reduce((a, x) => a + x.revenueZar, 0);
      const totalMargin = totalRevenue - totalCost;

      const findStat = (label: string) => {
        const el = screen
          .getAllByText(label)
          .find((e) => e.className.includes("text-[11px]"))!;
        return el.parentElement!.querySelector("p")!.textContent!;
      };
      expect(findStat("Cost (API + fees)")).toBe(fmt(totalCost));
      expect(findStat("Net Margin")).toBe(fmt(totalMargin));
    }
  });
});

