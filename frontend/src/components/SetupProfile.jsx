import { useState, useEffect } from "react";
import { api, setToken } from "../api";
import { initials } from "../helpers";

function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Выберите изображение")); return;
    }
    if (file.size > 7 * 1024 * 1024) {
      reject(new Error("Файл слишком большой. Выберите изображение до 7 МБ.")); return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas недоступен");
        const minSide = Math.min(img.width, img.height);
        const sx = Math.floor((img.width  - minSide) / 2);
        const sy = Math.floor((img.height - minSide) / 2);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.88));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось прочитать изображение")); };
    img.src = url;
  });
}

const LS_PREFIXES = ["cm_device_id", "cm_device_bundle_v2", "cm_e2ee_sessions_v4"];

function migrateLocalStorageKeys(oldUsername, newUsername) {
  if (!oldUsername || !newUsername || oldUsername === newUsername) return;
  LS_PREFIXES.forEach(prefix => {
    const oldKey = `${prefix}:${oldUsername}`;
    const newKey = `${prefix}:${newUsername}`;
    const value  = localStorage.getItem(oldKey);
    if (value !== null) {
      localStorage.setItem(newKey, value);
      localStorage.removeItem(oldKey);
    }
  });
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

// setupToken  — present for new phone users before JWT exists
// onFinishSetup(data) — completes phone setup and creates the first JWT session
// onDone(updatedMe)   — called after profile update for users that already have JWT
export default function SetupProfile({ me, setupToken, onFinishSetup, onDone }) {
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState(null);
  const [firstName,         setFirstName]         = useState("");
  const [lastName,          setLastName]          = useState("");
  const [username,          setUsername]          = useState("");
  const [bio,               setBio]               = useState("");
  const [usernameStatus,    setUsernameStatus]    = useState(null);
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState(null);

  useEffect(() => {
    if (me?.firstName) setFirstName(v => v || me.firstName);
    if (me?.lastName)  setLastName(v => v || me.lastName);
    if (me?.avatarUrl) setUploadedAvatarUrl(v => v || me.avatarUrl);
    if (me?.username && !me.username.match(/^user_[a-z0-9]{6,8}$/)) {
      setUsername(v => v || me.username);
    }
  }, [me]);

  useEffect(() => {
    const normalized = normalizeUsername(username);

    if (!normalized) { setUsernameStatus(null); return; }
    if (normalized.length < 3 || normalized.length > 32) { setUsernameStatus("invalid"); return; }
    if (!/^[a-z0-9_]+$/.test(normalized)) { setUsernameStatus("invalid"); return; }
    if (me?.username && normalized === normalizeUsername(me.username)) { setUsernameStatus("ok"); return; }

    let alive = true;
    setUsernameStatus("checking");

    const timer = setTimeout(async () => {
      try {
        const res = await api.usernameAvailable(normalized);
        if (!alive) return;
        setUsernameStatus(res?.available ? "ok" : "taken");
      } catch {
        if (alive) setUsernameStatus("unknown");
      }
    }, 350);

    return () => { alive = false; clearTimeout(timer); };
  }, [username, me?.username]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setError(null);
      const dataUrl = await resizeAvatarFile(file);
      setUploadedAvatarUrl(dataUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  const normalizedUsername = normalizeUsername(username);
  const canSubmit = Boolean(
    firstName.trim() &&
    normalizedUsername &&
    usernameStatus === "ok" &&
    !loading
  );

  const handleSave = async () => {
    if (!firstName.trim()) { setError("Enter your first name"); return; }
    if (usernameStatus !== "ok") { setError("Choose a valid username"); return; }

    setLoading(true);
    setError(null);

    try {
      const data = {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        username:  normalizedUsername,
        avatarUrl: uploadedAvatarUrl || null,
      };

      if (setupToken && onFinishSetup) {
        await onFinishSetup(data);
        return;
      }

      const res = await api.updateProfile(data);
      if (res?.token) {
        migrateLocalStorageKeys(me?.username, res.username || data.username);
        setToken(res.token);
      }
      onDone({
        ...me,
        firstName: data.firstName,
        lastName:  data.lastName,
        username:  res?.username || data.username,
        avatarUrl: data.avatarUrl,
      });
    } catch (e) {
      setError(e.message || "Failed to save");
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-glow" />
      <div className="auth-card setup-card">
        {error && <div className="err-bar">{error}</div>}

        <div className="setup-avatar-wrap">
          <label className="setup-avatar-upload" title="Загрузить фото">
            <input type="file" accept="image/*" onChange={handleAvatarUpload} hidden />
            {uploadedAvatarUrl ? (
              <img src={uploadedAvatarUrl} alt="avatar" />
            ) : (
              <span>{initials(firstName || username || "?")}</span>
            )}
            <em>+</em>
          </label>
          <div className="setup-avatar-caption">Нажмите, чтобы загрузить фото</div>
        </div>

        <h1 className="auth-title" style={{ marginBottom: 20 }}>Tell us about yourself</h1>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="auth-label">First name *</div>
            <input className="inp" placeholder="John" value={firstName}
              onChange={e => setFirstName(e.target.value)} autoFocus />
          </div>
          <div style={{ flex: 1 }}>
            <div className="auth-label">Фамилия</div>
            <input className="inp" placeholder="Smith" value={lastName}
              onChange={e => setLastName(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="auth-label">Username *</div>
          <input className="inp" placeholder="ivan_petrov" value={username}
            onChange={e => setUsername(e.target.value.toLowerCase())} maxLength={32} />
          <div className="username-check">
            {usernameStatus === "checking" && <span>Проверяем...</span>}
            {usernameStatus === "ok"       && <span className="username-ok">✓ Available</span>}
            {usernameStatus === "taken"    && <span className="username-err">✗ Already taken</span>}
            {usernameStatus === "invalid"  && <span className="username-err">✗ Only lowercase letters, digits and _</span>}
            {usernameStatus === "unknown"  && <span className="username-err">✗ Не удалось проверить username</span>}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="auth-label">Bio</div>
          <textarea className="inp" placeholder="A few words about yourself..."
            value={bio} onChange={e => setBio(e.target.value)}
            maxLength={200} rows={2} style={{ resize: "vertical" }} />
        </div>

        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={!canSubmit}
        >
          {loading ? "Сохраняем..." : "Enter messenger 🚀"}
        </button>
      </div>
    </div>
  );
}