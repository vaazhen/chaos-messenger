# Chaos Messenger — аудит безопасности и план усиления

Проект: E2EE-мессенджер на Spring Boot + React.

Главная архитектурная идея: криптография выполняется на клиенте. Backend отвечает за регистрацию пользователей, устройства, чаты, encrypted envelopes, WebSocket-события, статусы доставки и синхронизацию, но не должен иметь plaintext сообщений и private keys.

---

## 1. Текущий статус

На текущем этапе проект подтверждён не только unit/integration тестами, но и реальным интеграционным E2E:

- backend проходит тесты;
- frontend проходит тесты;
- backend имеет JaCoCo quality gate;
- frontend имеет Vitest coverage gate;
- mocked Playwright E2E зелёный;
- real Playwright E2E зелёный;
- real E2E подтверждает полный путь:
  - два реальных пользователя;
  - email-регистрация;
  - device registration;
  - direct chat;
  - encrypted message;
  - получение и расшифровка;
  - reload страницы;
  - успешная повторная расшифровка после reload.

Текущий статус: рабочий E2EE MVP.

Это ещё не production-grade Signal-level система, но базовая сквозная архитектура уже подтверждена реальным браузером, реальным backend, реальной БД и reload decrypt.

---

## 2. Главная цель безопасности

Сервер не должен иметь технической возможности прочитать содержимое пользовательских сообщений.

Дополнительные цели:

1. Пользователь не должен иметь доступ к чужим чатам.
2. Устройство не должно получать сообщения после деактивации.
3. WebSocket не должен позволять подписку на чужие topics.
4. Refresh-token не должен давать бесконечный доступ.
5. Device-registration-token должен быть short-lived и single-use.
6. Frontend должен обнаруживать подозрительную смену ключей устройств.
7. Replay старых сообщений/envelopes не должен приниматься как новое сообщение.
8. Backend logs не должны содержать plaintext, JWT, refresh-token, private keys.
9. После reload пользователь должен расшифровывать только те сообщения, к которым у него есть локальные ключи.
10. Ошибки криптографии должны быть явными, а не маскироваться под обычные сообщения.

---

## 3. Что НЕ гарантирует текущий MVP

Текущий MVP пока не гарантирует:

- полноценный safety number как в Signal;
- ручную верификацию ключей;
- защиту от полностью malicious backend, который подменяет public keys;
- защиту от XSS при полном выполнении произвольного JS в браузере;
- secure enclave / hardware-backed key storage;
- production-grade metadata protection;
- encrypted cloud backup;
- формальный криптографический аудит независимыми специалистами.

Главный оставшийся риск: подмена публичных ключей устройства через malicious backend или compromised API response. Для закрытия этого риска нужны fingerprint, trust-on-first-use, key-change warning и UX подтверждения ключей.

---

## 4. Критичные активы

### 4.1. На клиенте

Нужно защищать:

- private identity key;
- private signed pre-key;
- one-time pre-key material;
- local device bundle;
- local E2EE sessions;
- JWT;
- refresh-token;
- device id;
- decrypted messages в памяти;
- local encrypted/decrypted preview cache;
- hidden message ids.

Главный риск клиента: XSS или malicious extension. Если атакующий исполняет JS в браузере, он может прочитать localStorage, plaintext в памяти, токены и ключевой материал.

### 4.2. На сервере

Сервер хранит:

- пользователей;
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

Сервер не должен хранить:

- plaintext сообщений;
- private keys;
- shared secrets;
- session keys;
- расшифрованные вложения.

---

## 5. Модель атакующего

### 5.1. Внешний атакующий

Может пытаться:

- подобрать пароль;
- подобрать OTP;
- украсть refresh-token;
- переиспользовать refresh-token;
- переиспользовать device-registration-token;
- вызвать API чужого чата;
- подписаться на чужой WebSocket topic;
- отправить malformed envelope;
- replay старых сообщений;
- эксплуатировать XSS.

### 5.2. Злой пользователь

Может пытаться:

- отправить сообщение в чат, где он не участник;
- читать timeline чужого чата;
- подделать senderDeviceId;
- отправить envelope на устройство, не принадлежащее участнику чата;
- удалить чужое сообщение;
- менять статусы чужих сообщений;
- спамить reactions/read receipts;
- подписываться на чужие device topics.

### 5.3. Honest-but-curious server

Сервер видит metadata:

- кто с кем общается;
- время сообщений;
- размер ciphertext;
- количество устройств;
- read/delivery metadata.

Сервер не должен видеть:

- plaintext;
- private keys;
- session keys;
- shared secrets.

### 5.4. Malicious server

Malicious backend потенциально может:

- подменить public key устройства;
- скрыть устройство;
- добавить фиктивное устройство;
- вернуть stale prekey;
- не доставить сообщение;
- изменить metadata.

Текущий MVP не полностью защищает от malicious backend. Для этого нужен trust layer: fingerprint, safety number, key-change warning, device trust UX.

---

## 6. Trust boundaries

### 6.1. Browser boundary

Криптография выполняется в браузере. Значит browser JS context критичен.

Риски:

- XSS;
- compromised dependency;
- malicious browser extension;
- localStorage theft;
- accidental logging;
- token leakage.

### 6.2. API boundary

Backend API обязан проверять:

- JWT;
- user identity;
- active device;
- chat membership;
- ownership;
- request consistency;
- idempotency;
- rate limits.

### 6.3. WebSocket boundary

WebSocket обязан проверять:

