import { useMemo, useRef, useState } from "react";

const EMOJI_STORAGE_KEY = "cm_recent_emojis";
const MAX_RECENT_EMOJIS = 16;

const EMOJI_CATEGORIES = [
  {
    key: "recent",
    icon: "🕘",
    label: "Recent",
    emojis: [],
  },
  {
    key: "smileys",
    icon: "😊",
    label: "Smileys",
    emojis: ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😍","🥰","😘","😋","😎","🤩","🥳","😌","🤔","😴","😭","😡"],
  },
  {
    key: "gestures",
    icon: "👍",
    label: "Gestures",
    emojis: ["👍","👎","👏","🙌","🤝","👋","🤙","✌️","🤞","💪","🦾","☝️","👆","👇","👈","👉","👌","🙏"],
  },
  {
    key: "hearts",
    icon: "❤️",
    label: "Hearts",
    emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","❣️","💕","💞","💓","💗","💖","💘","💝"],
  },
  {
    key: "party",
    icon: "🎉",
    label: "Celebration",
    emojis: ["🎉","🎊","🎈","🎁","🏆","🥇","🎯","⭐","💫","✨","💥","🔥","🌟","🚀"],
  },
];

function loadRecentEmojis() {
  try {
    const raw = localStorage.getItem(EMOJI_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRecentEmojis(list) {
  try {
    localStorage.setItem(EMOJI_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENT_EMOJIS)));
  } catch {
    // ignore storage errors
  }
}

export default function MessageInput({ onSend, replyTo, onОтменаОтветить, disabled, onTyping }) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCat, setEmojiCat] = useState("recent");
  const [recentEmojis, setRecentEmojis] = useState(() => loadRecentEmojis());
  const [imgFile, setImgFile] = useState(null);
  const inpRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimerRef = useRef(null);

  const emojiCategories = useMemo(() => {
    const recentCategory = {
      ...EMOJI_CATEGORIES[0],
      emojis: recentEmojis,
    };
    return [recentCategory, ...EMOJI_CATEGORIES.slice(1)];
  }, [recentEmojis]);

  const currentCategory = emojiCategories.find((category) => category.key === emojiCat) || emojiCategories[1] || emojiCategories[0];
  const currentEmojis = currentCategory?.emojis?.length ? currentCategory.emojis : (emojiCat === "recent" ? EMOJI_CATEGORIES[1].emojis : []);

  const handleTextChange = (e) => {
    setText(e.target.value);
    if (onTyping) {
      if (typingTimerRef.current) return;
      onTyping();
      typingTimerRef.current = setTimeout(() => { typingTimerRef.current = null; }, 2000);
    }
  };

  const handleSend = () => {
    if (!text.trim() && !imgFile) return;
    onSend({ text: text.trim(), imgFile, replyTo });
    setText("");
    setImgFile(null);
    setShowEmoji(false);
    inpRef.current?.focus();
  };

  const handleKey = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const onFileChange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImgFile({ src: ev.target.result, file });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const addRecentEmoji = (emoji) => {
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJIS);
      saveRecentEmojis(next);
      return next;
    });
  };

  const pickEmoji = (emoji) => {
    setText((prev) => prev + emoji);
    addRecentEmoji(emoji);
    if (emojiCat !== "recent" && !recentEmojis.length) {
      setEmojiCat("recent");
    }
    setShowEmoji(false);
    inpRef.current?.focus();
  };

  return (
    <>
      {replyTo && (
        <div className="reply-prev" onClick={e => e.stopPropagation()}>
          <div style={{ color: "var(--acc)", fontSize: 18 }}>↩</div>
          <div className="reply-prev-inner">
            <div className="reply-prev-name">Ответить</div>
            <div className="reply-prev-txt">{replyTo._img ? "📷 Фото" : replyTo._text}</div>
          </div>
          <button className="modal-close" onClick={onОтменаОтветить}>×</button>
        </div>
      )}

      {imgFile && (
        <div style={{ padding: "8px 14px 0", background: "var(--bg1)", display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <img style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover", border: "1px solid var(--bdr2)" }} src={imgFile.src} alt="" />
            <button style={{ position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: "50%", background: "var(--red)", border: "none", color: "#fff", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setImgFile(null)}>×</button>
          </div>
        </div>
      )}

      <div className="input-bar" onClick={e => e.stopPropagation()}>
        {showEmoji && (
          <div className="emoji-picker" onClick={e => e.stopPropagation()}>
            <div className="emoji-cats">
              {emojiCategories.map((cat) => (
                <button
                  key={cat.key}
                  className={`emoji-cat-btn${emojiCat === cat.key ? " active" : ""}`}
                  onClick={() => setEmojiCat(cat.key)}
                  title={cat.label}
                >
                  <span>{cat.icon}</span>
                </button>
              ))}
            </div>
            <div className="emoji-section-head">
              <span>{currentCategory?.label || "Smileys"}</span>
              {emojiCat === "recent" && recentEmojis.length > 0 && (
                <button
                  type="button"
                  className="emoji-clear-btn"
                  onClick={() => {
                    setRecentEmojis([]);
                    saveRecentEmojis([]);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="emoji-grid">
              {currentEmojis.map((em) => (
                <button key={`${emojiCat}-${em}`} className="emoji-btn" onClick={() => pickEmoji(em)}>{em}</button>
              ))}
              {emojiCat === "recent" && recentEmojis.length === 0 && (
                <div className="emoji-empty">
                  Recently used emoji will appear here.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="inp-area">
          <button className="emoji-trigger" onClick={e => { e.stopPropagation(); setShowEmoji(v => !v); }}>😊</button>
          <textarea
            ref={inpRef}
            className="msg-inp"
            rows={1}
            placeholder="Сообщение..."
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKey}
            disabled={disabled}
          />
          <button className="emoji-trigger" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>📎</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFileChange} />
        </div>

        <button className="send-btn" onClick={handleSend} disabled={(!text.trim() && !imgFile) || disabled}>➤</button>
      </div>
    </>
  );
}
