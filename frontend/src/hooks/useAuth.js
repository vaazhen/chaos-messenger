import { useState, useRef, useCallback } from "react";
import { api, setToken, clearToken, getToken, isRevokedDeviceAuth } from "../api";
import { ensureDeviceRegistered, ensureCurrentDeviceExists } from "../deviceId";

export function useAuth() {
  const [screen,      setScreen]      = useState("loading");
  const [phone,       setPhone]       = useState("");
  const [dialCode,    setDialCode]    = useState("+7");
  const [otp,         setOtp]         = useState(["","","","","",""]);
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [authError,   setAuthError]   = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [me,          setMe]          = useState(null);
  const [setupToken,  setSetupToken]  = useState(null);

  const otpRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];

  const buildFullPhone = (dc, ph) => dc + ph.replace(/\D/g, "");
  const isProfileComplete = (u) => !!String(u?.firstName || "").trim();

  const refreshSession = useCallback(async () => {
    const res = await api.refreshToken();
    if (res?.token) {
      setToken(res.token);
      return res;
    }
    return null;
  }, []);

  const tryRefresh = useCallback(async () => {
    try { return !!(await refreshSession()); }
    catch (_) { return false; }
  }, [refreshSession]);

  const ensureDeviceOrRecover = useCallback(async () => {
    try {
      await ensureCurrentDeviceExists();
      return;
    } catch (firstError) {
      if (isRevokedDeviceAuth(firstError?.status, firstError?.message, firstError?.code)) {
        throw firstError;
      }
      try {
        await ensureDeviceRegistered();
        await ensureCurrentDeviceExists();
      } catch {
        throw firstError;
      }
    }
  }, []);

  const restoreSession = useCallback(async (onRestored) => {
    let hasToken = !!getToken();
    if (!hasToken) hasToken = await tryRefresh();
    if (!hasToken) { setScreen("auth"); return; }
    try {
      let meData;
      try {
        meData = await api.getMe();
      } catch (_firstErr) {
        // JWT expired but refresh token may still be valid
        const refreshed = await tryRefresh();
        if (!refreshed) { clearToken(); setScreen("auth"); return; }
        meData = await api.getMe();
      }
      setMe(meData);
      await ensureDeviceOrRecover();
      if (!isProfileComplete(meData)) { setScreen("setup"); return; }
      onRestored(meData);
    } catch {
      clearToken(); setScreen("auth");
    }
  }, [tryRefresh, ensureDeviceOrRecover]);

  /** Called after a successful OTP / email login — sets JWT and registers device. */
  const completeTokenLogin = useCallback(async (res, onSuccess) => {
    setToken(res.token);
    try {
      await ensureCurrentDeviceExists();
    } catch (firstError) {
      if (isRevokedDeviceAuth(firstError?.status, firstError?.message, firstError?.code)) {
        throw firstError;
      }
      await ensureDeviceRegistered(res.deviceRegistrationToken);
      await ensureCurrentDeviceExists();
    }
    const meData = await api.getMe();
    setMe(meData);
    onSuccess(meData, res.isNewUser || !isProfileComplete(meData));
  }, []);

  const submitPhone = useCallback(async (currentDialCode, currentPhone) => {
    const digits = (currentPhone || phone).replace(/\D/g, "");
    if (digits.length < 4) return;
    setAuthLoading(true); setAuthError(null);
    try {
      await api.sendPhone(buildFullPhone(currentDialCode || dialCode, currentPhone || phone));
      setScreen("otp");
      setTimeout(() => otpRefs[0].current?.focus(), 100);
    } catch (e) { setAuthError("Failed to send code: " + e.message); }
    setAuthLoading(false);
  }, [phone, dialCode, otpRefs]);

  const verifyOtp = useCallback(async (digits, onSuccess, currentDialCode, currentPhone) => {
    setAuthLoading(true); setAuthError(null);
    try {
      const res = await api.verifyOtp(
        buildFullPhone(currentDialCode || dialCode, currentPhone || phone),
        digits.join("")
      );
      if (res?.token) {
        // Existing user — full login
        await completeTokenLogin(res, onSuccess);
      } else if (res?.setupToken) {
        // New user — two-phase registration: store setup token and show profile setup
        setSetupToken(res.setupToken);
        setMe({ phone: buildFullPhone(currentDialCode || dialCode, currentPhone || phone) });
        onSuccess({ phone: buildFullPhone(currentDialCode || dialCode, currentPhone || phone) }, true);
      } else {
        setAuthError("Invalid code");
        setOtp(["","","","","",""]);
        setTimeout(() => otpRefs[0].current?.focus(), 50);
      }
    } catch (e) {
      setAuthError("Error: " + e.message);
      setOtp(["","","","","",""]);
    }
    setAuthLoading(false);
  }, [phone, dialCode, otpRefs, completeTokenLogin]);

  /**
   * Called from SetupProfile when a setupToken is present.
   * Calls /auth/complete-setup, then creates the first full JWT session.
   */
  const finishSetup = useCallback(async (profileData, onSuccess) => {
    if (!setupToken) throw new Error("Setup token is missing");

    setAuthLoading(true);
    setAuthError(null);

    try {
      const res = await api.completeSetup(setupToken, profileData);
      setSetupToken(null);
      return await completeTokenLogin(res, onSuccess);
    } catch (err) {
      const message = err.message || "Failed to complete setup";
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthLoading(false);
    }
  }, [setupToken, completeTokenLogin]);

  const submitEmail = useCallback(async (mode, onSuccess, currentEmail, currentPassword) => {
    const e = (currentEmail  ?? email).trim().toLowerCase();
    const p = currentPassword ?? password;
    if (!e || !p) return;
    setAuthLoading(true); setAuthError(null);
    try {
      const res = mode === "register"
        ? await api.registerEmail(e, p)
        : await api.loginEmail(e, p);
      if (!res?.token) throw new Error("Auth token was not returned");
      await completeTokenLogin(res, onSuccess);
    } catch (err) {
      setAuthError(err.message || "Authentication failed");
    }
    setAuthLoading(false);
  }, [email, password, completeTokenLogin]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch (_) { /* ignore optional failure */ }
    clearToken(); setMe(null); setSetupToken(null); setScreen("auth");
    if (typeof window !== "undefined" && window.location?.reload) {
      window.location.reload();
    }
  }, []);

  return {
    screen, setScreen,
    phone, setPhone,
    dialCode, setDialCode,
    otp, setOtp,
    otpRefs,
    email, setEmail,
    password, setPassword,
    authError, setAuthError,
    authLoading,
    me, setMe,
    setupToken,
    submitPhone,
    verifyOtp,
    finishSetup,
    submitEmail,
    logout,
    restoreSession,
  };
}