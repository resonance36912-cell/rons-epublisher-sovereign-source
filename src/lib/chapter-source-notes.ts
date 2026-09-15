function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseReference(reference: string): { label: string; url?: string } {
  const trimmed = reference.trim();
  const linked = trimmed.match(/^(.*?)\s*\((https?:\/\/[^\s]+)\)\s*$/i);
  if (!linked) return { label: trimmed };
  return { label: linked[1].trim() || linked[2], url: linked[2] };
}

/**
 * Render chapter-level provenance outside the narrated chapter body.
 * This deliberately does not imply claim-level verification: it exposes the
 * references already attached to the chapter and keeps their URLs inspectable.
 */
export function renderChapterSourceNotes(references?: string[]): string {
  const unique = Array.from(new Set((references || []).map((value) => value.trim()).filter(Boolean)));
  if (unique.length === 0) return "";

  const items = unique.map((reference) => {
    const parsed = parseReference(reference);
    const label = escapeHtml(parsed.label);
    if (!parsed.url) return `<li>${label}</li>`;
    const url = escapeHtml(parsed.url);
    return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
  }).join("");

  return `<aside class="source-notes" aria-label="Chapter source notes"><h3>Source notes</h3><p>Chapter-level provenance; factual verification remains separate.</p><ol>${items}</ol></aside>`;
}
