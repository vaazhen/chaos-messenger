function pickAvatarUrl(props) {
  return (
    props.avatarUrl ||
    props.user?.avatarUrl ||
    props.me?.avatarUrl ||
    props.chat?.avatarUrl ||
    ""
  );
}

function pickName(props) {
  const user = props.user || props.me || props.chat || props;
  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();

  return (
    props.name ||
    props.title ||
    fullName ||
    user.displayName ||
    user.username ||
    user.phone ||
    "Пользователь"
  );
}

function initialsFrom(value) {
  return String(value || "П")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(x => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "П";
}

function isImageAvatar(value) {
  if (!value) return false;

  return (
    value.startsWith("data:image/") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}

export default function Ava(props) {
  const avatarUrl = pickAvatarUrl(props);
  const name = pickName(props);

  const className =
    props.className ||
    `av${props.size ? ` ${props.size}` : ""}`;

  if (isImageAvatar(avatarUrl)) {
    return (
      <div className={className} title={name}>
        <img
          src={avatarUrl}
          alt={name}
          draggable="false"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            borderRadius: "inherit",
          }}
        />
        {props.online && <span className="online-dot" />}
      </div>
    );
  }

  return (
    <div className={className} title={name}>
      {initialsFrom(name)}
      {props.online && <span className="online-dot" />}
    </div>
  );
}