<p align="center">
  <img src="docs/assets/chaos-mark.svg" width="88" height="88" alt="Chaos">
</p>

<h1 align="center">Chaos</h1>

<p align="center"><strong>Self-hosted мессенджер с клиентским шифрованием и доставкой, которая переживает сбои.</strong></p>

<p align="center">
  Личные и групповые чаты · Зашифрованные файлы · Голос и кружки · 1:1 звонки · Мультидевайсное E2EE
</p>

<p align="center">
  <a href="https://github.com/vaazhen/chaos-e2ee-messenger/actions/workflows/ci.yml"><img src="https://github.com/vaazhen/chaos-e2ee-messenger/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Java-17-ED8B00?logo=openjdk&logoColor=white" alt="Java 17">
  <img src="https://img.shields.io/badge/Spring%20Boot-3.5-6DB33F?logo=springboot&logoColor=white" alt="Spring Boot">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="Apache 2.0">
</p>

<p align="center">
  <a href="README.md">English</a>
  · <a href="#зачем-chaos">Зачем</a>
  · <a href="#продукт">Продукт</a>
  · <a href="#как-идёт-сообщение">Протокол</a>
  · <a href="#запуск">Запуск</a>
  · <a href="#модель-безопасности">Безопасность</a>
  · <a href="#эксплуатация">Эксплуатация</a>
</p>

Обычный корпоративный мессенджер — удобный workspace, слабая конфиденциальность: оператор читает комнату. Signal — наоборот: сильное шифрование, но не продукт, который ты хостишь сам. Chaos стоит в пересечении: мессенджер под твоим контролем, сервер не в пути plaintext, а падение брокера заложено в протокол, а не в runbook как сюрприз.

Протокол свой: X3DH-inspired handshake и Double Ratchet-style на WebCrypto. Это **не** Signal и не совместимая копия Signal Protocol. Независимого аудита **нет**. Относись как к серьёзному инженерному продукту, не как к сейфу для государственной тайны.

<p align="center">
  <img src="docs/assets/readme/chaos-chat.png" width="920" alt="Chaos: чат с Mira, она онлайн и печатает, в треде голосовое">
</p>

<p align="center">
  <img src="docs/assets/readme/chaos-surfaces.png" width="920" alt="Вход, профиль и Safety Number — три экрана, которые человек реально открывает">
</p>

---

## Зачем Chaos

| | Типичный self-hosted чат | E2EE класса Signal | Chaos |
|---|---|---|---|
| Серверы у тебя | Да | Нет | **Да** |
| Оператор читает сообщения | Обычно да | Нет | **Нет** |
| Группы, файлы, голос, desktop | Да | Ограниченно | **Да** |
| Ключи на устройство, Safety Number | Редко | Да | **Да** |
| Outbox и durable reconnect | Иногда | Да | **Как инвариант** |
| Независимый crypto-аудит | Разное | Да | **Пока нет** |

Интересная задача не «зашифровать строку». А зашифровать на каждое устройство, пережить at-least-once доставку, догнать историю после disconnect и не доверять ключу, который сменился молча.

---

## Продукт

| Возможность | Web | Desktop | Статус |
|---|---|---|---|
| Личные чаты, группы, сохранённые | Да | Да | Есть |
| Ответы, правки, удаление, реакции | Да | Да | Есть |
| Delivery / read receipts, typing | Да | Да | Есть |
| Исчезающие сообщения | Да | Да | Есть |
| Зашифрованные фото и файлы | Да | Да | Есть |
| Голосовые (удержание, lock, отмена) | Да | Да | Есть |
| Видео-кружки | Да | Да | Есть |
| Окно отправки и листание в чате | Да | Да | Есть |
| Мультидевайсный encrypted fan-out | Да | Да | Есть |
| Safety Number / QR | Да | Да | Есть |
| Зашифрованный backup ключей | Да | Да | Есть |
| Web Push | Да | — | Есть |
| 1:1 аудио и видео звонки | Dev | Dev | Эксперимент |
| Групповые звонки / production TURN | — | — | Roadmap |
| Независимый криптоаудит | — | — | Не сделан |

