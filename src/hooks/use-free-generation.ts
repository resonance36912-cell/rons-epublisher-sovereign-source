// Tracks whether the user has used their one free generation
const STORAGE_KEY = "resonance_free_gen_used";

export function hasFreeGenerationBeenUsed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function markFreeGenerationUsed(): void {
  localStorage.setItem(STORAGE_KEY, "true");
}
