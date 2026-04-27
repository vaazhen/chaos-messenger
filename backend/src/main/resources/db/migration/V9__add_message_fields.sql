-- Add fields for message editing
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;

-- Index for pagination
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at);

-- Index for fast lookup by chat
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);