Звонки включены в локальной разработке. В production — выкл, пока перед WebRTC нет TURN. Медиа идёт по DTLS-SRTP; signaling (кто кому звонил, SDP, ICE) всё равно проходит через сервер.

---

## Как идёт сообщение

У каждого устройства своя identity. Отправка шифруется **отдельно на каждое устройство получателя**, включая твои другие устройства. Сервер маршрутизирует ciphertext. Ключ AES-GCM он не видит.

<p align="center">
  <img src="docs/diagrams/chaos-architecture.png" width="920" alt="Архитектура: устройство шифрует, Caddy и API ведут ciphertext, plaintext и in-process notify закрыты">
</p>

<p align="center">
  <img src="docs/diagrams/chaos-message-sequence.png" width="920" alt="Последовательность: pre-key bundles, шифрование у Alice, одна транзакция, событие Kafka, расшифровка у Bob">
</p>

AAD привязывает ciphertext к типу протокола, chat id, индексу, previous chain length и ratchet public key. Подменил заголовок — AES-GCM не откроется.

Realtime — быстрый канал. Правильность — журнал событий устройства: после reconnect клиент запрашивает всё после cursor и отбрасывает повторные `eventId`. Если Kafka лежит, строки outbox остаются и ретраятся. In-process fallback «просто опубликовать» нет.

<p align="center">
  <img src="docs/diagrams/chaos-delivery.png" width="920" alt="Доставка: одна транзакция, outbox, журнал Kafka, затем STOMP и GET /realtime/sync, расшифровка и отброс дублей">
</p>

Typing и presence эфемерны. В outbox они не попадают.

---

## Модель безопасности

### Что серверу можно знать

| Можно хранить или наблюдать | Нельзя получать |
|---|---|
| Метаданные аккаунта и профиля | Открытый текст сообщений |
| Идентификаторы устройств | Приватные identity keys |
| Публичные ключи и pre-key bundles | Приватные signed / one-time pre-keys |
| Состав чатов и authorization | Ratchet message keys |
| Зашифрованные envelopes и файлы | Plaintext вложений |
| Время доставки и размер ciphertext | Passphrase backup |
| Signaling звонка (участники, SDP, ICE) | Открытое call media |

Chaos не прячет метаданные. Состав чатов, число устройств, время и размер утекают. Тот же класс компромисса, который описывает Signal: **контент закрыт, анализ трафика — нет**.

### Куда E2EE не достаёт

Взломанная ОС, вредоносное расширение браузера, подменённый JavaScript на доверенном origin, разблокированный Electron, захват экрана или буфера.

### Доверие к устройству

Новое устройство — unverified. Safety Number / QR переводит в verified. Если identity key потом сменится, клиент не делает вид, что всё в порядке: состояние `KEY_CHANGED`, пока пользователь не подтвердит или не заблокирует.

<p align="center">
  <img src="docs/diagrams/chaos-device-trust.png" width="920" alt="Доверие к устройству: UNVERIFIED, VERIFIED, KEY_CHANGED, BLOCKED">
</p>

Регистрация устройства — короткоживущий одноразовый token, который потребляется через `GETDEL`. Это не криптографическая identity. Key bundle генерирует клиент.

### Backup

Шифруется на устройстве ключом из passphrase. Passphrase с машины не уходит. Restore возвращает identity. Он **не** обещает локальную историю, уже потраченные one-time pre-keys и все старые ratchet-сессии.

### Auth

Refresh-токены одноразовые. Повторное использование token family считается кражей. Access token — не замена identity устройства.

---

## Стек

| Слой | Выбор |
|---|---|
| Клиенты | React 18, Vite, Electron, WebCrypto, IndexedDB |
| Протокол | TypeScript DTO gate, свой Double Ratchet-style движок |
| API | Java 17, Spring Boot 3.5, Spring Security |
| Данные | PostgreSQL 16, Flyway, Redis 7 |
| Доставка | Transactional outbox, Kafka / Redpanda, native STOMP |
| Edge | Caddy, Nginx |
| Наблюдение | Actuator, Prometheus, Grafana, Loki |
| Поставка | Docker Compose, Kubernetes, GitHub Actions, GHCR, SBOM, Trivy |

