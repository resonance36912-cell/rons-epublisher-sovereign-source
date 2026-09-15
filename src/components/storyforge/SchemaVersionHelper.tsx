import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, FileCode2 } from "lucide-react";
import { CURRENT_SCHEMA_VERSION, SCHEMA_PREFIX } from "@/lib/storyboard-import";

/**
 * Build a minimal, schema-valid empty storyboard at the current version.
 * Useful as a starting point when a user's older file needs manual rework.
 */
export function buildCompatibleTemplate(opts?: { title?: string; projectId?: string | null }) {
  return {
    schema: `${SCHEMA_PREFIX}${CURRENT_SCHEMA_VERSION}`,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    projectId: opts?.projectId ?? null,
    title: opts?.title || "Untitled storyboard",
    config: {},
    storyline: "",
    storylineAccepted: false,
    overallRating: 0,
    sources: [],
    referenceImage: null,
    assets: [],
    chapters: [
      {
        id: "ch-1",
        title: "Chapter 1",
        body: "Replace this placeholder paragraph with your chapter text.",
        imagePrompt: "",
        diagramPrompt: "",
        notes: "",
        references: [],
      },
    ],
  };
}

interface SchemaVersionHelperProps {
  /** When provided and lower than CURRENT_SCHEMA_VERSION, show the upgrade CTA. */
  fileVersion?: number;
  /** Pre-fill the downloaded template with this title. */
  templateTitle?: string;
  className?: string;
}

/**
 * Small UI helper that highlights the build's current schema version and —
 * when the user is dealing with an older file — offers a one-click download
 * of an empty, schema-valid template at the current version.
 */
export function SchemaVersionHelper({
  fileVersion,
  templateTitle,
  className,
}: SchemaVersionHelperProps) {
  const isOlder = typeof fileVersion === "number" && fileVersion < CURRENT_SCHEMA_VERSION;

  const handleDownload = useCallback(() => {
    const tpl = buildCompatibleTemplate({ title: templateTitle });
    const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resonance-storyboard-v${CURRENT_SCHEMA_VERSION}-template.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }, [templateTitle]);

  return (
    <div
      className={[
        "rounded-md border bg-muted/20 p-2 text-xs flex items-center justify-between gap-2 flex-wrap",
        className || "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <FileCode2 className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-muted-foreground shrink-0">Current schema:</span>
        <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
          {SCHEMA_PREFIX}
          {CURRENT_SCHEMA_VERSION}
        </Badge>
        {isOlder && (
          <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-700 dark:text-amber-400">
            file: v{fileVersion}
          </Badge>
        )}
      </div>
      {isOlder && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={handleDownload}
        >
          <Download className="w-3 h-3 mr-1" />
          Download v{CURRENT_SCHEMA_VERSION} template
        </Button>
      )}
    </div>
  );
}
