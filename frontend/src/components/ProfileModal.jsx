import { useEffect, useRef, useState } from "react";
import { api, setToken } from "../api";
import { initials, AVATAR_PRESETS } from "../helpers";

export default function ProfileModal({
  me,
  onClose,
  onSaved,
  lang = "ru",
  theme = "light",
  onToggleTheme,
  onSwitchLang,
  onLogout,
}) {
  const [draft, setDraft] = useState({
    firstName: me?.firstName || "",
    lastName:  me?.lastName  || "",
    username:  me?.username  || "",
    avatarUrl: me?.avatarUrl || "",
  });

  const [usernameStatus, setUsernameStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const dragStartY = useRef(null);

  useEffect(() => {
    const value = draft.username.trim().toLowerCase();

    if (!value || value === me?.username) {
      setUsernameStatus(null);
      return;
    }

    if (value.length < 3 || !/^[a-zA-Z0-9_]+$/.test(value)) {
      setUsernameStatus("invalid");
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await api.searchUsers(value);
        const taken = Array.isArray(res) && res.some(u => u.username === value && u.id !== me?.id);
        setUsernameStatus(taken ? "taken" : "ok");
      } catch {
        setUsernameStatus("ok");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [draft.username, me?.username, me?.id]);

  const handleSave = async () => {
    if (usernameStatus === "taken" || usernameStatus === "invalid") return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.updateProfile({
        ...draft,
        username: draft.username.trim().toLowerCase(),
      });

      if (res?.token) {
        setToken(res.token);
      }

      setSuccess(true);
      onSaved({ ...me, ...res });

      setTimeout(() => setSuccess(false), 1800);
    } catch (e) {
      setError(e.message || "Не удалось сохранить профиль");
    } finally {
      setLoading(false);
    }
  };

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

  const fullName = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || me?.username || "Пользователь";
  const presetIdx = draft.avatarUrl?.startsWith("preset:") ? Number(draft.avatarUrl.split(":")[1]) : null;
  const currentPreset = presetIdx !== null && presetIdx < AVATAR_PRESETS.length ? AVATAR_PRESETS[presetIdx] : null;

  return (
    <div className="profile-drawer-root">
      <style>{DRAWER_CSS}</style>

      <div className="profile-drawer-backdrop" onClick={onClose} />

      <section className="profile-drawer-panel" onClick={e => e.stopPropagation()}>
        <div
          className="profile-drawer-grab-zone"
          onPointerDown={onHandlePointerDown}
          onPointerUp={onHandlePointerUp}
          onTouchStart={onHandlePointerDown}
          onTouchEnd={onHandlePointerUp}
        >
          <div className="profile-drawer-handle" />
        </div>

        <header className="profile-drawer-head">
          <button className="profile-round-close" onClick={onClose}>×</button>
          <div className="profile-drawer-title">Настройки</div>
          <div className="profile-head-spacer" />
        </header>

        <main className="settings-content profile-drawer-content scroll">
          <button className="settings-profile-card profile-main-card" onClick={() => setEditOpen(v => !v)}>
            <span
              className="settings-avatar"
              style={{ background: currentPreset?.bg || "linear-gradient(135deg,#111,#555)" }}
            >
              {currentPreset?.emoji || initials(fullName)}
            </span>

            <span className="settings-profile-main">
              <b>{fullName}</b>
              <small>@{me?.username || "username"}</small>
            </span>

            <i>›</i>
          </button>

          {editOpen && (
            <section className="settings-section">
              <div className="section-title">Профиль</div>

              {error && <div className="err-bar">{error}</div>}
              {success && <div className="ok-bar">Сохранено</div>}

              <div className="field-grid">
                <label className="field">
                  <span className="field-label">Имя</span>
                  <input
                    className="field-inp"
                    value={draft.firstName}
                    onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}
                    placeholder="Имя"
                  />
                </label>

                <label className="field">
                  <span className="field-label">Фамилия</span>
                  <input
                    className="field-inp"
                    value={draft.lastName}
                    onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
                    placeholder="Фамилия"
                  />
                </label>
              </div>

              <label className="field">
                <span className="field-label">Username</span>
                <input
                  className="field-inp"
                  value={draft.username}
                  onChange={e => setDraft(d => ({ ...d, username: e.target.value }))}
                  placeholder="username"
                />

                <span className="username-check">
                  {usernameStatus === "ok" && <span className="username-ok">Свободен</span>}
                  {usernameStatus === "taken" && <span className="username-err">Уже занят</span>}
                  {usernameStatus === "invalid" && <span className="username-err">Только латиница, цифры и _</span>}
                </span>
              </label>

              <div className="avatar-grid compact">
                {AVATAR_PRESETS.map((preset, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`avatar-opt${presetIdx === i ? " sel" : ""}`}
                    style={{ background: preset.bg }}
                    onClick={() => setDraft(d => ({ ...d, avatarUrl: `preset:${i}` }))}
                  >
                    {preset.emoji}
                  </button>
                ))}
              </div>

              <button
                className="btn-pri full"
                onClick={handleSave}
                disabled={loading || usernameStatus === "taken" || usernameStatus === "invalid"}
              >
                {loading ? "Сохраняем..." : "Сохранить профиль"}
              </button>
            </section>
          )}

          <SettingsGroup title="Приложение">
            <SettingsRow
              icon="◐"
              title="Оформление"
              value={theme === "dark" ? "Тёмная тема" : "Светлая тема"}
              onClick={onToggleTheme}
            />

            <SettingsRow
              icon="⌁"
              title="Язык"
              value={lang === "ru" ? "Русский" : "English"}
              onClick={onSwitchLang}
            />
</SettingsGroup>

          <SettingsGroup title="Безопасность">
            <SettingsRow
              icon="🔒"
              title="Шифрование"
              value="На устройстве"
              disabled
            />

            <SettingsRow
              icon="▣"
              title="Устройства"
              value="Следующий шаг"
              disabled
            />

            <SettingsRow
              icon="⚿"
              title="Код-пароль"
              value="Скоро"
              disabled
            />
          </SettingsGroup>

          <SettingsGroup title="Данные">
            <SettingsRow
              icon="◎"
              title="Хранилище"
              value="Скоро"
              disabled
            />

            <SettingsRow
              icon="◔"
              title="Использование сети"
              value="Скоро"
              disabled
            />

            <SettingsRow
              icon="▱"
              title="Экспорт данных"
              value="Скоро"
              disabled
            />
          </SettingsGroup>

          <SettingsGroup title="О проекте">
            <SettingsRow
              icon="C"
              title="Chaos Messenger"
              value="E2EE-inspired MVP"
              disabled
            />

            <SettingsRow
              icon="i"
              title="Версия"
              value="dev"
              disabled
            />
          </SettingsGroup>

          <button className="logout-row profile-logout" onClick={onLogout}>Выйти</button>
        </main>
      </section>
    </div>
  );
}

