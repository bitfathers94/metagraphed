import { describe, it, expect, vi, afterEach } from "vitest";
import { buildStoredSession, readStoredSession, writeStoredSession } from "./use-api-session";

const ADDR_A = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ADDR_B = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

// Map-backed sessionStorage -- enough to exercise read/write round-trips without jsdom.
function makeWindow(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildStoredSession", () => {
  it("builds the session record from a wallet/verify response pair (the challenge->sign->verify success path)", () => {
    const verify = { session_token: "tok-1", expires_in_seconds: 900, account: { ss58: ADDR_A, tier: "pro" } };
    expect(buildStoredSession(ADDR_A, verify, 1_000)).toEqual({
      token: "tok-1",
      ss58: ADDR_A,
      tier: "pro",
      expiresAtMs: 1_000 + 900_000,
    });
  });
});

describe("readStoredSession", () => {
  it("returns null during SSR (no window)", () => {
    expect(readStoredSession(ADDR_A)).toBeNull();
  });

  it("round-trips a session written for the same wallet", () => {
    vi.stubGlobal("window", makeWindow());
    const verify = { session_token: "tok-2", expires_in_seconds: 900, account: { ss58: ADDR_A, tier: "free" } };
    const session = buildStoredSession(ADDR_A, verify, Date.now());
    writeStoredSession(session);
    expect(readStoredSession(ADDR_A)).toEqual(session);
  });

  it("is null once the session has expired", () => {
    const now = Date.now();
    const win = makeWindow({
      "metagraphed:api-session": JSON.stringify({
        token: "tok-3",
        ss58: ADDR_A,
        tier: "free",
        expiresAtMs: now - 1,
      }),
    });
    vi.stubGlobal("window", win);
    expect(readStoredSession(ADDR_A)).toBeNull();
  });

  it("is null when read for a different wallet than the one it was stored for", () => {
    const now = Date.now();
    const win = makeWindow({
      "metagraphed:api-session": JSON.stringify({
        token: "tok-4",
        ss58: ADDR_A,
        tier: "free",
        expiresAtMs: now + 900_000,
      }),
    });
    vi.stubGlobal("window", win);
    expect(readStoredSession(ADDR_B)).toBeNull();
  });

  it("is null for malformed stored JSON rather than throwing", () => {
    vi.stubGlobal("window", makeWindow({ "metagraphed:api-session": "{not json" }));
    expect(readStoredSession(ADDR_A)).toBeNull();
  });

  it("is null when nothing has been stored yet", () => {
    vi.stubGlobal("window", makeWindow());
    expect(readStoredSession(ADDR_A)).toBeNull();
  });
});

describe("writeStoredSession", () => {
  it("is a no-op during SSR (no window)", () => {
    expect(() => writeStoredSession(null)).not.toThrow();
  });

  it("persists a session so it can be read back", () => {
    vi.stubGlobal("window", makeWindow());
    const session = { token: "tok-5", ss58: ADDR_A, tier: "pro", expiresAtMs: Date.now() + 900_000 };
    writeStoredSession(session);
    expect(readStoredSession(ADDR_A)).toEqual(session);
  });

  it("clears the stored session when passed null", () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const session = { token: "tok-6", ss58: ADDR_A, tier: "pro", expiresAtMs: Date.now() + 900_000 };
    writeStoredSession(session);
    writeStoredSession(null);
    expect(readStoredSession(ADDR_A)).toBeNull();
  });
});
