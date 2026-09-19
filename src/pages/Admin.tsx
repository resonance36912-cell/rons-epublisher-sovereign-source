import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useIsAdmin } from "@/hooks/use-admin";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AdminCouponManager } from "@/components/storyforge/AdminCouponManager";
import { CouponAnalytics } from "@/components/storyforge/CouponAnalytics";
import { AdminAddonCreditsPanel } from "@/components/storyforge/AdminAddonCreditsPanel";
import { AdminQaCreditsGrant } from "@/components/storyforge/AdminQaCreditsGrant";
import resonanceLogo from "@/assets/resonance-logo.png";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { AdminProvider, useAdmin } from "./admin/AdminContext";
import { formatBytes } from "./admin/types";
import { AdminStatsHeader } from "./admin/sections/AdminStatsHeader";
import { AdminApiUsageSection } from "./admin/sections/AdminApiUsageSection";
import { AdminCostSection } from "./admin/sections/AdminCostSection";
import { AdminStorageSection } from "./admin/sections/AdminStorageSection";
import { AdminStorageAccessLogsSection } from "./admin/sections/AdminStorageAccessLogsSection";
import { AdminSignedUrlTtlSection } from "./admin/sections/AdminSignedUrlTtlSection";
import { AdminSignedUrlTesterSection } from "./admin/sections/AdminSignedUrlTesterSection";
import { AdminTablesSection } from "./admin/sections/AdminTablesSection";
import { AdminPaymentsSection } from "./admin/sections/AdminPaymentsSection";
import { AdminSttDiagnosticsSection } from "./admin/sections/AdminSttDiagnosticsSection";
import { AdminProviderRoutingAudit } from "./admin/sections/AdminProviderRoutingAudit";
import { AdminEmbedFailuresSection } from "./admin/sections/AdminEmbedFailuresSection";
import { AdminEmbedRetriesSection } from "./admin/sections/AdminEmbedRetriesSection";
import { AdminSecurityScanSection } from "./admin/sections/AdminSecurityScanSection";
import { AdminAiAttemptsSection } from "./admin/sections/AdminAiAttemptsSection";
import { ProfitabilityPanel } from "./admin/sections/ProfitabilityPanel";
import { AdminHubCatalogProbe } from "./admin/sections/AdminHubCatalogProbe";
import { AdminAuthOriginsChecklist } from "./admin/sections/AdminAuthOriginsChecklist";
import { AdminPreviewRedirectChecklist } from "./admin/sections/AdminPreviewRedirectChecklist";
import { AdminCreditPacksAuditLog } from "./admin/sections/AdminCreditPacksAuditLog";
import { AdminWebhookLogsSection } from "./admin/sections/AdminWebhookLogsSection";

export default function Admin() {
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate("/admin/login", { replace: true });
    }
  }, [isAdmin, roleLoading, navigate]);

  if (roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <AdminProvider isAdmin={isAdmin}>
      <AdminInner />
    </AdminProvider>
  );
}

function AdminInner() {
  const navigate = useNavigate();
  const { profiles, storageFiles, storageTotalSize, confirmDeleteAll, setConfirmDeleteAll, handleDeleteAllStorage } = useAdmin();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-2">
            <img src={resonanceLogo} alt="Resonance ePublisher" width={36} height={36} className="w-9 h-9 object-contain" />
            <span className="font-display text-xl font-semibold gradient-text">Admin Portal</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/app")} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back to App
          </Button>
        </div>
      </header>

      <div className="container px-6 py-8 space-y-8">
        <AdminStatsHeader />
        <ProfitabilityPanel />
        <AdminSecurityScanSection />
        <AdminCouponManager profiles={profiles} />
        <CouponAnalytics profiles={profiles} />
        <AdminAddonCreditsPanel profiles={profiles} />
        <AdminQaCreditsGrant profiles={profiles} />
        <AdminApiUsageSection />
        <AdminAiAttemptsSection />
        <AdminProviderRoutingAudit />
        <AdminCostSection />
        <AdminStorageSection />
        <AdminStorageAccessLogsSection />
        <AdminSignedUrlTtlSection />
        <AdminSignedUrlTesterSection />
        <AdminTablesSection />
        <AdminPaymentsSection />
        <AdminCreditPacksAuditLog />
        <AdminWebhookLogsSection />
        <AdminHubCatalogProbe />
        <AdminAuthOriginsChecklist />
        <AdminPreviewRedirectChecklist />
        <AdminSttDiagnosticsSection />
        <AdminEmbedFailuresSection />
        <AdminEmbedRetriesSection />
      </div>

      <AlertDialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Storage Files</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {storageFiles.length} files ({formatBytes(storageTotalSize)}) from storage. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteAllStorage}
            >
              Delete All Files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
