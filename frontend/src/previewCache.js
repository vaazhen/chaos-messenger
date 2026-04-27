import { getOrCreateDeviceId } from "./deviceId";

const PREVIEW_PREFIX = "cm_decrypted_preview";
const INDEX_PREFIX = "cm_decrypted_preview_index";
const MAX_INDEX_SIZE = 500;

function normalize(value, fallback = "unknown") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

export function previewKey({ userId, deviceId, chatId, messageId }) {
  return [
    PREVIEW_PREFIX,
    normalize(userId, "anonymous"),
    normalize(deviceId, "no-device"),
    normalize(chatId, "no-chat"),
    normalize(messageId, "no-message"),
  ].join(":");
}

function indexKey({ userId, deviceId }) {
  return [
    INDEX_PREFIX,
    normalize(userId, "anonymous"),
    normalize(deviceId, "no-device"),
  ].join(":");
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function rememberKey({ userId, deviceId }, key) {
  const idxKey = indexKey({ userId, deviceId });
  const current = readJson(idxKey, []);
  const next = [key, ...current.filter(item => item !== key)].slice(0, MAX_INDEX_SIZE);
  writeJson(idxKey, next);
}

export function saveMessagePreview({ userId, deviceId = getOrCreateDeviceId(), chatId, messageId, preview, createdAt, isOut }) {
  if (!chatId || !messageId) return;
  const cleanPreview = String(preview || "").trim();
  if (!cleanPreview || cleanPreview === "[encrypted]") return;

  const key = previewKey({ userId, deviceId, chatId, messageId });
  writeJson(key, {
    preview: cleanPreview,
    createdAt: createdAt || null,
    isOut: Boolean(isOut),
    savedAt: new Date().toISOString(),
  });
  rememberKey({ userId, deviceId }, key);
}

export function loadMessagePreview({ userId, deviceId = getOrCreateDeviceId(), chatId, messageId }) {
  if (!chatId || !messageId) return null;
  const value = readJson(previewKey({ userId, deviceId, chatId, messageId }), null);
  return value?.preview ? value : null;
}

export function clearPreviewCacheForUser(userId, deviceId = getOrCreateDeviceId()) {
  const idxKey = indexKey({ userId, deviceId });
  const keys = readJson(idxKey, []);
  if (Array.isArray(keys)) {
    keys.forEach(key => {
      try { localStorage.removeItem(key); } catch (_) {}
    });
  }
  try { localStorage.removeItem(idxKey); } catch (_) {}
}