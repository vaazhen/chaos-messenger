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
    sessionStorage.clear();
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
    const { setToken } = await import("../api");
    setToken("jwt-token");

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

  it("ensureDeviceRegistered can re-bind with JWT and without an enrollment token", async () => {
    const { setToken } = await import("../api");
    setToken("jwt-token");

    window.e2ee = {
      getOrCreateDeviceId: vi.fn(() => "device-a"),
      ensureDeviceRegistered: vi.fn(async (apiFn) => {
        expect(apiFn.__canRegisterDevice).toBe(false);
        await apiFn("/api/crypto/devices/register", {
          method: "POST",
          body: JSON.stringify({ deviceId: "device-a" }),
        });
      }),
    };

    fetch.mockResolvedValueOnce(await okJson({ registered: true }));

    const { ensureDeviceRegistered } = await import("../deviceId");
    await expect(ensureDeviceRegistered()).resolves.toBe("device-a");

    const headers = fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer jwt-token");
    expect(headers["X-Device-Registration-Token"]).toBeUndefined();
  });

  it("ensureDeviceRegistered does not reset identity when server rejects key rotation", async () => {
    const { setToken } = await import("../api");
    setToken("jwt-token");

    const rotation = new Error("Device identity keys cannot be rotated. Register a new device id instead.");
    rotation.status = 409;

    window.e2ee = {
      getOrCreateDeviceId: vi.fn(() => "device-a"),
      resetLocalDeviceIdentity: vi.fn(),
      ensureDeviceRegistered: vi.fn().mockRejectedValueOnce(rotation),
    };

    const { ensureDeviceRegistered } = await import("../deviceId");

    await expect(ensureDeviceRegistered("device-registration-token")).rejects.toThrow(/cannot be rotated/);
    expect(window.e2ee.resetLocalDeviceIdentity).not.toHaveBeenCalled();
    expect(window.e2ee.ensureDeviceRegistered).toHaveBeenCalledTimes(1);
  });

  it("ensureDeviceRegistered does not reset identity on device id conflict without confirmation", async () => {
    const { setToken } = await import("../api");
    setToken("jwt-token");

    const conflict = new Error("Device id is already registered to another account");
    conflict.status = 409;

    window.e2ee = {
      getOrCreateDeviceId: vi.fn(() => "device-new"),
      resetLocalDeviceIdentity: vi.fn(),
      ensureDeviceRegistered: vi.fn().mockRejectedValueOnce(conflict),
    };

    const { ensureDeviceRegistered } = await import("../deviceId");

    await expect(ensureDeviceRegistered("device-registration-token")).rejects.toMatchObject({
      message: expect.stringMatching(/already registered to another account/),
      code: "DEVICE_IDENTITY_CONFLICT",
    });
    expect(window.e2ee.resetLocalDeviceIdentity).not.toHaveBeenCalled();
    expect(window.e2ee.ensureDeviceRegistered).toHaveBeenCalledTimes(1);
  });

  it("ensureDeviceRegistered resets local identity after explicit confirmation", async () => {
    const { setToken } = await import("../api");
    setToken("jwt-token");

    const conflict = new Error("Device id is already registered to another account");
    conflict.status = 409;

    window.e2ee = {
      getOrCreateDeviceId: vi.fn(() => "device-new"),
      resetLocalDeviceIdentity: vi.fn(),
      ensureDeviceRegistered: vi.fn()
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({}),
    };

    const { ensureDeviceRegistered } = await import("../deviceId");

    await expect(ensureDeviceRegistered("device-registration-token", {
      confirmIdentityReset: async () => true,
    })).resolves.toBe("device-new");

    expect(window.e2ee.resetLocalDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(window.e2ee.ensureDeviceRegistered).toHaveBeenCalledTimes(2);
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
    const { setToken } = await import("../api");
    setToken("jwt-token");
    localStorage.setItem("cm_device_id", "device-current");

    fetch.mockResolvedValueOnce(await okJson({ ok: true }));

    const { ensureCurrentDeviceExists } = await import("../deviceId");

    await expect(ensureCurrentDeviceExists()).resolves.toBe("device-current");

    const [url, opts] = fetch.mock.calls[0];

    expect(url).toContain("/crypto/devices/current");
    expect(opts.credentials).toBe("include");
    expect(opts.headers.Authorization).toBe("Bearer jwt-token");
    expect(opts.headers["X-Device-Id"]).toBe("device-current");
  });

  it("ensureCurrentDeviceExists throws backend message on failed current-device check", async () => {
    const { setToken } = await import("../api");
    setToken("jwt-token");
    localStorage.setItem("cm_device_id", "device-current");

    fetch.mockResolvedValueOnce(await failJson(401, "Unauthorized", {
      message: "device is not registered",
    }));

    const { ensureCurrentDeviceExists } = await import("../deviceId");

    await expect(ensureCurrentDeviceExists()).rejects.toThrow("device is not registered");
  });
});
