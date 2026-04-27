ALTER TABLE verification_codes
    ADD COLUMN IF NOT EXISTS used_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_verification_codes_phone_used_id
    ON verification_codes(phone, used_at, id DESC);
