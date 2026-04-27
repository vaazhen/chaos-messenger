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

// setupToken  — present for new users (phone registration, two-phase flow)
// onFinishSetup(data) — called instead of api.updateProfile when setupToken is set
// onDone(updatedMe)   — called after successful profile update for existing users
export default function SetupProfile({ me, setupToken, onFinishSetup, onDone }) {
  const [step,              setStep]             = useState(1);
  const [uploadedAvatarUrl, setUploadedAvatarUrl]= useState(null);
  const [firstName,         setFirstName]        = useState("");
  const [lastName,          setLastName]         = useState("");
  const [username,          setUsername]         = useState("");
  const [bio,               setBio]              = useState("");
  const [usernameStatus,    setUsernameStatus]   = useState(null);
  const [loading,           setLoading]          = useState(false);
  const [error,             setError]            = useState(null);

  useEffect(() => {
    if (me?.username && !me.username.match(/^user_[a-z0-9]{6,8}$/)) {
      setUsername(me.username);
    }
  }, [me]);

  useEffect(() => {
    const value = username.trim();
    if (!value || value.length < 3) { setUsernameStatus(null); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(value)) { setUsernameStatus("invalid"); return; }
    const normalized = value.toLowerCase();
    const t = setTimeout(async () => {
      try {
        const res = await api.searchUsers(normalized);
        const taken = Array.isArray(res) && res.some(u => u.username === normalized && u.id !== me?.id);
        setUsernameStatus(taken ? "taken" : "ok");
      } catch { setUsernameStatus("ok"); }
    }, 500);
    return () => clearTimeout(t);
  }, [username, me?.id]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeAvatarFile(file);
      setUploadedAvatarUrl(dataUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSave = async () => {
    if (!firstName.trim()) { setError("Enter your first name"); return; }
    if (!username.trim() || usernameStatus === "taken" || usernameStatus === "invalid") {
      setError("Choose a valid username"); return;
    }
    setLoading(true); setError(null);
    try {
      const data = {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        username:  username.trim().toLowerCase(),
        avatarUrl: uploadedAvatarUrl || null,
      };

      if (setupToken && onFinishSetup) {
        // ── New user (phone registration): no JWT yet, server issues it in complete-setup ──
        await onFinishSetup(data);
        // onFinishSetup calls auth.finishSetup → completeTokenLogin → navigates to app
        // No need to call onDone here
      } else {
        // ── Existing user: already has JWT, just update profile ──
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
      }
    } catch (e) {
      setError(e.message || "Failed to save");
      setLoading(false);
    }
  };

  // ─── Step 1: avatar ───────────────────────────────────────────────────────
  if (step === 1) return (
    <div className="auth">
      <div className="auth-glow" />
      <div className="auth-card">
        <div className="setup-step">
          <div className="step-dot active" />
          <div className="step-dot" />
        </div>

        <div className="auth-logo" style={uploadedAvatarUrl ? { background: "transparent", padding: 0 } : undefined}>
          {uploadedAvatarUrl
            ? <img src={uploadedAvatarUrl} alt="avatar"
                style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
            : "🎨"}
        </div>

        <h1 className="auth-title">Choose an avatar</h1>
        <p className="auth-sub" style={{ marginBottom: 20 }}>You can change it later in profile</p>

        <div className="btn-row">
          <label className="btn-sec" style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            Загрузить фото
            <input type="file" accept="image/*" onChange={handleAvatarUpload} hidden />
          </label>
          <button type="button" className="btn-sec" onClick={() => setUploadedAvatarUrl(null)}>
            Без фото
          </button>
        </div>

        {error && <div className="err-bar" style={{ marginTop: 12 }}>{error}</div>}

        <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => { setError(null); setStep(2); }}>
          Next →
        </button>
      </div>
    </div>
  );

  // ─── Step 2: name + username ──────────────────────────────────────────────
  return (
    <div className="auth">
      <div className="auth-glow" />
      <div className="auth-card">
        <div className="setup-step">
          <div className="step-dot" />
          <div className="step-dot active" />
        </div>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          {uploadedAvatarUrl ? (
            <img src={uploadedAvatarUrl} alt="avatar"
              style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", margin: "0 auto 8px", display: "block" }} />
          ) : (
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: "linear-gradient(135deg,#4fa3e0,#2d6fa8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 700, margin: "0 auto 8px",
            }}>
              {initials(firstName || "?")}
            </div>
          )}
          <button className="back-btn" style={{ justifyContent: "center", margin: "0 auto" }} onClick={() => setStep(1)}>
            ← Change avatar
          </button>
        </div>

        {error && <div className="err-bar">{error}</div>}

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
            onChange={e => setUsername(e.target.value)} maxLength={32} />
          <div className="username-check">
            {usernameStatus === "ok"      && <span className="username-ok">✓ Available</span>}
            {usernameStatus === "taken"   && <span className="username-err">✗ Already taken</span>}
            {usernameStatus === "invalid" && <span className="username-err">✗ Only letters, digits and _</span>}
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
          disabled={loading || !firstName.trim() || !username.trim() || usernameStatus === "taken" || usernameStatus === "invalid"}
        >
          {loading ? "Saving..." : "Enter messenger 🚀"}
        </button>
      </div>
    </div>
  );
}