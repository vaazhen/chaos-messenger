-- Index for fast message lookup by chat
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

-- Index for member lookup by user
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON chat_participants(user_id);

-- Index for member lookup by chat
CREATE INDEX IF NOT EXISTS idx_chat_participants_chat_id ON chat_participants(chat_id);

-- Index for sorting messages by time
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);