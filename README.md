<p align="center">
  <img src="docs/assets/chaos-mark.svg" width="88" height="88" alt="Chaos">
</p>

<h1 align="center">Chaos</h1>

<p align="center"><strong>Self-hosted messenger with client-side encryption and durable delivery.</strong></p>

<p align="center">
  Direct &amp; group chat · Encrypted files · Voice &amp; video notes · 1:1 calls · Multi-device E2EE
</p>

<p align="center">
  <a href="https://github.com/vaazhen/chaos-e2ee-messenger/actions/workflows/ci.yml"><img src="https://github.com/vaazhen/chaos-e2ee-messenger/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Java-17-ED8B00?logo=openjdk&logoColor=white" alt="Java 17">
  <img src="https://img.shields.io/badge/Spring%20Boot-3.5-6DB33F?logo=springboot&logoColor=white" alt="Spring Boot">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="Apache 2.0">
</p>

<p align="center">
  <a href="README.ru.md">Русская версия</a>
  · <a href="#why-chaos">Why</a>
  · <a href="#product">Product</a>
  · <a href="#how-a-message-moves">Protocol</a>
  · <a href="#run-it">Run</a>
  · <a href="#security-model">Security</a>
  · <a href="#operate">Operate</a>
</p>

Most team messengers are great collaboration tools and weak confidentiality tools: the operator can read the room. Signal is the opposite — strong encryption, not a workspace you host. Chaos is the overlap: a messenger you run, whose server is not in the plaintext path, and whose delivery path is designed for the broker to die.

It uses an original X3DH-inspired handshake and Double Ratchet-style protocol on WebCrypto. It is **not** Signal, not a Signal Protocol clone, and has **not** been independently audited. Treat it as a serious engineering product, not as a finished high-risk vault.

<p align="center">
  <img src="docs/assets/readme/chaos-chat.png" width="920" alt="Chaos desktop: Mira is online, a voice note in the thread, she is typing">
</p>

<p align="center">
  <img src="docs/assets/readme/chaos-surfaces.png" width="920" alt="Sign in, user profile, and Safety Number verification — the three surfaces a person opens">
</p>

---

## Why Chaos

| | Typical self-hosted chat | Signal-class E2EE | Chaos |
|---|---|---|---|
| You run the servers | Yes | No | **Yes** |
| Operator can read messages | Usually yes | No | **No** |
| Groups, files, voice, desktop | Yes | Constrained | **Yes** |
| Per-device keys, Safety Number | Rare | Yes | **Yes** |
| Outbox + durable reconnect | Sometimes | Yes | **First-class** |
| Independent crypto audit | Varies | Yes | **Not yet** |

The interesting problem is not “encrypt a string”. It is: encrypt for every device, survive at-least-once delivery, recover after a disconnect, and still refuse to trust a silently rotated identity key.

---

## Product

| Capability | Web | Desktop | Status |
|---|---|---|---|
| Direct chats, groups, saved messages | Yes | Yes | Shipped |
| Replies, edits, delete, reactions | Yes | Yes | Shipped |
| Delivery / read receipts, typing | Yes | Yes | Shipped |
| Disappearing messages | Yes | Yes | Shipped |
| Encrypted photos and files | Yes | Yes | Shipped |
| Voice messages (hold to record, lock, cancel) | Yes | Yes | Shipped |
| Video notes | Yes | Yes | Shipped |
| Send preview and in-chat paging | Yes | Yes | Shipped |
| Multi-device encrypted fan-out | Yes | Yes | Shipped |
| Safety Number / QR verification | Yes | Yes | Shipped |
| Encrypted key backup | Yes | Yes | Shipped |
| Web Push | Yes | — | Shipped |
| 1:1 audio & video calls | Dev | Dev | Experimental |
| Group calls / production TURN | — | — | Roadmap |
| Independent cryptographic audit | — | — | Pending |

Calls are on in local development. Production stays off until TURN sits in front of WebRTC. Media is DTLS-SRTP; signaling (who called whom, SDP, ICE) still traverses the server.

---

## How a message moves

Each device has its own identity. A send encrypts **once per destination device**, including your other devices. The server routes ciphertext. It never sees the AES-GCM key.

<p align="center">
  <img src="docs/diagrams/chaos-architecture.png" width="920" alt="Architecture: device encrypts, Caddy and API route ciphertext, plaintext and in-process notify are blocked">
</p>

<p align="center">
  <img src="docs/diagrams/chaos-message-sequence.png" width="920" alt="Sequence: fetch pre-key bundles, encrypt on Alice, one transaction, Kafka event, decrypt on Bob">
</p>

Authenticated associated data binds ciphertext to protocol type, chat id, message index, previous chain length and ratchet public key. Tamper with the header, AES-GCM fails.

Realtime is the fast path. Correctness is the device event log: after reconnect the client asks for everything after its cursor and ignores duplicate `eventId`s. If Kafka is down, outbox rows stay pending and retry. There is no in-process “just publish it” fallback.

<p align="center">
  <img src="docs/diagrams/chaos-delivery.png" width="920" alt="Durable delivery: one DB transaction, outbox, Kafka event log, then STOMP notify and GET /realtime/sync, decrypt and drop duplicate ids">
</p>

Typing and presence are ephemeral. They do not go through the outbox.

---

## Security model

### What the server is allowed to know

| May store or observe | Must never receive |
|---|---|
| Account and profile metadata | Message plaintext |
| Device identifiers | Private identity keys |
| Public identity keys and pre-key bundles | Private signed / one-time pre-keys |
| Chat membership and authorization | Ratchet message keys |
| Encrypted envelopes and attachment blobs | Attachment plaintext |
| Delivery timing and ciphertext size | Backup passphrase |
| Call signaling (peers, SDP, ICE) | Call media plaintext |

