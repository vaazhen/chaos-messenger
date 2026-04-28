# Chaos Messenger — Security Audit & Hardening Plan

Project: E2EE messenger built with Spring Boot + React.

Core architectural idea: cryptography runs on the client. The backend routes users, devices, chats, encrypted envelopes, WebSocket events, and message metadata, but it must not have plaintext messages or private keys.

---

## 1. Current status

At this stage, the project has:

- backend unit/integration tests;
- frontend unit/integration tests;
- backend JaCoCo quality gate;
- frontend Vitest coverage gate;
- mocked Playwright E2E;
- real Playwright E2E;
- real E2E confirms the full flow:
  - two real users;
  - email registration;
  - device registration;
  - direct chat;
  - encrypted message;
  - receiving and decrypting the message;
  - page reload;
  - successful decrypt after reload.

Current status: working E2EE MVP.

This is not yet a production-grade Signal-level system, but it is no longer a decorative pet project. The core end-to-end architecture is confirmed by a real browser, a real backend, a real database, and reload decrypt.

---

## 2. Main security goal

The server must not be technically able to read user message contents.

Additional goals:

1. A user must not access chats they do not belong to.
2. A device must not receive messages after deactivation.
3. WebSocket must not allow subscriptions to unauthorized topics.
4. Refresh tokens must not provide unlimited access.
5. Device registration tokens must be short-lived and single-use.
6. The frontend must detect suspicious device key changes.
7. Replay of old messages/envelopes must not be accepted as new messages.
8. Backend logs must not contain plaintext, JWTs, refresh tokens, or private keys.
9. After reload, a user must decrypt only messages for which local keys exist.
10. Cryptographic errors must be explicit.

---

## 3. What the current MVP does NOT guarantee

The current MVP does not yet guarantee:

- full Signal-like safety numbers;
- manual key verification;
- protection against a fully malicious backend that substitutes public keys;
- protection against XSS when arbitrary JavaScript execution is achieved;
- secure enclave / hardware-backed key storage;
- production-grade metadata protection;
- encrypted cloud backup;
- formal cryptographic audit by independent experts.

The main remaining risk is public device key substitution by a malicious backend or compromised API response. To mitigate it, the project needs fingerprints, trust-on-first-use, key-change warnings, and device trust UX.

---

## 4. Critical assets

### 4.1. Client-side assets

Must be protected:

- private identity key;
- private signed pre-key;
- one-time pre-key material;
- local device bundle;
- local E2EE sessions;
- JWT;
- refresh token;
- device id;
- decrypted messages in memory;
- local encrypted/decrypted preview cache;
- hidden message ids.

Main client-side risk: XSS or a malicious browser extension. If an attacker executes JavaScript in the browser, they can read localStorage, plaintext in memory, tokens, and key material.

### 4.2. Server-side assets

The server stores:

- users;
- password hashes;
- refresh-token records;
- setup/device-registration tokens;
- public device keys;
- signed pre-keys;
- one-time pre-keys;
- encrypted envelopes;
- chat membership;
- message metadata;
- delivery/read receipts.

The server must not store:

- message plaintext;
- private keys;
- shared secrets;
- session keys;
- decrypted attachments.

---

## 5. Attacker model

### 5.1. External attacker

May attempt to:

- brute-force passwords;
- brute-force OTP;
- steal refresh tokens;
- reuse refresh tokens;
- reuse device-registration tokens;
- call APIs for chats they do not belong to;
- subscribe to unauthorized WebSocket topics;
- send malformed envelopes;
- replay old messages;
- exploit XSS.

### 5.2. Malicious user

May attempt to:

- send a message to a chat they are not a member of;
- read another chat timeline;
- forge senderDeviceId;
- send an envelope to a device that does not belong to a chat participant;
- delete another user's message;
- update statuses for messages they should not update;
- spam reactions/read receipts;
- subscribe to another user's device topics.

### 5.3. Honest-but-curious server

The server sees metadata:

- who talks to whom;
- message timestamps;
- ciphertext size;
- number of devices;
- read/delivery metadata.

The server must not see:

- plaintext;
- private keys;
- session keys;
- shared secrets.

