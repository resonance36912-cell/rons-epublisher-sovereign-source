import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/storyforge/PageHeader";
import { AppFooter } from "@/components/storyforge/AppFooter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Seo } from "@/components/Seo";
import { ExternalLink, FileCode2, Layers, RefreshCw, AlertTriangle } from "lucide-react";

/** One <url> entry discovered in a sitemap document. */
interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
  /** File the URL was found in — "sitemap.xml" or a shard name. */
  source: string;
}

/** One <sitemap> entry from a <sitemapindex>. */
interface ShardRef {
  loc: string;
  name: string;
  lastmod?: string;
  urlCount?: number;
  error?: string;
}

interface SitemapData {
  kind: "urlset" | "sitemapindex";
  shards: ShardRef[];
  urls: SitemapUrl[];
}

const tag = (node: Element, name: string) =>
  node.getElementsByTagName(name)[0]?.textContent?.trim() || undefined;

const fileName = (loc: string) => {
  try {
    return new URL(loc, window.location.origin).pathname.split("/").pop() || loc;
  } catch {
    return loc;
  }
};

async function fetchXml(path: string): Promise<Document> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`${path} is not valid XML`);
  }
  return doc;
}

function readUrls(doc: Document, source: string): SitemapUrl[] {
  return Array.from(doc.getElementsByTagName("url")).map((node) => ({
    loc: tag(node, "loc") ?? "",
    lastmod: tag(node, "lastmod"),
    changefreq: tag(node, "changefreq"),
    priority: tag(node, "priority"),
    source,
  }));
}

/** Loads /sitemap.xml, following a <sitemapindex> to every referenced shard. */
async function loadSitemap(): Promise<SitemapData> {
  const root = await fetchXml("/sitemap.xml");

  if (root.getElementsByTagName("sitemapindex").length === 0) {
    return { kind: "urlset", shards: [], urls: readUrls(root, "sitemap.xml") };
  }

  const refs: ShardRef[] = Array.from(root.getElementsByTagName("sitemap")).map((node) => {
    const loc = tag(node, "loc") ?? "";
    return { loc, name: fileName(loc), lastmod: tag(node, "lastmod") };
  });

  const urls: SitemapUrl[] = [];
  for (const ref of refs) {
    try {
      const doc = await fetchXml(`/${ref.name}`);
      const shardUrls = readUrls(doc, ref.name);
      ref.urlCount = shardUrls.length;
      urls.push(...shardUrls);
    } catch (error) {
      ref.error = error instanceof Error ? error.message : "failed to load";
    }
  }

  return { kind: "sitemapindex", shards: refs, urls };
}

export default function SitemapPreview() {
  const [data, setData] = useState<SitemapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    loadSitemap()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load sitemap"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const withLastmod = data?.urls.filter((u) => u.lastmod).length ?? 0;
  const newest = data?.urls
    .map((u) => u.lastmod)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title="Sitemap — Resonance ePublisher"
        description="Human-readable index of every public Resonance ePublisher URL, with its sitemap shard, last-modified date, change frequency and priority."
        path="/sitemap"
      />
      <PageHeader />

      <main className="container mx-auto max-w-5xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Sitemap</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            A readable view of{" "}
            <a href="/sitemap.xml" className="underline underline-offset-4 hover:text-foreground">
              /sitemap.xml
            </a>
            . Every URL below is discovered by crawlers and consolidates onto The Resonance Hub
            through its canonical tag.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              {data?.kind === "sitemapindex" ? <Layers className="h-3 w-3" /> : <FileCode2 className="h-3 w-3" />}
              {data?.kind === "sitemapindex"
                ? `Sitemap index · ${data.shards.length} shards`
                : "Single sitemap"}
            </Badge>
            <Badge variant="secondary">{data?.urls.length ?? 0} URLs</Badge>
            <Badge variant="secondary">{withLastmod} with lastmod</Badge>
            {newest && <Badge variant="secondary">Newest change {newest}</Badge>}
            <Button variant="ghost" size="sm" className="gap-1" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Could not load the sitemap</p>
              <p className="text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {loading && !data && (
          <p className="text-sm text-muted-foreground">Loading sitemap…</p>
        )}

        {data && data.shards.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Referenced sitemaps</h2>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Sitemap</th>
                    <th className="px-4 py-2 font-medium">Last modified</th>
                    <th className="px-4 py-2 text-right font-medium">URLs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shards.map((shard) => (
                    <tr key={shard.loc} className="border-t border-border">
                      <td className="px-4 py-2">
                        <a
                          href={`/${shard.name}`}
                          className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-primary"
                        >
                          {shard.name}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{shard.lastmod ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {shard.error ? (
                          <span className="text-destructive">{shard.error}</span>
                        ) : (
                          (shard.urlCount ?? "—")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {data && (
          <section>
            <h2 className="mb-3 text-lg font-semibold">Pages</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">URL</th>
                    <th className="px-4 py-2 font-medium">Last modified</th>
                    <th className="px-4 py-2 font-medium">Change freq.</th>
                    <th className="px-4 py-2 font-medium">Priority</th>
                    {data.kind === "sitemapindex" && (
                      <th className="px-4 py-2 font-medium">Found in</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.urls.map((url) => (
                    <tr key={url.loc} className="border-t border-border align-top">
                      <td className="px-4 py-2">
                        <a
                          href={url.loc}
                          className="break-all underline underline-offset-4 hover:text-primary"
                        >
                          {url.loc}
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {url.lastmod ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{url.changefreq ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{url.priority ?? "—"}</td>
                      {data.kind === "sitemapindex" && (
                        <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                          {url.source}
                        </td>
                      )}
                    </tr>
                  ))}
                  {data.urls.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        No URLs found in the sitemap.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="mt-8 text-sm text-muted-foreground">
          Looking for the raw files? <a href="/sitemap.xml" className="underline underline-offset-4">sitemap.xml</a>{" "}
          · <a href="/robots.txt" className="underline underline-offset-4">robots.txt</a> ·{" "}
          <Link to="/" className="underline underline-offset-4">Home</Link>
        </p>
      </main>

      <AppFooter />
    </div>
  );
}
