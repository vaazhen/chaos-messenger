# Chaos Messenger — Complete Quick Setup

[Back to README](README.md) · [Russian README](README.ru.md) · [Быстрый запуск RU](SETUP_COMPLETE.ru.md)

This guide is the fastest path to run Chaos Messenger locally, open Swagger UI, check Grafana/Prometheus and test messaging between two browser sessions or two physical devices.

## 1. Requirements

Install:

- Java 17+
- Maven 3.8+
- Node.js 18+
- Docker with Docker Compose

Check:

```bash
java -version
mvn -version
node --version
npm --version
docker --version
docker compose version
```

---

## 2. Clone

```bash
git clone https://github.com/vaazhen/chaos-messenger.git
cd chaos-messenger
```

---

## 3. Start PostgreSQL and Redis

For development mode:

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps
```

Expected containers:

```text
chaos-messenger-db
chaos-messenger-redis
```

---

## 4. Start backend

From the `backend` directory:

```bash
mvn spring-boot:run
```

Useful backend URLs:

| Service | URL |
|---|---|
| Backend API | `http://localhost:8080` |
| Swagger UI | `http://localhost:8080/swagger-ui.html` |
| OpenAPI JSON | `http://localhost:8080/api-docs` |
| Health check | `http://localhost:8080/actuator/health` |
| Prometheus metrics | `http://localhost:8080/actuator/prometheus` |

---

## 5. Start frontend

Open a second terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Default `.env`:

```env
VITE_BACKEND_URL=http://localhost:8080
VITE_API_BASE=http://localhost:8080/api
VITE_WS_URL=http://localhost:8080/ws
```

---

## 6. Login flow

In local development, SMS sending is mocked.

1. Open `http://localhost:5173`.
2. Enter a phone number.
3. Check backend logs.
4. Copy the OTP code printed by `NoopSmsSender`.
5. Complete profile setup.
6. Open another browser/incognito window.
7. Register a second user.
8. Create a chat and send a message.

---

## 7. Run with monitoring

Prometheus and Grafana are included in `backend/docker-compose.yml`.

Start monitoring:

```bash
cd backend
docker compose up -d prometheus grafana
```

Open:

| Service | URL |
|---|---|
| Prometheus | `http://localhost:9090` |
| Grafana | `http://localhost:3000` |

Grafana login:

```text
admin / admin
```

Dashboard provisioning files:

```text
backend/src/main/resources/grafana-datasource.yml
backend/src/main/resources/grafana-dashboards.yml
backend/src/main/resources/chaos-messenger-dashboard.json
```

---

## 8. Test on two physical devices

Use this when you want to open the frontend from a phone or another computer in the same Wi-Fi network.

### Find your LAN IP

Windows:

```powershell
ipconfig
```

Linux/macOS:

```bash
ip addr
```

Example LAN IP:

```text
192.168.1.50
```

### Update frontend `.env`

```env
VITE_BACKEND_URL=http://192.168.1.50:8080
VITE_API_BASE=http://192.168.1.50:8080/api
VITE_WS_URL=http://192.168.1.50:8080/ws
```

### Allow frontend origins in backend

```bash
export CHAOS_CORS_ALLOWED_ORIGINS="http://localhost:5173,http://192.168.1.50:5173"
```

PowerShell:

```powershell
$env:CHAOS_CORS_ALLOWED_ORIGINS="http://localhost:5173,http://192.168.1.50:5173"
```

Restart backend and frontend.

Open from the second device:

```text
http://192.168.1.50:5173
```

---

## 9. Run checks

Backend:

```bash
cd backend
mvn test
```

Frontend:

```bash
cd frontend
npm test
npm run build
```

---

## 10. Troubleshooting

### Frontend cannot reach backend

Check `.env`:

```env
VITE_BACKEND_URL=http://localhost:8080
VITE_API_BASE=http://localhost:8080/api
VITE_WS_URL=http://localhost:8080/ws
```

For LAN testing, replace `localhost` with the backend machine IP.

### CORS error

Add the exact frontend origin to backend config:

```env
CHAOS_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.50:5173
```

### WebSocket closes immediately

Login again and check that the frontend sends a valid Bearer JWT.

### SMS code is not received

In local mode the code is printed in backend logs. It is not sent through a real SMS provider.

### Database migration fails

Reset local containers only if local data is not needed:

```bash
cd backend
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
mvn spring-boot:run
```

---

## Useful links

- English README: [README.md](README.md)
- Russian README: [README.ru.md](README.ru.md)
- Russian setup: [SETUP_COMPLETE.ru.md](SETUP_COMPLETE.ru.md)
- Swagger UI: `http://localhost:8080/swagger-ui.html`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`
