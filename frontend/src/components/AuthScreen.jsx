import { useRef, useState } from "react";

const COUNTRIES = [
  { code: "+7",   flag: "🇷🇺", name: "Russia",        mask: "999 000 00 00", len: 10 },
  { code: "+375", flag: "🇧🇾", name: "Belarus",       mask: "00 000 00 00",  len: 9  },
  { code: "+380", flag: "🇺🇦", name: "Ukraine",       mask: "00 000 00 00",  len: 9  },
  { code: "+7",   flag: "🇰🇿", name: "Kazakhstan",    mask: "000 000 00 00", len: 10 },
  { code: "+374", flag: "🇦🇲", name: "Armenia",       mask: "00 000 000",    len: 8  },
  { code: "+994", flag: "🇦🇿", name: "Azerbaijan",    mask: "00 000 00 00",  len: 9  },
  { code: "+995", flag: "🇬🇪", name: "Georgia",       mask: "000 000 000",   len: 9  },
  { code: "+992", flag: "🇹🇯", name: "Tajikistan",    mask: "00 000 0000",   len: 9  },
  { code: "+998", flag: "🇺🇿", name: "Uzbekistan",    mask: "00 000 00 00",  len: 9  },
  { code: "+996", flag: "🇰🇬", name: "Kyrgyzstan",    mask: "000 000 000",   len: 9  },
  { code: "+993", flag: "🇹🇲", name: "Turkmenistan",  mask: "0 000 000",     len: 8  },
  { code: "+1",   flag: "🇺🇸", name: "USA / Canada",  mask: "000 000 0000",  len: 10 },
  { code: "+44",  flag: "🇬🇧", name: "United Kingdom", mask: "0000 000000",  len: 10 },
  { code: "+49",  flag: "🇩🇪", name: "Germany",       mask: "000 00000000",  len: 11 },
  { code: "+33",  flag: "🇫🇷", name: "France",        mask: "0 00 00 00 00", len: 9  },
  { code: "+39",  flag: "🇮🇹", name: "Italy",         mask: "000 000 0000",  len: 10 },
  { code: "+34",  flag: "🇪🇸", name: "Spain",         mask: "000 000 000",   len: 9  },
  { code: "+90",  flag: "🇹🇷", name: "Turkey",        mask: "000 000 00 00", len: 10 },
  { code: "+86",  flag: "🇨🇳", name: "China",         mask: "000 0000 0000", len: 11 },
  { code: "+81",  flag: "🇯🇵", name: "Japan",         mask: "00 0000 0000",  len: 10 },
  { code: "+82",  flag: "🇰🇷", name: "Korea",         mask: "00 0000 0000",  len: 10 },
  { code: "+91",  flag: "🇮🇳", name: "India",         mask: "00000 00000",   len: 10 },
  { code: "+55",  flag: "🇧🇷", name: "Brazil",        mask: "00 00000 0000", len: 11 },
  { code: "+971", flag: "🇦🇪", name: "UAE",           mask: "00 000 0000",   len: 9  },
  { code: "+972", flag: "🇮🇱", name: "Israel",        mask: "00 000 0000",   len: 9  },
];