Chaos does not hide metadata. Membership, device count, timing and size leak. That is the same class of tradeoff Signal documents: **content is protected, traffic analysis is not**.

### What E2EE does not cover

A compromised OS, a malicious browser extension, injected JavaScript on a trusted origin, an unlocked Electron session, screen or clipboard capture.

### Device trust

A new device starts unverified. Safety Number / QR moves it to verified. If that identity key later changes, the client does not shrug — it enters `KEY_CHANGED` until the user re-verifies or blocks.

<p align="center">
  <img src="docs/diagrams/chaos-device-trust.png" width="920" alt="Device trust: UNVERIFIED, VERIFIED, KEY_CHANGED, BLOCKED">
</p>

Device enrollment uses a short-lived one-time registration token, consumed with `GETDEL`. That token is not the cryptographic identity. The key bundle is generated on the client.

### Backups

Encrypted on the device with a passphrase-derived AES-GCM key. The passphrase never leaves the machine. A restore brings back identity material. It does **not** promise local history, consumed one-time pre-keys, or every old ratchet session.

### Auth

Refresh tokens are single-use. Reuse of a token family is treated as theft. Access tokens are not a substitute for a device identity.

---

## Stack

| Layer | Choice |
|---|---|
| Clients | React 18, Vite, Electron, WebCrypto, IndexedDB |
| Protocol | TypeScript DTO gate, original Double Ratchet-style engine |
| API | Java 17, Spring Boot 3.5, Spring Security |
| Data | PostgreSQL 16, Flyway, Redis 7 |
| Delivery | Transactional outbox, Kafka / Redpanda, native STOMP |
| Edge | Caddy, Nginx |
| Observe | Actuator, Prometheus, Grafana, Loki |
| Ship | Docker Compose, Kubernetes, GitHub Actions, GHCR, SBOM, Trivy |

```text
backend/     Spring API, Flyway, tests
frontend/    Web + Electron + crypto engine
infra/       Caddy, Prometheus, Loki
k8s/         Stateless production manifests
docs/        Runbooks and production checklist
```

---

## Run it

Docker Engine, Compose v2, ~4 GB RAM.

```bash
git clone https://github.com/vaazhen/chaos-e2ee-messenger.git
cd chaos-e2ee-messenger
cp .env.example .env
```

Fill every `CHANGE_ME`:

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 32   # REDIS_PASSWORD
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # GRAFANA_ADMIN_PASSWORD
```

```dotenv
DOMAIN=localhost
CORS_ORIGINS=https://localhost
CHAOS_DEMO_ENABLED=false
KAFKA_BOOTSTRAP_SERVERS=localhost:19092
```

```bash
docker compose up --build -d
```

Open [https://localhost](https://localhost). Create two accounts, send a message. Caddy uses a local CA on localhost and a public certificate when `DOMAIN` is real.

```bash
docker compose down        # stop
docker compose down -v     # stop and wipe volumes
```

### Local development

```bash
cd backend && docker compose -f docker-compose.dev.yml up -d && ./mvnw spring-boot:run
cd frontend && cp .env.example .env && npm ci && npm run dev
```

API at `http://localhost:8080`, app at `http://localhost:5173`. Dev compose includes PostgreSQL, Redis, Redpanda and coturn so two browsers on one machine can complete a call.

```bash
cd frontend && cp .env.electron.example .env.electron && npm run electron:dev
```

Packaged desktop builds require absolute `https` / `wss` endpoints and should be signed.

### Verify

```bash
cd backend && ./mvnw --batch-mode --no-transfer-progress verify
cd ../frontend && npm ci && npm run lint && npm run typecheck && npm run test:coverage -- --run && npm run build
```

---

## Operate

`k8s/` deploys the stateless app. PostgreSQL, Redis, Kafka, object storage and secrets are yours.

```bash
kubectl kustomize k8s/
kubectl apply -k k8s/
```

[k8s/README.md](k8s/README.md) · [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) · [docs/runbooks/](docs/runbooks/)

CI verifies backend and frontend, runs CodeQL, publishes immutable GHCR images with SBOM/provenance, and gates HIGH/CRITICAL findings with Trivy. Staging and production deploys are protected environments.

<details>
<summary>Environment</summary>

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Database |
| `REDIS_PASSWORD` | Redis |
| `JWT_SECRET` | JWT signing secret |
| `DOMAIN` | Public hostname for Caddy |
| `CORS_ORIGINS` | Exact trusted web origin |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka-compatible brokers |
| `CHAOS_ATTACHMENTS_MAX_BYTES` | Max encrypted upload |
| `CHAOS_CALLS_ENABLED` | 1:1 signaling; off outside `dev` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push |

See `.env.example`, `backend/.env.example`, `frontend/.env.example`.

</details>

---

## Roadmap

1. Crypto engine is a strict TypeScript module; AAD v3 hex vectors live in [docs/protocol.md](docs/protocol.md)  
2. Production object storage for ciphertext attachments  
3. Production TURN, hardened call state, group calls  
4. Independent pentest and cryptographic review  
5. Formal protocol specification — working notes and pinned vectors in [docs/protocol.md](docs/protocol.md)  

Do not grow the product surface (group calls, new transports, extra chat types) until an independent review exists.

---

## Contributing

Small pull requests. Before opening one:

```bash
cd backend && ./mvnw verify
cd ../frontend && npm run lint && npm run typecheck && npm run test:coverage -- --run && npm run build
```

A security-sensitive change should state the invariant, the failure, tests for success/replay/tamper, and any compatibility impact. Report vulnerabilities privately until a fix exists.

## License

[Apache License 2.0](LICENSE).