### 5.4. Malicious server

A malicious backend may attempt to:

- substitute a device public key;
- hide a device;
- add a fake device;
- return a stale pre-key;
- drop messages;
- alter metadata.

The current MVP does not fully protect against a malicious backend. A trust layer is required: fingerprints, safety numbers, key-change warnings, and device trust UX.

---

## 6. Trust boundaries

### 6.1. Browser boundary

Cryptography runs in the browser, so the browser JavaScript context is critical.

Risks:

- XSS;
- compromised dependency;
- malicious browser extension;
- localStorage theft;
- accidental logging;
- token leakage.

### 6.2. API boundary

Backend API must validate:

- JWT;
- user identity;
- active device;
- chat membership;
- ownership;
- request consistency;
- idempotency;
- rate limits.

### 6.3. WebSocket boundary

WebSocket must validate:

- JWT on connect;
- X-Device-Id;
- active registered device;
- session-to-user binding;
- session-to-device binding;
- authorization for every topic.

A user must not subscribe to:

- another user's `/topic/users/{username}/chats`;
- another device's `/topic/devices/{deviceId}`;
- typing topic for a chat they do not belong to;
- device topic for a deactivated device.

### 6.4. Storage boundary

Backend storage is considered untrusted for plaintext. Even if the database leaks, the attacker should not get message contents without client private keys.

---

## 7. Current E2EE flow

### 7.1. Device registration

The frontend creates a local device bundle.

The backend receives:

- deviceId;
- registrationId;
- identityPublicKey;
- signingPublicKey;
- signedPreKey;
- oneTimePreKeys.

The backend does not receive private keys.

### 7.2. Sending a message

The frontend:

1. resolves target devices for chat participants;
2. builds an encrypted envelope for every target device;
3. sends the envelope array to the backend;
4. the backend stores encrypted envelopes;
5. the backend fanouts events to device topics.

### 7.3. Receiving a message

The receiver:

1. receives an envelope;
2. uses the local device bundle/session;
3. decrypts the message;
4. displays plaintext only on the client.

### 7.4. Reload

After reload, the frontend restores:

- device id;
- local device bundle;
- E2EE sessions;
- JWT/refresh-token;
- timeline;
- envelopes.

Real E2E confirmed: the message decrypts after reload.

---

## 8. Confirmed by tests

### 8.1. Backend

Covered areas:

- auth service;
- phone/email auth;
- setup-token;
- refresh-token;
- device-registration-token;
- device service;
- signed pre-key validation;
- one-time pre-key logic;
- prekey bundle;
- resolve chat devices;
- chat service;
- message service;
- idempotency;
- duplicate envelope target rejection;
- senderDeviceId validation;
- message edit/delete/status/reactions;
- user profile flow;
- WebSocket authorization;
- JWT filter;
- GlobalExceptionHandler.

### 8.2. Frontend

Covered areas:

- API headers;
- JWT + X-Device-Id;
- device-registration-token is sent only to register endpoint;
- auth setup flow;
- refresh recovery;
- missing device recovery;
- local crypto storage migration;
- missing local bundle error;
- useChats;
- useMessages;
- decrypt timeline;
- optimistic send;
- rollback send/edit;
- local/everyone delete;
- reactions;
- useWebSocket;
- ProfileModal devices;
- NewChat direct/group/saved;
- mocked Playwright E2E;
- real Playwright E2E.

---

## 9. Main risks

### RISK-001: No full device key verification

Severity: High  
Status: Open

The user currently cannot manually verify a contact's fingerprint/safety number. If the backend substitutes a public device key, the frontend may encrypt a message to an attacker-controlled device.

Required hardening:

- calculate fingerprints for device public keys;
- store known fingerprints by username + deviceId;
- detect key changes;
- show warnings;
- block silent sends to changed keys;
- add Security / Devices / Keys screen.

Tests:

- first seen key is stored;
- same key does not trigger warning;
- changed key creates warning;
- sending is blocked until user confirms the changed key.

### RISK-002: Device revocation must be strict

Severity: High  
Status: Partially covered

A deactivated device must not receive new envelopes.

Required hardening:

