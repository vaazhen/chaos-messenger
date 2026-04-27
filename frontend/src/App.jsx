import { useEffect, useMemo, useState } from "react";
import { CSS } from "./styles";

import { useAuth }     from "./hooks/useAuth";
import { useChats }    from "./hooks/useChats";
import { useMessages } from "./hooks/useMessages";
import { useI18n }     from "./hooks/useI18n";
import useWebSocket    from "./hooks/useWebSocket";

import AuthScreen   from "./components/AuthScreen";
import SetupProfile from "./components/SetupProfile";
import ChatList     from "./components/ChatList";
import MessageList  from "./components/MessageList";
import MessageInput from "./components/MessageInput";
import ProfileModal from "./components/ProfileModal";
import NewChatModal from "./components/NewChatModal";
import Ava          from "./components/Ava";

import { getTime, messageMatchesQuery } from "./helpers";
import { clearPreviewCacheForUser } from "./previewCache";
import { useUiTranslator } from "./i18n/useUiTranslator";

const THEME_STORAGE_KEY = "cm_theme";

export default function ChaosMessenger() {
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = CSS;
    document.head.appendChild(s);
    return () => s.remove();
  }, []);

  const auth      = useAuth();
  const { lang, t, loadTranslations, switchLang } = useI18n();
  useUiTranslator(lang);
  const chatStore = useChats(auth.me?.id);
  const msgStore  = useMessages(auth.me?.id);

  const [replyTo,        setReplyTo]        = useState(null);
  const [ctx,            setCtx]            = useState(null);
  const [showSettings,   setShowSettings]   = useState(false);
  const [showNewChat,    setShowNewChat]    = useState(false);
  const [typingUsers,    setTypingUsers]    = useState({});
  const [chatSearch,     setChatSearch]     = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [messageSearch,  setMessageSearch]  = useState("");
  const [chatInfoOpen,   setChatInfoOpen]   = useState(false);
  const [chatBg,         setChatBg]         = useState(() => localStorage.getItem("cm_chat_background") || "clean");
  const [chatFilter,     setChatFilter]     = useState("all");
  const [deleteTarget,   setDeleteTarget]   = useState(null);
  const [editTarget,     setEditTarget]     = useState(null);
  const [editText,       setEditText]       = useState("");
  const [editLoading,    setEditLoading]    = useState(false);

  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem(THEME_STORAGE_KEY) || "light";
  });

  const activeChat = chatStore.chats.find(c => c.id === chatStore.activeId);
  const activeMsgs = msgStore.msgs[chatStore.activeId] || [];

  const searchCount = useMemo(() => {
    if (!messageSearch.trim()) return 0;
    return activeMsgs.filter(m => messageMatchesQuery(m, messageSearch)).length;
  }, [activeMsgs, messageSearch]);

  useEffect(() => {
    const h = () => setCtx(null);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    loadTranslations(lang);
    auth.restoreSession(async (meData) => {
      await chatStore.loadChats(meData.id);
      auth.setScreen("app");
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (chatStore.activeId) {
      msgStore.loadMessages(chatStore.activeId);
    }
  }, [chatStore.activeId]); // eslint-disable-line

  const ws = useWebSocket({
    me:       auth.me,
    activeId: chatStore.activeId,
    chatIds:  chatStore.chats.map(c => c.id),
    enabled:  auth.screen === "app",

    onMessage: async (event, chatId) => {
      const result = await msgStore.handleIncomingEvent(event, chatId);
      if (result) {
        const isActive = Number(chatId) === Number(chatStore.activeId);
        if (result.type !== "MESSAGE_EDITED" && result.type !== "MESSAGE_REACTION") {
          chatStore.updateChatPreview(chatId, result.text, result.isOut, event.createdAt, !result.isOut && !isActive);
        }
        if (!result.isOut && isActive) {
          import("./api").then(({ api }) => {
            api.markRead(chatId).catch(() => {});
            api.markDelivered(chatId).catch(() => {});
          });
        }
      }
    },

    onChatListUpdate: () => chatStore.loadChats(auth.me?.id),

    onStatusUpdate: (data) => {
      if (data.type === "delivery" && data.messageId) {
        msgStore.updateMessageStatus(data.messageId, data.status);
      }
      if (data.type === "user_status") {
        chatStore.markChatOnlineStatus(data.username, data.status === "ONLINE");
      }
    },

    onTyping: (data, chatId) => {
      if (!data.username || data.username === auth.me?.username) return;
      setTypingUsers(p => ({ ...p, [chatId]: data.username }));
      setTimeout(() => {
        setTypingUsers(p => {
          if (p[chatId] === data.username) {
            const next = { ...p }; delete next[chatId]; return next;
          }
          return p;
        });
      }, 3000);
    },
  });

  const onVerifyOtpSuccess = async (meData, isNew) => {
    auth.setMe(meData);
    if (isNew) {
      auth.setScreen("setup");
    } else {
      await chatStore.loadChats(meData.id);
      auth.setScreen("app");
    }
  };

  const onSetupDone = async (updatedMe) => {
    auth.setMe(updatedMe);
    await chatStore.loadChats(updatedMe.id);
    auth.setScreen("app");
  };

  const logout = async () => {
    clearPreviewCacheForUser(auth.me?.id);
    await auth.logout();
    chatStore.setChats([]);
    chatStore.setActiveId(null);
    msgStore.setMsgs({});
    setShowSettings(false);
  };

  const sendMsg = async ({ text, imgFile }) => {
    if ((!String(text || "").trim() && !imgFile) || !chatStore.activeId) return;
    const preview = imgFile
      ? (String(text || "").trim() ? `📷 ${String(text).trim()}` : "📷 Фото")
      : String(text).trim();
    chatStore.updateChatPreview(chatStore.activeId, preview, true, getTime());
    setReplyTo(null);
    await msgStore.sendMessage(chatStore.activeId, { text, imgFile });
  };

  const openCtx = (e, msg) => {
    e.preventDefault(); e.stopPropagation();
    setCtx({
      x: Math.min(e.clientX, window.innerWidth  - 208),
      y: Math.min(e.clientY, window.innerHeight - 280),
      msg,
    });
  };

  const reactToMsg = (msg, emoji) => {
    setCtx(null);
    if (!chatStore.activeId || !msg?.id || msg._temp) return;
    if (typeof msgStore.toggleReaction === "function") {
      msgStore.toggleReaction(chatStore.activeId, msg, emoji);
    }
  };

  const beginEdit = (msg) => {
    setCtx(null);
    setEditTarget(msg);
    setEditText(msg?._text || "");
  };

  const submitEdit = async () => {
    const text = editText.trim();
    if (!text || !editTarget || !chatStore.activeId) return;
    setEditLoading(true);
    try {
      const result = await msgStore.editMessage(chatStore.activeId, editTarget, text);
      if (result) {
        const last = activeMsgs[activeMsgs.length - 1];
        if (String(last?.id) === String(editTarget.id)) {
          chatStore.updateChatPreview(chatStore.activeId, result.preview || text, true, getTime());
        }
        setEditTarget(null);
        setEditText("");
      }
    } finally {
      setEditLoading(false);
    }
  };

  const beginDelete = (msg) => { setCtx(null); setDeleteTarget(msg); };

  const confirmDelete = (scope) => {
    if (!deleteTarget || !chatStore.activeId) return;
    msgStore.deleteMessage(chatStore.activeId, deleteTarget, scope);
    setDeleteTarget(null);
    if (scope === "everyone") {
      setTimeout(() => chatStore.loadChats(auth.me?.id), 250);
    }
  };

  const onChatCreated = async (chatId) => {
    setShowNewChat(false);
    msgStore.setMsgs(p => ({ ...p, [chatId]: undefined }));
    await chatStore.loadChats(auth.me?.id);
    chatStore.setActiveId(chatId);
  };

  const goBackToList = () => {
    chatStore.setActiveId(null);
    setReplyTo(null);
    setCtx(null);
    setMessageSearch("");
    setChatSearchOpen(false);
    setChatInfoOpen(false);
  };

  if (auth.screen === "loading") {
    return (
      <div className="boot-screen">
        <div className="boot-mark">C</div>
        <div className="spinner" />
      </div>
    );
  }

  if (auth.screen === "auth" || auth.screen === "otp") {
    return (
      <AuthScreen
        screen={auth.screen}
        phone={auth.phone}       setPhone={auth.setPhone}
        dialCode={auth.dialCode} setDialCode={auth.setDialCode}
        otp={auth.otp}           setOtp={auth.setOtp}
        otpRefs={auth.otpRefs}
        email={auth.email}       setEmail={auth.setEmail}
        password={auth.password} setPassword={auth.setPassword}
        onSubmitPhone={() => auth.submitPhone(auth.dialCode, auth.phone)}
        onVerifyOtp={(digits) => auth.verifyOtp(digits, onVerifyOtpSuccess, auth.dialCode, auth.phone)}
        onSubmitEmail={(mode) => auth.submitEmail(mode, onVerifyOtpSuccess, auth.email, auth.password)}
        loading={auth.authLoading}
        error={auth.authError}
        onBack={() => { auth.setScreen("auth"); auth.setOtp(["","","","","",""]); }}
      />
    );
  }

  if (auth.screen === "setup") {
    return (
      <SetupProfile
        me={auth.me}
        setupToken={auth.setupToken}
        onFinishSetup={(data) => auth.finishSetup(data, onVerifyOtpSuccess)}
        onDone={onSetupDone}
      />
    );
  }

  return (
    <div className={`app mobile-product-shell${activeChat ? " has-active-chat" : ""}`} onClick={() => setCtx(null)}>
      <div className="app-frame">
        <ChatList
          me={auth.me}
          chats={chatStore.chats}
          activeId={chatStore.activeId}
          loadingChats={chatStore.loadingChats}
          search={chatSearch}
          onПоиск={setChatSearch}
          filter={chatFilter}
          onFilterChange={setChatFilter}
          onSelectChat={chatStore.selectChat}
          onNewChat={() => setShowNewChat(true)}
          onOpenНастройки={() => setShowSettings(true)}
          onMarkAllRead={() => {
            chatStore.chats.forEach(c => {
              import("./api").then(({ api }) => api.markRead(c.id).catch(() => {}));
            });
            chatStore.setChats(prev => prev.map(c => ({ ...c, unread: 0 })));
          }}
          t={t}
        />

        <section className={`chat-view chat-bg-${chatBg}`}>
          {!activeChat ? (
            <div className="product-empty">
              <div className="product-empty-icon">◯</div>
              <div className="product-empty-title">Нет сообщений</div>
              <div className="product-empty-sub">Создайте новую переписку.</div>
            </div>
          ) : (
            <>
              <div className="product-chat-head">
                <button className="round-action desktop-hidden" onClick={goBackToList} title="Back">‹</button>
                <Ava name={activeChat.name} colorIdx={activeChat.colorIdx} size="md" online={activeChat.online} avatarUrl={activeChat.avatarUrl} />
                <div className="product-chat-title">
                  <div className="head-name">{activeChat.name}</div>
                  <div className={`head-status${activeChat.online ? "" : " off"}`}>
                    {activeChat.type === "group"
                      ? `${activeChat.members} ${t.participants || "members"}`
                      : activeChat.online ? (t.online || "online") : (t.offline || "last seen recently")}
                  </div>
                </div>
                <div className="chat-head-actions">
                  <button
                    className={`chat-head-btn${chatSearchOpen ? " active" : ""}`}
                    title="Search"
                    onClick={() => { setChatSearchOpen(v => !v); setChatInfoOpen(false); }}
                  >⌕</button>
                  <button
                    className={`chat-head-btn${chatInfoOpen ? " active" : ""}`}
                    title="Chat info"
                    onClick={() => { setChatInfoOpen(v => !v); setChatSearchOpen(false); }}
                  >i</button>
                </div>
              </div>

              {chatSearchOpen && (
                <div className="chat-search-bar" onClick={e => e.stopPropagation()}>
                  <span>⌕</span>
                  <input
                    value={messageSearch}
                    onChange={e => setMessageSearch(e.target.value)}
                    placeholder="Search messages"
                    autoFocus
                  />
                  <b>{messageSearch.trim() ? searchCount : ""}</b>
                  <button onClick={() => { setMessageSearch(""); setChatSearchOpen(false); }}>×</button>
                </div>
              )}

              {chatInfoOpen && (
                <ChatInfoPanel
                  chat={activeChat}
                  chatBg={chatBg}
                  onChangeBg={setChatBg}
                  onClose={() => setChatInfoOpen(false)}
                  onOpenSearch={() => { setChatInfoOpen(false); setChatSearchOpen(true); }}
                />
              )}

              <MessageList
                msgs={activeMsgs}
                me={auth.me}
                activeChat={activeChat}
                loadingMsgs={msgStore.loadingMsgs}
                onContextMenu={openCtx}
                onReact={reactToMsg}
                searchQuery={messageSearch}
                typingUsername={typingUsers[chatStore.activeId] || null}
              />

              <div className="enc-notice">
                <span>🔒</span>
                <span>{t.encrypted_notice || "Encrypted on device"}</span>
              </div>

              <MessageInput
                onSend={sendMsg}
                replyTo={replyTo}
                onОтменаОтветить={() => setReplyTo(null)}
                onTyping={() => ws.sendTyping(chatStore.activeId)}
              />
            </>
          )}
        </section>
      </div>

      {ctx && (
        <div className="ctx-menu product-menu" style={{ left: ctx.x, top: ctx.y }} onClick={e => e.stopPropagation()}>
          <div className="ctx-reactions">
            {["👍","❤️","😂","😮","😢","🔥"].map(em => (
              <button key={em} className="ctx-react" type="button" onClick={() => reactToMsg(ctx.msg, em)}>{em}</button>
            ))}
          </div>
          <div className="menu-line" />
          {ctx.msg?._out && !ctx.msg?._temp && (ctx.msg?._text || ctx.msg?._img) && (
            <button className="ctx-item" onClick={() => beginEdit(ctx.msg)}>
              <span className="ci">✎</span>Edit
            </button>
          )}
          <button className="ctx-item" onClick={() => { setReplyTo(ctx.msg); setCtx(null); }}>
            <span className="ci">↩</span>Reply
          </button>
          {ctx.msg?._text && (
            <button className="ctx-item" onClick={() => { navigator.clipboard?.writeText(ctx.msg._text || ""); setCtx(null); }}>
              <span className="ci">▣</span>Copy
            </button>
          )}
          <div className="menu-line" />
          <button className="ctx-item danger" onClick={() => beginDelete(ctx.msg)}>
            <span className="ci">♜</span>Delete
          </button>
        </div>
      )}

      {editTarget && (
        <div className="modal-bg" onClick={() => !editLoading && setEditTarget(null)}>
          <div className="modal small-modal glass-card" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              Edit message
              <button className="modal-close" onClick={() => !editLoading && setEditTarget(null)}>×</button>
            </div>
            <textarea
              className="field-inp edit-textarea"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              autoFocus rows={4}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitEdit(); }}
            />
            {editTarget._img && <div className="field-hint">Only the image caption will be changed.</div>}
            <div className="btn-row">
              <button className="btn-sec" disabled={editLoading} onClick={() => setEditTarget(null)}>Cancel</button>
              <button className="btn-pri" disabled={editLoading || !editText.trim()} onClick={submitEdit}>
                {editLoading ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-bg" onClick={() => setDeleteTarget(null)}>
          <div className="modal small-modal glass-card" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              Delete message
              <button className="modal-close" onClick={() => setDeleteTarget(null)}>×</button>
            </div>
            <div className="confirm-text">Choose how to delete this message.</div>
            <div className="delete-actions">
              <button className="btn-sec" onClick={() => confirmDelete("me")}>Delete for me</button>
              {deleteTarget._out && !deleteTarget._temp && (
                <button className="btn-pri danger-pri" onClick={() => confirmDelete("everyone")}>Delete for everyone</button>
              )}
              <button className="btn-sec" onClick={() => setDeleteTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <ProfileModal
          me={auth.me}
          lang={lang}
          theme={theme}
          onClose={() => setShowSettings(false)}
          onSaved={(u) => { auth.setMe(u); setShowSettings(false); chatStore.loadChats(u?.id || auth.me?.id); }}
          onToggleTheme={() => setTheme(prev => prev === "dark" ? "light" : "dark")}
          onSwitchLang={() => switchLang(lang === "ru" ? "en" : "ru")}
          onLogout={logout}
        />
      )}

      {showNewChat && (
        <NewChatModal
          me={auth.me}
          onClose={() => setShowNewChat(false)}
          onCreated={onChatCreated}
        />
      )}
    </div>
  );
}

function ChatInfoPanel({ chat, chatBg, onChangeBg, onClose, onOpenSearch }) {
  const backgrounds = [
    { key: "clean",  label: "Clean"  },
    { key: "soft",   label: "Soft"   },
    { key: "grid",   label: "Grid"   },
    { key: "paper",  label: "Paper"  },
  ];
  return (
    <div className="chat-tools-panel" onClick={e => e.stopPropagation()}>
      <div className="chat-tools-head">
        <div><b>Chat settings</b><span>{chat?.name}</span></div>
        <button onClick={onClose}>×</button>
      </div>
      <button className="tool-row" onClick={onOpenSearch}>
        <span>⌕</span><b>Search messages</b><i>›</i>
      </button>
      <div className="tool-card">
        <div className="tool-title">Chat background</div>
        <div className="bg-picker">
          {backgrounds.map(item => (
            <button
              key={item.key}
              className={`bg-option bg-${item.key}${chatBg === item.key ? " active" : ""}`}
              onClick={() => onChangeBg(item.key)}
            >
              <span /><b>{item.label}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="tool-card">
        <div className="tool-title">Security</div>
        <div className="tool-note">
          The server stores only encrypted envelopes. Messages are decrypted on device.
        </div>
      </div>
      <button className="tool-row disabled"><span>◐</span><b>Notifications</b><em>coming soon</em></button>
      <button className="tool-row disabled"><span>▧</span><b>Media & files</b><em>coming soon</em></button>
    </div>
  );
}