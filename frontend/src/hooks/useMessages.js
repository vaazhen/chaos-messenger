import { useState, useCallback } from "react";
import { api, call, getToken, API_BASE } from "../api";
import { getOrCreateDeviceId } from "../deviceId";
import { getTime } from "../helpers";
import { saveMessagePreview } from "../previewCache";

/**
 * Manages per-chat message maps, loading, sending (E2EE), editing, deleting.
 */
export function useMessages(myId) {
  const [msgs, setMsgs]               = useState({});
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // ── Load & decrypt messages for a chat ──────────────────────────────────────
  const loadMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMsgs(true);
    try {
      const data = await api.getMessages(chatId);
      if (!Array.isArray(data)) return;
      const hidden = loadHiddenMessageIds(myId);
      const decrypted = await Promise.all(
        data
          .filter(msg => !hidden.has(String(msg.id || msg.messageId)))
          .map(msg => decryptMsg(msg, myId, chatId))
      );
      setMsgs(prev => ({ ...prev, [chatId]: decrypted }));
    } catch (e) {
      console.error("loadMessages:", e);
    } finally {
      setLoadingMsgs(false);
    }
    try { await api.markRead(chatId); } catch (_) {}
    try { await api.markDelivered(chatId); } catch (_) {}
  }, [myId]);

  // ── Handle incoming WS event ─────────────────────────────────────────────────
  const handleIncomingEvent = useCallback(async (event, chatId) => {
    if (event.type === "MESSAGE_REACTION") {
      setMsgs(prev => updateMessageReactions(
        prev,
        chatId,
        event.messageId,
        event.reactions,
        event.actorUserId,
        event.emoji,
        event.active,
        myId
      ));
      return { type: event.type, isOut: Number(event.actorUserId) === Number(myId) };
    }

    const messageId = event.id || event.messageId;
    if (messageId && loadHiddenMessageIds(myId).has(String(messageId))) {
      return null;
    }

    if (event.type === "MESSAGE_DELETED") {
      setMsgs(prev => ({
        ...prev,
        [chatId]: (prev[chatId] || []).filter(m => String(m.id) !== String(event.messageId)),
      }));
      return null;
    }

    let decryptedText = "[encrypted]";
    if (event.envelope && window.e2ee?.decryptEnvelope) {
      try {
        const envelope = {
          ...event.envelope,
          senderDeviceId: event.senderDeviceId || event.envelope?.senderDeviceId,
        };
        decryptedText = await window.e2ee.decryptEnvelope(envelope);
      } catch (e) {
        console.warn("[WS] decrypt:", e.message);
      }
    } else if (event.content && event.content !== "[encrypted]") {
      decryptedText = event.content;
    }

    const parsed = parseMessagePayload(decryptedText);
    const isOut = event.senderId === myId;
    const preview = messagePreview(parsed);
    saveMessagePreview({
      userId: myId,
      chatId,
      messageId,
      preview,
      createdAt: event.createdAt,
      isOut,
    });
    const msg = {
      id:        messageId,
      senderId:  event.senderId,
      content:   decryptedText,
      createdAt: event.createdAt,
      editedAt:  event.editedAt,
      version:   event.version,
      status:    event.status || "SENT",
      reactions: event.reactions || {},
      myReactions: event.myReactions || [],
      _out:      isOut,
      _text:     parsed.text,
      _img:      parsed.img,
      _payload:  parsed.payload,
      _time:     getTime(event.createdAt),
    };

    setMsgs(prev => {
      const arr         = prev[chatId] || [];
      const withoutTemp = isOut ? arr.filter(m => !(m._temp && m._clientMessageId === event.clientMessageId)) : arr;
      const idx         = withoutTemp.findIndex(m => String(m.id) === String(msg.id));
      const updated     = idx >= 0
        ? withoutTemp.map((m, i) => i === idx ? { ...m, ...msg } : m)
        : [...withoutTemp, msg];
      return { ...prev, [chatId]: updated };
    });

    return { isOut, text: preview, type: event.type, messageId };
  }, [myId]);

  // ── Update delivery/read status ─────────────────────────────────────────────
  const updateMessageStatus = useCallback((messageId, status) => {
    setMsgs(prev => {
      const updated = {};
      for (const [cid, arr] of Object.entries(prev)) {
        updated[cid] = arr.map(m =>
          String(m.id) === String(messageId) ? { ...m, status } : m
        );
      }
      return updated;
    });
  }, [myId]);

  // ── Send (E2EE) ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (chatId, input) => {
    const text = typeof input === "string" ? input : String(input?.text || "").trim();
    const imgFile = typeof input === "string" ? null : input?.imgFile;
    if ((!text && !imgFile) || !chatId) return null;
    if (!window.e2ee?.buildFanoutRequest) {
      console.error("[Send] crypto-engine is not loaded");
      return null;
    }

    const clientMessageId = "tmp_" + Date.now();
    let parsedPayload = { text, img: null, payload: null };
    let encryptedPlaintext = text;

    try {
      if (imgFile?.file) {
        const image = await compressImageFile(imgFile.file);
        parsedPayload = {
          text,
          img: image.dataUrl,
          payload: {
            v: 1,
            type: "image",
            text,
            image,
          },
        };
        encryptedPlaintext = JSON.stringify(parsedPayload.payload);
      }
    } catch (e) {
      console.error("[Send] image prepare error:", e);
      return null;
    }

    const tempMsg = {
      id: clientMessageId,
      _clientMessageId: clientMessageId,
      _temp: true,
      _out: true,
      _text: parsedPayload.text,
      _img: parsedPayload.img,
      _payload: parsedPayload.payload,
      _time: getTime(),
      content: encryptedPlaintext,
      senderId: myId,
      status: "SENT",
      reactions: {},
      myReactions: [],
    };
    setMsgs(prev => ({ ...prev, [chatId]: [...(prev[chatId] || []), tempMsg] }));

    try {
      const fanout = await window.e2ee.buildFanoutRequest(makeCryptoApi(), chatId, encryptedPlaintext);
      const response = await call("/messages/encrypted/v2", {
        method: "POST",
        body: JSON.stringify({ ...fanout, clientMessageId }),
      });

      if (response?.id || response?.messageId) {
        const savedId = response.id || response.messageId;
        const preview = messagePreview(parsedPayload);
        saveMessagePreview({
          userId: myId,
          chatId,
          messageId: savedId,
          preview,
          createdAt: response.createdAt,
          isOut: true,
        });
        setMsgs(prev => ({
          ...prev,
          [chatId]: (prev[chatId] || []).map(m =>
            m.id === clientMessageId
              ? { ...m, id: savedId, _temp: false, status: response.status || "SENT", reactions: response.reactions || {}, myReactions: response.myReactions || [] }
              : m
          ),
        }));
      }
      return { clientMessageId, response, preview: messagePreview(parsedPayload) };
    } catch (e) {
      console.error("[Send] error:", e);
      setMsgs(prev => ({
        ...prev,
        [chatId]: (prev[chatId] || []).filter(m => m.id !== clientMessageId),
      }));
      return null;
    }
  }, [myId]);

  // ── Edit (E2EE) ─────────────────────────────────────────────────────────────
  const toggleReaction = useCallback(async (chatId, msg, emoji) => {
    if (!chatId || !msg?.id || msg._temp || !emoji) return;

    const had = Array.isArray(msg.myReactions) && msg.myReactions.includes(emoji);
    const nextSummary = adjustReactionSummary(msg.reactions || {}, emoji, had ? -1 : 1);
    const nextMine = had
      ? (msg.myReactions || []).filter(e => e !== emoji)
      : [...new Set([...(msg.myReactions || []), emoji])];

    setMsgs(prev => ({
      ...prev,
      [chatId]: (prev[chatId] || []).map(m =>
        String(m.id) === String(msg.id)
          ? { ...m, reactions: nextSummary, myReactions: nextMine }
          : m
      ),
    }));

    try {
      const event = await api.toggleReaction(msg.id, emoji);
      setMsgs(prev => updateMessageReactions(
        prev,
        chatId,
        event.messageId,
        event.reactions,
        event.actorUserId,
        event.emoji,
        event.active,
        myId
      ));
      return event;
    } catch (e) {
      console.error("[Reaction] error:", e);

      setMsgs(prev => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map(m =>
          String(m.id) === String(msg.id)
            ? { ...m, reactions: msg.reactions || {}, myReactions: msg.myReactions || [] }
            : m
        ),
      }));

      return null;
    }
  }, [myId]);

  const editMessage = useCallback(async (chatId, msg, newText) => {
    const text = String(newText || "").trim();
    if (!chatId || !msg?.id || msg._temp || !text) return null;
    if (!window.e2ee?.buildFanoutRequest) {
      console.error("[Edit] crypto-engine is not loaded");
      return null;
    }

    const previous = { ...msg };
    const nextPayload = buildEditedPayload(msg, text);
    const plaintext = nextPayload.plaintext;
    const parsed = nextPayload.parsed;
    const editedAt = new Date().toISOString();

    setMsgs(prev => ({
      ...prev,
      [chatId]: (prev[chatId] || []).map(m =>
        String(m.id) === String(msg.id)
          ? {
              ...m,
              content: plaintext,
              editedAt,
              version: (m.version || 1) + 1,
              _text: parsed.text,
              _img: parsed.img,
              _payload: parsed.payload,
            }
          : m
      ),
    }));

    try {
      const fanout = await window.e2ee.buildFanoutRequest(makeCryptoApi(), chatId, plaintext);
      const response = await call(`/messages/${msg.id}/encrypted/v2`, {
        method: "PUT",
        body: JSON.stringify({
          senderDeviceId: fanout.senderDeviceId,
          envelopes: fanout.envelopes,
        }),
      });

      setMsgs(prev => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map(m =>
          String(m.id) === String(msg.id)
            ? {
                ...m,
                editedAt: response?.editedAt || editedAt,
                version: response?.version || m.version,
                status: response?.status || m.status,
              }
            : m
        ),
      }));

      const preview = messagePreview(parsed);
      saveMessagePreview({
        userId: myId,
        chatId,
        messageId: msg.id,
        preview,
        createdAt: response?.createdAt || msg.createdAt,
        isOut: true,
      });

      return { response, preview };
    } catch (e) {
      console.error("[Edit] error:", e);
      setMsgs(prev => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map(m =>
          String(m.id) === String(msg.id) ? previous : m
        ),
      }));
      return null;
    }
  }, [myId]);

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteMessage = useCallback((chatId, msg, scope = "everyone") => {
    if (!msg?.id) return;

    setMsgs(prev => ({
      ...prev,
      [chatId]: (prev[chatId] || []).filter(m => String(m.id) !== String(msg.id)),
    }));

    if (scope === "me" || msg._temp) {
      addHiddenMessageId(myId, msg.id);
      return;
    }

    api.deleteMsg(msg.id).catch(console.error);
  }, [myId]);

  return {
    msgs, setMsgs,
    loadingMsgs,
    loadMessages,
    handleIncomingEvent,
    updateMessageStatus,
    sendMessage,
    editMessage,
    toggleReaction,
    deleteMessage,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function decryptMsg(msg, myId, fallbackChatId) {
  let decryptedText = msg.content || "[encrypted]";
  if (msg.envelope && window.e2ee?.decryptEnvelope) {
    try {
      const envelope = {
        ...msg.envelope,
        senderDeviceId: msg.senderDeviceId || msg.envelope?.senderDeviceId,
      };
      decryptedText = await window.e2ee.decryptEnvelope(envelope);
    } catch (e) {
      console.warn("[Timeline] decrypt:", e.message);
    }
  }
  const parsed = parseMessagePayload(decryptedText);
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
    _img: parsed.img,
    _payload: parsed.payload,
    _out:  msg.senderId === myId,
    _time: getTime(msg.createdAt),
  };
}

