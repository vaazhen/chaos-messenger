import { color, initials, AVATAR_PRESETS, avatarPreset } from "../helpers";

export default function Ava({ name, colorIdx, size = "", online, avatarUrl, avatarEmoji, avatarBg }) {
  const preset = avatarPreset(avatarUrl);
  const [c0, c1] = color(colorIdx ?? 0);
  const bg = avatarBg || preset?.bg || `linear-gradient(135deg,${c0},${c1})`;
  const text = avatarEmoji || preset?.emoji || initials(name);

  return (
    <div className={`av${size ? " " + size : ""}`} style={{ background: bg }}>
      {text}
      {online && <div className="online-dot" />}
    </div>
  );
}

export { AVATAR_PRESETS };
