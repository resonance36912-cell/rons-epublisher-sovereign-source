import type { UsageLog } from "../../types";

export type DailyPoint = { day: string; spend: number };

export type ServiceForecast = {
  key: string;
  label: string;
  spend7d: number;
  spend30d: number;
  rate7d: number;
  rate30d: number;
  projected: number;
  trendPct: number;
  /** Final budget used for the bar — manual override if set, else auto. */
  budget: number;
  autoBudget: number;
  budget30Heuristic: number;
  budget90Heuristic: number;
  manualBudget: number | null;
  overBudgetPct: number;
  daily14: DailyPoint[];
};

export const SERVICES: Array<{ key: "elevenlabs-tts" | "generate-chapter-image"; label: string }> = [
  { key: "elevenlabs-tts", label: "ElevenLabs TTS" },
  { key: "generate-chapter-image", label: "Gemini Image" },
];

export type { UsageLog };
