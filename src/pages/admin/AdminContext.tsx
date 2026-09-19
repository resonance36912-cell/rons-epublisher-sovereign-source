import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getTierQuotaPresets, saveTierQuotaPreset } from "@/lib/usage-limits";
import {
  type Profile, type Job, type BetaSignup, type StorageFile, type PayfastPayment,
  type ApiUsageData, type UsageLog, type TierPreset,
  TIER_ORDER, TIER_META,
} from "./types";

type AdminContextValue = {
  // Core
  profiles: Profile[];
  setProfiles: React.Dispatch<React.SetStateAction<Profile[]>>;
  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  betaSignups: BetaSignup[];
  setBetaSignups: React.Dispatch<React.SetStateAction<BetaSignup[]>>;
  loading: boolean;

  // Storage
  storageFiles: StorageFile[];
  storageTotalSize: number;
  storageRequestId: string | null;
  storageLoading: boolean;
  setStorageLoading: React.Dispatch<React.SetStateAction<boolean>>;
  deletingPaths: Set<string>;
  confirmDeleteAll: boolean;
  setConfirmDeleteAll: (v: boolean) => void;
  fetchStorage: () => Promise<void>;
  handleDeleteFile: (path: string) => Promise<void>;
  handleDeleteAllStorage: () => Promise<void>;

  // API usage / tier presets
  apiUsage: ApiUsageData | null;
  apiUsageLoading: boolean;
  fetchApiUsage: () => Promise<void>;
  tierPresets: TierPreset[];
  tierInputs: Record<string, number>;
  setTierInputs: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  tierPresetsLoading: boolean;
  tierPresetsSaving: boolean;
  fetchTierPresets: () => Promise<void>;
  saveTierPresets: () => Promise<void>;

  // Usage logs + derived
  usageLogs: UsageLog[];
  usageLogsLoading: boolean;
  fetchUsageLogs: () => Promise<void>;
  usageChartData: Array<{ date: string; tts: number; images: number; ttsChars: number }>;
  driftChartData: Array<{ date: string; avg: number; p95: number; count: number }>;
  usageSummary: { totalTts: number; totalImages: number; totalChars: number; avgDurationTts: number; avgDurationImg: number };
  costSummary: {
    last30: { ttsCost: number; imgCost: number; total: number };
    last7: { ttsCost: number; imgCost: number; total: number };
    allTime: { ttsCost: number; imgCost: number; total: number };
  };
  perUserCosts: Array<{ userId: string; name: string; ttsCalls: number; imgCalls: number; ttsCost: number; imgCost: number; chars: number; total: number }>;
  projectedMonthlyCost: number;

  // Cost threshold
  costThreshold: number;
  setCostThreshold: (n: number) => void;
  editingThreshold: boolean;
  setEditingThreshold: (v: boolean) => void;
  thresholdInput: string;
  setThresholdInput: (s: string) => void;
  costThresholdExceeded: boolean;

  // Historical payment audit
  payments: PayfastPayment[];
  paymentsLoading: boolean;
  fetchPayments: () => Promise<void>;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminProvider>");
  return ctx;
}

