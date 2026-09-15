/**
 * Client-side audit logging for chapter-image storage operations.
 *
 * Admin-side listings are logged inside the `admin-storage` edge function
 * (service-role). This helper covers the user-side paths where the browser
 * lists or views its own chapter-image objects directly via supabase-js.
 *
 * Every row carries:
 *   - a stable correlation/request id (`request_id`) so a single user
 *     action can be traced across multiple audit rows;
 *   - the user-facing action name (`ui_action`) — e.g. "Open project",
 *     "Delete project" — for human readability in the admin viewer;
 *   - optional `project_id` plus any caller-supplied extras.
 *
 * Auditing is best-effort:
 *   - never throws,
 *   - never awaited inside the calling flow (fire-and-forget via `void`),
 *   - silently no-ops for anonymous sessions or empty view payloads.
 */
import { supabase } from "@/integrations/supabase/client";

type AuditAction = "list" | "view";

export type StorageAuditOptions = {
  bucket: string;
  scopePath: string;
  fileCount: number;
  /** Project this access is scoped to, when known. */
  projectId?: string;
  /** Human-readable action label shown in the admin log viewer. */
  uiAction?: string;
  /**
   * Stable correlation id for a single user-initiated request. When the
   * caller doesn't supply one we mint a fresh id so every audit row is
   * still groupable.
   */
  requestId?: string;
  /** Arbitrary extra fields merged into the `metadata` jsonb column. */
  metadata?: Record<string, unknown>;
};

function newRequestId(): string {
  try {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Public helper so callers can group multi-step flows under one id. */
export function createAuditRequestId(): string {
  return newRequestId();
}

// ── Correlation scopes ──────────────────────────────────────────────────
//
// A "scope" is a named, module-scoped slot holding the current request id
// for an in-flight user flow (e.g. "storyboard"). Any audit/log call that
// happens inside the scope and doesn't pass its own `requestId` will pick
// up the scope's id automatically, so every related row — storage audits,
// edge-function correlation ids, api_usage_logs — can be joined later.
const _scopes = new Map<string, string>();

export function beginCorrelationScope(scope: string, requestId?: string): string {
  const id = requestId ?? newRequestId();
  _scopes.set(scope, id);
  return id;
}

export function endCorrelationScope(scope: string): void {
  _scopes.delete(scope);
}

export function getCorrelationId(scope: string): string | undefined {
  return _scopes.get(scope);
}

/**
 * Run `fn` inside a named correlation scope, guaranteeing the scope is
 * cleared even when `fn` throws. Returns the value of `fn` plus the id
 * that was active so callers can echo it in UI / errors.
 */
export async function withCorrelationScope<T>(
  scope: string,
  fn: (requestId: string) => Promise<T>,
  requestId?: string,
): Promise<{ result: T; requestId: string }> {
  const id = beginCorrelationScope(scope, requestId);
  try {
    const result = await fn(id);
    return { result, requestId: id };
  } finally {
    endCorrelationScope(scope);
  }
}


/** Scope names whose id should be inherited when no explicit one is given. */
const INHERIT_SCOPES = ["storyboard"] as const;

function inheritedScopeId(): { id?: string; scope?: string } {
  for (const scope of INHERIT_SCOPES) {
    const id = _scopes.get(scope);
    if (id) return { id, scope };
  }
  return {};
}

function buildMetadata(opts: StorageAuditOptions): Record<string, unknown> {
  const inherited = opts.requestId ? {} : inheritedScopeId();
  const meta: Record<string, unknown> = {
    request_id: opts.requestId ?? inherited.id ?? newRequestId(),
    ...(inherited.scope ? { request_scope: inherited.scope } : {}),
    ...(opts.uiAction ? { ui_action: opts.uiAction } : {}),
    ...(opts.projectId ? { project_id: opts.projectId } : {}),
    client_ts: new Date().toISOString(),
    ...(opts.metadata ?? {}),
  };
  return meta;
}

async function insertAudit(action: AuditAction, opts: StorageAuditOptions): Promise<void> {
  // Detach from the caller's microtask queue so we never block the listing.
  await Promise.resolve();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    await supabase.from("storage_access_logs").insert([{
      user_id: uid,
      actor_role: "user",
      bucket: opts.bucket,
      scope_path: opts.scopePath,
      action,
      file_count: opts.fileCount,
      metadata: buildMetadata(opts) as never,
    }]);
  } catch (err) {
    console.warn(`[storage-audit] failed to log ${action}:`, err);
  }
}

export function logUserStorageListing(opts: StorageAuditOptions): Promise<void> {
  return insertAudit("list", opts);
}

/**
 * Logs a "view" of chapter-image objects materialized via stored public
 * URLs (project load, gallery thumbnails, storyboard generation previews,
 * exports, etc.) where no explicit `.list()` call happens.
 */
export function logUserStorageView(opts: StorageAuditOptions): Promise<void> {
  if (!opts.fileCount || opts.fileCount <= 0) return Promise.resolve();
  return insertAudit("view", opts);
}
