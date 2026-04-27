-- Add last_seen field to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP;

-- Add status field to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'SENT';

-- Create an index for fast lookup
CREATE INDEX IF NOT EXISTS idx_messages_chat_id_sender_id ON messages(chat_id, sender_id);