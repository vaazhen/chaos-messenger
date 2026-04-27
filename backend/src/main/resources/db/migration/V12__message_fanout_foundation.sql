ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_device_id VARCHAR(100);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(100);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_kind VARCHAR(30) NOT NULL DEFAULT 'ENCRYPTED';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;
UPDATE messages SET sender_device_id = COALESCE(sender_device_id, 'legacy-device') WHERE sender_device_id IS NULL;
UPDATE messages SET client_message_id = COALESCE(client_message_id, 'legacy-' || id::text) WHERE client_message_id IS NULL;
ALTER TABLE messages ALTER COLUMN sender_device_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN client_message_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_message_id ON messages(client_message_id);

CREATE TABLE IF NOT EXISTS message_envelopes (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL,
    target_user_id BIGINT NOT NULL REFERENCES users(id),
    target_device_db_id BIGINT NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
    target_device_id VARCHAR(100) NOT NULL,
    sender_user_id BIGINT NOT NULL REFERENCES users(id),
    sender_device_id VARCHAR(100) NOT NULL,
    message_type VARCHAR(40) NOT NULL,
    sender_identity_public_key TEXT NOT NULL,
    ephemeral_public_key TEXT,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    signed_prekey_id INTEGER,
    one_time_prekey_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, target_device_id)
);

CREATE INDEX IF NOT EXISTS idx_message_envelopes_message_id ON message_envelopes(message_id);
CREATE INDEX IF NOT EXISTS idx_message_envelopes_chat_target_device ON message_envelopes(chat_id, target_device_id);
CREATE INDEX IF NOT EXISTS idx_message_envelopes_target_device_db_id ON message_envelopes(target_device_db_id, created_at);
