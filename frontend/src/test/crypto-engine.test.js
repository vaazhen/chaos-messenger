import { beforeEach, describe, expect, it, vi } from "vitest";

function b64urlJson(value) {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function loadCryptoEngine() {
  vi.resetModules();
  await import("../crypto-engine.js");
}

describe("crypto-engine frontend safety checks", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete window.e2ee;
  });

  it("migrates old username-scoped crypto storage to unscoped storage once token subject is known", async () => {
    const token = `header.${b64urlJson({ sub: "alice" })}.signature`;

    localStorage.setItem("cm_token", token);
    localStorage.setItem("cm_device_id:alice", "device-old");
    localStorage.setItem("cm_device_bundle_v2:alice", JSON.stringify({ deviceId: "device-old" }));
    localStorage.setItem("cm_e2ee_sessions_v4:alice", JSON.stringify({ session: true }));

    await loadCryptoEngine();

    expect(localStorage.getItem("cm_device_id")).toBe("device-old");
    expect(JSON.parse(localStorage.getItem("cm_device_bundle_v2"))).toEqual({ deviceId: "device-old" });
    expect(JSON.parse(localStorage.getItem("cm_e2ee_sessions_v4"))).toEqual({ session: true });

    expect(localStorage.getItem("cm_device_id:alice")).toBeNull();
    expect(localStorage.getItem("cm_device_bundle_v2:alice")).toBeNull();
    expect(localStorage.getItem("cm_e2ee_sessions_v4:alice")).toBeNull();
  });

  it("does not overwrite already existing unscoped crypto storage during migration", async () => {
    const token = `header.${b64urlJson({ sub: "alice" })}.signature`;

    localStorage.setItem("cm_token", token);
    localStorage.setItem("cm_device_id", "device-current");
    localStorage.setItem("cm_device_id:alice", "device-old");

    await loadCryptoEngine();

    expect(localStorage.getItem("cm_device_id")).toBe("device-current");
    expect(localStorage.getItem("cm_device_id:alice")).toBeNull();
  });

  it("getOrCreateDeviceId creates stable unscoped device id", async () => {
    await loadCryptoEngine();

    const first = window.e2ee.getOrCreateDeviceId();
    const second = window.e2ee.getOrCreateDeviceId();

    expect(first).toMatch(/^device-/);
    expect(second).toBe(first);
    expect(localStorage.getItem("cm_device_id")).toBe(first);
  });

  it("decryptEnvelope fails clearly when local bundle is missing", async () => {
    await loadCryptoEngine();

    await expect(window.e2ee.decryptEnvelope({
      messageType: "SELF_WHISPER",
      ciphertext: "bad",
      nonce: "bad",
    })).rejects.toThrow("Local device bundle is missing");
  });
});