- JWT при connect;
- X-Device-Id;
- active registered device;
- session-to-user binding;
- session-to-device binding;
- authorization на каждый topic.

Пользователь не должен подписываться на:

- чужой `/topic/users/{username}/chats`;
- чужой `/topic/devices/{deviceId}`;
- typing чужого чата;
- device topic отключённого устройства.

### 6.4. Storage boundary

Backend storage считается недоверенным для plaintext. Даже при утечке БД атакующий не должен получить содержимое сообщений без client private keys.

---

## 7. Текущий E2EE flow

### 7.1. Device registration

Frontend создаёт локальный device bundle.

Backend получает:

- deviceId;
- registrationId;
- identityPublicKey;
- signingPublicKey;
- signedPreKey;
- oneTimePreKeys.

Backend не получает private keys.

### 7.2. Sending message

Frontend:

1. получает target devices участников чата;
2. строит encrypted envelope для каждого target device;
3. отправляет массив envelopes на backend;
4. backend сохраняет encrypted envelopes;
5. backend рассылает events по device topics.

### 7.3. Receiving message

Получатель:

1. получает envelope;
2. использует local device bundle/session;
3. расшифровывает сообщение;
4. отображает plaintext только на клиенте.

### 7.4. Reload

После reload frontend восстанавливает:

- device id;
- local device bundle;
- E2EE sessions;
- JWT/refresh-token;
- timeline;
- envelopes.

Real E2E подтвердил: сообщение расшифровывается после reload.

---

## 8. Уже подтверждено тестами

### 8.1. Backend

Покрыты:

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

Покрыты:

- API headers;
- JWT + X-Device-Id;
- device-registration-token отправляется только на register endpoint;
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
- delete local/everyone;
- reactions;
- useWebSocket;
- ProfileModal devices;
- NewChat direct/group/saved;
- mocked Playwright E2E;
- real Playwright E2E.

---

## 9. Основные риски

### RISK-001: Нет полноценной верификации ключей устройств

Severity: High  
Status: Open

Пользователь пока не может вручную проверить fingerprint/safety number собеседника. Если backend подменит public key устройства, frontend может зашифровать сообщение атакующему устройству.

Что сделать:

- вычислять fingerprint device public keys;
- хранить known fingerprints по username + deviceId;
- detect key change;
- показывать предупреждение;
- блокировать silent send на changed key;
- добавить экран Security / Devices / Keys.

Тесты:

- first seen key сохраняется;
- повторный same key проходит без warning;
- changed key создаёт warning;
- send blocked until user confirms changed key.

### RISK-002: Device revocation должен быть жёстким

Severity: High  
Status: Partially covered

Отключённое устройство не должно получать новые envelopes.

Что сделать:

- backend resolve devices не возвращает inactive devices;
- bundle endpoint не возвращает inactive devices;
- `/crypto/devices/current` rejects inactive device;
- WebSocket connect rejects inactive device;
- frontend не строит fanout на inactive device;
- old WebSocket session should stop receiving events after revocation.

Тесты:

- inactive device excluded from resolveChatDevices;
- inactive device cannot connect WS;
- real E2E: Bob device deactivated, Alice sends message, old Bob device не получает/decrypt.

### RISK-003: Replay protection

Severity: High  
Status: Open

Старый envelope или старый messageIndex не должен быть принят как новое сообщение.

Что сделать:

- clientMessageId idempotency;
- messageIndex monotonic per sender/receiver device session;
- reject duplicate/lower messageIndex;
- store last accepted messageIndex;
- duplicate targetDeviceId rejected.

Тесты:

- same clientMessageId returns existing message;
- duplicate envelope target rejected;
- replay old messageIndex ignored/rejected;
- replay after reload ignored/rejected.

### RISK-004: Refresh-token hardening

Severity: High  
Status: Partially covered

Требования:

- refresh-token rotation;
- old token invalid after use;
- logout revokes token;
- token stored hashed server-side;
- suspicious reuse detection;
- optional device binding.

Тесты:

- old refresh-token cannot be reused;
- logout invalidates refresh-token;
- invalid refresh returns 401;
- stolen old refresh-token cannot mint new JWT.

### RISK-005: Device-registration-token hardening

Severity: High  
Status: Partially covered

Требования:

- short TTL;
- single-use;
- bound to username;
- accepted only by `/crypto/devices/register`;
- not stored in localStorage;
- never sent to unrelated endpoints.

Тесты:

- token sent only to register endpoint;
- reused token rejected;
- expired token rejected;
- token for another user rejected.

### RISK-006: XSS destroys E2EE

Severity: Critical  
Status: Open

Если атакующий исполняет JS в браузере, он может прочитать localStorage, plaintext, ключи и токены.

Что сделать:

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

## 12. Команды, которые должны оставаться зелёными

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
- [ ] WebSocket cannot subscribe to чужой topic.
- [ ] Inactive device cannot connect.
- [ ] Inactive device excluded from resolve devices.
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

## 15. Текущий вывод

Chaos Messenger сейчас является рабочим E2EE MVP.

Самое сильное доказательство — real integration E2E:

- real backend;
- real database;
- real browser;
- two users;
- real device registration;
- real encrypted direct message;
- reload;
- successful decrypt after reload.

Архитектура функциональна.

Главная оставшаяся security-дыра — trust verification для public device keys. Без fingerprint/safety number/key-change warning malicious backend теоретически может выполнить key substitution.

Следующий этап: device revocation correctness, key-change detection, safety number UX, replay protection, refresh-token hardening, CSP/browser hardening.
