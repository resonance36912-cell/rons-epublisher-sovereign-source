/**
 * Test harness route — mounts <AdminSignedUrlTtlSection /> in isolation so
 * Playwright can drive the server-error inline panel + dismiss flow without
 * traversing the real /admin auth + role-check flow.
 *
 * Only registered in dev builds (gated in App.tsx). The section uses the
 * Supabase client directly; the spec stubs every /rest/v1/* + /auth/v1/*
 * request via page.route() so the run is hermetic.
 *
 * I18n + Toaster are already provided by the top-level App shell, so we
 * just render the section and expose a small ready flag for the test.
 */
import { useEffect, useState } from "react";
import { AdminSignedUrlTtlSection } from "@/pages/admin/sections/AdminSignedUrlTtlSection";

export default function AdminTtlServerErrorHarness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      data-testid="admin-ttl-server-error-harness"
      data-ready={ready ? "true" : "false"}
    >
      <div className="container px-4 py-8 space-y-6">
        <AdminSignedUrlTtlSection />
      </div>
    </div>
  );
}
