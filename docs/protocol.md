# Chaos protocol notes

This is the contract the tests already enforce. It is not a Signal Protocol
specification and has not been independently audited.

The crypto engine is a module: `frontend/src/crypto-engine.ts` exports `e2ee`.
`window.e2ee` is only a compatibility adapter. Callers use `getE2ee()`.
HTTP from the engine goes through `createCryptoApi()`; a 401/404 must keep
`error.status` so a missing server device can re-register.

## What the server may see

Public device identifiers, public identity / pre-key material, chat membership,
ciphertext, ciphertext size, and delivery timing. It must not receive plaintext,
private identity keys, ratchet message keys, or a backup passphrase.

## Envelope types

| `messageType` | When |
|---|---|
| `PREKEY_WHISPER` | First message to a device, after reserving a pre-key |
| `WHISPER` | Later messages on an existing Double Ratchet session |
| `SELF_WHISPER` | Fan-out to the sender's own device, Double Ratchet session on that device |

AAD version `0x03` binds ciphertext to protocol type, 64-bit chat id, message
index, previous chain length, sender device id, target device id, and ratchet
public key, including `SELF_WHISPER`. Change any of those fields — AES-GCM
must fail. Decrypt uses that one AAD; there is no empty associated data and
no static-key `SELF_WHISPER` fallback. Tampering must not consume a one-time
pre-key or create a session. New sessions require a one-time pre-key; an
empty pool fails the send. A forged `WHISPER` must not delete a healthy
initiator session.

Layout is a 22-byte header (18 used + 4 trailing zeros), then two
length-prefixed Latin-1 device ids (sender, target). If a ratchet public key
is present, the encoder appends another `uint32` BE length plus Latin-1 key
bytes. Type codes: `PREKEY_WHISPER` = 1, `WHISPER` = 2, `SELF_WHISPER` = 3,
unknown = 0.

Pinned hex vectors (`frontend/src/test/envelopeAad.test.js`):

| Context | Hex |
|---|---|
| WHISPER, chat 100, idx 0, pcl 0 | `030200000000000000640000000000000000000000000000000000000000` |
| PREKEY_WHISPER, chat 1, idx 7, pcl 3 | `030100000000000000010000000700000003000000000000000000000000` |
| SELF_WHISPER, missing chat | `030300000000000000000000000000000000000000000000000000000000` |
| WHISPER, chat 100, idx 2, pcl 1, sender `device-a`, target `device-b`, rpk `AB` | `03020000000000000064000000020000000100000000000000086465766963652d61000000086465766963652d62000000024142` |
| unknown type, chat 0 | `030000000000000000000000000000000000000000000000000000000000` |

## Device trust

A new remote identity starts `UNVERIFIED`. Safety Number / QR moves it to
`VERIFIED`. The contact fingerprint hashes every remote identity key and
signing key in the chat; adding a device changes it. If any remote in a
fan-out is `VERIFIED`, every other remote must also be `VERIFIED` or the
send raises `UNVERIFIED_DEVICE`. The check is not grouped by server-supplied
`userId`. A device id is pinned to the first `userId` it is seen with; a
later relabel is `UNVERIFIED_DEVICE`. If that identity key later changes,
send and decrypt raise `IDENTITY_KEY_CHANGED` until the user re-verifies or
blocks (`BLOCKED`).

## Delivery

Send is one database transaction plus an outbox row. Kafka is the only notify
path. After reconnect the client asks `GET /realtime/sync?after={cursor}` and
drops duplicate `eventId`s. Typing and presence are ephemeral and skip the
outbox.

## Threat model per state transition

This is the claimed model. It is not an independent proof.

| Transition | Adversary | Must hold |
|---|---|---|
| Reserve OTK | Chat member | Server marks OTK used before decrypt. Empty pool is an error, not a 3-DH fallback. Reserve is rate-limited. |
| `PREKEY_WHISPER` decrypt | Network / replay | AES-GCM fail keeps OTK and creates no session. Missing OTK cannot establish or replace a session. Second decrypt is `PREKEY_REPLAY`. |
| `WHISPER` decrypt | Replay / reorder | In-order replay fails AES-GCM and does not advance `Nr` or delete the session. Out-of-order uses skipped keys (`MAX_SKIP=2000`). |
| DH ratchet | Stolen chain key | Next reverse-direction message replaces the chain (PCS after one RTT). Past message keys are gone (FS for those messages). `SELF_WHISPER` reseeds its chains after decrypt catches up with send. |
| Identity change | Malicious server | `IDENTITY_KEY_CHANGED` blocks send/decrypt until the user re-verifies. A new device next to a verified one is `UNVERIFIED_DEVICE`, including when the server lies about `userId`. |
| Device deactivate | Stolen device | Server stops fanout / WS / API and writes `DEVICE_REVOKED`. Peer ratchet state is not remotely wiped. Active-device cap 8 applies to reactivation. |
| Incoming call with `mediaKeys` | Failed unwrap or stripped field | If the callee can do media E2EE, missing or undecryptable `mediaKeys` hang up. No DTLS fallback. |

Forward secrecy: a stolen current chain key must not decrypt earlier messages whose keys were already deleted. Post-compromise security: after a DH ratchet in both directions, a stolen old chain key must not decrypt later messages.

## Groups

There is no sender-key or MLS group ratchet. This generation will not add
one. A group message is one pairwise envelope per active participant device,
plus self-whisper to the sender's devices.

`ChatLimits.MAX_GROUP_PARTICIPANTS = 32`. Create and invite reject a larger
set. 32 users × 8 devices is the worst-case fanout we accept. Larger groups
need a later protocol, not a bigger N here.

A user may have at most `DeviceLimits.MAX_ACTIVE_DEVICES = 8` active devices.
Deactivate sets `active=false` (fanout and `requireCurrentDevice` stop), then
closes WebSocket sessions for that `deviceId`. Peer ratchet state on other
phones is not remotely wiped.

## Kafka ordering

`OutboxPublisher.partitionKey` is the chat id for `message` / `chat` /
`request` aggregates. Events for one chat stay on one partition. Crypto state
still has to tolerate at-least-once Kafka delivery: the device log keys
`(device_id, event_id, destination)`.

## Sync

`GET /api/realtime/sync?after=&limit=` is clamped to 1..500 in the controller
and again in `RealtimeEventStore`.

## Backup

A passphrase-derived AES-GCM key stays on the device. Restore returns identity
and signing material only. It does not restore signed pre-keys, one-time
pre-keys, or ratchet sessions, so old `SELF_WHISPER` and peer envelopes stay
undecryptable until new sessions form. Restore keeps previously verified
Safety Number records and a journal of consumed one-time pre-key ids.
Device-id conflict on register does not wipe identity unless the user confirms.

## Tests that pin this

- `frontend/src/test/envelopeAad.test.js` — AAD v3 hex vectors
- `frontend/src/test/cryptoApi.test.js` — HTTP adapter keeps `status` / `code`
- `frontend/src/test/crypto-engine.test.js` — handshake, ratchet, skip, WHISPER replay, tamper, heal, self-whisper, `KEY_CHANGED`
- `frontend/src/test/messageModel.test.js` — payload / merge / placeholder rules
- `frontend/src/test/messageCrypto.test.js` — decrypt keeps `replyTo`
- `frontend/src/test/messageTimeline.test.js` — merge / optimistic / hidden rows
- `frontend/src/test/messageSend.test.js` — TTL, reply wrapper, payload size
- `backend/.../DurableRealtimeDeliveryTest` — persist before STOMP
- `frontend/e2e/send-reconnect.e2e.spec.js` — send, reload, decrypt from timeline
