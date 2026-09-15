import { describe, it, expect, vi } from "vitest";
import {
  ttlMessage,
  TTL_I18N_KEYS,
  captureTtlServerError,
  formatTtlServerErrorDescription,
} from "@/lib/ttlMessages";

// Bind a `t` into the same call shape the hook produces so we can drive the
// helpers directly from unit tests (no React tree needed).
const makeM =
  (t: (k: string) => string) =>
  (key: (typeof TTL_I18N_KEYS)[keyof typeof TTL_I18N_KEYS], ctx?: { min: number; max: number; value?: number; clamped?: number }) =>
    ttlMessage(t, key, ctx ?? { min: 0, max: 0 });

// A `t` that always returns the key (simulates missing translations) — exercises the EN_FALLBACK path.
const tMissing = (key: string) => key;

// A `t` that returns a localized template — exercises the i18n path.
const tLocalized = (map: Record<string, string>) => (key: string) =>
  map[key] ?? key;

describe("ttlMessage()", () => {
  describe("placeholder interpolation (EN fallback)", () => {
    it("interpolates {min} and {max} in helpRange", () => {
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.helpRange, { min: 60, max: 3600 }),
      ).toBe("Allowed range: 60–3600 seconds.");
    });

    it("interpolates {min} and {value} in errorTooLow", () => {
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.errorTooLow, {
          min: 60,
          max: 3600,
          value: 30,
        }),
      ).toBe("Too low — minimum is 60s (1 min). You entered 30s.");
    });

    it("interpolates {max} and {value} in errorTooHigh", () => {
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.errorTooHigh, {
          min: 60,
          max: 3600,
          value: 9999,
        }),
      ).toBe("Too high — maximum is 3600s (1 hour). You entered 9999s.");
    });

    it("interpolates {min}, {max}, {clamped} in outOfRange description", () => {
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.toastOutD, {
          min: 60,
          max: 3600,
          clamped: 3600,
        }),
      ).toBe("TTL must be between 60s and 3600s. Clamped to 3600s.");
    });

    it("interpolates {value} and {clamped} in rounded description", () => {
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.toastRoundD, {
          min: 60,
          max: 3600,
          value: 120.5,
          clamped: 120,
        }),
      ).toBe("TTL must be a whole number. Adjusted 120.5 → 120s.");
    });

    it("derives {minutes} from {value} (rounded) in saved description", () => {
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.toastSavedD, {
          min: 60,
          max: 3600,
          value: 900,
        }),
      ).toBe("900s (~15 min). Live within ~60s.");
    });

    it("rounds {minutes} for non-divisible {value}", () => {
      // 125 / 60 = 2.083… → Math.round → 2
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.toastSavedD, {
          min: 60,
          max: 3600,
          value: 125,
        }),
      ).toBe("125s (~2 min). Live within ~60s.");
    });
  });

  describe("fallback behaviour for missing keys", () => {
    it("returns the EN fallback when t() returns the raw key", () => {
      const spy = vi.fn((key: string) => key);
      const out = ttlMessage(spy, TTL_I18N_KEYS.errorDecimal, {
        min: 60,
        max: 3600,
      });
      expect(spy).toHaveBeenCalledWith(TTL_I18N_KEYS.errorDecimal);
      expect(out).toBe("TTL must be a whole number (no decimals).");
    });

    it("returns the raw key for an unknown key not in EN_FALLBACK", () => {
      const bogus = "admin.ttl.does.not.exist" as never;
      expect(ttlMessage(tMissing, bogus, { min: 0, max: 0 })).toBe(bogus);
    });

    it("uses ctx defaults when called without ctx (no throw)", () => {
      // helpRange uses {min}/{max}; defaults are 0/0.
      expect(ttlMessage(tMissing, TTL_I18N_KEYS.helpRange)).toBe(
        "Allowed range: 0–0 seconds.",
      );
    });

    it("leaves unknown placeholders untouched when ctx value missing", () => {
      // errorTooLow needs {value}, but we omit it — placeholder stays as {value}.
      expect(
        ttlMessage(tMissing, TTL_I18N_KEYS.errorTooLow, {
          min: 60,
          max: 3600,
        }),
      ).toBe("Too low — minimum is 60s (1 min). You entered {value}s.");
    });
  });

  describe("localized templates from t()", () => {
    it("prefers the i18n template over EN_FALLBACK and interpolates placeholders", () => {
      const t = tLocalized({
        [TTL_I18N_KEYS.helpRange]: "Toegelate reeks: {min}–{max} sekondes.",
      });
      expect(
        ttlMessage(t, TTL_I18N_KEYS.helpRange, { min: 60, max: 3600 }),
      ).toBe("Toegelate reeks: 60–3600 sekondes.");
    });

    it("interpolates {clamped} into a localized template", () => {
      const t = tLocalized({
        [TTL_I18N_KEYS.toastOutD]:
          "TTL moet tussen {min}s en {max}s wees. Vasgestel op {clamped}s.",
      });
      expect(
        ttlMessage(t, TTL_I18N_KEYS.toastOutD, {
          min: 60,
          max: 3600,
          clamped: 3600,
        }),
      ).toBe("TTL moet tussen 60s en 3600s wees. Vasgestel op 3600s.");
    });
  });
});

