-- V18: add signing_public_key column to user_devices
--
-- Context: critical bug #1 in DeviceService.computeSignedPreKeySignature()
-- used SHA-256(identityKey || signedPreKey) as a "signature".
-- It is a hash, not a signature; anyone could compute it and register a forged bundle.
--
-- Fix: the client now generates a separate ECDSA P-256 signing key pair,
-- signs SignedPreKey with a real digital signature and the server verifies it.
--
-- signing_public_key: Base64-encoded SPKI public key (ECDSA P-256).
-- Nullable: old devices registered before the patch get NULL.
-- On next connection the client recreates the bundle and updates the column.

ALTER TABLE user_devices
    ADD COLUMN IF NOT EXISTS signing_public_key TEXT;

COMMENT ON COLUMN user_devices.signing_public_key
    IS 'Base64 SPKI ECDSA P-256 — signing key for SignedPreKey verification. NULL = old device before the V18 patch.';
