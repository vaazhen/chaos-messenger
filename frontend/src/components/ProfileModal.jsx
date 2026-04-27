import { useEffect, useMemo, useState } from "react";
import { api, getCurrentDeviceId } from "../api";

const AVATARS = ["🦊", "🐺", "🦁", "🐯", "🐼", "🐨", "🐵", "🐸", "🐙", "🦉"];

function initials(me, form) {
  const first = form?.firstName || me?.firstName || "";
  const last = form?.lastName || me?.lastName || "";
  const username = me?.username || "";

  const value = `${first} ${last}`.trim() || username || "U";
  return value
    .split(/\s+/)
    .map(x => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value) {
  if (!value) return "нет данных";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "нет данных";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deviceTitle(device) {
  if (device?.deviceName) return device.deviceName;

  const id = device?.deviceId || "";
  if (!id) return "Устройство";

  if (id.startsWith("device-")) {
    return `Браузер ${id.slice(7, 15)}`;
  }

  return `Устройство ${id.slice(0, 8)}`;
}

function deviceSub(device) {
  const id = device?.deviceId || "";
  if (!id) return "ID не найден";

  return id.length > 28 ? `${id.slice(0, 18)}…${id.slice(-6)}` : id;
}


function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Выберите файл изображения"));
      return;
    }

    if (file.size > 7 * 1024 * 1024) {
      reject(new Error("Файл слишком большой. Выберите изображение до 7 МБ."));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Canvas недоступен");
        }

        const minSide = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - minSide) / 2);
        const sy = Math.floor((img.height - minSide) / 2);

        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };

    img.src = url;
  });
}

