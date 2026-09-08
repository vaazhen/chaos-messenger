import { API_BASE } from "./config";
import { createCryptoApi } from "./cryptoApi";
import { getOrCreateDeviceId } from "./deviceId";
import { getToken } from "./api";
import { getE2ee } from "./e2ee";

const CALL_KEY_PREFIX = "chaos-call-key:v1:";

function callCryptoApi() {
  return createCryptoApi({
    token: getToken,
    deviceId: getOrCreateDeviceId,
    baseUrl: API_BASE.replace(/\/api$/, ""),
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let workerRef = null;

function mediaWorker() {
  if (workerRef) return workerRef;
  workerRef = new Worker(new URL("./call-e2ee-worker.js", import.meta.url), { type: "module" });
  return workerRef;
}

export function supportsMediaE2ee() {
  return typeof globalThis.RTCRtpScriptTransform === "function"
    || typeof globalThis.RTCRtpSender !== "undefined" && typeof globalThis.RTCRtpSender.prototype.createEncodedStreams === "function";
}

export function generateCallKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptCallKeyForChat(chatId, rawKey) {
  if (!getE2ee()?.buildFanoutRequest) return [];
  const fanout = await getE2ee().buildFanoutRequest(
    callCryptoApi(),
    chatId,
    CALL_KEY_PREFIX + bytesToBase64(rawKey),
  );
  return (fanout?.envelopes || []).map((envelope) => ({
    ...envelope,
    senderDeviceId: fanout.senderDeviceId,
  }));
}

export async function decryptCallKeyEnvelope(envelopes) {
  if (!getE2ee()?.decryptEnvelope || !Array.isArray(envelopes)) return null;
  const ownId = getOrCreateDeviceId();
  const mine = envelopes.find((item) => item?.targetDeviceId === ownId);
  if (!mine) return null;
  const plaintext = await getE2ee().decryptEnvelope(mine);
  if (!String(plaintext).startsWith(CALL_KEY_PREFIX)) return null;
  return base64ToBytes(String(plaintext).slice(CALL_KEY_PREFIX.length));
}

async function attachTransform(target, action, rawKey) {
  if (!target || !rawKey) return false;
  const keyBuffer = rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength);
  if (typeof globalThis.RTCRtpScriptTransform === "function") {
    target.transform = new globalThis.RTCRtpScriptTransform(mediaWorker(), { action, rawKey: keyBuffer });
    return true;
  }
  if (typeof target.createEncodedStreams !== "function") return false;
  const { readable, writable } = target.createEncodedStreams();
  mediaWorker().postMessage({ action, rawKey: keyBuffer, readable, writable }, [readable, writable]);
  return true;
}

export async function protectSender(sender, rawKey) {
  return attachTransform(sender, "encrypt", rawKey);
}

export async function protectReceiver(receiver, rawKey) {
  return attachTransform(receiver, "decrypt", rawKey);
}

export async function protectPeerConnection(pc, rawKey) {
  if (!pc || !rawKey) return false;
  const senders = await Promise.all((pc.getSenders?.() || []).map((sender) => protectSender(sender, rawKey)));
  const receivers = await Promise.all((pc.getReceivers?.() || []).map((receiver) => protectReceiver(receiver, rawKey)));
  return senders.some(Boolean) || receivers.some(Boolean);
}