function updateMessageReactions(prev, chatId, messageId, reactions, actorUserId, emoji, active, myId) {
  return {
    ...prev,
    [chatId]: (prev[chatId] || []).map(m => {
      if (String(m.id) !== String(messageId)) return m;

      let myReactions = Array.isArray(m.myReactions) ? [...m.myReactions] : [];

      if (Number(actorUserId) === Number(myId) && emoji) {
        myReactions = active
          ? [...new Set([...myReactions, emoji])]
          : myReactions.filter(e => e !== emoji);
      }

      return {
        ...m,
        reactions: reactions || {},
        myReactions,
      };
    }),
  };
}

function adjustReactionSummary(summary, emoji, delta) {
  const next = { ...(summary || {}) };
  const value = Math.max(0, Number(next[emoji] || 0) + delta);

  if (value <= 0) delete next[emoji];
  else next[emoji] = value;

  return next;
}

function parseMessagePayload(raw) {
  const fallbackText = String(raw || "");
  if (!fallbackText || fallbackText === "[encrypted]") {
    return { text: fallbackText, img: null, payload: null };
  }
  try {
    const payload = JSON.parse(fallbackText);
    if (payload?.v === 1 && payload?.type === "image") {
      const image = payload.image || {};
      return {
        text: String(payload.text || ""),
        img: image.dataUrl || payload.dataUrl || null,
        payload,
      };
    }
  } catch (_) {
    // regular text message
  }
  return { text: fallbackText, img: null, payload: null };
}

