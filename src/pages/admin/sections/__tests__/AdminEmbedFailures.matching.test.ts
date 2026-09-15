/**
 * End-to-end-ish test for the admin "demo embed failures/retries" matching
 * logic. We don't render the full section (it talks to Supabase) — instead we
 * replicate the exact `retryUrlSet` / `matchedFailureUrls` / `combinedRows`
 * derivations from `AdminEmbedFailuresSection.tsx` against a seeded mixture
 * of legacy (un-normalized) and normalized URL rows, and assert that the
 * normalization step makes them join into the same buckets.
 *
 * If the derivation in the section changes shape, this test must be updated
 * to keep parity — see AdminEmbedFailuresSection.tsx lines ~134-167.
 */
import { describe, it, expect } from "vitest";
import { normalizeEmbedUrl } from "@/lib/embedEvents";

interface EventRow {
  id: string;
  created_at: string;
  properties: { provider?: string; embed_url?: string } | null;
}
type CombinedRow = EventRow & {
  kind: "failure" | "retry";
  normalizedUrl: string | null;
};

function deriveMatching(rows: EventRow[], retryRows: EventRow[]) {
  const retryUrlSet = new Set<string>();
  for (const r of retryRows) {
    const n = normalizeEmbedUrl(r.properties?.embed_url);
    if (n) retryUrlSet.add(n);
  }
  const failed = new Set<string>();
  const matched = new Set<string>();
  for (const r of rows) {
    const n = normalizeEmbedUrl(r.properties?.embed_url);
    if (!n) continue;
    failed.add(n);
    if (retryUrlSet.has(n)) matched.add(n);
  }
  const combined: CombinedRow[] = [
    ...rows.map((r) => ({
      ...r,
      kind: "failure" as const,
      normalizedUrl: normalizeEmbedUrl(r.properties?.embed_url),
    })),
    ...retryRows.map((r) => ({
      ...r,
      kind: "retry" as const,
      normalizedUrl: normalizeEmbedUrl(r.properties?.embed_url),
    })),
  ];
  combined.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    retryUrlSet,
    matchedDistinct: matched.size,
    totalDistinctFailedUrls: failed.size,
    combined,
  };
}

const t = (s: string) => new Date(s).toISOString();

describe("AdminEmbedFailuresSection matching (e2e)", () => {
  it("joins legacy + normalized URL variants into the same matched bucket", () => {
    // Failures: 4 rows that all reduce to the SAME normalized URL
    //   - legacy with hash fragment
    //   - legacy with uppercase scheme + whitespace
    //   - already-normalized
    //   - duplicate of the normalized form
    // Plus 1 unrelated URL with no matching retry, and 1 invalid (non-http)
    // row that must be discarded by normalization.
    const failures: EventRow[] = [
      { id: "f1", created_at: t("2025-05-10T10:00:00Z"), properties: { provider: "YouTube", embed_url: "https://youtu.be/abc#t=42" } },
      { id: "f2", created_at: t("2025-05-10T10:05:00Z"), properties: { provider: "YouTube", embed_url: "  HTTPS://youtu.be/abc  " } },
      { id: "f3", created_at: t("2025-05-10T10:10:00Z"), properties: { provider: "YouTube", embed_url: "https://youtu.be/abc" } },
      { id: "f4", created_at: t("2025-05-10T10:15:00Z"), properties: { provider: "YouTube", embed_url: "https://youtu.be/abc" } },
      { id: "f5-no-retry", created_at: t("2025-05-10T11:00:00Z"), properties: { provider: "Vimeo", embed_url: "https://vimeo.com/999" } },
      { id: "f6-invalid", created_at: t("2025-05-10T11:05:00Z"), properties: { provider: "YouTube", embed_url: "javascript:alert(1)" } },
    ];

    // Retries: a legacy variant of the SAME URL (different hash), plus a
    // separate unmatched retry, plus an invalid row.
    const retries: EventRow[] = [
      { id: "r1-legacy", created_at: t("2025-05-10T10:20:00Z"), properties: { provider: "YouTube", embed_url: "https://youtu.be/abc#different-hash" } },
      { id: "r2-unmatched", created_at: t("2025-05-10T12:00:00Z"), properties: { provider: "YouTube", embed_url: "https://youtu.be/xyz" } },
      { id: "r3-invalid", created_at: t("2025-05-10T12:05:00Z"), properties: { provider: "YouTube", embed_url: "ftp://broken" } },
    ];

    const { retryUrlSet, matchedDistinct, totalDistinctFailedUrls, combined } =
      deriveMatching(failures, retries);

    // Retry set is normalized (hash stripped) and excludes invalid scheme.
    expect(retryUrlSet.has("https://youtu.be/abc")).toBe(true);
    expect(retryUrlSet.has("https://youtu.be/xyz")).toBe(true);
    expect(retryUrlSet.size).toBe(2);

    // Distinct failed URLs (after normalization, dropping invalid): abc + vimeo/999
    expect(totalDistinctFailedUrls).toBe(2);
    // Only the youtu.be/abc URL has a corresponding retry → 1 distinct match.
    expect(matchedDistinct).toBe(1);

    // Every failure row pointing at the normalized URL is flagged as
    // "retry seen" via the retryUrlSet lookup.
    const failuresForAbc = combined.filter(
      (r) => r.kind === "failure" && r.normalizedUrl === "https://youtu.be/abc",
    );
    expect(failuresForAbc).toHaveLength(4);
    expect(failuresForAbc.every((r) => retryUrlSet.has(r.normalizedUrl!))).toBe(true);

    // The Vimeo failure normalizes fine but has no matching retry.
    const vimeo = combined.find((r) => r.id === "f5-no-retry");
    expect(vimeo?.normalizedUrl).toBe("https://vimeo.com/999");
    expect(retryUrlSet.has(vimeo!.normalizedUrl!)).toBe(false);

    // Invalid rows surface in the table with normalizedUrl === null (so the
    // UI falls back to the raw value) and never count toward matched/totals.
    const invalidFailure = combined.find((r) => r.id === "f6-invalid");
    expect(invalidFailure?.normalizedUrl).toBeNull();
    const invalidRetry = combined.find((r) => r.id === "r3-invalid");
    expect(invalidRetry?.normalizedUrl).toBeNull();

    // Combined table is sorted newest-first across both event kinds.
    const orderedIds = combined.map((r) => r.id);
    expect(orderedIds[0]).toBe("r3-invalid"); // 12:05
    expect(orderedIds[1]).toBe("r2-unmatched"); // 12:00
    expect(orderedIds[2]).toBe("f6-invalid"); // 11:05
  });

  it("emits matchedDistinct = 0 when every retry URL is invalid", () => {
    const failures: EventRow[] = [
      { id: "f1", created_at: t("2025-05-10T10:00:00Z"), properties: { provider: "YouTube", embed_url: "https://youtu.be/abc#x" } },
    ];
    const retries: EventRow[] = [
      { id: "r1", created_at: t("2025-05-10T10:01:00Z"), properties: { provider: "YouTube", embed_url: "javascript:alert(1)" } },
      { id: "r2", created_at: t("2025-05-10T10:02:00Z"), properties: { provider: "YouTube", embed_url: "not a url" } },
    ];
    const { matchedDistinct, totalDistinctFailedUrls, retryUrlSet } =
      deriveMatching(failures, retries);
    expect(retryUrlSet.size).toBe(0);
    expect(totalDistinctFailedUrls).toBe(1);
    expect(matchedDistinct).toBe(0);
  });
});
