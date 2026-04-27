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

describe("api", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.e2ee;
    global.fetch = vi.fn();
  });

  it("call attaches JWT, current device id, JSON content type and custom headers", async () => {
    const { call, setToken } = await import("../api");

    setToken("jwt-token");
    localStorage.setItem("cm_device_id", "device-local");

    fetch.mockResolvedValueOnce(await okJson({ ok: true }));

    const response = await call("/test", {
      method: "POST",
      headers: { "X-Custom": "yes" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(response).toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];

    expect(url).toContain("/test");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer jwt-token",
      "X-Device-Id": "device-local",
      "X-Custom": "yes",
    });
  });

  it("call uses window.e2ee device id when crypto engine is loaded", async () => {
    window.e2ee = {
      getOrCreateDeviceId: vi.fn(() => "device-from-e2ee"),
    };

    const { call } = await import("../api");

    fetch.mockResolvedValueOnce(await okJson({ ok: true }));

    await call("/secured");

    const [, opts] = fetch.mock.calls[0];

    expect(window.e2ee.getOrCreateDeviceId).toHaveBeenCalled();
    expect(opts.headers["X-Device-Id"]).toBe("device-from-e2ee");
  });

  it("call throws backend message on non-2xx response", async () => {
    const { call } = await import("../api");

    fetch.mockResolvedValueOnce(await failJson(409, "Conflict", {
      message: "username is taken",
    }));

    await expect(call("/users/profile")).rejects.toThrow("username is taken");
  });

  it("call falls back to status text when error body has no message", async () => {
    const { call } = await import("../api");

    fetch.mockResolvedValueOnce(await failJson(500, "Server Error", {}));

    await expect(call("/boom")).rejects.toThrow("500 Server Error");
  });

  it("completeSetup sends setupToken merged with profile payload", async () => {
    const { api } = await import("../api");

    fetch.mockResolvedValueOnce(await okJson({ token: "jwt" }));

    await api.completeSetup("setup-123", {
      firstName: "Alice",
      username: "alice",
      avatarUrl: "data:image/png;base64,abc",
    });

    const [, opts] = fetch.mock.calls[0];
    const body = JSON.parse(opts.body);

    expect(opts.method).toBe("POST");
    expect(body).toEqual({
      setupToken: "setup-123",
      firstName: "Alice",
      username: "alice",
      avatarUrl: "data:image/png;base64,abc",
    });
  });

  it("usernameAvailable calls public auth endpoint when method exists", async () => {
    const { api } = await import("../api");

    if (!api.usernameAvailable) {
      return;
    }

    fetch.mockResolvedValueOnce(await okJson({ username: "alice", available: true }));

    const response = await api.usernameAvailable("alice");

    expect(response.available).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain("/auth/username-available?username=alice");
  });
});