import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth } from "../hooks/useAuth";

vi.mock("../api", () => ({
  api: {
    sendPhone:   vi.fn().mockResolvedValue({ sent: true }),
    verifyOtp:   vi.fn(),
    getMe:       vi.fn().mockResolvedValue({ id: 1, username: "user_abc", firstName: "Test" }),
    refreshToken: vi.fn().mockResolvedValue(null),
    logout:      vi.fn().mockResolvedValue(null),
  },
  setToken:   vi.fn(),
  clearToken: vi.fn(),
  getToken:   vi.fn().mockReturnValue(""),
}));

vi.mock("../deviceId", () => ({
  ensureDeviceRegistered: vi.fn().mockResolvedValue("device-123"),
  ensureCurrentDeviceExists: vi.fn().mockResolvedValue("device-123"),
}));

describe("useAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("starts in loading screen", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.screen).toBe("loading");
  });

  it("submitPhone transitions to otp screen", async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      result.current.setPhone("9991234567");
    });
    await act(async () => {
      await result.current.submitPhone();
    });
    expect(result.current.screen).toBe("otp");
    expect(result.current.authError).toBeNull();
  });

  it("submitPhone sets error on API failure", async () => {
    const { api } = await import("../api");
    api.sendPhone.mockRejectedValueOnce(new Error("SMS failed"));
    const { result } = renderHook(() => useAuth());
    await act(async () => { result.current.setPhone("9991234567"); });
    await act(async () => { await result.current.submitPhone(); });
    expect(result.current.authError).toContain("SMS failed");
    expect(result.current.screen).not.toBe("otp");
  });

  it("verifyOtp calls onSuccess with me data", async () => {
    const { api, setToken } = await import("../api");
    api.verifyOtp.mockResolvedValueOnce({
      token: "jwt-token",
      refreshToken: "refresh-token",
      deviceRegistrationToken: "dreg-token",
      isNewUser: false,
    });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      result.current.setPhone("9991234567");
    });
    await act(async () => {
      await result.current.verifyOtp(["1","2","3","4","5","6"], onSuccess);
    });
    expect(setToken).toHaveBeenCalledWith("jwt-token");
    expect(onSuccess).toHaveBeenCalled();
  });
});
