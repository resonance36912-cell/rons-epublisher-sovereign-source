// Once-off credit packs sold via Paystack (ZAR).
// Source of truth = public.credit_packs table. This module fetches from DB
// and falls back to the seeded catalog if the network / DB is unavailable.
import { supabase } from "@/integrations/supabase/client";
import { OPEN_NOVA_LOCAL_ONLY } from "@/lib/sovereign-mode";
import { FREE_PROMOTION_ACTIVE } from "@/lib/promotion";

export type CreditPack = {
  id: string;
  name: string;
  tagline: string;
  priceZAR: number;      // rand
  imageCredits: number;  // premium AI images
  ttsCredits: number;    // ElevenLabs characters
  highlight?: boolean;
};

// Fallback / seed values. Kept in sync with the initial DB seed migration.
export const FALLBACK_CREDIT_PACKS: CreditPack[] = [
  {
    id: "pack_taste",
    name: "Taste Pack",
    tagline: "Try premium narration and imagery on a single short chapter.",
    priceZAR: 49,
    imageCredits: 8,
    ttsCredits: 5_000,
  },
  {
    id: "pack_starter",
    name: "Starter Pack",
    tagline: "Publish one short AudioVisual eBook.",
    priceZAR: 99,
    imageCredits: 20,
    ttsCredits: 15_000,
  },
  {
    id: "pack_creator",
    name: "Creator Pack",
    tagline: "One polished eBook — narration, images, PDF/HTML/ePub export.",
    priceZAR: 249,
    imageCredits: 65,
    ttsCredits: 50_000,
    highlight: true,
  },
  {
    id: "pack_studio",
    name: "Studio Pack",
    tagline: "Multi-book run — long-form projects, premium narration.",
    priceZAR: 599,
    imageCredits: 180,
    ttsCredits: 150_000,
  },
];

// Backwards-compatible alias — some callers still import CREDIT_PACKS.
export const CREDIT_PACKS = FALLBACK_CREDIT_PACKS;

type Row = {
  id: string;
  name: string;
  tagline: string | null;
  price_zar: number;
  image_credits: number;
  tts_credits: number;
  highlight: boolean;
};

function rowToPack(r: Row): CreditPack {
  return {
    id: r.id,
    name: r.name,
    tagline: r.tagline ?? "",
    priceZAR: r.price_zar,
    imageCredits: r.image_credits,
    ttsCredits: r.tts_credits,
    highlight: r.highlight,
  };
}

export async function fetchActiveCreditPacks(): Promise<CreditPack[]> {
  if (FREE_PROMOTION_ACTIVE) return [];
  if (OPEN_NOVA_LOCAL_ONLY) return FALLBACK_CREDIT_PACKS;
  try {
    const { data, error } = await supabase
      .from("credit_packs")
      .select("id, name, tagline, price_zar, image_credits, tts_credits, highlight")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return FALLBACK_CREDIT_PACKS;
    return (data as Row[]).map(rowToPack);
  } catch {
    return FALLBACK_CREDIT_PACKS;
  }
}

export async function fetchCreditPack(id: string): Promise<CreditPack | null> {
  if (FREE_PROMOTION_ACTIVE) return null;
  if (OPEN_NOVA_LOCAL_ONLY) return FALLBACK_CREDIT_PACKS.find((p) => p.id === id) ?? null;
  try {
    const { data, error } = await supabase
      .from("credit_packs")
      .select("id, name, tagline, price_zar, image_credits, tts_credits, highlight")
      .eq("id", id)
      .maybeSingle();
    if (!error && data) return rowToPack(data as Row);
  } catch {
    /* fall through */
  }
  return FALLBACK_CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

// Synchronous best-effort lookup from the static fallback list.
// Prefer fetchCreditPack for anything that needs live pricing.
export function getCreditPack(id: string): CreditPack | undefined {
  if (FREE_PROMOTION_ACTIVE) return undefined;
  return FALLBACK_CREDIT_PACKS.find((p) => p.id === id);
}
