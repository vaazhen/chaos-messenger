# Chaos Messenger — полный быстрый запуск

[Вернуться к README](README.ru.md) · [English README](README.md) · [Quick Setup EN](SETUP_COMPLETE.md)

Эта инструкция — самый быстрый путь, чтобы локально запустить Chaos Messenger, открыть Swagger UI, проверить Grafana/Prometheus и протестировать переписку между двумя браузерами или двумя устройствами.

## 1. Требования

Установить:

- Java 17+
- Maven 3.8+
- Node.js 18+
- Docker with Docker Compose

Проверить:

```bash
java -version
mvn -version
node --version
npm --version
docker --version
docker compose version
```

---

## 2. Клонирование проекта

```bash
git clone https://github.com/vaazhen/chaos-messenger.git
cd chaos-messenger
```

---

## 3. Запуск PostgreSQL и Redis

Для dev-режима:

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps
```

Ожидаемые контейнеры:

```text
chaos-messenger-db
chaos-messenger-redis
```

---

## 4. Запуск backend

Из папки `backend`:

```bash
mvn spring-boot:run
```

Полезные backend-ссылки:

| Сервис | URL |
|---|---|
| Backend API | `http://localhost:8080` |
| Swagger UI | `http://localhost:8080/swagger-ui.html` |
| OpenAPI JSON | `http://localhost:8080/api-docs` |
| Health check | `http://localhost:8080/actuator/health` |
| Prometheus metrics | `http://localhost:8080/actuator/prometheus` |

---

## 5. Запуск frontend

Открыть второй терминал:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Открыть:

```text
http://localhost:5173
```

Стандартный `.env`:

```env
VITE_BACKEND_URL=http://localhost:8080
VITE_API_BASE=http://localhost:8080/api
VITE_WS_URL=http://localhost:8080/ws
```

---

## 6. Вход и тестовая переписка

В локальном dev-режиме SMS отправка замокана.

1. Открыть `http://localhost:5173`.
2. Ввести номер телефона.
3. Посмотреть логи backend.
4. Скопировать OTP-код из сообщения `NoopSmsSender`.
5. Заполнить профиль.
6. Открыть другой браузер или incognito window.
7. Зарегистрировать второго пользователя.
8. Создать чат и отправить сообщение.

---

## 7. Запуск мониторинга

Prometheus и Grafana есть в `backend/docker-compose.yml`.

Запустить monitoring stack:

```bash
cd backend
docker compose up -d prometheus grafana
```

Открыть:

| Сервис | URL |
|---|---|
| Prometheus | `http://localhost:9090` |
| Grafana | `http://localhost:3000` |

Логин Grafana:

```text
admin / admin
```

Файлы provisioning для Grafana:

```text
backend/src/main/resources/grafana-datasource.yml
backend/src/main/resources/grafana-dashboards.yml
backend/src/main/resources/chaos-messenger-dashboard.json
```

---

## 8. Проверка на двух физических устройствах

Этот режим нужен, если frontend нужно открыть с телефона или другого компьютера в той же Wi-Fi сети.

### Найти LAN IP

Windows:

```powershell
ipconfig
```

Linux/macOS:

```bash
ip addr
```

Пример LAN IP:

```text
192.168.1.50
```

### Обновить frontend `.env`

```env
VITE_BACKEND_URL=http://192.168.1.50:8080
VITE_API_BASE=http://192.168.1.50:8080/api
VITE_WS_URL=http://192.168.1.50:8080/ws
```

### Разрешить frontend origins в backend

```bash
export CHAOS_CORS_ALLOWED_ORIGINS="http://localhost:5173,http://192.168.1.50:5173"
```

PowerShell:

```powershell
$env:CHAOS_CORS_ALLOWED_ORIGINS="http://localhost:5173,http://192.168.1.50:5173"
```

После этого перезапустить backend и frontend.

Открыть со второго устройства:

```text
http://192.168.1.50:5173
```

---

## 9. Проверки

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

## 10. Частые проблемы

### Frontend не подключается к backend

Проверить `.env`:

```env
VITE_BACKEND_URL=http://localhost:8080
VITE_API_BASE=http://localhost:8080/api
VITE_WS_URL=http://localhost:8080/ws
```

Для проверки по локальной сети заменить `localhost` на IP компьютера, где запущен backend.

### CORS error

Добавить точный frontend origin в backend config:

```env
CHAOS_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.50:5173
```

### WebSocket сразу закрывается

Нужно заново войти в приложение и проверить, что frontend отправляет валидный Bearer JWT.

### SMS-код не приходит

В локальном режиме код печатается в логах backend. Реальная SMS отправка не используется.

### Ошибка миграции базы

Сбросить локальные контейнеры можно только если локальные данные не нужны:

```bash
cd backend
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
mvn spring-boot:run
```

---

## Полезные ссылки

- Русский README: [README.ru.md](README.ru.md)
- English README: [README.md](README.md)
- English setup: [SETUP_COMPLETE.md](SETUP_COMPLETE.md)
- Swagger UI: `http://localhost:8080/swagger-ui.html`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`
