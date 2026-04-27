import { useRef, useEffect } from "react";
import Ava from "./Ava";
import { getTime, messageMatchesQuery } from "../helpers";

export default function MessageList({
  msgs,
  me,
  activeChat,
  loadingMsgs,
  onContextMenu,
  onReact,
  searchQuery = "",
  typingUsername,
}) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  if (loadingMsgs) {
    return (
      <div className="msgs scroll">
        <div className="loading-msgs"><div className="spinner" /></div>
      </div>
    );
  }

  if (!msgs.length) {
    return (
      <div className="msgs scroll">
        <div className="product-empty">
          <div className="product-empty-icon">◯</div>
          <div className="product-empty-title">Нет сообщений</div>
          <div className="product-empty-sub">Создайте новую переписку.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="msgs scroll">
      <div className="date-div">today</div>

      {msgs.map((msg, idx) => {
        const isOut = msg._out ?? (msg.senderId === me?.id);
        const next = msgs[idx + 1];
        const isGroupEnd = !next || ((next._out ?? (next.senderId === me?.id)) !== isOut);
        const text = msg._text ?? msg.content ?? "[encrypted]";
        const time = msg._time ?? getTime(msg.createdAt);
        const reactions = msg.reactions || {};
        const myReactions = msg.myReactions || [];
        const isПоискHit = messageMatchesQuery(msg, searchQuery);

        return (
          <div
            key={msg.id ?? idx}
            className={`msg-wrap${isOut ? " out" : ""}${isПоискHit ? " search-hit" : ""}`}
            onContextMenu={e => onContextMenu(e, { ...msg, _text: text, _out: isOut })}
          >
            {!isOut && (
              isGroupEnd
                ? <Ava name={activeChat?.name} colorIdx={activeChat?.colorIdx} size="sm" avatarUrl={activeChat?.avatarUrl} />
                : <div style={{ width: 28, flexShrink: 0 }} />
            )}

            <div
              className={`bubble ${isOut ? "out" : "in"}${isGroupEnd ? (isOut ? " tl-out" : " tl-in") : ""}`}
              onClick={e => e.stopPropagation()}
            >
              {msg._replyTo && (
                <div className="reply-quote">
                  <div className="reply-q-name">Ответить</div>
                  <div className="reply-q-text">{msg._replyTo._text}</div>
                </div>
              )}

              {msg._img && <img className="msg-img" src={msg._img} alt="" />}

              {text && <span>{renderHighlightedText(text, searchQuery)}</span>}

              <div className="msg-meta">
                {msg.измененоAt && <span className="изменено-mark">изменено</span>}
                <span>{time}</span>
                {isOut && (
                  <span className={`check${msg.status === "READ" ? " read" : ""}`}>
                    {msg.status === "READ" ? "✓✓" : "✓"}
                  </span>
                )}
              </div>

              {Object.keys(reactions).length > 0 && (
                <div className="message-reactions">
                  {Object.entries(reactions).map(([emoji, count]) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`reaction-chip${myReactions.includes(emoji) ? " mine" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReact?.({ ...msg, _text: text, _out: isOut }, emoji);
                      }}
                    >
                      <span>{emoji}</span>
                      <span>{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {typingUsername && (
        <div className="msg-wrap">
          <Ava name={typingUsername} colorIdx={0} size="sm" />
          <div className="typing">
            <div className="td" /><div className="td" /><div className="td" />
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
function renderHighlightedText(text, query) {
  const q = String(query || "").trim();
  const source = String(text || "");

  if (!q) return source;

  const lower = source.toLowerCase();
  const needle = q.toLowerCase();
  const parts = [];

  let pos = 0;
  let idx = lower.indexOf(needle);

  while (idx !== -1) {
    if (idx > pos) parts.push(source.slice(pos, idx));

    parts.push(
      <mark className="msg-search-mark" key={`${idx}-${needle}`}>
        {source.slice(idx, idx + q.length)}
      </mark>
    );

    pos = idx + q.length;
    idx = lower.indexOf(needle, pos);
  }

  if (pos < source.length) parts.push(source.slice(pos));

  return parts;
}