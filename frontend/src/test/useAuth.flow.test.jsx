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
      if (value) localStorage.setItem("cm_token", value);
    }),
    clearToken: vi.fn(() => {
      token = "";
      localStorage.removeItem("cm_token");
    }),
    getToken: vi.fn(() => token),
    ensureDeviceRegistered: vi.fn(),
    ensureCurrentDeviceExists: vi.fn(),
  };
});

vi.mock("../api", () => ({
  api: mocks.api,
  setToken: mocks.setToken,
  clearToken: mocks.clearToken,
  getToken: mocks.getToken,
}));

vi.mock("../deviceId", () => ({
  ensureDeviceRegistered: mocks.ensureDeviceRegistered,
  ensureCurrentDeviceExists: mocks.ensureCurrentDeviceExists,
}));

describe("useAuth critical frontend auth flow", () => {
  beforeEach(() => {
    localStorage.clear();
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
    expect(localStorage.getItem("cm_refresh_token")).toBe("refresh-after-setup");
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

  it("restoreSession refreshes JWT and recovers missing device registration", async () => {
    const { useAuth } = await import("../hooks/useAuth");

    localStorage.setItem("cm_refresh_token", "refresh-old");

    mocks.api.refreshToken
      .mockResolvedValueOnce({
        token: "jwt-refreshed-1",
        refreshToken: "refresh-new-1",
      })
      .mockResolvedValueOnce({
        token: "jwt-refreshed-2",
        refreshToken: "refresh-new-2",
        deviceRegistrationToken: "device-reg-recovery",
      });

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

    expect(mocks.api.refreshToken).toHaveBeenCalledTimes(2);
    expect(mocks.setToken).toHaveBeenCalledWith("jwt-refreshed-1");
    expect(mocks.setToken).toHaveBeenCalledWith("jwt-refreshed-2");
    expect(mocks.ensureDeviceRegistered).toHaveBeenCalledWith("device-reg-recovery");
    expect(mocks.ensureCurrentDeviceExists).toHaveBeenCalledTimes(2);

    expect(onRestored).toHaveBeenCalledWith({
      id: 1,
      username: "alice",
      firstName: "Alice",
    });
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
});