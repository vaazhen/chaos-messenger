import { loadMessagePreview } from "./previewCache";
import { getOrCreateDeviceId } from "./deviceId";

export const COLORS = [
  "#111111|#555555",
  "#0f6ea8|#49b2ef",
  "#1c7c54|#62d39a",
  "#7c3aed|#c084fc",
  "#ea580c|#fdba74",
  "#be123c|#fb7185",
  "#0f766e|#5eead4"
];

export const color = (i) => {
  const [a, b] = COLORS[Math.abs(Number(i || 0)) % COLORS.length].split("|");
  return [a, b];
};

export const getTime = (iso) => {
  const d = iso ? new Date(iso) : new Date();

  if (Number.isNaN(d.getTime())) return "";

  const now = new Date();
  const diff = now - d;

  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  if (diff < 604800000) {
    return d.toLocaleDateString("ru-RU", { weekday: "short" });
  }

  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
};

export const initials = (name) =>
  (name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join("")
    .toUpperCase() || "?";

export const AVATAR_PRESETS = [
  { emoji: "🦊", bg: "linear-gradient(135deg,#e05555,#e09e4f)" },
  { emoji: "🐺", bg: "linear-gradient(135deg,#4fa3e0,#2d6fa8)" },
  { emoji: "🦁", bg: "linear-gradient(135deg,#e09e4f,#d4691e)" },
  { emoji: "🐯", bg: "linear-gradient(135deg,#da7de0,#9d7de0)" },
  { emoji: "🐻", bg: "linear-gradient(135deg,#3fb950,#1a3d1a)" },
  { emoji: "🐼", bg: "linear-gradient(135deg,#8b949e,#21262d)" },
  { emoji: "🦄", bg: "linear-gradient(135deg,#da7de0,#4fa3e0)" },
  { emoji: "🐉", bg: "linear-gradient(135deg,#3fb950,#4fa3e0)" },
];

export const avatarPreset = (avatarUrl) => {
  if (!avatarUrl) return null;

  if (String(avatarUrl) === "preset:saved") {
    return { emoji: "★", bg: "linear-gradient(135deg,#111111,#777777)" };
  }

  if (!String(avatarUrl).startsWith("preset:")) return null;

  const idx = Number(String(avatarUrl).split(":")[1]);
  return Number.isInteger(idx) && idx >= 0 && idx < AVATAR_PRESETS.length ? AVATAR_PRESETS[idx] : null;
};

export const mapChat = (c, myId) => {
  const chatId = c.chatId ?? c.id;
  const rawType = String(c.type || "").toLowerCase();

  const isGroup = rawType === "group";
  const isSaved = rawType === "saved";

  const otherFirstName = c.otherFirstName ?? c.firstName ?? "";
  const otherLastName  = c.otherLastName  ?? c.lastName  ?? "";
  const otherUsername  = c.otherUsername  ?? c.username  ?? "";

  const fallbackName = [otherFirstName, otherLastName].filter(Boolean).join(" ") || otherUsername || "Контакт";

  const name = isSaved
    ? "Избранное"
    : isGroup
      ? (c.name || "Группа")
      : fallbackName;

  const lastMessageId = c.lastMessageId ?? c.messageId ?? null;
  const lastMessageAt = c.lastMessageAt ?? c.createdAt ?? c.updatedAt ?? null;
  const lastSenderId  = c.lastMessageSenderId ?? c.senderId ?? null;

  let cached = null;

  try {
    const deviceId = getOrCreateDeviceId();

    cached = lastMessageId
      ? loadMessagePreview({
          userId: myId,
          deviceId,
          chatId,
          messageId: lastMessageId,
        })
      : null;
  } catch (_) {}

  return {
    id: chatId,
    type: isSaved ? "saved" : (isGroup ? "group" : "direct"),

    name,
    username: otherUsername,
    otherUserId: c.otherUserId ?? null,
    colorIdx: Number(chatId || 0) % 7,
    avatarUrl: isSaved ? "preset:saved" : (c.otherAvatarUrl ?? c.avatarUrl ?? null),

    online: Boolean(c.online),
    unread: Number(c.unreadCount ?? c.unread ?? 0),

    time: getTime(cached?.createdAt || lastMessageAt),
    preview: cached?.preview || "",

    lastMessageId,
    lastOut: cached ? Boolean(cached.isOut) : Number(lastSenderId) === Number(myId),
    lastMessageAt,

    members: Array.isArray(c.participants) ? c.participants.length : Number(c.members ?? 0),
    isSaved,
  };
};

export function messageMatchesQuery(msg, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;

  return String(msg?._text || msg?.content || "")
    .toLowerCase()
    .includes(q);
}