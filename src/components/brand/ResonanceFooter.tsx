import * as React from "react";
import { appConfig } from "@/lib/app-config";
import { ResonanceLogo } from "./ResonanceLogo";

/**
 * <ResonanceFooter />
 * The shared footer link strip. Drop into every spoke so users can move
 * between apps and back to the Hub without losing the brand thread.
 */
const APPS = [
  { name: "Hub",                href: "https://reson8.life" },
  { name: "ePublisher",         href: "https://www.resonanceonline.life" },
  { name: "Creative Studio",    href: "https://www.creativestudio.life" },
  { name: "Sync Vision",        href: "https://www.syncvision.life" },
  { name: "YouTube Optimizer",  href: "https://optimizer.resonance.life" },
  { name: "Podcast",            href: "https://resonance-podcast.com" },
];

export function ResonanceFooter({
  currentApp = appConfig.name,
  contact = appConfig.contactEmail,
}: {
  currentApp?: string;
  contact?: string;
}) {
  return (
    <footer className="mt-24 border-t border-white/10 bg-[hsl(222_47%_5%)] text-white/60">
      <div className="mx-auto max-w-7xl px-6 py-12 grid gap-10 md:grid-cols-[1fr_2fr_1fr] items-start">
        <div>
          <ResonanceLogo height={26} />
          <p className="mt-3 text-xs leading-relaxed max-w-xs">
            One AI ecosystem for South African creators, publishers, and businesses.
          </p>
        </div>
        <nav className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          {APPS.map((a) => (
            <a
              key={a.name}
              href={a.href}
              className={`hover:text-white transition-colors ${
                currentApp === a.name ? "text-white font-semibold" : ""
              }`}
            >
              {a.name}
            </a>
          ))}
        </nav>
        <div className="text-xs space-y-2">
          <a href={`mailto:${contact}`} className="block hover:text-white">{contact}</a>
          <a href="https://reson8.life/pricing" className="block hover:text-white">Free access promotion</a>
          <a href="https://reson8.life/updates" className="block hover:text-white">View updates</a>
          <a href="https://reson8.life/account" className="block hover:text-white">
            Back to hub
          </a>
        </div>
      </div>
      <div className="border-t border-white/5 px-6 py-4 text-[10px] uppercase tracking-[0.25em] text-white/40 text-center">
        © {new Date().getFullYear()} The Resonance · Free access promotion · Updates &amp; support managed by The Resonance Hub
      </div>
    </footer>
  );
}
