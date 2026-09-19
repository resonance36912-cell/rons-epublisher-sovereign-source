export function resolveOpenNovaLocalOnly(value: string | undefined): boolean {
  return value !== "0";
}

// This repository is the sovereign-local application. Clean production builds
// therefore stay local-first even when a gitignored .env.local file is absent.
// A deliberately hosted/cloud build must opt out explicitly with value "0".
export const OPEN_NOVA_LOCAL_ONLY = resolveOpenNovaLocalOnly(
  import.meta.env.VITE_OPEN_NOVA_LOCAL_ONLY,
);

export function isSovereignLocal(): boolean {
  return OPEN_NOVA_LOCAL_ONLY;
}

export const OPEN_NOVA_LOCAL_LABEL = "Sovereign local";
