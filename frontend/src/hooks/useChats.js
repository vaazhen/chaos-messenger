import { useState, useCallback } from "react";
import { api } from "../api";
import { mapChat, getTime } from "../helpers";

/**
 * Manages the chat list: loading, selecting, unread counters.
 */
export function useChats(myId) {
  const [chats, setChats]             = useState([]);
  const [activeId, setActiveId]       = useState(null);
  const [loadingChats, setLoadingChats] = useState(false);

  const loadChats = useCallback(async (id) => {
    const resolvedId = id ?? myId;
    setLoadingChats(true);
    try {
      const data = await api.getChats();
      if (Array.isArray(data)) {
        setChats(data.map(c => mapChat(c, resolvedId)));
      }
    } catch (e) {
      console.error("loadChats:", e);
    } finally {
      setLoadingChats(false);
    }
  }, [myId]);

  const selectChat = useCallback((id) => {
    setActiveId(id);
    setChats(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c));
  }, []);

  const updateChatPreview = useCallback((chatId, preview, isOut = false, createdAt = null, incrementUnread = false) => {
    const activityAt = normalizeChatActivityAt(createdAt);

    setChats(prev => sortChatsByActivity(
      prev.map(chat => {
        if (String(chat.id) !== String(chatId)) {
          return chat;
        }

        const currentUnread = Number(chat.unread || 0);
        const nextUnread = incrementUnread ? currentUnread + 1 : currentUnread;

        return {
          ...chat,
          preview: preview || chat.preview || "",
          lastOut: Boolean(isOut),
          time: formatChatActivityTime(activityAt),
          lastMessageAt: activityAt,
          lastActivityAt: activityAt,
          unread: nextUnread,
        };
      })
    ));
  }, []);

  const markChatOnlineStatus = useCallback((username, isOnline) => {
    setChats(prev => prev.map(c =>
      c.username === username ? { ...c, online: isOnline } : c
    ));
  }, []);

  return {
    chats, setChats,
    activeId, setActiveId,
    loadingChats,
    loadChats,
    selectChat,
    updateChatPreview,
    markChatOnlineStatus,
  };
}
function normalizeChatActivityAt(value) {
  if (!value) return new Date().toISOString();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function formatChatActivityTime(value) {
  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "";
  }

  const now = new Date();
  const diff = now - d;

  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  if (diff < 604800000) {
    return d.toLocaleDateString("ru-RU", { weekday: "short" });
  }

  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function getChatActivityMs(chat) {
  const raw =
    chat?.lastActivityAt ||
    chat?.lastMessageAt ||
    chat?.updatedAt ||
    chat?.createdAt ||
    null;

  if (!raw) return 0;

  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function sortChatsByActivity(chats) {
  return [...(chats || [])].sort((a, b) => {
    const byActivity = getChatActivityMs(b) - getChatActivityMs(a);
    if (byActivity !== 0) return byActivity;

    return Number(b.id || 0) - Number(a.id || 0);
  });
}