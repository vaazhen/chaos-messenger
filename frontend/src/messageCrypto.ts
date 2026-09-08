import { getToken, API_BASE } from "./api";
import { createCryptoApi } from "./cryptoApi";
import { getOrCreateDeviceId } from "./deviceId";
import { getE2ee } from "./e2ee";
import { getTime } from "./helpers";
import { saveMessagePreview } from "./previewCache";
import * as localStore from "./localMessageStore";
import { hydrateAttachment } from "./messageAttachments";
import {
  envelopeForDecrypt,
  isEncryptedPlaceholder,
  parseMessagePayload,
  messagePreview,
} from "./messageModel";
import type { CryptoApi, DecryptEnvelope, TimelineMessage } from "./types/protocol";

export async function persistDecryptedMessages(
  messages: Array<TimelineMessage | null | undefined> | null | undefined,
): Promise<void> {
  const persistable = (messages || []).filter((m) => m && !isEncryptedPlaceholder(m));
  if (persistable.length === 0) return;
  await localStore.saveMessages(persistable);
}

export async function decryptMsg(
  msg: TimelineMessage,
  myId: string | number,
  fallbackChatId: string | number,
): Promise<TimelineMessage> {
  const e2ee = getE2ee();
  let decryptedText = "[encrypted]";

  if (msg.envelope && e2ee?.decryptEnvelope) {
    try {
      const envelope = envelopeForDecrypt(
        msg.envelope,
        msg.senderDeviceId,
        (msg.chatId || fallbackChatId) as number,
        msg.senderId,
      );
      decryptedText = await e2ee.decryptEnvelope(envelope as DecryptEnvelope);
    } catch (e) {
      console.warn("[Timeline] decrypt:", (e as { message?: string }).message);
    }
  } else if (msg.content && msg.content !== "[encrypted]") {
    decryptedText = msg.content;
  }
  const parsed = parseMessagePayload(decryptedText);

  let resolvedImg = parsed.img;
  let resolvedVoice = parsed.voice;
  let resolvedVideoNote = parsed.videoNote;
  let resolvedAttachment = parsed.attachment || null;

  if (resolvedAttachment?.attachmentId && e2ee?.decryptFile) {
    try {
      const hydrated = await hydrateAttachment(resolvedAttachment, parsed.payload?.type);
      resolvedImg = hydrated.img || resolvedImg;
      resolvedVoice = hydrated.voice || resolvedVoice;
      resolvedVideoNote = hydrated.videoNote || resolvedVideoNote;
      resolvedAttachment = hydrated.attachment;
    } catch (e) {
      console.warn("[Timeline] attachment decrypt:", (e as { message?: string }).message);
    }
  }

  let expiresAt = null;
  if (parsed.ttl && msg.createdAt) {
    expiresAt = new Date(new Date(msg.createdAt).getTime() + parsed.ttl * 1000).toISOString();
  }

  saveMessagePreview({
    userId: myId,
    chatId: msg.chatId || fallbackChatId,
    messageId: msg.id || msg.messageId,
    preview: messagePreview(parsed),
    createdAt: msg.createdAt,
    isOut: msg.senderId === myId,
  });
  return {
    ...msg,
    content: decryptedText,
    _text: parsed.text,
    _img: resolvedImg,
    _voice: resolvedVoice,
    _videoNote: resolvedVideoNote,
    _payload: parsed.payload,
    _attachment: resolvedAttachment,
    _ttl: parsed.ttl || null,
    _replyTo: parsed.replyTo || null,
    expiresAt,
    _out: msg.senderId === myId,
    _time: getTime(msg.createdAt),
  };
}

export function makeCryptoApi(): CryptoApi {
  return createCryptoApi({
    token: getToken,
    deviceId: getOrCreateDeviceId,
    baseUrl: API_BASE.replace(/\/api$/, ""),
  });
}
