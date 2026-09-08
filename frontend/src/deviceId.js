import { clearAll as clearLocalStore } from "./localMessageStore";
import { getToken, API_BASE } from "./api";
import { createCryptoApi } from "./cryptoApi";
import { getE2ee } from "./e2ee";

function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Storage key — NOT scoped by username (device identity is independent of user account)
const DEVICE_ID_KEY = "cm_device_id";

/**
 * Returns deviceId from the crypto engine.
 * Fallback generates UUID with the unscoped storage key.
 */
export function getOrCreateDeviceId() {
  const e2ee = getE2ee();
  if (e2ee?.getOrCreateDeviceId) {
    return e2ee.getOrCreateDeviceId();
  }
  // Fallback (crypto engine is not loaded yet)
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = "device-" + generateUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Registers the device through the crypto engine.
 * Login passes a one-time enrollment token. Session restore may omit it and
 * only re-bind an already enrolled device whose identity keys still match.
 *
 * @param {string} [deviceRegistrationToken] — short-lived token (60 s) from login.
 */
export async function ensureDeviceRegistered(deviceRegistrationToken, options = {}) {
  const e2ee = getE2ee();
  if (!e2ee?.ensureDeviceRegistered) {
    if (import.meta.env.DEV) console.warn("[E2EE] crypto engine is not loaded");
    return getOrCreateDeviceId();
  }

  const apiFn = createCryptoApi({
    token: getToken,
    deviceId: getOrCreateDeviceId,
    baseUrl: API_BASE.replace(/\/api$/, ""),
    credentials: "include",
    headerFactory: (path) => (
      deviceRegistrationToken && path.includes("/crypto/devices/register")
        ? { "X-Device-Registration-Token": deviceRegistrationToken }
        : {}
    ),
  });
  apiFn.__canRegisterDevice = Boolean(deviceRegistrationToken);

  try {
    await e2ee.ensureDeviceRegistered(apiFn);
  } catch (error) {
    if (!isDeviceIdentityConflict(error) || !e2ee?.resetLocalDeviceIdentity) {
      throw error;
    }
    const confirmed = typeof options.confirmIdentityReset === "function"
      ? await options.confirmIdentityReset(error)
      : false;
    if (!confirmed) {
      error.code = error.code || "DEVICE_IDENTITY_CONFLICT";
      throw error;
    }

    if (import.meta.env.DEV) console.warn("[E2EE] Device id conflict, resetting local identity and retrying registration");
    await e2ee.resetLocalDeviceIdentity();
    clearLocalStore().catch(() => {});
    await e2ee.ensureDeviceRegistered(apiFn);
  }
  const deviceId = e2ee.getOrCreateDeviceId();
  if (import.meta.env.DEV) console.warn("[E2EE] Device registered");
  return deviceId;
}

function isDeviceIdentityConflict(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.status === 409 && message.includes("already registered to another account");
}

/**
 * Checks that the current local device is already registered on the backend.
 * Used only during session restore / page reload.
 */
export async function ensureCurrentDeviceExists() {
  const token = getToken();
  if (!token) throw new Error("Missing JWT token");

  const deviceId = getOrCreateDeviceId();
  const r = await fetch(`${API_BASE}/crypto/devices/current`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      "X-Device-Id": deviceId,
    },
  });

  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const error = new Error(body?.message || `${r.status} ${r.statusText}`);
    error.status = r.status;
    error.code = body?.code ?? body?.error;
    throw error;
  }

  if (getE2ee()?.replenishOneTimePreKeys) {
    await getE2ee().replenishOneTimePreKeys(createCryptoApi({
      token,
      deviceId,
      baseUrl: API_BASE.replace(/\/api$/, ""),
      credentials: "include",
    }));
  }

  return deviceId;
}