- backend resolve devices must not return inactive devices;
- bundle endpoint must not return inactive devices;
- `/crypto/devices/current` must reject inactive devices;
- WebSocket connect must reject inactive devices;
- frontend must not build fanout for inactive devices;
- old WebSocket session should stop receiving events after revocation.

Tests:

- inactive device excluded from resolveChatDevices;
- inactive device cannot connect over WebSocket;
- real E2E: Bob's old device is deactivated, Alice sends a message, old Bob device does not receive/decrypt it.

### RISK-003: Replay protection

Severity: High  
Status: Open

An old envelope or old messageIndex must not be accepted as a new message.

Required hardening:

- clientMessageId idempotency;
- messageIndex monotonic per sender/receiver device session;
- reject duplicate/lower messageIndex;
- store last accepted messageIndex;
- reject duplicate targetDeviceId.

Tests:

- same clientMessageId returns existing message;
- duplicate envelope target rejected;
- replay old messageIndex ignored/rejected;
- replay after reload ignored/rejected.

### RISK-004: Refresh-token hardening

Severity: High  
Status: Partially covered

Requirements:

- refresh-token rotation;
- old token invalid after use;
- logout revokes token;
- token stored hashed server-side;
- suspicious reuse detection;
- optional device binding.

Tests:

- old refresh-token cannot be reused;
- logout invalidates refresh-token;
- invalid refresh returns 401;
- stolen old refresh-token cannot mint new JWT.

### RISK-005: Device-registration-token hardening

Severity: High  
Status: Partially covered

Requirements:

- short TTL;
- single-use;
- bound to username;
- accepted only by `/crypto/devices/register`;
- not stored in localStorage;
- never sent to unrelated endpoints.

Tests:

- token sent only to register endpoint;
- reused token rejected;
- expired token rejected;
- token for another user rejected.

### RISK-006: XSS destroys E2EE

Severity: Critical  
Status: Open

If an attacker executes JavaScript in the browser, they can read localStorage, plaintext, keys, and tokens.

Required hardening:

- strict CSP;
- avoid dangerous innerHTML;
- sanitize user content;
- no external untrusted scripts;
- no tokens in URL;
- no plaintext logs;
- dependency audit;
- consider IndexedDB + non-extractable WebCrypto keys.

---

## 10. Security requirements

### 10.1. Backend requirements

Auth:

- JWT secret length >= 32 chars.
- JWT expires.
- Refresh-token rotates.
- Refresh-token revocable.
- Setup-token short-lived.
- Device-registration-token short-lived and single-use.

Users:

- username normalized lowercase.
- username uniqueness enforced.
- profile update returns new JWT on username change.
- search requires auth.

Devices:

- deviceId belongs to authenticated user.
- inactive devices rejected.
- inactive devices do not receive envelopes.
- signedPreKey signature verified.
- one-time prekeys not reused incorrectly.

Chats:

- only participants can read timeline.
- only participants can send.
- only participants can resolve devices.
- group member list validated.
- direct chat avoids duplicates.

Messages:

- sender must be participant.
- senderDeviceId must match current device.
- clientMessageId idempotent.
- duplicate targetDeviceId rejected.
- targetUserId must be participant.
- targetDeviceId must belong to targetUserId and be active.
- edit/delete only by sender.
- reactions on deleted messages rejected.

WebSocket:

- connect requires valid JWT.
- connect requires active X-Device-Id.
- subscribe validates topic ownership.
- user cannot subscribe to another user/device topic.
- typing topic validates chat membership.

### 10.2. Frontend requirements

Auth:

- startup without token shows auth screen, not infinite loader;
- setup order:
  1. complete setup;
  2. save JWT;
  3. save refresh-token;
  4. register device;
  5. fetch `/me`;
  6. load chats;
  7. enter messenger.

Device:

- X-Device-Id sent on authenticated requests;
- device-registration-token only sent to device registration endpoint;
- local device id stable;
- crypto storage migration works.

Crypto:

- plaintext only client-side;
- missing local bundle fails clearly;
- corrupted ciphertext fails clearly;
- send fails safely without crypto engine;
- optimistic message rolls back on failure;
- reload preserves decrypt.

