import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";

/**
 * Build-time guard: verifies favicon / og:image / twitter:image / JSON-LD logo
 * and manifest icon references in index.html point to assets that exist in /public.
 * Runs once at the start of `vite build` and fails the build on missing assets.
 */
function verifyBrandAssetsPlugin(): PluginOption {
  return {
    name: "verify-brand-assets",
    apply: "build",
    buildStart() {
      const script = path.resolve(__dirname, "scripts/verify-brand-assets.mjs");
      const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
      if (result.status !== 0) {
        this.error("Brand asset verification failed — see log above.");
      }
    },
  };
}

/**
 * Build-time guard: fails the build when public/sitemap.xml is malformed XML
 * or lists any route disallowed in public/robots.txt.
 */
function verifySitemapPlugin(): PluginOption {
  return {
    name: "verify-sitemap",
    apply: "build",
    buildStart() {
      const script = path.resolve(__dirname, "scripts/validate-sitemap.mjs");
      const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
      if (result.status !== 0) {
        this.error("Sitemap validation failed — see log above.");
      }
    },
  };
}

/**
 * Serves sitemap.xml, its shards and robots.txt with a crawler-correct
 * Content-Type, and hands out the pre-compressed `.gz` sibling (written by
 * scripts/compress-sitemap.mjs) with `Content-Encoding: gzip` whenever the
 * client advertises gzip support. Applies to both `vite dev` and `vite preview`
 * so what we verify locally matches the static-host rules in public/_headers.
 */
function sitemapHeadersPlugin(): PluginOption {
  const match = (url: string) =>
    /^\/(sitemap\.xml|sitemap-\d+\.xml|robots\.txt)$/.test(url);

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0];
    if (!match(url)) return next();

    const isRobots = url === "/robots.txt";
    const contentType = isRobots
      ? "text/plain; charset=utf-8"
      : "application/xml; charset=utf-8";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const gzPath = path.resolve(__dirname, `public${url}.gz`);
    const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    if (acceptsGzip && fs.existsSync(gzPath)) {
      const body = fs.readFileSync(gzPath);
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", body.length);
      res.end(body);
      return;
    }

    const rawPath = path.resolve(__dirname, `public${url}`);
    if (!fs.existsSync(rawPath)) return next();
    const body = fs.readFileSync(rawPath);
    res.setHeader("Content-Length", body.length);
    res.end(body);
  };

  return {
    name: "sitemap-headers",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "localhost",
    port: 3101,
    proxy: {
      "/open-nova-research": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
        rewrite: (requestPath) => requestPath.replace(/^\/open-nova-research/, ""),
      },
    },
    hmr: {
      overlay: false,
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 3101,
    proxy: {
      "/open-nova-research": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
        rewrite: (requestPath) => requestPath.replace(/^\/open-nova-research/, ""),
      },
    },
  },  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  plugins: [
    react(),
    verifyBrandAssetsPlugin(),
    verifySitemapPlugin(),
    sitemapHeadersPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
