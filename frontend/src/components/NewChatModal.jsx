import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Ava from "./Ava";

export default function NewChatModal({ me, onClose, onCreated }) {
  const [mode, setMode] = useState("direct");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState("");

  const dragStartY = useRef(null);

  useEffect(() => {
    const q = query.trim();

    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setSearching(true);
      setHint("");

      try {
        const data = await api.searchUsers(q);

        if (cancelled) return;

        const list = Array.isArray(data) ? data : [];

        setResults(
          list.filter(u =>
            String(u.id) !== String(me?.id) &&
            String(u.username || "").toLowerCase().includes(q.toLowerCase())
          )
        );
      } catch (e) {
        if (!cancelled) {
          setHint(e.message || "Не удалось выполнить поиск");
          setResults([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, me?.id]);

  const onHandlePointerDown = (e) => {
    dragStartY.current = e.clientY ?? e.touches?.[0]?.clientY ?? null;
  };

  const onHandlePointerUp = (e) => {
    const endY = e.clientY ?? e.changedTouches?.[0]?.clientY ?? null;

    if (dragStartY.current !== null && endY !== null && endY - dragStartY.current > 70) {
      onClose();
    }

    dragStartY.current = null;
  };

  const openSaved = async () => {
    setLoading(true);
    setHint("");

    try {
      const res = await api.createSaved();
      if (!res?.chatId) throw new Error("Backend не вернул chatId");
      onCreated?.(res.chatId);
    } catch (e) {
      setHint(e.message || "Не удалось открыть Избранное");
    } finally {
      setLoading(false);
    }
  };

  const startDirect = async (username) => {
    if (!username) return;

    setLoading(true);
    setHint("");

    try {
      const res = await api.createDirect(username);
      if (!res?.chatId) throw new Error("Backend не вернул chatId");
      onCreated?.(res.chatId);
    } catch (e) {
      setHint(e.message || "Не удалось создать чат");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (user) => {
    setSelected(prev =>
      prev.some(u => String(u.id) === String(user.id))
        ? prev.filter(u => String(u.id) !== String(user.id))
        : [...prev, user]
    );
  };

  const createGroup = async () => {
    if (!groupName.trim() || selected.length === 0) return;

    setLoading(true);
    setHint("");

    try {
      const res = await api.createGroup(groupName.trim(), selected.map(u => u.id));
      if (!res?.chatId) throw new Error("Backend не вернул chatId");
      onCreated?.(res.chatId);
    } catch (e) {
      setHint(e.message || "Не удалось создать группу");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="new-chat-drawer-root">
      <style>{NEW_CHAT_DRAWER_CSS}</style>

      <div className="new-chat-drawer-backdrop" onClick={onClose} />

      <section className="new-chat-drawer-panel" onClick={e => e.stopPropagation()}>
        <div
          className="new-chat-drawer-grab-zone"
          onPointerDown={onHandlePointerDown}
          onPointerUp={onHandlePointerUp}
          onTouchStart={onHandlePointerDown}
          onTouchEnd={onHandlePointerUp}
        >
          <div className="new-chat-drawer-handle" />
        </div>

        <header className="new-chat-drawer-head">
          <button type="button" className="new-chat-round-close" onClick={onClose}>×</button>
          <div className="new-chat-drawer-title">Новый чат</div>
          <div className="new-chat-head-spacer" />
        </header>

        <div className="new-chat-drawer-search">
          <span>⌕</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск по username"
            autoFocus
          />
        </div>

        <div className="new-chat-drawer-tabs">
          <button
            type="button"
            className={mode === "direct" ? "active" : ""}
            onClick={() => setMode("direct")}
          >
            Личные
          </button>

          <button
            type="button"
            className={mode === "group" ? "active" : ""}
            onClick={() => setMode("group")}
          >
            Группа
          </button>
        </div>

        {hint && <div className="err-bar new-chat-drawer-error">{hint}</div>}

        <div className="new-chat-drawer-content scroll">
          {mode === "direct" && (
            <>
              <button type="button" className="new-chat-drawer-action" onClick={openSaved} disabled={loading}>
                <span className="new-chat-drawer-action-icon">★</span>
                <span className="new-chat-drawer-action-text">
                  <b>Избранное</b>
                  <small>Личные зашифрованные заметки и файлы</small>
                </span>
                <i>›</i>
              </button>

              <button type="button" className="new-chat-drawer-action" onClick={() => setMode("group")}>
                <span className="new-chat-drawer-action-icon">♙</span>
                <span className="new-chat-drawer-action-text">
                  <b>Создать группу</b>
                  <small>Закрытая переписка с несколькими участниками</small>
                </span>
                <i>›</i>
              </button>
            </>
          )}

          {mode === "group" && (
            <div className="new-chat-drawer-group-card">
              <label className="field-label">Название группы</label>
              <input
                className="field-inp"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="Команда, семья, проект..."
              />

              {selected.length > 0 && (
                <div className="selected-users">
                  {selected.map(u => (
                    <button type="button" key={u.id} onClick={() => toggleSelect(u)}>
                      @{u.username} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {searching && (
            <div className="new-chat-drawer-loading">
              <div className="spinner" />
            </div>
          )}

          {!searching && results.map(u => {
            const selectedUser = selected.some(s => String(s.id) === String(u.id));
            const displayName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username;

            return (
              <button
                key={u.id || u.username}
                type="button"
                className={`new-chat-drawer-user${selectedUser ? " selected" : ""}`}
                onClick={() => mode === "direct" ? startDirect(u.username) : toggleSelect(u)}
              >
                <Ava
                  name={displayName}
                  colorIdx={Number(u.id || 0) % 7}
                  size="md"
                  avatarUrl={u.avatarUrl}
                />

                <span className="new-chat-drawer-user-main">
                  <b>{displayName}</b>
                  <small>@{u.username}</small>
                </span>

                <i>{mode === "group" ? (selectedUser ? "✓" : "+") : "›"}</i>
              </button>
            );
          })}

          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <div className="product-empty mini">
              <div className="product-empty-title">Ничего не найдено</div>
              <div className="product-empty-sub">Поиск сейчас работает по username.</div>
            </div>
          )}
        </div>

        {mode === "group" && (
          <div className="new-chat-drawer-bottom">
            <button type="button" className="btn-sec" onClick={onClose}>Отмена</button>
            <button
              type="button"
              className="btn-pri"
              onClick={createGroup}
              disabled={loading || !groupName.trim() || selected.length === 0}
            >
              {loading ? "Создаём..." : `Создать (${selected.length})`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

const NEW_CHAT_DRAWER_CSS = `
.new-chat-drawer-root{
  position:fixed;
  inset:0;
  z-index:260;
  display:flex;
  align-items:flex-end;
  justify-content:center;
  pointer-events:auto;
}

.new-chat-drawer-backdrop{
  position:absolute;
  inset:0;
  background:rgba(0,0,0,.28);
  backdrop-filter:blur(1px);
  animation:newChatDrawerFade .16s ease;
}

.new-chat-drawer-panel{
  position:relative;
  width:min(100%,560px);
  height:calc(100dvh - 74px);
  max-height:860px;
  background:var(--bg0);
  border-radius:34px 34px 0 0;
  box-shadow:0 -24px 80px rgba(0,0,0,.22);
  display:flex;
  flex-direction:column;
  overflow:hidden;
  animation:newChatDrawerUp .22s cubic-bezier(.2,.8,.2,1);
}

.new-chat-drawer-grab-zone{
  height:26px;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:grab;
  touch-action:none;
  flex-shrink:0;
}

.new-chat-drawer-grab-zone:active{
  cursor:grabbing;
}

.new-chat-drawer-handle{
  width:46px;
  height:5px;
  border-radius:999px;
  background:rgba(0,0,0,.18);
}

[data-theme='dark'] .new-chat-drawer-handle{
  background:rgba(255,255,255,.22);
}

.new-chat-drawer-head{
  min-height:58px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 20px 12px;
  flex-shrink:0;
}

.new-chat-drawer-title{
  font-size:22px;
  font-weight:900;
  letter-spacing:-.035em;
}

.new-chat-round-close{
  width:48px;
  height:48px;
  border:none;
  border-radius:50%;
  background:var(--bg1);
  color:var(--t1);
  box-shadow:var(--soft-shadow);
  font-size:28px;
  line-height:1;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
}

.new-chat-head-spacer{
  width:48px;
  height:48px;
}

.new-chat-drawer-search{
  height:58px;
  margin:0 22px 14px;
  border-radius:999px;
  background:var(--bg1);
  display:flex;
  align-items:center;
  gap:10px;
  padding:0 18px;
  color:var(--t2);
  box-shadow:var(--soft-shadow);
  flex-shrink:0;
}

.new-chat-drawer-search input{
  flex:1;
  min-width:0;
  border:none;
  outline:none;
  background:transparent;
  color:var(--t1);
  font-size:18px;
}

.new-chat-drawer-tabs{
  margin:0 22px 18px;
  height:42px;
  border-radius:999px;
  padding:3px;
  background:var(--bg3);
  display:grid;
  grid-template-columns:1fr 1fr;
  flex-shrink:0;
}

.new-chat-drawer-tabs button{
  border:none;
  border-radius:999px;
  background:transparent;
  cursor:pointer;
  font-weight:850;
  font-size:15px;
}

.new-chat-drawer-tabs button.active{
  background:var(--bg1);
  box-shadow:0 1px 6px rgba(0,0,0,.06);
}

.new-chat-drawer-error{
  margin-left:22px;
  margin-right:22px;
  flex-shrink:0;
}

.new-chat-drawer-content{
  flex:1;
  padding:12px 22px 30px;
  overflow-y:auto;
}

.new-chat-drawer-action,
.new-chat-drawer-user{
  width:100%;
  border:none;
  background:var(--bg1);
  border-radius:28px;
  padding:18px;
  display:flex;
  align-items:center;
  gap:16px;
  text-align:left;
  cursor:pointer;
  margin-bottom:10px;
}

.new-chat-drawer-action:active,
.new-chat-drawer-user:active{
  transform:scale(.99);
}

.new-chat-drawer-action i,
.new-chat-drawer-user i{
  margin-left:auto;
  color:var(--t3);
  font-style:normal;
  font-size:28px;
}

.new-chat-drawer-action-icon{
  width:56px;
  height:56px;
  border-radius:50%;
  background:var(--bg3);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:24px;
  flex-shrink:0;
}

.new-chat-drawer-action-text,
.new-chat-drawer-user-main{
  display:flex;
  flex-direction:column;
  min-width:0;
}

.new-chat-drawer-action-text b,
.new-chat-drawer-user-main b{
  font-size:20px;
  letter-spacing:-.03em;
}

.new-chat-drawer-action-text small,
.new-chat-drawer-user-main small{
  color:var(--t2);
  font-size:15px;
  margin-top:3px;
}

.new-chat-drawer-group-card{
  background:var(--bg1);
  border-radius:28px;
  padding:18px;
  margin-bottom:12px;
}

.new-chat-drawer-user{
  background:transparent;
  box-shadow:none;
}

.new-chat-drawer-user:hover,
.new-chat-drawer-user.selected{
  background:var(--bg1);
}

.new-chat-drawer-loading{
  display:flex;
  align-items:center;
  justify-content:center;
  padding:28px;
}

.new-chat-drawer-bottom{
  padding:12px 22px 24px;
  display:flex;
  gap:10px;
  flex-shrink:0;
}

@keyframes newChatDrawerUp{
  from{
    transform:translateY(100%);
    opacity:.92;
  }
  to{
    transform:translateY(0);
    opacity:1;
  }
}

@keyframes newChatDrawerFade{
  from{opacity:0}
  to{opacity:1}
}

@media (min-width: 900px){
  .new-chat-drawer-panel{
    height:calc(100dvh - 54px);
    border-radius:36px 36px 0 0;
  }
}

@media (max-width: 520px){
  .new-chat-drawer-panel{
    height:calc(100dvh - 54px);
    border-radius:30px 30px 0 0;
  }

  .new-chat-drawer-head,
  .new-chat-drawer-content,
  .new-chat-drawer-bottom{
    padding-left:18px;
    padding-right:18px;
  }

  .new-chat-drawer-search,
  .new-chat-drawer-tabs,
  .new-chat-drawer-error{
    margin-left:18px;
    margin-right:18px;
  }
}
`;