UI:

- device list shows current device;
- device deactivation is explicit;
- key-change warning must be added;
- errors visible to user.

---

## 11. Hardening roadmap

### Phase 1 — Immediate hardening

Estimate: 2-4 evenings.

Tasks:

1. Device revocation tests.
2. Inactive devices excluded from all resolve/bundle paths.
3. Inactive device WebSocket rejection.
4. Key fingerprint calculation.
5. Store known device fingerprints.
6. Detect changed keys.
7. UI warning for changed keys.
8. E2E regression for device revocation.

### Phase 2 — Trust UI / Safety number

Estimate: 1 week.

Tasks:

1. Security screen.
2. Contact devices list.
3. Fingerprint/safety number display.
4. Trusted/untrusted device state.
5. Warning for new device.
6. Warning for changed key.
7. Confirmation before sending to changed key.

### Phase 3 — Replay hardening

Estimate: 1 week.

Tasks:

1. Track last messageIndex per session pair.
2. Reject old/lower/equal messageIndex.
3. Add replay unit tests.
4. Add reload replay E2E.
5. Add malformed envelope tests.

### Phase 4 — Token hardening

Estimate: 2-5 evenings.

Tasks:

1. Verify refresh-token stored hashed server-side.
2. Add reuse detection.
3. Bind refresh-token to device if appropriate.
4. Token family invalidation on reuse.
5. Logout all devices.
6. Tests for stolen old refresh-token.

### Phase 5 — Browser hardening

Estimate: 2-5 evenings.

Tasks:

1. Add strict CSP.
2. Review inline scripts/styles.
3. Dependency audit.
4. Security headers.
5. Static checks.
6. Review localStorage use.
7. Consider IndexedDB + non-extractable keys.

---

## 12. Commands that must remain green

Backend:

```powershell
cd backend
mvn clean verify
```

Expected:

- instruction coverage >= 80%;
- branch coverage >= 60%;
- all tests green.

Frontend:

```powershell
cd frontend
npm test
npm run test:coverage
```

Expected:

- statements >= 65%;
- lines >= 65%;
- branches >= 55%;
- functions >= 45%;
- all tests green.

Mocked E2E:

```powershell
cd frontend
npm run test:e2e
```

Real E2E:

```powershell
cd frontend
npm run test:e2e:real
```

Requires:

- Docker Desktop running;
- Postgres running;
- Redis running;
- backend running on 8080.

---

## 13. Manual checklist before demo

- [ ] Backend tests green.
- [ ] Frontend tests green.
- [ ] Frontend coverage green.
- [ ] Mocked E2E green.
- [ ] Real E2E green.
- [ ] No JWT in logs.
- [ ] No refresh-token in logs.
- [ ] No device-registration-token in logs.
- [ ] No private keys in logs.
- [ ] No plaintext messages in backend logs.
- [ ] WebSocket cannot subscribe to another user's topic.
- [ ] Inactive device cannot connect.
- [ ] Inactive device excluded from resolved devices.
- [ ] Deactivated device does not receive new envelopes.
- [ ] Refresh-token rotation works.
- [ ] Device-registration-token single-use.
- [ ] Setup-token expires.
- [ ] OTP rate limit works.
- [ ] CSP reviewed.
- [ ] Dependencies reviewed.

---

## 14. Immediate next tasks

Priority order:

1. Device revocation E2E.
2. Key fingerprint MVP.
3. Key-change warning UI.
4. Refresh-token reuse test.
5. WebSocket negative real test.
6. CSP/security headers.
7. Replay protection.

---

## 15. Current conclusion

Chaos Messenger is currently a working E2EE MVP.

The strongest proof is real integration E2E:

- real backend;
- real database;
- real browser;
- two users;
- real device registration;
- real encrypted direct message;
- reload;
- successful decrypt after reload.

The architecture is functional.

The main remaining security gap is trust verification for public device keys. Without fingerprint/safety number/key-change warning, a malicious backend could theoretically perform key substitution.

Next stage: device revocation correctness, key-change detection, safety number UX, replay protection, refresh-token hardening, CSP/browser hardening.