function CountrySelector({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef(null);

  const filtered = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.code.includes(search)
  );
  const current = COUNTRIES.find(c => c.code === selected) || COUNTRIES[0];

  const select = (c) => {
    onChange(c);
    setOpen(false);
    setSearch("");
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setTimeout(() => inputRef.current?.focus(), 50); }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "0 12px", height: 48, borderRadius: 12,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
          color: "var(--fg, #e8e8e8)", cursor: "pointer", fontSize: 15,
          whiteSpace: "nowrap", minWidth: 90,
        }}
      >
        <span style={{ fontSize: 20 }}>{current.flag}</span>
        <span>{current.code}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 999,
          background: "#1a1f2e", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12, width: 260, maxHeight: 320, overflow: "hidden",
          display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search country..."
              style={{
                width: "100%", background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                color: "#e8e8e8", padding: "6px 10px", fontSize: 13,
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map((c, i) => (
              <button
                key={`${c.code}-${c.name}-${i}`}
                type="button"
                onClick={() => select(c)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "9px 14px", background: "transparent",
                  border: "none", color: "#e8e8e8", cursor: "pointer",
                  fontSize: 14, textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: 20, minWidth: 24 }}>{c.flag}</span>
                <span style={{ flex: 1 }}>{c.name}</span>
                <span style={{ opacity: 0.5, fontSize: 13 }}>{c.code}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: "16px", textAlign: "center", opacity: 0.4, fontSize: 13 }}>No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuthScreen({
  screen, phone, setPhone,
  dialCode, setDialCode,
  otp, setOtp, otpRefs,
  email = "", setEmail = () => {},
  password = "", setPassword = () => {},
  onSubmitPhone, onVerifyOtp, onSubmitEmail,
  loading, error, onBack,
}) {
  const [method, setMethod] = useState("email");
  const [emailMode, setEmailMode] = useState("login");
  const currentCountry = COUNTRIES.find(c => c.code === dialCode) || COUNTRIES[0];
  const validEmail = /.+@.+\..+/.test(email.trim());
  const validPassword = password.length >= 6;

  if (screen === "otp") return (
    <div className="auth">
      <div className="auth-glow" />
      <div className="auth-card">
        {error && <div className="err-bar">{error}</div>}
        <button className="back-btn" onClick={onBack}>Back</button>
        <div className="auth-logo">📱</div>
        <h1 className="auth-title">Enter the code</h1>
        <p className="auth-sub">
          The code will appear in backend logs:<br />
          <code style={{ fontSize: 11, color: "var(--acc)" }}>OTP for {dialCode}...: XXXXXX</code>
        </p>
        <div className="otp-row">
          {otp.map((d, i) => (
            <input
              key={i}
              ref={otpRefs[i]}
              className="otp-box"
              type="tel"
              maxLength={1}
              value={d}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, "").slice(-1);
                const next = [...otp]; next[i] = v;
                setOtp(next);
                if (v && i < 5) otpRefs[i + 1].current?.focus();
                if (next.every(x => x)) onVerifyOtp(next);
              }}
              onKeyDown={e => e.key === "Backspace" && !otp[i] && i > 0 && otpRefs[i - 1].current?.focus()}
              disabled={loading}
            />
          ))}
        </div>
        {loading && <div style={{ textAlign: "center", marginBottom: 12 }}><div className="spinner" /></div>}
      </div>
    </div>
  );

  return (
    <div className="auth">
      <div className="auth-glow" />
      <div className="auth-card">
        {error && <div className="err-bar">{error}</div>}
        <div className="auth-logo">🔐</div>
        <h1 className="auth-title">Chaos Messenger</h1>
        <p className="auth-sub">E2E encryption — the server cannot read messages</p>

        <div style={{ display: "flex", gap: 4, marginBottom: 18, background: "var(--bg3)", borderRadius: 10, padding: 4 }}>
          <button type="button" onClick={() => setMethod("email")}
            style={{ flex: 1, padding: "9px 0", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font)", fontWeight: 700,
              background: method === "email" ? "var(--bg1)" : "transparent", color: method === "email" ? "var(--t1)" : "var(--t3)" }}>
            Email
          </button>
          <button type="button" onClick={() => setMethod("phone")}
            style={{ flex: 1, padding: "9px 0", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font)", fontWeight: 700,
              background: method === "phone" ? "var(--bg1)" : "transparent", color: method === "phone" ? "var(--t1)" : "var(--t3)" }}>
            Phone
          </button>
        </div>

        {method === "email" ? (
          <>
            <div className="auth-label">Email</div>
            <input
              className="inp"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <div className="auth-label" style={{ marginTop: 12 }}>Password</div>
            <input
              className="inp"
              type="password"
              placeholder="Minimum 6 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && validEmail && validPassword && onSubmitEmail(emailMode)}
              disabled={loading}
            />
            <button
              className="btn-primary"
              onClick={() => onSubmitEmail(emailMode)}
              disabled={!validEmail || !validPassword || loading}
            >
              {loading ? "Please wait..." : emailMode === "register" ? "Create account" : "Sign in"}
            </button>
            <button
              type="button"
              className="back-btn"
              style={{ justifyContent: "center", margin: "10px auto 0" }}
              onClick={() => setEmailMode(emailMode === "register" ? "login" : "register")}
            >
              {emailMode === "register" ? "I already have an account" : "Create account by email"}
            </button>
          </>
        ) : (
          <>
            <div className="auth-label">Phone number</div>
            <div className="phone-row" style={{ gap: 8, alignItems: "stretch" }}>
              <CountrySelector
                selected={dialCode}
                onChange={(c) => { setDialCode(c.code); setPhone(""); }}
              />
              <input
                className="inp"
                type="tel"
                placeholder={currentCountry.mask}
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, currentCountry.len))}
                onKeyDown={e => e.key === "Enter" && onSubmitPhone()}
                maxLength={currentCountry.len}
                disabled={loading}
                autoFocus
              />
            </div>
            <button
              className="btn-primary"
              onClick={onSubmitPhone}
              disabled={phone.replace(/\D/g, "").length < 4 || loading}
            >
              {loading ? "Sending..." : "Get code"}
            </button>
          </>
        )}

        <p className="auth-hint">X3DH · Symmetric Ratchet · AES-GCM</p>
      </div>
    </div>
  );
}
