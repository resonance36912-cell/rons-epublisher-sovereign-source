import { toast as sonnerToast } from "sonner";

/**
 * Recognises the per-tier project-cap error thrown by `saveProject` and
 * surfaces a friendly toast with actionable next steps (upgrade or open the
 * project manager to delete an old one).
 *
 * Returns `true` if the error was a cap error and the toast was shown — callers
 * should then skip their generic "save failed" toast. Returns `false` for any
 * other error.
 */
export function notifyProjectSaveError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!/project limit reached/i.test(msg)) return false;

  // Pull the cap + tier out of the DB exception text when present, e.g.:
  // "Project limit reached for free tier (5 projects). Upgrade or delete…"
  const tierMatch = msg.match(/for\s+(free|standard|premium)\s+tier/i);
  const capMatch = msg.match(/\((\d+)\s+projects?\)/i);
  const tier = tierMatch?.[1]?.toLowerCase();
  const cap = capMatch?.[1];

  const title = "Project limit reached";
  const description =
    tier && cap
      ? `Your ${tier} plan allows up to ${cap} active projects. Upgrade for more, or delete a project you no longer need.`
      : "You've reached the project limit for your current plan. Upgrade for more, or delete a project you no longer need.";

  sonnerToast.error(title, {
    description,
    duration: 12_000,
    action: {
      label: "Upgrade",
      onClick: () => {
        window.location.assign("/pricing");
      },
    },
    cancel: {
      label: "Manage projects",
      onClick: () => {
        // Open the project manager panel on the main app screen.
        try {
          window.dispatchEvent(new CustomEvent("open-project-manager"));
        } catch {
          /* no-op */
        }
        if (!window.location.pathname.startsWith("/app")) {
          window.location.assign("/app");
        }
      },
    },
  });
  return true;
}
