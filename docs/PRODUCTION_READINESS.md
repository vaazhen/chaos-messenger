# Production Readiness Tracking

| ID | Проблема | Приоритет | Статус | Изменённые файлы | Проверка |
|---|---|---:|---|---|---|
| P0-1 | AES-GCM AAD envelope binding | P0 | VERIFIED | `crypto-engine.ts` | crypto tests |
| P0-2 | STOMP only after durable persist | P0 | VERIFIED | `DomainEventProcessor.java` | backend tests |
| P0-3 | Durable insert gates unread/push on retry | P0 | VERIFIED | `RealtimeEventStore.java`, `DomainEventProcessor.java` | backend tests |
| RT-3 | Sequential client event queue | P0 | VERIFIED | `useWebSocket.js` | `useWebSocket.test.jsx` |
| RT-4 | Failed recovery event replay | P0 | VERIFIED | `useWebSocket.js` | retry test |
| RT-5 | Cursor after durable client apply | P0 | VERIFIED | `useWebSocket.js` | ordering/cursor tests |
| RT-6 | Bounded full-resync state | P0 | VERIFIED | `useWebSocket.js` | unit tests + `e2e/send-reconnect.e2e.spec.js` |
| P0-6 | Honest backup semantics | P0 | VERIFIED | backup UI | frontend tests |
| P0-7 | Backup passphrase remains client-side | P0 | VERIFIED | `BackupController`, `api.js`, `BackupModal.jsx` | export has no passphrase header; `api.test.js` |
| P0-8 | Device linking step-up | P0 | VERIFIED | auth services | backend tests |
| AUTH-1 | Atomic refresh rotation | P1 | VERIFIED | `RefreshTokenService.java` | backend tests |
| SEC-3 | AAD protocol v3 and 64-bit chat ID | P1 | VERIFIED | `crypto-engine.ts` | crypto tests |
| TS-1 | Real TypeScript gate includes crypto engine | P1 | VERIFIED | `tsconfig.json`, CI | local typecheck |
| TS-2 | Protocol DTO strict gate | P1 | VERIFIED | `tsconfig.protocol.json` | local typecheck |
| TS-3 | Full strict typing of crypto engine | P1 | VERIFIED | `crypto-engine.ts`, `tsconfig.crypto.json` | `typecheck:crypto` + `typecheck:protocol` |
| TS-4 | Strict typing of message / timeline model | P1 | VERIFIED | `messageModel.ts`, `protocol.ts` | `typecheck:protocol` + `messageModel.test.js` |
| TS-5 | Strict typing of decrypt / attachment helpers | P1 | VERIFIED | `messageCrypto.ts`, `messageAttachments.ts` | `typecheck:crypto` + message tests |
| MOD-2 | Timeline and send payload are modules | P1 | VERIFIED | `messageTimeline.ts`, `messageSend.ts`, `useMessages.js` | unit tests + `useMessages.critical.test.jsx` |
| MOD-1 | Crypto engine is a module, window is adapter | P1 | VERIFIED | `crypto-engine.ts`, `e2ee.ts` | named export + adapter test |
| HTTP-1 | Crypto HTTP adapter always carries `status` | P1 | VERIFIED | `cryptoApi.ts` | `cryptoApi.test.js`; send / device / call reuse it |
| CICD-1 | Trivy blocking gate | P0 | VERIFIED | `ci.yml` | workflow audit |
| CICD-2 | Explicit CodeQL builds | P1 | VERIFIED | `ci.yml` | PR #510 Actions |
| CICD-5 | Master CI: durable cursor order + Tomcat 10.1.59 | P0 | FIXED | `DurableRealtimeDeliveryTest`, `pom.xml` | local tests; live CI on PR |
| CICD-3 | Production depends on deployed staging | P0 | VERIFIED | `ci.yml` | workflow output gate |
| CICD-4 | Mandatory staging smoke test when enabled | P0 | VERIFIED | `ci.yml` | workflow audit |
| K8S-1 | Example secret excluded from kustomization | P0 | VERIFIED | `kustomization.yaml` | static audit |
| K8S-2 | Tracked placeholder secret removed | P0 | VERIFIED | `.gitignore`, `k8s/secret.yaml` removed | static audit |
| OBS-1 | Metrics, alerts and runbooks | P1 | VERIFIED | `infra`, `docs/runbooks` | static audit |
| ATT-1 | Attachment hardening | P1 | VERIFIED | attachment backend | `AttachmentAccessServiceTest`, `AttachmentControllerTest`, storage tests |
| CALL-1 | Calls behind feature flag | P1 | VERIFIED | signaling controller | static audit |
| BE-CI-1 | Full Maven verify | P0 | VERIFIED | backend | local `mvn verify` |
| DELIVERY-1 | Single outbox path through Kafka | P0 | VERIFIED | `EventPublisher`, `OutboxPublisher`, `RealtimeEventConsumer`, `DomainEventProcessor` | `DurableRealtimeDeliveryTest` |
| AUTH-2 | JWT denied after refresh-family revoke | P0 | VERIFIED | `JwtAuthenticationFilter`, WS interceptor | backend tests |
| AUTH-3 | Email registration and public auth IP rate limits | P1 | VERIFIED | `CredentialRateLimiter`, auth controllers | limiter + `AuthServiceTest` |
| AUTH-4 | Profile JWT stays on the current refresh family | P1 | VERIFIED | `UserService`, `JwtAuthenticationFilter` | `UserServiceTest`, `InfraSecurityTest` |
| AUTH-5 | Logout closes WebSocket sessions | P1 | VERIFIED | `WebSocketLogoutCloser`, `AuthService` | `WebSocketLogoutCloserTest`, `AuthServiceTest` |
| AUTH-6 | Demo seed cannot start under prod | P1 | VERIFIED | `DemoDisabledInProduction` | `DemoDisabledInProductionTest` |
| PERF-1 | Self-destruct and chat lookup stay bounded | P1 | VERIFIED | `SelfDestructScheduler`, `ChatQueryService` | scheduler unit test |
| DELIVERY-2 | Recurring chat outbox keys are unique | P1 | VERIFIED | `OutboxIds` | `OutboxIdsTest` 200 unique keys |
| DELIVERY-4 | Request and chat one-shot keys do not collide | P1 | VERIFIED | `OutboxIds.eventKey`, `ChatOutboxService` | `ChatOutboxServiceTest` |
| DELIVERY-3 | Kafka partition key is chat id | P1 | VERIFIED | `OutboxPublisher` | `OutboxPublisherTest` |
| RT-7 | `/realtime/sync` limit clamped to 500 | P1 | VERIFIED | `RealtimeSyncLimits`, controller | `RealtimeSyncLimitsTest` |
| CRYPTO-1 | WHISPER replay does not advance `Nr` | P1 | VERIFIED | `crypto-engine.ts` | crypto-engine cycle test |
| CALL-2 | Incoming call with `mediaKeys` fails closed | P1 | VERIFIED | `useCall.js` | `useCall.test.js` |
| AUTH-7 | Exists lookup does not echo phone | P1 | VERIFIED | `AuthService` | empty phone field |
| AUTH-8 | Tighter IP limits on lookup and SMS verify | P1 | VERIFIED | `CredentialRateLimiter` | limiter test |
| PREKEY-1 | Reserve-prekey uses user + per-target limiter | P1 | VERIFIED | `BundleController`, `CredentialRateLimiter` | `BundleControllerTest`, `CredentialRateLimiterTest` |
| ATT-2 | Attachment upload/download streams | P1 | VERIFIED | `AttachmentStorageService`, controller | storage + controller tests |
| GROUP-1 | Pairwise groups capped at 32 | P1 | VERIFIED | `ChatLimits`, `GroupModerationService` | `GroupModerationServiceTest` |
| DEVICE-1 | At most 8 active devices | P1 | VERIFIED | `DeviceLimits`, `DeviceService` | `DeviceServiceTest` |
| DEVICE-2 | Revoke closes that device WebSocket | P1 | VERIFIED | `WebSocketLogoutCloser`, `DeviceController` | closer + controller tests |
| DEVICE-3 | Revoke writes `DEVICE_REVOKED` outbox | P1 | VERIFIED | `DeviceService`, `DomainEventProcessor` | processor + device tests |
| RT-8 | `/realtime/sync` user rate limit | P1 | VERIFIED | `RealtimeSyncController` | limiter `sync` |
| OBS-2 | Prometheus loads `alerts.yml` | P2 | VERIFIED | `backend/prometheus.yml`, compose | rule_files mount |
| K8S-3 | Default-deny NetworkPolicy | P2 | VERIFIED | `k8s/network-policy.yaml` | kustomization |
| DR-1 | Postgres dump/restore drill script | P2 | VERIFIED | `scripts/restore-drill.sh` | runbook |
| CRYPTO-AUDIT | Independent protocol audit | P0 | OPEN | `docs/CRYPTO_AUDIT_BRIEF.md` | external reviewer |
| PROD-S3 | S3-compatible ciphertext store | P2 | OPEN | local stream store only | infra |
| PROD-TURN | Production TURN | P2 | OPEN | roadmap | infra |
| PROD-HA | HA Redis / Kafka / Postgres drills | P2 | OPEN | runbooks exist | ops |
