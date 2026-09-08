import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  let token = "";

  return {
    get token() {
      return token;
    },
    set token(value) {
      token = value || "";
    },
    api: {
      sendPhone: vi.fn(),
      verifyOtp: vi.fn(),
      completeSetup: vi.fn(),
      registerEmail: vi.fn(),
      loginEmail: vi.fn(),
      refreshToken: vi.fn(),
      logout: vi.fn(),
      getMe: vi.fn(),
    },
    setToken: vi.fn((value) => {
      token = value || "";
    }),
    clearToken: vi.fn(() => {
      token = "";
    }),
    getToken: vi.fn(() => token),
    ensureDeviceRegistered: vi.fn(),
    ensureCurrentDeviceExists: vi.fn(),
    isRevokedDeviceAuth: vi.fn(() => false),
  };
});

vi.mock("../api", () => ({
  api: mocks.api,
    setToken: mocks.setToken,
    clearToken: mocks.clearToken,
    getToken: mocks.getToken,
    isRevokedDeviceAuth: mocks.isRevokedDeviceAuth,
}));

vi.mock("../deviceId", () => ({
  ensureDeviceRegistered: mocks.ensureDeviceRegistered,
  ensureCurrentDeviceExists: mocks.ensureCurrentDeviceExists,
}));

describe("useAuth critical frontend auth flow", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.token = "";

    mocks.api.sendPhone.mockResolvedValue({ sent: true });
    mocks.api.verifyOtp.mockReset();
    mocks.api.completeSetup.mockReset();
    mocks.api.registerEmail.mockReset();
    mocks.api.loginEmail.mockReset();
    mocks.api.refreshToken.mockReset();
    mocks.api.logout.mockResolvedValue({ loggedOut: true });
    mocks.api.getMe.mockResolvedValue({ id: 1, username: "alice", firstName: "Alice" });

    mocks.ensureDeviceRegistered.mockResolvedValue("device-a");
    mocks.ensureCurrentDeviceExists.mockResolvedValue("device-a");
    mocks.isRevokedDeviceAuth.mockReturnValue(false);
  });

  it("verifyOtp handles new phone user by storing setupToken and moving to setup branch without JWT", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.api.verifyOtp.mockResolvedValueOnce({
      setupToken: "setup-token-1",
      phone: "+79001234567",
    });

    const onSuccess = vi.fn();

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      result.current.setPhone("9001234567");
    });

    await act(async () => {
      await result.current.verifyOtp(["1", "2", "3", "4", "5", "6"], onSuccess);
    });

    expect(mocks.api.verifyOtp).toHaveBeenCalledWith("+79001234567", "123456");
    expect(result.current.setupToken).toBe("setup-token-1");
    expect(result.current.me).toEqual({ phone: "+79001234567" });
    expect(onSuccess).toHaveBeenCalledWith({ phone: "+79001234567" }, true);

    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(mocks.ensureDeviceRegistered).not.toHaveBeenCalled();
  });

  it("finishSetup completes setup in correct order: token -> device -> me -> callback", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.api.verifyOtp.mockResolvedValueOnce({
      setupToken: "setup-token-1",
    });

    mocks.ensureCurrentDeviceExists.mockRejectedValueOnce(new Error("device is not registered"));
    mocks.api.completeSetup.mockResolvedValueOnce({
      token: "jwt-after-setup",
      refreshToken: "refresh-after-setup",
      deviceRegistrationToken: "device-reg-after-setup",
      isNewUser: false,
    });

    mocks.api.getMe.mockResolvedValueOnce({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });

    const onSetupBranch = vi.fn();
    const onFinished = vi.fn();

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      result.current.setPhone("9001234567");
    });

    await act(async () => {
      await result.current.verifyOtp(["1", "2", "3", "4", "5", "6"], onSetupBranch);
    });

    await act(async () => {
      await result.current.finishSetup({
        firstName: "Alice",
        username: "alice",
        avatarUrl: null,
      }, onFinished);
    });

    expect(mocks.api.completeSetup).toHaveBeenCalledWith("setup-token-1", {
      firstName: "Alice",
      username: "alice",
      avatarUrl: null,
    });

    expect(mocks.setToken).toHaveBeenCalledWith("jwt-after-setup");
    expect(localStorage.getItem("cm_refresh_token")).toBeNull();
    expect(mocks.ensureDeviceRegistered).toHaveBeenCalledWith("device-reg-after-setup");
    expect(mocks.api.getMe).toHaveBeenCalled();

    expect(result.current.setupToken).toBeNull();
    expect(result.current.me).toEqual({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });

    expect(onFinished).toHaveBeenCalledWith({
      id: 1,
      username: "alice",
      firstName: "Alice",
    }, false);
  });

  it("finishSetup exposes backend failure and keeps user on setup branch", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.api.verifyOtp.mockResolvedValueOnce({
      setupToken: "setup-token-1",
    });

    mocks.api.completeSetup.mockRejectedValueOnce(new Error("username is taken"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.verifyOtp(["1", "2", "3", "4", "5", "6"], vi.fn(), "+7", "9001234567");
    });

    await act(async () => {
      await expect(result.current.finishSetup({
        firstName: "Alice",
        username: "taken",
      }, vi.fn())).rejects.toThrow("username is taken");
    });

    expect(result.current.authError).toBe("username is taken");
    expect(result.current.setupToken).toBe("setup-token-1");
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(mocks.ensureDeviceRegistered).not.toHaveBeenCalled();
  });

  it("restoreSession re-binds a missing device with JWT instead of a refresh registration token", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.token = "jwt-existing";
    mocks.api.getMe.mockResolvedValueOnce({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });

    mocks.ensureCurrentDeviceExists
      .mockRejectedValueOnce(new Error("device is not registered"))
      .mockResolvedValueOnce("device-a");

    const onRestored = vi.fn();

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.restoreSession(onRestored);
    });

    expect(mocks.api.refreshToken).not.toHaveBeenCalled();
    expect(mocks.ensureDeviceRegistered).toHaveBeenCalledWith();
    expect(mocks.ensureCurrentDeviceExists).toHaveBeenCalledTimes(2);
    expect(onRestored).toHaveBeenCalledWith({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });
  });

  it("restoreSession does not re-register a revoked device", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.token = "jwt-stolen";
    mocks.api.getMe.mockResolvedValueOnce({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });
    const revoked = Object.assign(new Error("Current device is revoked or inactive"), {
      status: 401,
      code: "DEVICE_REVOKED",
    });
    mocks.ensureCurrentDeviceExists.mockRejectedValueOnce(revoked);
    mocks.isRevokedDeviceAuth.mockReturnValue(true);

    const onRestored = vi.fn();
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.restoreSession(onRestored);
    });

    expect(mocks.ensureDeviceRegistered).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(result.current.screen).toBe("auth");
  });

  it("restoreSession moves to setup screen when profile is incomplete", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.token = "jwt-existing";
    mocks.api.getMe.mockResolvedValueOnce({
      id: 1,
      username: "user_tmp",
      firstName: "",
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.restoreSession(vi.fn());
    });

    expect(result.current.screen).toBe("setup");
    expect(result.current.me).toEqual({
      id: 1,
      username: "user_tmp",
      firstName: "",
    });
  });

  it("submitEmail trims/lowercases email and performs full login", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.ensureCurrentDeviceExists.mockRejectedValueOnce(new Error("device is not registered"));
    mocks.api.loginEmail.mockResolvedValueOnce({
      token: "jwt-email",
      refreshToken: "refresh-email",
      deviceRegistrationToken: "device-reg-email",
      isNewUser: false,
    });

    mocks.api.getMe.mockResolvedValueOnce({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });

    const onSuccess = vi.fn();

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.submitEmail("login", onSuccess, "  Alice@Test.COM  ", "pass123");
    });

    expect(mocks.api.loginEmail).toHaveBeenCalledWith("alice@test.com", "pass123");
    expect(mocks.setToken).toHaveBeenCalledWith("jwt-email");
    expect(mocks.ensureDeviceRegistered).toHaveBeenCalledWith("device-reg-email");
    expect(onSuccess).toHaveBeenCalledWith({
      id: 1,
      username: "alice",
      firstName: "Alice",
    }, false);
  });

  it("login on the same enrolled device rebinds it and does not re-register", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    mocks.api.loginEmail.mockResolvedValueOnce({
      token: "jwt-email",
      refreshToken: "refresh-email",
      deviceRegistrationToken: "device-reg-email",
      isNewUser: false,
    });
    mocks.api.getMe.mockResolvedValueOnce({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.submitEmail("login", onSuccess, "alice@test.com", "pass123");
    });

    expect(mocks.ensureCurrentDeviceExists).toHaveBeenCalledTimes(1);
    expect(mocks.ensureDeviceRegistered).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({
      id: 1,
      username: "alice",
      firstName: "Alice",
    }, false);
  });
});