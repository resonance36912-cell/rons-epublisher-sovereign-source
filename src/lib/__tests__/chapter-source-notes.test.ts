import { describe, expect, it } from "vitest";
import { renderChapterSourceNotes } from "../chapter-source-notes";

describe("chapter source notes", () => {
  it("keeps inspectable URLs outside narrative prose and removes duplicates", () => {
    const html = renderChapterSourceNotes([
      "Cape Coloureds (https://en.wikipedia.org/wiki/Cape_Coloureds)",
      "Cape Coloureds (https://en.wikipedia.org/wiki/Cape_Coloureds)",
      "Human review note",
    ]);

    expect(html).toContain('aria-label="Chapter source notes"');
    expect(html).toContain('href="https://en.wikipedia.org/wiki/Cape_Coloureds"');
    expect(html.match(/Cape Coloureds/g)).toHaveLength(1);
    expect(html).toContain("Chapter-level provenance; factual verification remains separate.");
    expect(html).toContain("<li>Human review note</li>");
  });

  it("escapes untrusted labels and rejects non-HTTP link syntax", () => {
    const html = renderChapterSourceNotes([
      '<script>alert("x")</script> (javascript:alert(1))',
    ]);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });

  it("omits the source-note block when no references exist", () => {
    expect(renderChapterSourceNotes()).toBe("");
    expect(renderChapterSourceNotes([])).toBe("");
  });
});
