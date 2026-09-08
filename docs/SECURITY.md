# Chaos security position

Chaos is a **private, verifiable, multi-device E2EE messenger**.
It is not Telegram-with-Kafka and not Signal.

## What we claim

- Content is E2EE. The server stores ciphertext, public keys, membership,
  timing, and size.
- Delivery is durable: Postgres + outbox + Kafka + device event log.
  WebSocket is acceleration. Sync recovers after disconnect.
- Multi-device is first-class. At most 8 active devices. Revoke marks the
  device inactive, stops fanout, and closes that device's WebSocket.
- Groups stay pairwise. Hard cap **32 participants**. No MLS in this
  protocol generation.

## What we do not claim

- Independent cryptographic audit. See `docs/CRYPTO_AUDIT_BRIEF.md`.
- Metadata privacy (sealed sender, hidden membership).
- Web origin integrity. A malicious origin can ship other JS. Prefer
  Electron / a signed client for high assurance.
- Production object storage, TURN, or HA Postgres/Redis/Kafka. Those
  remain operator work (`PROD-S3`, `PROD-TURN`, `PROD-HA`).

## Frozen protocol

The current X3DH-inspired + Double Ratchet-style contract is frozen in
`docs/protocol.md`. New crypto features wait. Property the tests already
pin: AAD v2, self-whisper ratchet, OTK fail-closed, PREKEY replay, WHISPER replay,
skip keys, identity change, unverified extra device, incoming-call fail-closed.

## Operator drills

- `scripts/delivery-drill.sh` — health, outbox, sync; optional Kafka/Redis break
- `scripts/restore-drill.sh` — pg_dump / restore
- `docs/runbooks/` — outbox, refresh reuse, database, rollback
