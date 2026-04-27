import { useMemo, useState } from "react";
import Ava from "./Ava";

const FILTERS = [
  { key: "all",    label: "Все" },
  { key: "direct", label: "Личные" },
  { key: "group",  label: "Группы" },
  { key: "saved",  label: "Избранное" },
  { key: "unread", label: "Непрочитанные" },
];

function chatActivityMs(chat) {
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

export default function ChatList({
  me,
  chats = [],
  activeId,
  search = "",
  loadingChats,
  filter = "all",
  onFilterChange = () => {},
  onSelectChat,
  onПоиск = () => {},
  onNewChat,
  onOpenНастройки,
  onMarkAllRead,
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchFocused, setПоискFocused] = useState(false);

  const myName = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || me?.username || "Я";

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();

    return chats.filter(chat => {
      if (!chat?.id) return false;

      if (filter === "direct" && chat.type !== "direct") return false;
      if (filter === "group"  && chat.type !== "group")  return false;
      if (filter === "saved"  && chat.type !== "saved")  return false;
      if (filter === "unread" && !(chat.unread > 0))     return false;

      if (!q) return true;

      return [
        chat.name,
        chat.username,
        chat.preview,
      ].some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) => {
      const byActivity = chatActivityMs(b) - chatActivityMs(a);
      if (byActivity !== 0) return byActivity;

      return Number(b.id || 0) - Number(a.id || 0);
    });
  }, [chats, search, filter]);

  const currentFilter = FILTERS.find(f => f.key === filter)?.label || "Все";

  const selectChat = (chatId) => {
    if (!chatId) return;
    setFilterOpen(false);
    onSelectChat?.(chatId);
  };

  return (
    <aside className="home-screen" onClick={() => setFilterOpen(false)}>
      <style>{PLUS_BUTTON_CSS}</style>
      <div className="ios-status-spacer" />

      <header className="home-topbar">
        <button
          type="button"
          className="avatar-button"
          onClick={(e) => {
            e.stopPropagation();
            setFilterOpen(false);
            onOpenНастройки?.();
          }}
          title="Настройки"
        >
          <Ava user={me} name={myName} className="avatar-face" />
        </button>

        <div className="screen-title">Чаты</div>

        <button
          type="button"
          className={`round-action filter-top-btn${filterOpen ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setFilterOpen(v => !v);
          }}
          title="Фильтры"
        >
          ≡
        </button>

        {filterOpen && (
          <div className="filter-popover" onClick={e => e.stopPropagation()}>
            <div className="filter-title">Показать</div>

            {FILTERS.map(item => (
              <button
                key={item.key}
                type="button"
                className="filter-item"
                onClick={() => {
                  onFilterChange(item.key);
                  setFilterOpen(false);
                }}
              >
                <span className="filter-check">{filter === item.key ? "✓" : ""}</span>
                <span>{item.label}</span>
              </button>
            ))}

            <div className="filter-sep" />

            <button
              type="button"
              className="filter-item"
              onClick={() => {
                onMarkAllRead?.();
                setFilterOpen(false);
              }}
            >
              <span className="filter-check">✓</span>
              <span>Прочитать все</span>
            </button>
          </div>
        )}
      </header>

      <main className="home-content scroll">
        <div className="list-hint">
          <span>{currentFilter}</span>
          {search.trim() && <b>поиск: {search.trim()}</b>}
        </div>

        {loadingChats ? (
          <div className="product-empty">
            <div className="spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="product-empty">
            <div className="product-empty-icon">◯</div>
            <div className="product-empty-title">Нет чатов</div>
            <div className="product-empty-sub">Создайте переписку или выберите другой фильтр.</div>
          </div>
        ) : (
          <div className="conversation-list">
            {filtered.map(chat => (
              <button
                key={chat.id}
                type="button"
                className={`conversation-item${Number(activeId) === Number(chat.id) ? " active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectChat(chat.id);
                }}
              >
                <Ava name={chat.name} colorIdx={chat.colorIdx} online={chat.online} avatarUrl={chat.avatarUrl} />

                <div className="conversation-main">
                  <div className="conversation-line">
                    <span className="conversation-name trim">{chat.name}</span>
                    <span className="conversation-time">{chat.time}</span>
                  </div>

                  <div className="conversation-line">
                    <span className="conversation-preview trim">
                      {chat.lastOut && chat.preview ? "Вы: " : ""}
                      {chat.preview || (chat.lastMessageId ? "Зашифрованное сообщение" : "Сообщений пока нет")}
                    </span>

                    {chat.type === "saved" && <span className="soft-chip">★</span>}
                    {chat.type === "group" && <span className="soft-chip">{chat.members}</span>}
                    {chat.unread > 0 && <span className="badge">{chat.unread}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <footer className={`floating-searchbar restored${searchFocused ? " focused" : ""}`} onClick={e => e.stopPropagation()}>
        <label className="bottom-search restored-search">
          <span>⌕</span>
          <input
            value={search}
            onChange={e => onПоиск(e.target.value)}
            onFocus={() => setПоискFocused(true)}
            onBlur={() => setПоискFocused(false)}
            placeholder="Поиск"
          />
        </label>

        <button
          type="button"
          className="bottom-round new-chat-action-btn"
          onClick={onNewChat}
          title="Новый чат"
        >
          <span className="new-chat-plus-icon" aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}
const PLUS_BUTTON_CSS = `
.floating-searchbar.restored{
  grid-template-columns:1fr 60px;
  gap:10px;
  align-items:center;
}

.bottom-round.new-chat-action-btn{
  width:56px;
  height:56px;
  min-width:56px;
  border-radius:50%;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:0;
  line-height:1;
}

.new-chat-plus-icon{
  position:relative;
  display:block;
  width:18px;
  height:18px;
}

.new-chat-plus-icon::before,
.new-chat-plus-icon::after{
  content:"";
  position:absolute;
  left:50%;
  top:50%;
  width:18px;
  height:2px;
  border-radius:999px;
  background:var(--t1);
  transform:translate(-50%,-50%);
}

.new-chat-plus-icon::after{
  transform:translate(-50%,-50%) rotate(90deg);
}
`;