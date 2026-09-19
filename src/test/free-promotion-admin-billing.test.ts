import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";

describe("residual admin billing removal", () => {
  it("keeps the suite-wide free promotion active", () => {
    expect(FREE_PROMOTION_ACTIVE).toBe(true);
  });

  it("does not ship the active credit-pack catalog editor", () => {
    const admin = readFileSync(resolve(process.cwd(), "src/pages/Admin.tsx"), "utf8");
    expect(admin).not.toContain("AdminCreditPacksManager");
    expect(existsSync(resolve(process.cwd(), "src/pages/admin/sections/AdminCreditPacksManager.tsx"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/lib/credit-packs.ts"))).toBe(false);
  });

  it("retains payment records as read-only historical audit data", () => {
    const payments = readFileSync(
      resolve(process.cwd(), "src/pages/admin/sections/AdminPaymentsSection.tsx"),
      "utf8",
    );
    const packAudit = readFileSync(
      resolve(process.cwd(), "src/pages/admin/sections/AdminCreditPacksAuditLog.tsx"),
      "utf8",
    );

    expect(payments).toContain("Historical payment audit");
    expect(payments).toContain("Read-only");
    expect(packAudit).toContain("Historical credit-pack audit log");
    expect(packAudit).toContain("Read-only");
  });
});
