<div align="center">

```
░█████╗░██╗░░██╗░█████╗░░█████╗░░██████╗
██╔══██╗██║░░██║██╔══██╗██╔══██╗██╔════╝
██║░░╚═╝███████║███████║██║░░██║╚█████╗░
██║░░██╗██╔══██║██╔══██║██║░░██║░╚═══██╗
╚█████╔╝██║░░██║██║░░██║╚█████╔╝██████╔╝
░╚════╝░╚═╝░░╚═╝╚═╝░░╚═╝░╚════╝░╚═════╝░
```

### Realtime-мессенджер с клиентским E2EE-подходом

*Spring Boot 3 · React/Vite · WebSocket/STOMP · PostgreSQL · Redis · Flyway · Swagger · Prometheus · Grafana*

[🇬🇧 English README](README.md) · [🚀 Быстрый запуск](SETUP_COMPLETE.ru.md) · [⚡ Quick Setup EN](SETUP_COMPLETE.md)

<br/>

[![CI](https://github.com/vaazhen/chaos-messenger/actions/workflows/ci.yml/badge.svg)](https://github.com/vaazhen/chaos-messenger/actions/workflows/ci.yml)
[![Java](https://img.shields.io/badge/Java-17-orange?logo=openjdk&logoColor=white)](https://openjdk.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.x-brightgreen?logo=springboot&logoColor=white)](https://spring.io/projects/spring-boot)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis&logoColor=white)](https://redis.io/)
[![WebSocket](https://img.shields.io/badge/WebSocket-STOMP-purple)](https://stomp.github.io/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-Swagger-85EA2D?logo=swagger&logoColor=black)](http://localhost:8080/swagger-ui.html)

<br/>

[Описание](#описание) · [Функции](#функции) · [Архитектура](#архитектура) · [Быстрый запуск](#быстрый-запуск) · [API](#api) · [Мониторинг](#мониторинг) · [Для разработчиков](#для-разработчиков)

</div>

---

## Описание

**Chaos Messenger** — full-stack realtime-мессенджер с фокусом на безопасную доставку сообщений, клиентское шифрование и multi-device модель.

Backend не работает с открытым текстом сообщений. Он отвечает за авторизацию, чаты, устройства, хранение encrypted envelopes и realtime-доставку через WebSocket/STOMP до нужных устройств.

<p align="center">
  <img src="docs/assets/architecture.svg" alt="Архитектура Chaos Messenger" width="100%">
</p>

Проект хорошо подходит как:

- сильный Java Backend / Fullstack проект для GitHub и резюме;
- пример realtime-архитектуры на Spring Boot;
- демонстрация доставки encrypted envelopes вместо хранения plaintext;
- база для Android-клиента, encrypted media и WebRTC.

---

## Функции

<table>
<tr>
<td width="50%">

### Безопасность и шифрование

- Клиентское шифрование сообщений.
- Encrypted envelopes для каждого устройства.
- Session bootstrap через prekeys.
- Проверка signed prekey.
- Symmetric ratchet movement для message keys.
- JWT-аутентификация.
- Redis rate limiting для SMS-кодов.
- Усиленная WebSocket-авторизация.
- Явные CORS origins и security headers.

</td>
<td width="50%">

### Сообщения

- Личные чаты.
- Групповые чаты.
- Realtime-доставка через WebSocket/STOMP.
- Индикатор печати.
- Статусы доставки и прочтения.
- Ответы на сообщения и редактирование.
- Soft delete.
- Фото-вложения.
- Профиль пользователя и emoji-avatar.

</td>
</tr>
<tr>
<td width="50%">

### Backend

- Spring Boot 3.
- Spring Security.
- PostgreSQL.
- Redis.
- Flyway migrations.
- OpenAPI / Swagger UI.
- Actuator metrics.
- Prometheus endpoint.
- Grafana dashboard assets.
- Docker Compose для локальной инфраструктуры.

</td>
<td width="50%">

### Frontend

- React 18.
- Vite.
- Crypto engine на WebCrypto.
- Frontend crypto layer как ES module.
- UI в стиле современного мессенджера.
- Device identity на стороне клиента.
- WebSocket client integration.
- Frontend unit tests.

</td>
</tr>
</table>

---

## Архитектура

```text
React / Vite client
  ├─ REST API: auth, users, profile, chats, messages, devices
  ├─ WebSocket/STOMP: message events, typing, presence, chat updates
  └─ WebCrypto: client-side message encryption

Spring Boot backend
  ├─ Auth and JWT
  ├─ Chat and message orchestration
  ├─ Device registry and encrypted envelope fanout
  ├─ WebSocket authorization
  ├─ Redis: refresh tokens, presence, rate limits
  └─ PostgreSQL: users, chats, messages, envelopes, devices

Observability
  ├─ Spring Boot Actuator
  ├─ Prometheus
  └─ Grafana dashboard
```

Ключевая идея архитектуры — разделение ответственности:

- **Client** создаёт ключи, шифрует/расшифровывает сообщения и работает с plaintext.
- **Backend** проверяет доступ, хранит encrypted envelopes и маршрутизирует realtime-события.
- **Database** хранит состояние приложения и encrypted payloads.
- **Redis** хранит быструю временную информацию: refresh tokens, presence и rate limits.

---

## Быстрый запуск

Полная инструкция:

- [SETUP_COMPLETE.ru.md](SETUP_COMPLETE.ru.md) — быстрый запуск на русском.
- [SETUP_COMPLETE.md](SETUP_COMPLETE.md) — quick setup in English.

### Требования

```bash
java -version      # Java 17+
mvn -version       # Maven 3.8+
node --version     # Node.js 18+
docker --version
docker compose version
```

### Запустить инфраструктуру

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
```

### Запустить backend

```bash
mvn spring-boot:run
```

### Запустить frontend

```bash
cd frontend
npm install
npm run dev
```

Открыть приложение:

```text
http://localhost:5173
```

В dev-режиме SMS-коды выводятся в логах backend.

---

## Локальные ссылки

| Сервис | URL |
|---|---|
| Web Client | `http://localhost:5173` |
| Backend API | `http://localhost:8080` |
| Swagger UI | `http://localhost:8080/swagger-ui.html` |
| OpenAPI JSON | `http://localhost:8080/api-docs` |
| Actuator Health | `http://localhost:8080/actuator/health` |
| Prometheus Metrics | `http://localhost:8080/actuator/prometheus` |
| Prometheus UI | `http://localhost:9090` |
| Grafana | `http://localhost:3000` |

Данные для входа в Grafana при локальном Docker Compose:

```text
admin / admin
```

---

## API

Swagger UI доступен после запуска backend:

```text
http://localhost:8080/swagger-ui.html
```

OpenAPI JSON:

```text
http://localhost:8080/api-docs
```

### Основные зоны API

| Зона | Назначение |
|---|---|
| Auth | Login by phone, OTP verification, JWT refresh |
| Profile | User profile, username, display name, avatar |
| Devices | Device registration, prekeys, signed prekeys |
| Chats | Direct chats, group chats, chat list |
| Messages | Send/edit/delete messages, statuses |
| WebSocket | Realtime delivery, typing, presence, chat updates |

### Пример локального сценария

```text
1. Register/login by phone.
2. Complete profile.
3. Register device keys.
4. Create or open a chat.
5. Send encrypted envelopes.
6. Receive realtime events over WebSocket.
```

---

## WebSocket Topics

| Topic | Назначение |
|---|---|
| `/topic/devices/{deviceId}` | Per-device encrypted message delivery |
| `/topic/users/{username}/chats` | Chat-list updates for a specific user |
| `/topic/chats/{chatId}/typing` | Typing events in a chat |
| `/topic/user/status` | Presence and status events |

WebSocket connections используют Bearer JWT authentication.

---

## Мониторинг

В проекте есть Spring Boot Actuator, Prometheus configuration и Grafana dashboard provisioning.

Запуск monitoring stack:

```bash
cd backend
docker compose up -d prometheus grafana
```

Открыть:

```text
Prometheus: http://localhost:9090
Grafana:    http://localhost:3000
```

Grafana dashboard provisioning files:

```text
backend/src/main/resources/grafana-datasource.yml
backend/src/main/resources/grafana-dashboards.yml
backend/src/main/resources/chaos-messenger-dashboard.json
```

Prometheus собирает метрики отсюда:

```text
http://localhost:8080/actuator/prometheus
```

---

## Структура проекта

```text
.
├── .github/workflows/          # GitHub Actions CI
├── backend/                    # Spring Boot backend
│   ├── src/main/java/...       # Application code
│   ├── src/main/resources/     # Config, Flyway, Grafana, i18n
│   ├── docker-compose.dev.yml  # PostgreSQL + Redis for development
│   └── docker-compose.yml      # App + PostgreSQL + Redis + monitoring
├── frontend/                   # React/Vite client
│   ├── src/crypto-engine.js    # Frontend WebCrypto engine
│   ├── src/components/         # UI components
│   └── src/hooks/              # Auth, chats, messages, WebSocket hooks
├── docs/assets/                # README images and diagrams
├── README.md                   # English README
├── README.ru.md                # Russian README
├── SETUP_COMPLETE.md           # English setup guide
└── SETUP_COMPLETE.ru.md        # Russian setup guide
```

---

## Для разработчиков

### Backend checks

```bash
cd backend
mvn test
mvn spring-boot:run
```

### Frontend checks

```bash
cd frontend
npm test
npm run build
```

### CI

GitHub Actions workflow находится здесь:

```text
.github/workflows/ci.yml
```

Pipeline проверяет backend и frontend test/build.

---

## Environment

Backend:

```env
JWT_SECRET=change-this-to-a-strong-32-plus-character-secret
JWT_EXPIRATION=86400000
CHAOS_CORS_ALLOWED_ORIGINS=http://localhost:5173
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/chaos_messenger
SPRING_DATASOURCE_USERNAME=postgres
SPRING_DATASOURCE_PASSWORD=postgres
SPRING_DATA_REDIS_HOST=localhost
SPRING_DATA_REDIS_PORT=6379
```

Frontend:

```env
VITE_BACKEND_URL=http://localhost:8080
VITE_API_BASE=http://localhost:8080/api
VITE_WS_URL=http://localhost:8080/ws
```

---

## Roadmap

- Android client.
- Android Keystore integration.
- Push notifications.
- Encrypted voice messages.
- Encrypted media storage.
- WebRTC calls.
- TURN/STUN infrastructure.
- Deployment profiles for staging and production.
- Extended integration tests and load tests.

---

## License

Перед внешними contributions нужно добавить license file.
