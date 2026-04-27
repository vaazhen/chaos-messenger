-- Add E2EE fields
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_content TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS iv TEXT;

-- Public key field in users, likely already present
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT;