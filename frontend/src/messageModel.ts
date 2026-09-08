import type {
  ChatMessageMap,
  CompactReply,
  MessageAttachment,
  MessagePayloadV1,
  ParsedMessage,
  TimelineMessage,
} from "./types/protocol";

export function envelopeForDecrypt<T extends object>(
  envelope: T | null | undefined,
  senderDeviceId?: string,
  chatId?: number | null,
  senderUserId?: number | string | null,
): T | null | undefined {
  if (!envelope) return envelope;
  return {
    ...envelope,
    senderDeviceId: senderDeviceId || (envelope as { senderDeviceId?: string }).senderDeviceId,
    _chatId: chatId ?? (envelope as { _chatId?: number })._chatId,
    ...(senderUserId != null && senderUserId !== ''
      ? { _senderUserId: Number(senderUserId) }
      : {}),
  };
}

export function mergeIncomingMessage(
  existing: TimelineMessage | null | undefined,
  incoming: TimelineMessage,
): TimelineMessage {
  if (!existing) return incoming;

  const incomingEncrypted = isEncryptedPlaceholder(incoming);
  const existingPlain = hasRenderablePlaintext(existing);
  if (incomingEncrypted && existingPlain) {
    return {
      ...incoming,
      content: existing.content,
      _text: existing._text,
      _img: existing._img,
      _voice: existing._voice,
      _videoNote: existing._videoNote,
      _payload: existing._payload,
      _attachment: existing._attachment,
      _ttl: existing._ttl,
      expiresAt: existing.expiresAt,
      _time: existing._time,
    };
  }

  return { ...existing, ...incoming };
}

export function isEncryptedPlaceholder(msg: TimelineMessage | null | undefined): boolean {
  return !msg || msg.content === "[encrypted]" || msg._text === "[encrypted]";
}

export function hasRenderablePlaintext(msg: TimelineMessage | null | undefined): boolean {
  if (!msg) return false;
  if (msg._img || msg._voice || msg._videoNote || msg._attachment) return true;
  return Boolean(msg._text && msg._text !== "[encrypted]");
}

export function updateMessageReactions(
  prev: ChatMessageMap,
  chatId: string | number,
  messageId: string | number,
  reactions: Record<string, number> | null | undefined,
  actorUserId: string | number,
  emoji: string | null | undefined,
  active: boolean,
  myId: string | number,
): ChatMessageMap {
  const key = String(chatId);
  return {
    ...prev,
    [key]: (prev[key] || []).map((m) => {
      if (String(m.id) !== String(messageId)) return m;

      let myReactions = Array.isArray(m.myReactions) ? [...m.myReactions] : [];

      if (Number(actorUserId) === Number(myId) && emoji) {
        myReactions = active
          ? [...new Set([...myReactions, emoji])]
          : myReactions.filter((entry) => entry !== emoji);
      }

      return {
        ...m,
        reactions: reactions || {},
        myReactions,
      };
    }),
  };
}

export function adjustReactionSummary(
  summary: Record<string, number> | null | undefined,
  emoji: string,
  delta: number,
): Record<string, number> {
  const next = { ...(summary || {}) };
  const value = Math.max(0, Number(next[emoji] || 0) + delta);

  if (value <= 0) delete next[emoji];
  else next[emoji] = value;

  return next;
}

function emptyParsed(text: string): ParsedMessage {
  return { text, img: null, voice: null, videoNote: null, payload: null, attachment: null, replyTo: null };
}

export function parseMessagePayload(raw: unknown): ParsedMessage {
  const fallbackText = String(raw || "");
  if (!fallbackText || fallbackText === "[encrypted]") {
    return emptyParsed(fallbackText);
  }
  try {
    const payload = JSON.parse(fallbackText) as MessagePayloadV1;
    if (payload?.v === 1 && payload?.type === "image") {
      const image = payload.image || {};
      const attachment = payload.attachment || null;
      const img = image.dataUrl || payload.dataUrl || null;
      return {
        text: String(payload.text || ""),
        img: isInlineDataSrc(img) ? img : null,
        voice: null,
        videoNote: null,
        payload,
        attachment,
        ttl: payload.ttl || null,
        replyTo: payload.replyTo || null,
      };
    }
    if (payload?.v === 1 && payload?.type === "voice") {
      const voice = payload.voice || {};
      const attachment = payload.attachment || null;
      const transcript = String(payload.text || voice.transcript || attachment?.transcript || "");
      return {
        text: transcript,
        img: null,
        voice: isInlineDataSrc(voice.dataUrl) ? { ...voice, transcript } : null,
        videoNote: null,
        payload,
        attachment,
        ttl: payload.ttl || null,
        replyTo: payload.replyTo || null,
      };
    }
    if (payload?.v === 1 && payload?.type === "video_note") {
      const attachment = payload.attachment || null;
      const note = payload.videoNote || {};
      const src = isInlineDataSrc(note.src) ? note.src : null;
      return {
        text: String(payload.text || ""),
        img: null,
        voice: null,
        videoNote: src
          ? {
              src,
              durationMs: note.durationMs || attachment?.durationMs || 0,
              mime: playbackMime(note.mime, attachment?.mimeType || "video/webm"),
            }
          : null,
        payload,
        attachment,
        ttl: payload.ttl || null,
        replyTo: payload.replyTo || null,
      };
    }
    if (payload?.v === 1 && payload?.type === "file") {
      const attachment = payload.attachment || {};
      return {
        text: String(payload.text || ""),
        img: null,
        voice: null,
        videoNote: null,
        payload,
        attachment,
        ttl: payload.ttl || null,
        replyTo: payload.replyTo || null,
      };
    }
    if (payload?.v === 1) {
      return {
        text: String(payload.text || fallbackText),
        img: null,
        voice: null,
        videoNote: null,
        payload,
        attachment: null,
        ttl: payload.ttl || null,
        replyTo: payload.replyTo || null,
      };
    }
  } catch {
    // regular text message
  }
  return emptyParsed(fallbackText);
}

