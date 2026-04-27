import { beforeEach, describe, expect, it, vi } from "vitest";

function okJson(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  });
}

function failJson(status, statusText, body) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve(body),
  });
}

describe("deviceId", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.e2ee;
    global.fetch = vi.fn();
  });

  it("getOrCreateDeviceId delegates to crypto engine when available", async () => {
    window.e2ee = {
      getOrCreateDeviceId: vi.fn(() => "device-e2ee"),
    };

    const { getOrCreateDeviceId } = await import("../deviceId");

    expect(getOrCreateDeviceId()).toBe("device-e2ee");
    expect(window.e2ee.getOrCreateDeviceId).toHaveBeenCalled();
  });

  it("getOrCreateDeviceId fallback creates and persists unscoped device id", async () => {
    const { getOrCreateDeviceId } = await import("../deviceId");

    const first = getOrCreateDeviceId();
    const second = getOrCreateDeviceId();

    expect(first).toMatch(/^device-/);
    expect(second).toBe(first);
    expect(localStorage.getItem("cm_device_id")).toBe(first);
  });

  it("ensureDeviceRegistered passes device-registration token only to register endpoint", async () => {
    localStorage.setItem("cm_token", "jwt-token");

    window.e2ee = {
      getOrCreateDeviceId: vi.fn(() => "device-a"),
      ensureDeviceRegistered: vi.fn(async (apiFn) => {
        expect(apiFn.__canRegisterDevice).toBe(true);

        await apiFn("/api/crypto/devices/register", {
          method: "POST",
          body: JSON.stringify({ deviceId: "device-a" }),
        });

        await apiFn("/api/crypto/resolve-chat-devices/100", {
          method: "POST",
        });
      }),
    };

    fetch
      .mockResolvedValueOnce(await okJson({ registered: true }))
      .mockResolvedValueOnce(await okJson({ targetDevices: [] }));

    const { ensureDeviceRegistered } = await import("../deviceId");

    const deviceId = await ensureDeviceRegistered("device-registration-token");

    expect(deviceId).toBe("device-a");
    expect(window.e2ee.ensureDeviceRegistered).toHaveBeenCalled();

    const firstHeaders = fetch.mock.calls[0][1].headers;
    const secondHeaders = fetch.mock.calls[1][1].headers;

    expect(firstHeaders.Authorization).toBe("Bearer jwt-token");
    expect(firstHeaders["X-Device-Registration-Token"]).toBe("device-registration-token");

    expect(secondHeaders.Authorization).toBe("Bearer jwt-token");
    expect(secondHeaders["X-Device-Registration-Token"]).toBeUndefined();
  });

  it("ensureDeviceRegistered falls back to local device id when crypto engine is not loaded", async () => {
    const { ensureDeviceRegistered } = await import("../deviceId");

    const deviceId = await ensureDeviceRegistered("unused");

    expect(deviceId).toMatch(/^device-/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ensureCurrentDeviceExists rejects when JWT is missing", async () => {
    const { ensureCurrentDeviceExists } = await import("../deviceId");

    await expect(ensureCurrentDeviceExists()).rejects.toThrow("Missing JWT token");
  });

  it("ensureCurrentDeviceExists sends JWT and X-Device-Id", async () => {
    localStorage.setItem("cm_token", "jwt-token");
    localStorage.setItem("cm_device_id", "device-current");

    fetch.mockResolvedValueOnce(await okJson({ ok: true }));

    const { ensureCurrentDeviceExists } = await import("../deviceId");

    await expect(ensureCurrentDeviceExists()).resolves.toBe("device-current");

    const [url, opts] = fetch.mock.calls[0];

    expect(url).toContain("/crypto/devices/current");
    expect(opts.headers.Authorization).toBe("Bearer jwt-token");
    expect(opts.headers["X-Device-Id"]).toBe("device-current");
  });

  it("ensureCurrentDeviceExists throws backend message on failed current-device check", async () => {
    localStorage.setItem("cm_token", "jwt-token");
    localStorage.setItem("cm_device_id", "device-current");

    fetch.mockResolvedValueOnce(await failJson(401, "Unauthorized", {
      message: "device is not registered",
    }));

    const { ensureCurrentDeviceExists } = await import("../deviceId");

    await expect(ensureCurrentDeviceExists()).rejects.toThrow("device is not registered");
  });
});