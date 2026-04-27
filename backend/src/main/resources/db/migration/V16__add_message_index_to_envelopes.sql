-- Add message_index for Symmetric Ratchet support.
-- The client sends the message sequence number within the session,
-- and the recipient uses it to synchronize ratchet state.
ALTER TABLE message_envelopes ADD COLUMN IF NOT EXISTS message_index INTEGER;
