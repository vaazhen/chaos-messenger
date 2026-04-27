CREATE TABLE IF NOT EXISTS message_events (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL,
    actor_user_id BIGINT NOT NULL REFERENCES users(id),
    event_type VARCHAR(40) NOT NULL,
    payload_json TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_events_message_id ON message_events(message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_message_events_chat_id ON message_events(chat_id, created_at);
