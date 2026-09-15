import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * Compact, copy-to-clipboard chip used to surface the correlation/request
 * id of an in-flight or just-finished operation. Pair this with audit rows
 * in the admin "Storage Access Logs" panel — searching by Request ID will
 * return every row produced during the same user action.
 */
export function RequestIdBadge({
  requestId,
  label = "Request ID",
  className = "",
}: {
  requestId: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!requestId) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      toast.success("Request ID copied", {
        description: requestId,
      });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy Request ID");
    }
  };

  const short = requestId.length > 12 ? `${requestId.slice(0, 8)}…` : requestId;

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`${label}: ${requestId}\nClick to copy`}
      className={`inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${className}`}
    >
      <span className="opacity-70">{label}</span>
      <span className="text-foreground">{short}</span>
      {copied ? (
        <Check className="h-3 w-3 text-primary" />
      ) : (
        <Copy className="h-3 w-3 opacity-60" />
      )}
    </button>
  );
}