function SettingsGroup({ title, children }) {
  return (
    <section className="settings-section">
      <div className="section-title">{title}</div>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function SettingsRow({ icon, title, value, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`settings-row${disabled ? " disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
    >
      <span className="settings-row-icon">{icon}</span>
      <span className="settings-row-title">{title}</span>
      <span className="settings-row-value">{value}</span>
      <i>›</i>
    </button>
  );
}

const DRAWER_CSS = `
.profile-drawer-root{
  position:fixed;
  inset:0;
  z-index:260;
  display:flex;
  align-items:flex-end;
  justify-content:center;
  pointer-events:auto;
}

.profile-drawer-backdrop{
  position:absolute;
  inset:0;
  background:rgba(0,0,0,.28);
  backdrop-filter:blur(1px);
  animation:profileDrawerFade .16s ease;
}

.profile-drawer-panel{
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
  animation:profileDrawerUp .22s cubic-bezier(.2,.8,.2,1);
}

.profile-drawer-grab-zone{
  height:26px;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:grab;
  touch-action:none;
  flex-shrink:0;
}

.profile-drawer-grab-zone:active{
  cursor:grabbing;
}

.profile-drawer-handle{
  width:46px;
  height:5px;
  border-radius:999px;
  background:rgba(0,0,0,.18);
}

[data-theme='dark'] .profile-drawer-handle{
  background:rgba(255,255,255,.22);
}

.profile-drawer-head{
  min-height:58px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 20px 12px;
  flex-shrink:0;
}

.profile-drawer-title{
  font-size:22px;
  font-weight:900;
  letter-spacing:-.035em;
}

.profile-round-close{
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

.profile-head-spacer{
  width:48px;
  height:48px;
}

.profile-drawer-content{
  flex:1;
  padding:8px 22px 34px;
  overflow-y:auto;
}

.profile-main-card{
  margin-bottom:6px;
}

.profile-logout{
  margin-bottom:20px;
}

@keyframes profileDrawerUp{
  from{
    transform:translateY(100%);
    opacity:.92;
  }
  to{
    transform:translateY(0);
    opacity:1;
  }
}

@keyframes profileDrawerFade{
  from{opacity:0}
  to{opacity:1}
}

@media (min-width: 900px){
  .profile-drawer-root{
    align-items:flex-end;
  }

  .profile-drawer-panel{
    height:calc(100dvh - 54px);
    border-radius:36px 36px 0 0;
  }
}

@media (max-width: 520px){
  .profile-drawer-panel{
    height:calc(100dvh - 54px);
    border-radius:30px 30px 0 0;
  }

  .profile-drawer-content{
    padding-left:18px;
    padding-right:18px;
  }

  .profile-drawer-head{
    padding-left:18px;
    padding-right:18px;
  }
}
`;