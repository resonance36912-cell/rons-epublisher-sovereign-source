import { lazy, Suspense, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PremiumOverQuotaDialog } from "@/components/PremiumOverQuotaDialog";
import { Loader2 } from "lucide-react";
import { HubPricingMismatchBanner } from "@/components/HubPricingMismatchBanner";
import { SignInDebugPanel } from "@/components/SignInDebugPanel";
import { AuthSessionSync } from "@/components/AuthSessionSync";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";

// Lazy-loaded routes for code splitting
const Landing = lazy(() => import("./pages/Landing"));
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Auth = lazy(() => import("./pages/Auth"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const PrivacyAccess = lazy(() => import("./pages/PrivacyAccess"));
const Contact = lazy(() => import("./pages/Contact"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const SignedImageRequests = lazy(() => import("./pages/admin/SignedImageRequests"));
const About = lazy(() => import("./pages/About"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const Pricing = lazy(() => import("./pages/Pricing"));
const CheckoutReturn = lazy(() => import("./pages/CheckoutReturn"));
const Billing = lazy(() => import("./pages/Billing"));
const Account = lazy(() => import("./pages/Account"));
const SamplePreview = lazy(() => import("./pages/SamplePreview"));
const SitemapPreview = lazy(() => import("./pages/SitemapPreview"));
// Dev-only test harnesses for Playwright e2e. Tree-shaken in production.
const NarrationHarness = import.meta.env.DEV
  ? lazy(() => import("./pages/__test/NarrationHarness"))
  : null;
const AdminStorageHarness = import.meta.env.DEV
  ? lazy(() => import("./pages/__test/AdminStorageHarness"))
  : null;
const AdminTtlServerErrorHarness = import.meta.env.DEV
  ? lazy(() => import("./pages/__test/AdminTtlServerErrorHarness"))
  : null;
const ExportMatrixHarness = import.meta.env.DEV
  ? lazy(() => import("./pages/__test/ExportMatrixHarness"))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 min
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function HostedRoute({ children }: PropsWithChildren) {
  if (!OPEN_NOVA_LOCAL_ONLY) return children;
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <section className="max-w-xl text-center space-y-4">
        <h1 className="text-3xl font-semibold">Unavailable in sovereign local mode</h1>
        <p className="text-muted-foreground">This account, billing, or administration route depends on hosted services and has been disabled. Your local ePublisher projects remain available in the workspace.</p>
        <a href="/app" className="inline-flex text-primary underline underline-offset-4">Return to ePublisher</a>
      </section>
    </main>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      {!OPEN_NOVA_LOCAL_ONLY && <AuthSessionSync />}
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          {!OPEN_NOVA_LOCAL_ONLY && <HubPricingMismatchBanner />}
          {!OPEN_NOVA_LOCAL_ONLY && <PremiumOverQuotaDialog />}
          {!OPEN_NOVA_LOCAL_ONLY && <SignInDebugPanel />}
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || undefined}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/app" element={<Index />} />
                <Route path="/about" element={<About />} />
                <Route path="/auth" element={<HostedRoute><Auth /></HostedRoute>} />
                <Route path="/auth/callback" element={<HostedRoute><AuthCallback /></HostedRoute>} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/privacy/access" element={<HostedRoute><PrivacyAccess /></HostedRoute>} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/admin" element={<HostedRoute><Admin /></HostedRoute>} />
                <Route path="/admin/signed-image-requests" element={<HostedRoute><SignedImageRequests /></HostedRoute>} />
                <Route path="/admin/login" element={<HostedRoute><AdminLogin /></HostedRoute>} />
                <Route path="/reset-password" element={<HostedRoute><ResetPassword /></HostedRoute>} />
                <Route path="/pricing" element={<HostedRoute><Pricing /></HostedRoute>} />
                <Route path="/checkout/return" element={<HostedRoute><CheckoutReturn /></HostedRoute>} />
                <Route path="/billing" element={<HostedRoute><Billing /></HostedRoute>} />
                <Route path="/account" element={<HostedRoute><Account /></HostedRoute>} />
                <Route path="/samples/:slug" element={<SamplePreview />} />
                <Route path="/sitemap" element={<SitemapPreview />} />
                {NarrationHarness && (
                  <Route path="/__test/narration" element={<NarrationHarness />} />
                )}
                {AdminStorageHarness && (
                  <Route path="/__test/admin-storage" element={<AdminStorageHarness />} />
                )}
                {AdminTtlServerErrorHarness && (
                  <Route
                    path="/__test/admin-ttl-server-error"
                    element={<AdminTtlServerErrorHarness />}
                  />
                )}
                {ExportMatrixHarness && (
                  <Route path="/__test/exports" element={<ExportMatrixHarness />} />
                )}
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
