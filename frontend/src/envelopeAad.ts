import type { AADContext } from "./types/protocol";

export const ENVELOPE_AAD_VERSION = 0x03;

function typeCode(messageType: string | undefined): number {
  if (messageType === "PREKEY_WHISPER") return 1;
  if (messageType === "WHISPER") return 2;
  if (messageType === "SELF_WHISPER") return 3;
  return 0;
}

function appendLatin1(base: ArrayBuffer, text: string): ArrayBuffer {
  const value = String(text || "");
  const ext = new ArrayBuffer(base.byteLength + 4 + value.length);
  new Uint8Array(ext).set(new Uint8Array(base), 0);
  const view = new DataView(ext);
  view.setUint32(base.byteLength, value.length, false);
  for (let i = 0; i < value.length; i++) {
    view.setUint8(base.byteLength + 4 + i, value.charCodeAt(i));
  }
  return ext;
}

/** AES-GCM AAD v3: version, type, chat id, index, previous chain length, sender, target, optional ratchet key. */
export function buildEnvelopeAAD({
  messageType,
  chatId,
  messageIndex,
  previousChainLength,
  senderDeviceId,
  targetDeviceId,
  ratchetPublicKey,
}: AADContext): ArrayBuffer {
  const cid = BigInt(chatId != null ? chatId : 0);
  const idx = messageIndex != null ? messageIndex >>> 0 : 0;
  const pcl = previousChainLength != null ? previousChainLength >>> 0 : 0;

  const buf = new ArrayBuffer(22);
  const dv = new DataView(buf);
  dv.setUint8(0, ENVELOPE_AAD_VERSION);
  dv.setUint8(1, typeCode(messageType));
  dv.setBigUint64(2, cid, false);
  dv.setUint32(10, idx, false);
  dv.setUint32(14, pcl, false);

  let body = appendLatin1(buf, senderDeviceId || "");
  body = appendLatin1(body, targetDeviceId || "");
  if (ratchetPublicKey) {
    body = appendLatin1(body, String(ratchetPublicKey));
  }
  return body;
}

export function envelopeAadHex(context: AADContext): string {
  return [...new Uint8Array(buildEnvelopeAAD(context))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
