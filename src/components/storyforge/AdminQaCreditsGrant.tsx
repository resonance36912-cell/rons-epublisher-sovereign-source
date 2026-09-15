import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FlaskConical, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { notifyAddonCreditsChanged } from "@/lib/addon-credits-events";

type Profile = {
  user_id: string;
  email: string | null;
  full_name: string | null;
};

interface Props {
  profiles: Profile[];
}

export function AdminQaCreditsGrant({ profiles }: Props) {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [creditType, setCreditType] = useState<"image" | "tts">("image");
  const [amount, setAmount] = useState<string>("10");
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleReset = async () => {
    setConfirmReset(false);
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-grant-credits", {
        body: { action: "reset_qa" },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const n = (data as any)?.deleted ?? 0;
      toast.success(n === 0 ? "No QA credits to delete" : `Deleted ${n} QA credit row${n === 1 ? "" : "s"}`);
      notifyAddonCreditsChanged();
    } catch (err) {
      toast.error("Failed to reset: " + (err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? profiles.filter(
          (p) =>
            (p.email || "").toLowerCase().includes(q) ||
            (p.full_name || "").toLowerCase().includes(q) ||
            p.user_id.toLowerCase().includes(q),
        )
      : profiles;
    return list.slice(0, 50);
  }, [profiles, search]);

  const handleGrant = async () => {
    if (!selectedUserId) {
      toast.error("Pick a target user");
      return;
    }
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error("Amount must be a positive integer");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-grant-credits", {
        body: {
          target_user_id: selectedUserId,
          credit_type: creditType,
          credits_total: n,
        },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      const target = profiles.find((p) => p.user_id === selectedUserId);
      toast.success(
        `Granted ${n} ${creditType === "image" ? "image" : "TTS char"} credits to ${
          target?.email || target?.full_name || selectedUserId.slice(0, 8)
        }`,
      );
      // If admin granted credits to themselves, refresh their widget too
      notifyAddonCreditsChanged();
    } catch (err) {
      toast.error("Failed to grant credits: " + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold">QA: Grant Synthetic Add-on Credits</h3>
          <span className="text-xs text-muted-foreground">
            Test-only — bypasses PayFast
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmReset(true)}
          disabled={resetting}
          className="h-8 text-destructive hover:text-destructive"
        >
          {resetting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Trash2 className="h-3.5 w-3.5 mr-1" />
          )}
          Reset all QA credits
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="space-y-1">
          <Label htmlFor="qa-user-search" className="text-xs">Target user</Label>
          <Input
            id="qa-user-search"
            placeholder="Search email, name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder={`Pick from ${filtered.length} match${filtered.length === 1 ? "" : "es"}`} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {filtered.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
              )}
              {filtered.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  <span className="font-mono text-xs">
                    {p.email || p.full_name || p.user_id.slice(0, 8)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={creditType} onValueChange={(v) => setCreditType(v as "image" | "tts")}>
            <SelectTrigger className="h-9 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="tts">TTS chars</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="qa-amount" className="text-xs">Amount</Label>
          <Input
            id="qa-amount"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-9 w-[110px]"
          />
        </div>

        <div className="flex items-end">
          <Button
            onClick={handleGrant}
            disabled={submitting || !selectedUserId}
            className="h-9"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <FlaskConical className="h-4 w-4 mr-1" />
            )}
            Grant
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all QA credits?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every <code className="px-1 rounded bg-muted">addon_credits</code> row
              with <code className="px-1 rounded bg-muted">source = 'qa_admin_grant'</code> across all users.
              Real PayFast purchases are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete QA credits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
