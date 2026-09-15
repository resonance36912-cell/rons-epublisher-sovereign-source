import { Loader2, RefreshCw, CreditCard, DollarSign, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "../AdminContext";

export function AdminPaymentsSection() {
  const { profiles, payments, paymentsLoading, fetchPayments } = useAdmin();

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Payfast Payments</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{payments.length} records</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchPayments} disabled={paymentsLoading}>
            <RefreshCw className={`w-4 h-4 ${paymentsLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!paymentsLoading && payments.length > 0 && (() => {
        const purchases = payments.filter(p => p.amount_total > 0);
        const totalRevenue = purchases.reduce((s, p) => s + p.amount_total, 0);
        const uniqueBuyers = new Set(purchases.map(p => p.user_id)).size;
        return (
          <div className="px-6 py-4 border-b grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold">R {(totalRevenue / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">Total Revenue</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold">{purchases.length}</p>
                <p className="text-xs text-muted-foreground">Purchases</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold">{uniqueBuyers}</p>
                <p className="text-xs text-muted-foreground">Unique Buyers</p>
              </div>
            </div>
          </div>
        );
      })()}

      {paymentsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : payments.length === 0 ? (
        <div className="px-6 py-12 text-center text-muted-foreground text-sm">No payments recorded yet.</div>
      ) : (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Product</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Env</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map(p => {
                const profile = profiles.find(pr => pr.user_id === p.user_id);
                const displayName = profile?.full_name || profile?.email || p.user_id.slice(0, 8) + "…";
                return (
                  <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {p.created_at ? new Date(p.created_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-4 py-2.5 max-w-[180px] truncate" title={p.user_id}>{displayName}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {p.price_id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {p.amount_total > 0 ? `R ${(p.amount_total / 100).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium ${p.environment === "live" ? "text-green-500" : "text-muted-foreground"}`}>
                        {p.environment}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-[120px]" title={p.stripe_session_id}>
                      {p.stripe_session_id.slice(0, 12)}…
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