export function AdminProvider({ children, isAdmin }: { children: ReactNode; isAdmin: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [betaSignups, setBetaSignups] = useState<BetaSignup[]>([]);
  const [loading, setLoading] = useState(true);

  const [storageFiles, setStorageFiles] = useState<StorageFile[]>([]);
  const [storageTotalSize, setStorageTotalSize] = useState(0);
  const [storageRequestId, setStorageRequestId] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [deletingPaths, setDeletingPaths] = useState<Set<string>>(new Set());
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const [apiUsage, setApiUsage] = useState<ApiUsageData | null>(null);
  const [apiUsageLoading, setApiUsageLoading] = useState(false);
  const [tierPresets, setTierPresets] = useState<TierPreset[]>([]);
  const [tierInputs, setTierInputs] = useState<Record<string, number>>({});
  const [tierPresetsLoading, setTierPresetsLoading] = useState(false);
  const [tierPresetsSaving, setTierPresetsSaving] = useState(false);

  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [usageLogsLoading, setUsageLogsLoading] = useState(false);

  const [costThreshold, setCostThresholdState] = useState<number>(() => {
    const saved = localStorage.getItem("admin_cost_threshold");
    return saved ? parseFloat(saved) : 10;
  });
  const setCostThreshold = useCallback((n: number) => {
    setCostThresholdState(n);
    localStorage.setItem("admin_cost_threshold", String(n));
  }, []);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");

  const [payments, setPayments] = useState<PayfastPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  const fetchStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await supabase.functions.invoke("admin-storage", { body: { action: "list" } });
      if (res.error) throw new Error(res.error.message);
      const d = res.data as { files: StorageFile[]; totalSize: number; request_id?: string };
      setStorageFiles(d.files || []);
      setStorageTotalSize(d.totalSize || 0);
      setStorageRequestId(d.request_id ?? null);
    } catch (err: any) {
      toast.error("Failed to load storage: " + err.message);
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const fetchApiUsage = useCallback(async () => {
    setApiUsageLoading(true);
    try {
      const res = await supabase.functions.invoke("admin-api-usage");
      if (res.error) throw new Error(res.error.message);
      setApiUsage(res.data as ApiUsageData);
    } catch (err: any) {
      toast.error("Failed to load API usage: " + err.message);
    } finally {
      setApiUsageLoading(false);
    }
  }, []);

  const fetchTierPresets = useCallback(async () => {
    setTierPresetsLoading(true);
    try {
      const presets = await getTierQuotaPresets();
      setTierPresets(presets);
      const inputs: Record<string, number> = {};
      for (const p of presets) inputs[`${p.tier}:${p.service}`] = p.daily_limit;
      setTierInputs(inputs);
    } catch (err: any) {
      toast.error("Failed to load tier presets: " + err.message);
    } finally {
      setTierPresetsLoading(false);
    }
  }, []);

  const saveTierPresets = useCallback(async () => {
    setTierPresetsSaving(true);
    try {
      const saves: Promise<void>[] = [];
      for (const tier of TIER_ORDER) {
        for (const service of ["generate-chapter-image", "elevenlabs-tts"]) {
          const key = `${tier}:${service}`;
          const val = Number(tierInputs[key]);
          if (!Number.isInteger(val) || val < 0) {
            toast.error(`Invalid value for ${TIER_META[tier].label} ${service === "generate-chapter-image" ? "images" : "TTS"}`);
            setTierPresetsSaving(false);
            return;
          }
          saves.push(saveTierQuotaPreset(tier, service, val));
        }
      }
      await Promise.all(saves);
      await fetchTierPresets();
      toast.success("Tier quotas saved");
    } catch (err: any) {
      toast.error("Failed to save tier presets: " + err.message);
    } finally {
      setTierPresetsSaving(false);
    }
  }, [tierInputs, fetchTierPresets]);

  const fetchUsageLogs = useCallback(async () => {
    setUsageLogsLoading(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data, error } = await supabase
        .from("api_usage_logs")
        .select("*")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: true });
      if (error) throw error;
      setUsageLogs((data as UsageLog[]) || []);
    } catch (err: any) {
      console.error("Failed to load usage logs:", err.message);
    } finally {
      setUsageLogsLoading(false);
    }
  }, []);

  const fetchPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const [purchasesRes, subsRes] = await Promise.all([
        supabase.from("purchases").select("*").order("created_at", { ascending: false }),
        supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
      ]);
      const purchases: PayfastPayment[] = (purchasesRes.data || []) as PayfastPayment[];
      const subs: PayfastPayment[] = ((subsRes.data || []) as any[]).map(s => ({
        id: s.id,
        user_id: s.user_id,
        stripe_session_id: s.stripe_subscription_id,
        stripe_customer_id: s.stripe_customer_id,
        product_id: s.product_id,
        price_id: s.price_id,
        amount_total: 0,
        currency: "zar",
        environment: s.environment,
        created_at: s.created_at,
      }));
      setPayments([...purchases, ...subs].sort((a, b) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      ));
    } catch (err: any) {
      console.error("Failed to load payments:", err.message);
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  // Derived
  const usageChartData = useMemo(() => {
    const dayMap = new Map<string, { date: string; tts: number; images: number; ttsChars: number }>();
    usageLogs.forEach((log) => {
      const day = log.created_at.slice(0, 10);
      const entry = dayMap.get(day) || { date: day, tts: 0, images: 0, ttsChars: 0 };
      if (log.service === "elevenlabs-tts") {
        entry.tts += 1;
        entry.ttsChars += log.tokens_or_chars || 0;
      } else if (log.service === "generate-chapter-image") {
        entry.images += 1;
      }
      dayMap.set(day, entry);
    });
    return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [usageLogs]);

  const driftChartData = useMemo(() => {
    const dayMap = new Map<string, number[]>();
    for (const log of usageLogs) {
      if (log.service !== "video-export-av-drift") continue;
      const m = log.metadata as any;
      const abs = Math.abs(Number(m?.absDriftSecs ?? m?.driftSecs ?? NaN));
      if (!Number.isFinite(abs)) continue;
      const day = log.created_at.slice(0, 10);
      const arr = dayMap.get(day) || [];
      arr.push(abs);
      dayMap.set(day, arr);
    }
    return Array.from(dayMap.entries())
      .map(([date, vals]) => {
        const sorted = [...vals].sort((a, b) => a - b);
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
        return { date, avg: Number(avg.toFixed(3)), p95: Number(p95.toFixed(3)), count: vals.length };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [usageLogs]);

  const usageSummary = useMemo(() => {
    const totalTts = usageLogs.filter((l) => l.service === "elevenlabs-tts").length;
    const totalImages = usageLogs.filter((l) => l.service === "generate-chapter-image").length;
    const totalChars = usageLogs.filter((l) => l.service === "elevenlabs-tts").reduce((s, l) => s + (l.tokens_or_chars || 0), 0);
    const avgDurationTts = totalTts > 0
      ? Math.round(usageLogs.filter((l) => l.service === "elevenlabs-tts").reduce((s, l) => s + (l.duration_ms || 0), 0) / totalTts)
      : 0;
    const avgDurationImg = totalImages > 0
      ? Math.round(usageLogs.filter((l) => l.service === "generate-chapter-image").reduce((s, l) => s + (l.duration_ms || 0), 0) / totalImages)
      : 0;
    return { totalTts, totalImages, totalChars, avgDurationTts, avgDurationImg };
  }, [usageLogs]);

  const costSummary = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const calc = (logs: UsageLog[]) => {
      let ttsCost = 0, imgCost = 0;
      for (const l of logs) {
        const c = l.cost_estimate ?? 0;
        if (l.service === "elevenlabs-tts") ttsCost += c;
        else if (l.service === "generate-chapter-image") imgCost += c;
      }
      return { ttsCost, imgCost, total: ttsCost + imgCost };
    };
    return {
      last30: calc(usageLogs.filter(l => new Date(l.created_at) >= thirtyDaysAgo)),
      last7: calc(usageLogs.filter(l => new Date(l.created_at) >= sevenDaysAgo)),
      allTime: calc(usageLogs),
    };
  }, [usageLogs]);

  const perUserCosts = useMemo(() => {
    const userMap = new Map<string, { ttsCalls: number; imgCalls: number; ttsCost: number; imgCost: number; chars: number }>();
    for (const l of usageLogs) {
      const uid = l.user_id || "anonymous";
      const entry = userMap.get(uid) || { ttsCalls: 0, imgCalls: 0, ttsCost: 0, imgCost: 0, chars: 0 };
      const c = l.cost_estimate ?? 0;
      if (l.service === "elevenlabs-tts") {
        entry.ttsCalls += 1;
        entry.ttsCost += c;
        entry.chars += l.tokens_or_chars || 0;
      } else if (l.service === "generate-chapter-image") {
        entry.imgCalls += 1;
        entry.imgCost += c;
      }
      userMap.set(uid, entry);
    }
    return Array.from(userMap.entries())
      .map(([userId, data]) => {
        const profile = profiles.find(p => p.user_id === userId);
        return {
          userId,
          name: profile?.full_name || profile?.email || (userId === "anonymous" ? "Anonymous" : userId.slice(0, 8) + "…"),
          ...data,
          total: data.ttsCost + data.imgCost,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [usageLogs, profiles]);

  const projectedMonthlyCost = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const recentLogs = usageLogs.filter(l => new Date(l.created_at) >= thirtyDaysAgo);
    if (recentLogs.length === 0) return 0;
    const totalCost = recentLogs.reduce((s, l) => s + (l.cost_estimate ?? 0), 0);
    const oldestLog = new Date(Math.min(...recentLogs.map(l => new Date(l.created_at).getTime())));
    const daysCovered = Math.max(1, (now.getTime() - oldestLog.getTime()) / 86400000);
    return (totalCost / daysCovered) * 30;
  }, [usageLogs]);

  const costThresholdExceeded = projectedMonthlyCost > costThreshold && costThreshold > 0;

  useEffect(() => {
    if (costThresholdExceeded) {
      toast.warning("Monthly cost threshold exceeded", {
        description: `Projected: $${projectedMonthlyCost.toFixed(2)}/mo — Threshold: $${costThreshold.toFixed(2)}/mo`,
        duration: 10000,
        id: "cost-threshold-alert",
      });
    }
  }, [costThresholdExceeded, projectedMonthlyCost, costThreshold]);

  // Initial load
  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      const [profilesRes, jobsRes, betaRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("research_jobs").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("beta_signups").select("*").order("created_at", { ascending: false }),
      ]);
      setProfiles((profilesRes.data as Profile[]) || []);
      setJobs((jobsRes.data as Job[]) || []);
      setBetaSignups((betaRes.data as BetaSignup[]) || []);
      setLoading(false);
    };
    load();
    fetchStorage();
    fetchApiUsage();
    fetchUsageLogs();
    fetchTierPresets();
    fetchPayments();
  }, [isAdmin, fetchStorage, fetchApiUsage, fetchUsageLogs, fetchTierPresets, fetchPayments]);

  const handleDeleteFile = useCallback(async (path: string) => {
    setDeletingPaths((prev) => new Set(prev).add(path));
    try {
      const res = await supabase.functions.invoke("admin-storage", {
        body: { action: "delete", paths: [path] },
      });
      if (res.error) throw new Error(res.error.message);
      setStorageFiles((prev) => prev.filter((f) => f.path !== path));
      setStorageTotalSize((prev) => prev - (storageFiles.find((f) => f.path === path)?.size || 0));
      toast.success("File deleted");
    } catch (err: any) {
      toast.error("Failed to delete: " + err.message);
    } finally {
      setDeletingPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [storageFiles]);

  const handleDeleteAllStorage = useCallback(async () => {
    setConfirmDeleteAll(false);
    if (storageFiles.length === 0) return;
    const allPaths = storageFiles.map((f) => f.path);
    setStorageLoading(true);
    try {
      for (let i = 0; i < allPaths.length; i += 100) {
        const batch = allPaths.slice(i, i + 100);
        const res = await supabase.functions.invoke("admin-storage", {
          body: { action: "delete", paths: batch },
        });
        if (res.error) throw new Error(res.error.message);
      }
      setStorageFiles([]);
      setStorageTotalSize(0);
      toast.success(`All ${allPaths.length} files deleted`);
    } catch (err: any) {
      toast.error("Failed to delete all: " + err.message);
      fetchStorage();
    } finally {
      setStorageLoading(false);
    }
  }, [storageFiles, fetchStorage]);

  const value: AdminContextValue = {
    profiles, setProfiles, jobs, setJobs, betaSignups, setBetaSignups, loading,
    storageFiles, storageTotalSize, storageRequestId, storageLoading, setStorageLoading, deletingPaths,
    confirmDeleteAll, setConfirmDeleteAll,
    fetchStorage, handleDeleteFile, handleDeleteAllStorage,
    apiUsage, apiUsageLoading, fetchApiUsage,
    tierPresets, tierInputs, setTierInputs, tierPresetsLoading, tierPresetsSaving,
    fetchTierPresets, saveTierPresets,
    usageLogs, usageLogsLoading, fetchUsageLogs,
    usageChartData, driftChartData, usageSummary, costSummary, perUserCosts, projectedMonthlyCost,
    costThreshold, setCostThreshold, editingThreshold, setEditingThreshold,
    thresholdInput, setThresholdInput, costThresholdExceeded,
    payments, paymentsLoading, fetchPayments,
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