describe("captureTtlServerError() — 'Unknown server error.' fallback", () => {
  // All shapes the Supabase client may hand us that lack a usable .message.
  // Each must collapse to the SAME localized fallback string so the toast
  // description and the inline panel never disagree.
  const EMPTY_CASES: Array<[string, unknown]> = [
    ["null",            null],
    ["undefined",       undefined],
    ["empty object",    {}],
    ["empty string",    { message: "" }],
    ["whitespace only", { message: "   \n\t " }],
    ["non-string",      { message: 123 as unknown as string }],
  ];

  it.each(EMPTY_CASES)(
    "uses the localized 'Unknown server error.' fallback for %s",
    (_label, raw) => {
      const m = makeM((k) => k); // force EN_FALLBACK path
      const captured = captureTtlServerError(m, raw);
      expect(captured.message).toBe("Unknown server error.");
      // Other fields stay undefined — nothing fabricated.
      expect(captured.hint).toBeUndefined();
      expect(captured.details).toBeUndefined();
      expect(captured.code).toBeUndefined();
    },
  );

  it("uses the localized template from t() when one is registered", () => {
    const m = makeM((k) =>
      k === TTL_I18N_KEYS.serverUnknown ? "Onbekende bedienerfout." : k,
    );
    expect(captureTtlServerError(m, {}).message).toBe("Onbekende bedienerfout.");
  });

  it("preserves a real server message instead of falling back", () => {
    const m = makeM((k) => k);
    const captured = captureTtlServerError(m, {
      message: "  permission denied  ",
      hint: " admins only ",
      details: "",
      code: "42501",
    });
    expect(captured.message).toBe("permission denied"); // trimmed
    expect(captured.hint).toBe("admins only");
    expect(captured.details).toBeUndefined();           // empty → undefined
    expect(captured.code).toBe("42501");
  });

  it("renders an identical toast description for every empty-shape input", () => {
    // The toast formatter joins parts with ' — '; with only `.message` set,
    // the output is exactly the fallback string. This guarantees all
    // unparsable errors surface the same single-line message everywhere.
    const m = makeM((k) => k);
    const descriptions = EMPTY_CASES.map(([, raw]) =>
      formatTtlServerErrorDescription(m, captureTtlServerError(m, raw)),
    );
    const unique = new Set(descriptions);
    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe("Unknown server error.");
  });

  it("does not emit a SQLSTATE segment when the server gave no code", () => {
    const m = makeM((k) => k);
    const desc = formatTtlServerErrorDescription(
      m,
      captureTtlServerError(m, null),
    );
    expect(desc).not.toMatch(/SQLSTATE/);
    // No raw i18n keys / unfilled placeholders leak through either.
    expect(desc).not.toMatch(/admin\.ttl\./);
    expect(desc).not.toMatch(/\{[a-z]+\}/);
  });
});
