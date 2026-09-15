/**
 * Test harness route — mounts <AdminStorageSection /> in isolation so
 * Playwright can verify the admin storage panel renders the list returned
 * by the admin-storage edge function, without traversing the real /admin
 * auth + role-check flow.
 *
 * Only registered in dev builds (gated in App.tsx). The admin-storage
 * edge function and all other admin REST calls must be stubbed by the test
 * via page.route(). The AdminProvider receives isAdmin={true} directly.
 */
import { useEffect, useState } from "react";
import { AdminProvider } from "@/pages/admin/AdminContext";
import { AdminStorageSection } from "@/pages/admin/sections/AdminStorageSection";

export default function AdminStorageHarness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Give the provider's initial fetch effects one tick to fire.
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div data-testid="admin-storage-harness" data-ready={ready ? "true" : "false"}>
      <AdminProvider isAdmin={true}>
        <div className="container px-4 py-8 space-y-6">
          <AdminStorageSection />
        </div>
      </AdminProvider>
    </div>
  );
}
