export const OPEN_NOVA_LOCAL_ONLY = import.meta.env.VITE_OPEN_NOVA_LOCAL_ONLY === "1";

export function isSovereignLocal(): boolean {
  return OPEN_NOVA_LOCAL_ONLY;
}

export const OPEN_NOVA_LOCAL_LABEL = "Sovereign local";
