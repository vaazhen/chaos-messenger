import { getToken, API_BASE } from "./api";

/**
 * Generates UUID v4.
 * Uses crypto.randomUUID() when available (localhost / HTTPS).
 * Fallback uses crypto.getRandomValues() for non-secure contexts.
 */
function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Returns deviceId from window.e2ee (crypto-engine.js).
 * Fallback generates UUID with the same storage key format.
 */
export function getOrCreateDeviceId() {
  if (window.e2ee?.getOrCreateDeviceId) {
    return window.e2ee.getOrCreateDeviceId();
  }
  const token = getToken();
  let username = "anonymous";
  try {
    if (token) {
      username =
          JSON.parse(
              atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
          )?.sub || "anonymous";
    }
  } catch (_) {}
  const key = `cm_device_id:${username}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = "device-" + generateUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * Registers the device through crypto-engine.js.
 * Called right after OTP verify-code.
 *
 * @param {string} deviceRegistrationToken — short-lived token (60 s) from verify-code.
 *   When omitted, the legacy JWT fallback is used for compatibility only.
 */
export async function ensureDeviceRegistered(deviceRegistrationToken) {
  if (!window.e2ee?.ensureDeviceRegistered) {
    console.warn("[E2EE] crypto-engine.js is not loaded");
    return getOrCreateDeviceId();
  }

  const token   = getToken();
  const baseUrl = API_BASE.replace(/\/api$/, "");

  const apiFn = async (path, opts = {}) => {
    const extraHeaders = {};
    // Pass the device registration token to the /register endpoint
    if (deviceRegistrationToken && path.includes("/crypto/devices/register")) {
      extraHeaders["X-Device-Registration-Token"] = deviceRegistrationToken;
    }
    const r = await fetch(baseUrl + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        ...extraHeaders,
        ...opts.headers,
      },
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body?.message || `${r.status}`);
    }
    return r.json().catch(() => null);
  };
  apiFn.__canRegisterDevice = Boolean(deviceRegistrationToken);

  await window.e2ee.ensureDeviceRegistered(apiFn);
  const deviceId = window.e2ee.getOrCreateDeviceId();
  console.log("[E2EE] Device registered:", deviceId);
  return deviceId;
}

/**
 * Checks that the current local device is already registered on the backend.
 * Used only during session restore / page reload.
 *
 * Important: this must NOT call /api/crypto/devices/register, because reload
 * flow does not have X-Device-Registration-Token anymore.
 */
export async function ensureCurrentDeviceExists() {
  const token = getToken();
  if (!token) {
    throw new Error("Missing JWT token");
  }

  const deviceId = getOrCreateDeviceId();
  const r = await fetch(`${API_BASE}/crypto/devices/current`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      "X-Device-Id": deviceId,
    },
  });

  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.message || `${r.status} ${r.statusText}`);
  }

  return deviceId;
}