```text
backend/     Spring API, Flyway, тесты
frontend/    Web + Electron + crypto-движок
infra/       Caddy, Prometheus, Loki
k8s/         Stateless production-манифесты
docs/        Runbooks и production checklist
```

---

## Запуск

Docker Engine, Compose v2, около 4 ГБ RAM.

```bash
git clone https://github.com/vaazhen/chaos-e2ee-messenger.git
cd chaos-e2ee-messenger
cp .env.example .env
```

Заполни все `CHANGE_ME`:

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

Открой [https://localhost](https://localhost). Два аккаунта, одно сообщение. На localhost Caddy берёт локальный CA, на реальном `DOMAIN` — публичный сертификат.

```bash
docker compose down        # остановить
docker compose down -v     # остановить и стереть volumes
```

### Разработка

```bash
cd backend && docker compose -f docker-compose.dev.yml up -d && ./mvnw spring-boot:run
cd frontend && cp .env.example .env && npm ci && npm run dev
```

API: `http://localhost:8080`. Приложение: `http://localhost:5173`. Dev-compose поднимает PostgreSQL, Redis, Redpanda и coturn, чтобы два браузера на одной машине могли дозвониться.

```bash
cd frontend && cp .env.electron.example .env.electron && npm run electron:dev
```

Сборка desktop требует абсолютные `https` / `wss` и должна быть подписана.

### Проверки

```bash
cd backend && ./mvnw --batch-mode --no-transfer-progress verify
cd ../frontend && npm ci && npm run lint && npm run typecheck && npm run test:coverage -- --run && npm run build
```

---

## Эксплуатация

`k8s/` поднимает stateless-приложение. PostgreSQL, Redis, Kafka, object storage и секреты — снаружи.

```bash
kubectl kustomize k8s/
kubectl apply -k k8s/
```

[k8s/README.md](k8s/README.md) · [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) · [docs/runbooks/](docs/runbooks/)

CI проверяет backend и frontend, гоняет CodeQL, публикует immutable-образы в GHCR с SBOM/provenance и режет HIGH/CRITICAL через Trivy. Staging и production — protected environments.

<details>
<summary>Окружение</summary>

| Переменная | Назначение |
|---|---|
| `POSTGRES_PASSWORD` | База |
| `REDIS_PASSWORD` | Redis |
| `JWT_SECRET` | Секрет подписи JWT |
| `DOMAIN` | Публичный hostname для Caddy |
| `CORS_ORIGINS` | Точный доверенный web origin |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka-compatible брокеры |
| `CHAOS_ATTACHMENTS_MAX_BYTES` | Потолок encrypted upload |
| `CHAOS_CALLS_ENABLED` | Signaling 1:1; вне `dev` выкл |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push |

Примеры: `.env.example`, `backend/.env.example`, `frontend/.env.example`.

</details>

---

## Roadmap

1. Crypto-движок — strict TypeScript-модуль; hex-векторы AAD v3 в [docs/protocol.md](docs/protocol.md)  
2. Production object storage для ciphertext  
3. Production TURN, устойчивый call state, групповые звонки  
4. Внешний pentest и криптоаудит  
5. Формальная спецификация протокола — черновик и закреплённые векторы в [docs/protocol.md](docs/protocol.md)  

Не расти поверхность продукта (групповые звонки, новые транспорты), пока нет внешнего ревью.

---

## Вклад

Короткие PR. Перед отправкой:

```bash
cd backend && ./mvnw verify
cd ../frontend && npm run lint && npm run typecheck && npm run test:coverage -- --run && npm run build
```

Security-sensitive изменение: инвариант, сценарий поломки, тесты на success/replay/tamper, совместимость. Уязвимости — не в публичные issue до фикса.

## Лицензия

[Apache License 2.0](LICENSE).
