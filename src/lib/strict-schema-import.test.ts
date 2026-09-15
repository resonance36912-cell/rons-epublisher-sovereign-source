import { describe, it, expect, beforeEach } from "vitest";
import {
  isImportBlocked,
  readStrictSchemaPref,
  writeStrictSchemaPref,
  STRICT_SCHEMA_PREF_KEY,
} from "@/lib/strict-schema-import";

/** Minimal in-memory Storage stand-in. */
function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

describe("isImportBlocked — strict-schema gating", () => {
  const matched = { originalSchemaVersion: 2, schemaVersion: 2 };
  const mismatched = { originalSchemaVersion: 1, schemaVersion: 2 };

  it("never blocks when schema versions match", () => {
    expect(isImportBlocked({ ...matched, strict: true, overrideAck: false })).toBe(false);
    expect(isImportBlocked({ ...matched, strict: true, overrideAck: true })).toBe(false);
    expect(isImportBlocked({ ...matched, strict: false, overrideAck: false })).toBe(false);
  });

  it("blocks mismatched imports when strict is on and override is unticked", () => {
    expect(isImportBlocked({ ...mismatched, strict: true, overrideAck: false })).toBe(true);
  });

  it("override checkbox unblocks a mismatched import", () => {
    expect(isImportBlocked({ ...mismatched, strict: true, overrideAck: true })).toBe(false);
  });

  it("does not block when strict mode is off, even on mismatch", () => {
    expect(isImportBlocked({ ...mismatched, strict: false, overrideAck: false })).toBe(false);
  });

  it("treats a downgrade (newer file → older build) as a mismatch", () => {
    expect(
      isImportBlocked({
        strict: true,
        originalSchemaVersion: 3,
        schemaVersion: 2,
        overrideAck: false,
      }),
    ).toBe(true);
  });
});

describe("strict-schema preference persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to true (block by default) when nothing is stored", () => {
    expect(readStrictSchemaPref()).toBe(true);
  });

  it("reads '1' as true and '0' as false", () => {
    const on = memStorage({ [STRICT_SCHEMA_PREF_KEY]: "1" });
    const off = memStorage({ [STRICT_SCHEMA_PREF_KEY]: "0" });
    expect(readStrictSchemaPref(on)).toBe(true);
    expect(readStrictSchemaPref(off)).toBe(false);
  });

  it("writes '1' / '0' under the canonical key", () => {
    const s = memStorage();
    writeStrictSchemaPref(true, s);
    expect(s._dump()[STRICT_SCHEMA_PREF_KEY]).toBe("1");
    writeStrictSchemaPref(false, s);
    expect(s._dump()[STRICT_SCHEMA_PREF_KEY]).toBe("0");
  });

  it("round-trips the preference through localStorage", () => {
    writeStrictSchemaPref(false);
    expect(readStrictSchemaPref()).toBe(false);
    writeStrictSchemaPref(true);
    expect(readStrictSchemaPref()).toBe(true);
  });

  it("falls back to true if storage throws on read", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStrictSchemaPref(broken)).toBe(true);
  });

  it("silently swallows storage write failures", () => {
    const broken = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeStrictSchemaPref(false, broken)).not.toThrow();
  });
});