export function messagePreview(parsed: Partial<ParsedMessage> | null | undefined): string {
  if (parsed?.payload?.type === "video_note") return parsed.text ? `🎥 ${parsed.text}` : "Video message";
  if (parsed?.attachment?.attachmentId && parsed?.payload?.type === "file") {
    const name = parsed.attachment.fileName || "File";
    return parsed.text ? `📎 ${parsed.text}` : `📎 ${name}`;
  }
  if (parsed?.img) return parsed.text ? `📷 ${parsed.text}` : "📷 Photo";
  if (parsed?.payload?.type === "voice" || parsed?.voice) {
    const caption = parsed.voice?.transcript || parsed.text;
    return caption ? `Voice: ${caption}` : "Voice message";
  }
  return parsed?.text || "";
}

export function buildEditedPayload(msg: TimelineMessage | null | undefined, text: string): {
  plaintext: string;
  parsed: ParsedMessage;
} {
  const replyTo = msg?._replyTo || msg?._payload?.replyTo || null;
  if (msg?._payload?.v === 1 && msg?._payload?.type === "image") {
    const payload: MessagePayloadV1 = { ...msg._payload, text };
    if (replyTo) payload.replyTo = replyTo;
    const image = payload.image || {};
    return {
      plaintext: JSON.stringify(payload),
      parsed: {
        text,
        img: image.dataUrl || payload.dataUrl || (typeof msg._img === "string" ? msg._img : null),
        voice: null,
        videoNote: null,
        payload,
        attachment: payload.attachment || null,
        replyTo,
      },
    };
  }

  if (msg?._payload?.v === 1 && msg?._payload?.type === "voice") {
    const payload: MessagePayloadV1 = { ...msg._payload, text };
    if (replyTo) payload.replyTo = replyTo;
    const voice = payload.voice || {};
    return {
      plaintext: JSON.stringify(payload),
      parsed: {
        text,
        img: null,
        voice: voice.dataUrl ? voice : (msg._voice as ParsedMessage["voice"]) || null,
        videoNote: null,
        payload,
        attachment: payload.attachment || null,
        replyTo,
      },
    };
  }

  if (replyTo) {
    const payload: MessagePayloadV1 = { v: 1, type: "text", text, replyTo };
    return {
      plaintext: JSON.stringify(payload),
      parsed: { text, img: null, voice: null, videoNote: null, payload, attachment: null, replyTo },
    };
  }

  return {
    plaintext: text,
    parsed: { text, img: null, voice: null, videoNote: null, payload: null, attachment: null, replyTo: null },
  };
}

export function compactReplyTo(replyTo: Record<string, unknown> | CompactReply | null | undefined): CompactReply | null {
  if (!replyTo) return null;
  const record = replyTo as Record<string, unknown>;
  return {
    id: (record.id ?? record.messageId ?? null) as string | number | null,
    _text: String(record._text || record.content || "").slice(0, 500),
    _img: Boolean(record._img),
    _voice: Boolean(record._voice),
    _videoNote: Boolean(record._videoNote),
  };
}

export function isInlineDataSrc(value: unknown): boolean {
  const raw = String(value || "");
  return raw.startsWith("data:") || raw.startsWith("blob:");
}

export function visibleMessageText(msg: {
  _text?: string | undefined;
  content?: string | undefined;
  envelope?: unknown;
} | null | undefined): string {
  if (!msg) return "[encrypted]";
  if (msg.envelope && (msg._text == null || msg._text === "" || msg._text === "[encrypted]")) {
    return "[encrypted]";
  }
  return msg._text ?? msg.content ?? "[encrypted]";
}

export function playbackMime(mime: unknown, fallback = "application/octet-stream"): string {
  const raw = String(mime || fallback || "").split(";")[0]?.trim();
  return raw || fallback;
}

export function hiddenKey(myId: string | number | null | undefined): string {
  return `cm_hidden_message_ids:${myId || "anonymous"}`;
}

export function loadHiddenMessageIds(myId: string | number | null | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(hiddenKey(myId));
    const parsed = JSON.parse(raw || "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function addHiddenMessageId(myId: string | number | null | undefined, messageId: string | number): void {
  const ids = loadHiddenMessageIds(myId);
  ids.add(String(messageId));
  try {
    localStorage.setItem(hiddenKey(myId), JSON.stringify([...ids].slice(-2000)));
  } catch {
    /* ignore optional failure */
  }
}

export type { ChatMessageMap, CompactReply, MessageAttachment, ParsedMessage, TimelineMessage };
