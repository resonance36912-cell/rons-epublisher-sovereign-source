import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the storage-audit fire-and-forget logger.
 *
 * Contract verified:
 *   1. Every insert payload carries `metadata.request_id` (UUID-ish string)
 *      and `metadata.ui_action` when supplied by the caller.
 *   2. A correlation scope id is inherited when no explicit requestId is passed.
 *   3. The audit call is fully detached — the caller's listing/view operation
 *      resolves immediately even when the supabase insert is slow or throws.
 *   4. Errors in the audit insert never propagate to the caller.
 */

// ── Mock the supabase client used by storage-audit ───────────────────────
const insertSpy = vi.fn().mockResolvedValue({ error: null });
const getSessionMock = vi.fn().mockResolvedValue({
  data: { session: { user: { id: "user-under-test" } } },
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
    from: (_table: string) => ({ insert: insertSpy }),
  },
}));

import {
  logUserStorageListing,
  logUserStorageView,
  beginCorrelationScope,
  endCorrelationScope,
  createAuditRequestId,
} from "./storage-audit";

const flush = async () => {
  // storage-audit detaches via `await Promise.resolve()` then awaits the
  // insert promise. Two macrotask flushes are enough to settle both.
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  insertSpy.mockClear();
  insertSpy.mockResolvedValue({ error: null });
  getSessionMock.mockClear();
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: "user-under-test" } } },
  });
});

afterEach(() => {
  endCorrelationScope("storyboard");
});

describe("storage-audit metadata contract", () => {
  it("includes request_id and ui_action in every list insert", async () => {
    const reqId = createAuditRequestId();
    await logUserStorageListing({
      bucket: "chapter-images",
      scopePath: "user-under-test/proj-1",
      fileCount: 3,
      uiAction: "Open project gallery",
      projectId: "proj-1",
      requestId: reqId,
    });
    await flush();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [rows] = insertSpy.mock.calls[0];
    expect(Array.isArray(rows)).toBe(true);
    const row = rows[0];
    expect(row.action).toBe("list");
    expect(row.metadata.request_id).toBe(reqId);
    expect(row.metadata.ui_action).toBe("Open project gallery");
    expect(row.metadata.project_id).toBe("proj-1");
  });

  it("includes request_id and ui_action in every view insert", async () => {
    await logUserStorageView({
      bucket: "chapter-images",
      scopePath: "user-under-test/proj-2",
      fileCount: 2,
      uiAction: "Open project",
      projectId: "proj-2",
    });
    await flush();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0][0];
    expect(row.action).toBe("view");
    expect(row.metadata.ui_action).toBe("Open project");
    expect(typeof row.metadata.request_id).toBe("string");
    expect(row.metadata.request_id.length).toBeGreaterThan(8);
  });

  it("inherits an active correlation scope's request_id when none is supplied", async () => {
    const scopeId = beginCorrelationScope("storyboard");
    await logUserStorageView({
      bucket: "chapter-images",
      scopePath: "user-under-test/proj-3",
      fileCount: 1,
      uiAction: "Render storyboard editor",
    });
    await flush();

    const row = insertSpy.mock.calls[0][0][0];
    expect(row.metadata.request_id).toBe(scopeId);
    expect(row.metadata.request_scope).toBe("storyboard");
    expect(row.metadata.ui_action).toBe("Render storyboard editor");
  });

  it("skips empty view payloads without inserting", async () => {
    await logUserStorageView({
      bucket: "chapter-images",
      scopePath: "user-under-test/proj-4",
      fileCount: 0,
      uiAction: "noop",
    });
    await flush();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("storage-audit non-blocking behaviour", () => {
  it("returns to caller before a slow insert resolves", async () => {
    let resolveInsert!: (v: unknown) => void;
    insertSpy.mockImplementationOnce(
      () => new Promise((res) => { resolveInsert = res; }),
    );

    const order: string[] = [];
    const p = logUserStorageListing({
      bucket: "chapter-images",
      scopePath: "user-under-test/slow",
      fileCount: 1,
      uiAction: "Slow op",
    }).then(() => order.push("audit-done"));

    // The listing operation continues — simulate it finishing immediately.
    order.push("listing-returned");

    // Let microtasks drain; insert is still pending so audit must NOT be done.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["listing-returned"]);

    resolveInsert({ error: null });
    await p;
    expect(order).toEqual(["listing-returned", "audit-done"]);
  });

  it("swallows insert errors so callers never see them", async () => {
    insertSpy.mockRejectedValueOnce(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      logUserStorageListing({
        bucket: "chapter-images",
        scopePath: "user-under-test/err",
        fileCount: 1,
        uiAction: "Boom",
        requestId: "req-err-1",
      }),
    ).resolves.toBeUndefined();
    await flush();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no-ops silently when there is no authenticated session", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });
    await logUserStorageListing({
      bucket: "chapter-images",
      scopePath: "anon/path",
      fileCount: 2,
      uiAction: "Anon list",
    });
    await flush();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