function renderProfileAvatar(value, fallback) {
  if (value?.startsWith("preset:")) {
    return value.replace("preset:", "") || fallback;
  }

  if (
    value?.startsWith("data:image/") ||
    value?.startsWith("blob:") ||
    value?.startsWith("http://") ||
    value?.startsWith("https://")
  ) {
    return (
      <img
        src={value}
        alt="Аватар"
        draggable="false"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          borderRadius: "inherit",
        }}
      />
    );
  }

  return fallback;
}
export default function ProfileModal({
  me,
  lang,
  theme,
  onClose,
  onSaved,
  onToggleTheme,
  onSwitchLang,
  onLogout,
}) {
  const [form, setForm] = useState(() => ({
    firstName: me?.firstName || "",
    lastName: me?.lastName || "",
    username: me?.username || "",
    avatarUrl: me?.avatarUrl || "",
  }));

  const [tab, setTab] = useState("profile");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [avatarError, setAvatarError] = useState("");

  
  // profile-sync-form-from-me
  useEffect(() => {
    setForm({
      firstName: me?.firstName || "",
      lastName: me?.lastName || "",
      username: me?.username || "",
      avatarUrl: me?.avatarUrl || "",
    });
  }, [me?.id, me?.username, me?.firstName, me?.lastName, me?.avatarUrl]);
const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState("");
  const [deactivatingId, setDeactivatingId] = useState(null);

  const currentDeviceId = useMemo(() => {
    try {
      return getCurrentDeviceId();
    } catch (_) {
      return "";
    }
  }, []);

  const activeDevicesCount = useMemo(
    () => devices.filter(d => d.active).length,
    [devices]
  );

  const loadDevices = async () => {
    setDevicesLoading(true);
    setDevicesError("");

    try {
      const data = await api.listDevices();
      setDevices(Array.isArray(data) ? data : []);
    } catch (e) {
      setDevicesError(e?.message || "Не удалось загрузить устройства");
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "devices") {
      loadDevices();
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleAvatarUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setAvatarError("");

    try {
      const dataUrl = await resizeAvatarFile(file);
      setField("avatarUrl", dataUrl);
    } catch (e) {
      setAvatarError(e?.message || "Не удалось загрузить аватар");
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");

    try {
      const payload = {
        firstName: form.firstName?.trim() || "",
        lastName: form.lastName?.trim() || "",
        username: me?.username || form.username,
        avatarUrl: form.avatarUrl?.trim() || "",
      };

      const updated = await api.updateProfile(payload);
      // profile-save-new-token
      if (updated?.token) {
        localStorage.setItem("cm_token", updated.token);
      }
      onSaved?.(updated);
    } catch (e) {
      setError(e?.message || "Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (device) => {
    if (!device?.id || !device.active || device.current) return;

    const ok = window.confirm(
      `Отключить устройство "${deviceTitle(device)}"?\n\nОно больше не сможет получать и отправлять зашифрованные сообщения.`
    );

    if (!ok) return;

    setDeactivatingId(device.id);
    setDevicesError("");

    try {
      await api.deactivateDevice(device.id, false);
      await loadDevices();
    } catch (e) {
      const message = e?.message || "";

      if (message.toLowerCase().includes("last active device")) {
        setDevicesError("Нельзя отключить последнее активное устройство.");
      } else {
        setDevicesError(message || "Не удалось отключить устройство");
      }
    } finally {
      setDeactivatingId(null);
    }
  };

  const closeOnBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div className="profile-drawer-root" onMouseDown={closeOnBackdrop}>
      <style>{PROFILE_DRAWER_CSS}</style>

      <div className="profile-drawer-backdrop" />

      <section className="profile-drawer-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="profile-drawer-grab-zone" onMouseDown={onClose}>
          <div className="profile-drawer-handle" />
        </div>

        <header className="profile-drawer-head">
          <div>
            <div className="profile-drawer-title">Настройки</div>
            <div className="profile-drawer-subtitle">Профиль, интерфейс и безопасность</div>
          </div>

          <button type="button" className="profile-round-close" onClick={onClose} title="Закрыть">
            ×
          </button>
        </header>

        <div className="profile-tabs">
          <button
            type="button"
            className={tab === "profile" ? "active" : ""}
            onClick={() => setTab("profile")}
          >
            Профиль
          </button>

          <button
            type="button"
            className={tab === "devices" ? "active" : ""}
            onClick={() => setTab("devices")}
          >
            Устройства
          </button>
        </div>

        <div className="profile-drawer-content scroll">
          {tab === "profile" && (
            <>
              <div className="profile-main-card">
                <div className="profile-big-avatar">
                  {renderProfileAvatar(form.avatarUrl, initials(me, form))}
                </div>

                <div className="profile-main-text">
                  <b>{`${form.firstName} ${form.lastName}`.trim() || me?.username || "Пользователь"}</b>
                  <small>@{me?.username || form.username || "username"}</small>
                </div>
              </div>              <div className="profile-section-title">Фото профиля</div>

              <div className="profile-card">
                <div
                  style={{
                    padding: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ display: "block", fontSize: 17, marginBottom: 5 }}>
                      Главное фото
                    </b>

                    <small
                      style={{
                        display: "block",
                        color: "var(--t2)",
                        lineHeight: 1.35,
                      }}
                    >
                      Используется в профиле, списке чатов и шапке приложения.
                    </small>

                    {avatarError && (
                      <div
                        style={{
                          marginTop: 10,
                          color: "var(--red)",
                          fontSize: 13,
                          lineHeight: 1.35,
                        }}
                      >
                        {avatarError}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                    {form.avatarUrl && (
                      <button
                        type="button"
                        className="btn-sec"
                        style={{ whiteSpace: "nowrap" }}
                        onClick={() => setField("avatarUrl", "")}
                      >
                        Удалить
                      </button>
                    )}

                    <label
                      className="btn-pri"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        margin: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Загрузить
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        hidden
                      />
                    </label>
                  </div>
                </div>
              </div>


              <div className="profile-section-title">Данные профиля</div>

              <div className="profile-card">
                <label className="profile-field">
                  <span>Имя</span>
                  <input
                    value={form.firstName}
                    onChange={e => setField("firstName", e.target.value)}
                    placeholder="Имя"
                  />
                </label>

                <label className="profile-field">
                  <span>Фамилия</span>
                  <input
                    value={form.lastName}
                    onChange={e => setField("lastName", e.target.value)}
                    placeholder="Фамилия"
                  />
                </label>

                <label className="profile-field">
                  <span>Username</span>
                  <input
                    value={form.username}
                    onChange={e => setField("username", e.target.value)}
                    placeholder="username"
                    autoComplete="off"
                    title="3-32 символа: латиница, цифры и underscore"
                  />
                  <small className="profile-field-note">
                    Username можно изменить. После сохранения авторизация обновится автоматически.
                  </small>
                </label>
              </div>

              <div className="profile-section-title">Приложение</div>

              <div className="profile-card">
                <button type="button" className="profile-row" onClick={onToggleTheme}>
                  <span className="profile-row-icon">{theme === "dark" ? "☾" : "☀"}</span>
                  <span className="profile-row-main">
                    <b>Оформление</b>
                    <small>{theme === "dark" ? "Тёмная тема" : "Светлая тема"}</small>
                  </span>
                  <i>›</i>
                </button>

                <button type="button" className="profile-row" onClick={onSwitchLang}>
                  <span className="profile-row-icon">文</span>
                  <span className="profile-row-main">
                    <b>Язык</b>
                    <small>{lang === "ru" ? "Русский" : "English"}</small>
                  </span>
                  <i>›</i>
                </button>
              </div>

              {error && <div className="profile-error">{error}</div>}

              <div className="profile-bottom-actions">
                <button type="button" className="btn-sec" onClick={onClose} disabled={saving}>
                  Отмена
                </button>

                <button type="button" className="btn-pri" onClick={save} disabled={saving}>
                  {saving ? "Сохраняем..." : "Сохранить"}
                </button>
              </div>

              <button type="button" className="profile-logout" onClick={onLogout}>
                Выйти из аккаунта
              </button>
            </>
          )}

          {tab === "devices" && (
            <>
              <div className="profile-device-hero">
                <div className="profile-device-hero-icon">⌘</div>
                <div>
                  <b>Активные устройства</b>
                  <span>
                    Управляйте браузерами и клиентами, которым разрешено работать с E2EE.
                  </span>
                </div>
              </div>

              <div className="profile-security-note">
                Отключённое устройство больше не сможет подключиться к WebSocket, получать crypto bundle и отправлять зашифрованные сообщения.
              </div>

              <div className="profile-section-title">
                Устройства {devices.length ? `· ${activeDevicesCount} активн.` : ""}
              </div>

              {devicesError && <div className="profile-error">{devicesError}</div>}

              {devicesLoading ? (
                <div className="profile-devices-loading">
                  <div className="spinner" />
                  <span>Загружаем устройства...</span>
                </div>
              ) : (
                <div className="profile-devices-list">
                  {devices.map(device => {
                    const isCurrent = Boolean(device.current) || device.deviceId === currentDeviceId;
                    const canDeactivate = device.active && !isCurrent;

                    return (
                      <div
                        key={device.id || device.deviceId}
                        className={`profile-device-card${!device.active ? " inactive" : ""}${isCurrent ? " current" : ""}`}
                      >
                        <div className="profile-device-icon">
                          {isCurrent ? "●" : device.active ? "◉" : "○"}
                        </div>

                        <div className="profile-device-main">
                          <div className="profile-device-line">
                            <b>{deviceTitle(device)}</b>
                            {isCurrent && <span className="device-pill current">это устройство</span>}
                            {!device.active && <span className="device-pill off">отключено</span>}
                          </div>

                          <small>{deviceSub(device)}</small>

                          <div className="profile-device-meta">
                            <span>Последняя активность: {formatDate(device.lastSeen || device.createdAt)}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="profile-device-action"
                          disabled={!canDeactivate || deactivatingId === device.id}
                          onClick={() => deactivate(device)}
                          title={isCurrent ? "Текущее устройство нельзя отключить отсюда" : "Отключить устройство"}
                        >
                          {deactivatingId === device.id ? "..." : canDeactivate ? "Отключить" : "—"}
                        </button>
                      </div>
                    );
                  })}

                  {!devices.length && (
                    <div className="profile-empty-devices">
                      <b>Устройств пока нет</b>
                      <span>После регистрации текущий браузер появится здесь автоматически.</span>
                    </div>
                  )}
                </div>
              )}

              <div className="profile-bottom-actions single">
                <button type="button" className="btn-sec" onClick={loadDevices} disabled={devicesLoading}>
                  Обновить список
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

const PROFILE_DRAWER_CSS = `
.profile-drawer-root{
  position:fixed;
  inset:0;
  z-index:270;
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
}

.profile-drawer-panel{
  position:relative;
  width:min(100%,560px);
  height:calc(100dvh - 54px);
  max-height:900px;
  background:var(--bg0);
  border-radius:34px 34px 0 0;
  box-shadow:0 -24px 80px rgba(0,0,0,.24);
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
  cursor:pointer;
  flex-shrink:0;
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
  min-height:70px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 22px 14px;
  flex-shrink:0;
}

.profile-drawer-title{
  font-size:25px;
  font-weight:950;
  letter-spacing:-.04em;
}

.profile-drawer-subtitle{
  color:var(--t2);
  font-size:14px;
  margin-top:2px;
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

.profile-tabs{
  margin:0 22px 14px;
  height:44px;
  border-radius:999px;
  padding:4px;
  background:var(--bg3);
  display:grid;
  grid-template-columns:1fr 1fr;
  flex-shrink:0;
}

.profile-tabs button{
  border:none;
  border-radius:999px;
  background:transparent;
  color:var(--t2);
  cursor:pointer;
  font-size:15px;
  font-weight:850;
}

.profile-tabs button.active{
  background:var(--bg1);
  color:var(--t1);
  box-shadow:0 1px 7px rgba(0,0,0,.07);
}

.profile-drawer-content{
  flex:1;
  padding:0 22px 28px;
}

.profile-main-card,
.profile-card,
.profile-device-hero,
.profile-security-note,
.profile-empty-devices{
  background:var(--bg1);
  border-radius:28px;
}

.profile-main-card{
  padding:18px;
  display:flex;
  align-items:center;
  gap:16px;
}

.profile-big-avatar{
  width:70px;
  height:70px;
  border-radius:50%;
  background:#111;
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:26px;
  font-weight:950;
  flex-shrink:0;
}

[data-theme='dark'] .profile-big-avatar{
  background:#f3f5f8;
  color:#08090b;
}

.profile-main-text{
  display:flex;
  flex-direction:column;
  min-width:0;
}

.profile-main-text b{
  font-size:22px;
  letter-spacing:-.035em;
}

.profile-main-text small{
  color:var(--t2);
  font-size:15px;
  margin-top:3px;
}

.profile-section-title{
  color:var(--t2);
  font-weight:850;
  font-size:15px;
  margin:24px 0 10px 20px;
}

.profile-card{
  overflow:hidden;
}

.profile-field{
  display:block;
  padding:14px 18px;
  border-bottom:1px solid var(--bdr);
}

.profile-field:last-child{
  border-bottom:none;
}

.profile-field span{
  display:block;
  color:var(--t2);
  font-size:12px;
  font-weight:850;
  margin-bottom:8px;
}

.profile-field input{
  width:100%;
  border:none;
  outline:none;
  background:transparent;
  color:var(--t1);
  font-size:18px;
}

.profile-field-flat{
  border-top:1px solid var(--bdr);
  border-bottom:none;
}

.profile-row{
  width:100%;
  min-height:62px;
  border:none;
  background:transparent;
  display:grid;
  grid-template-columns:38px 1fr 20px;
  align-items:center;
  gap:12px;
  padding:0 18px;
  border-bottom:1px solid var(--bdr);
  cursor:pointer;
  text-align:left;
}

.profile-row:last-child{
  border-bottom:none;
}

.profile-row-icon{
  color:var(--t2);
  font-size:24px;
  text-align:center;
}

.profile-row-main{
  display:flex;
  flex-direction:column;
  min-width:0;
}

.profile-row-main b{
  font-size:17px;
}

.profile-row-main small{
  color:var(--t2);
  margin-top:2px;
}

.profile-row i{
  color:var(--t3);
  font-style:normal;
  font-size:22px;
}

.profile-error{
  margin-top:14px;
  border-radius:20px;
  padding:12px 14px;
  color:var(--red);
  background:rgba(229,72,77,.12);
  font-size:14px;
  line-height:1.4;
}

.profile-bottom-actions{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:18px;
}

.profile-bottom-actions.single{
  grid-template-columns:1fr;
}

.profile-logout{
  width:100%;
  height:58px;
  margin-top:18px;
  border:none;
  border-radius:28px;
  background:rgba(229,72,77,.12);
  color:var(--red);
  font-size:18px;
  font-weight:900;
  cursor:pointer;
}

.profile-device-hero{
  padding:18px;
  display:flex;
  gap:15px;
  align-items:flex-start;
}

.profile-device-hero-icon{
  width:54px;
  height:54px;
  border-radius:20px;
  background:var(--bg3);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:24px;
  flex-shrink:0;
}

.profile-device-hero b{
  display:block;
  font-size:21px;
  letter-spacing:-.035em;
}

.profile-device-hero span{
  display:block;
  color:var(--t2);
  line-height:1.45;
  margin-top:4px;
}

.profile-security-note{
  color:var(--t2);
  padding:14px 16px;
  margin-top:10px;
  font-size:14px;
  line-height:1.45;
}

.profile-devices-loading{
  min-height:160px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:14px;
  color:var(--t2);
}

.profile-devices-list{
  display:flex;
  flex-direction:column;
  gap:10px;
}

.profile-device-card{
  background:var(--bg1);
  border-radius:24px;
  padding:14px;
  display:grid;
  grid-template-columns:42px 1fr auto;
  gap:12px;
  align-items:center;
  border:1px solid transparent;
}

.profile-device-card.current{
  border-color:var(--bdr2);
  box-shadow:0 0 0 3px var(--acc2);
}

.profile-device-card.inactive{
  opacity:.58;
}

.profile-device-icon{
  width:42px;
  height:42px;
  border-radius:16px;
  background:var(--bg3);
  display:flex;
  align-items:center;
  justify-content:center;
  color:var(--t1);
  font-size:18px;
}

.profile-device-main{
  min-width:0;
}

.profile-device-line{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:6px;
}

.profile-device-line b{
  font-size:16px;
}

.profile-device-main small{
  display:block;
  color:var(--t3);
  margin-top:3px;
  word-break:break-all;
}

.profile-device-meta{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  color:var(--t2);
  font-size:12px;
  margin-top:7px;
}

.device-pill{
  border-radius:999px;
  padding:3px 8px;
  font-size:11px;
  font-weight:850;
}

.device-pill.current{
  background:var(--acc3);
  color:var(--t1);
}

.device-pill.off{
  background:rgba(229,72,77,.12);
  color:var(--red);
}

.profile-device-action{
  min-width:92px;
  height:38px;
  border:none;
  border-radius:999px;
  background:var(--bg2);
  color:var(--t1);
  cursor:pointer;
  font-weight:850;
}

.profile-device-action:not(:disabled):hover{
  background:rgba(229,72,77,.12);
  color:var(--red);
}

.profile-device-action:disabled{
  opacity:.45;
  cursor:default;
}

.profile-empty-devices{
  padding:22px;
  text-align:center;
  color:var(--t2);
}

.profile-empty-devices b{
  display:block;
  color:var(--t1);
  font-size:18px;
  margin-bottom:6px;
}

@keyframes profileDrawerUp{
  from{
    transform:translateY(100%);
    opacity:.94;
  }
  to{
    transform:translateY(0);
    opacity:1;
  }
}


.profile-avatar-upload-row{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  padding:0 16px 16px;
}

.profile-avatar-upload-btn,
.profile-avatar-clear-btn{
  height:46px;
  border:none;
  border-radius:18px;
  background:var(--bg2);
  color:var(--t1);
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  font-size:15px;
  font-weight:850;
}

.profile-avatar-upload-btn:hover,
.profile-avatar-clear-btn:hover{
  background:var(--bg3);
}

.profile-avatar-error{
  margin:0 16px 16px;
  padding:10px 12px;
  border-radius:16px;
  background:rgba(229,72,77,.12);
  color:var(--red);
  font-size:13px;
  line-height:1.35;
}

.profile-field-note{
  display:block;
  color:var(--t3);
  font-size:12px;
  margin-top:7px;
  line-height:1.35;
}

.profile-field input[readonly]{
  color:var(--t2);
  cursor:default;
}
@media (max-width: 520px){
  .profile-drawer-panel{
    height:calc(100dvh - 44px);
    border-radius:30px 30px 0 0;
  }

  .profile-drawer-head,
  .profile-drawer-content{
    padding-left:18px;
    padding-right:18px;
  }

  .profile-tabs{
    margin-left:18px;
    margin-right:18px;
  }

  .profile-device-card{
    grid-template-columns:38px 1fr;
  }

  .profile-device-action{
    grid-column:1 / -1;
    width:100%;
  }
}
`;