function messagePreview(parsed) {
  if (parsed?.img) return parsed.text ? `📷 ${parsed.text}` : "📷 Photo";
  return parsed?.text || "";
}

function buildEditedPayload(msg, text) {
  if (msg?._payload?.v === 1 && msg?._payload?.type === "image") {
    const payload = { ...msg._payload, text };
    const image = payload.image || {};
    return {
      plaintext: JSON.stringify(payload),
      parsed: {
        text,
        img: image.dataUrl || payload.dataUrl || msg._img || null,
        payload,
      },
    };
  }

  return {
    plaintext: text,
    parsed: { text, img: null, payload: null },
  };
}

function makeCryptoApi() {
  const token    = getToken();
  const deviceId = getOrCreateDeviceId();
  const baseUrl  = API_BASE.replace(/\/api$/, "");

  return async (path, opts = {}) => {
    const r = await fetch(baseUrl + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "X-Device-Id": deviceId,
        ...opts.headers,
      },
    });

    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body?.message || `${r.status}`);
    }

    return r.json().catch(() => null);
  };
}

function hiddenKey(myId) {
  return `cm_hidden_message_ids:${myId || "anonymous"}`;
}

function loadHiddenMessageIds(myId) {
  try {
    const raw = localStorage.getItem(hiddenKey(myId));
    const parsed = JSON.parse(raw || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function addHiddenMessageId(myId, messageId) {
  const ids = loadHiddenMessageIds(myId);
  ids.add(String(messageId));
  try {
    localStorage.setItem(hiddenKey(myId), JSON.stringify([...ids].slice(-2000)));
  } catch (_) {}
}

async function compressImageFile(file) {
  const maxSide = 1280;
  const quality = 0.82;
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  const outputMime = file.type === "image/png" && file.size < 650_000 ? "image/png" : "image/jpeg";
  const output = canvas.toDataURL(outputMime, outputMime === "image/jpeg" ? quality : undefined);

  return {
    dataUrl: output,
    mime: outputMime,
    name: file.name || "image",
    originalMime: file.type || null,
    originalSize: file.size || 0,
    size: Math.round((output.length * 3) / 4),
    width,
    height,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Cannot read image"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Cannot load image"));
    img.src = src;
  });
}
