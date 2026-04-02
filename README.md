# Finfinity-wa-bot

WhatsApp webhook bot for Finfinity, with lead logging and analytics dashboard.

## Environment

Create a `.env` file with:

- `TOKEN=<meta_whatsapp_access_token>`
- `PHONE_NUMBER_ID=<meta_phone_number_id>`
- `WA_VERIFY_TOKEN=<your_verify_token>`
- `APP_SECRET=<meta_app_secret>` (recommended for webhook signature verification)
- `PORT=3000` (optional)
- `IMAGE_URL=<optional_header_image_url>` (optional)
- `WEBVIEW_LINK=<optional_override_url>` (optional)
- `WA_TIMEOUT_MS=10000` (optional)
- `WA_RETRY_COUNT=2` (optional)
- `WA_RETRY_BASE_MS=400` (optional)
- `TESTER_ACCESS_ENABLED=false` (optional; when true, only allowlisted WhatsApp numbers can use the bot)
- `TESTER_ALLOWED_PHONES=919999999999,918888888888` (optional; comma-separated phone numbers with or without +)
- `LEAD_STORAGE=csv` (optional; set to `postgres` to store leads in PostgreSQL)
- `POSTGRES_HOST=<host>` (required when `LEAD_STORAGE=postgres`)
- `POSTGRES_PORT=5432` (optional)
- `POSTGRES_DB=<database_name>` (required when `LEAD_STORAGE=postgres`)
- `POSTGRES_USER=<database_user>` (required when `LEAD_STORAGE=postgres`)
- `POSTGRES_PASSWORD=<database_password>` (required when `LEAD_STORAGE=postgres`)
- `POSTGRES_SSL=false` (optional)
- `POSTGRES_POOL_MAX=10` (optional)
- `SMTP_HOST=<smtp_host>` (optional, required for email notifications)
- `SMTP_PORT=587` (optional)
- `SMTP_SECURE=false` (optional; true for SSL SMTP)
- `SMTP_IGNORE_TLS=false` (optional; set true for plain SMTP relays on port 25 that do not support STARTTLS)
- `SMTP_USER=<smtp_username>` (optional; required only if your SMTP relay requires auth)
- `SMTP_PASS=<smtp_password>` (optional; required only if your SMTP relay requires auth)
- `EMAIL_FROM=<from_email_address>` (optional)
- `EMAIL_TO=admin@finfinity.co` (optional; defaults to this address)
- `LOG_TO_FILE=true` (optional; writes JSON logs into `logs/app.log` and `logs/error.log`)
- `LOG_DIR=/app/logs` (optional; defaults to `<project>/logs`)

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Health check:

```bash
curl http://localhost:3000/ping
```

## Run With Docker

Build and run:

```bash
docker compose -f docker.yml up --build -d
```

Stop:

```bash
docker compose -f docker.yml down
```

The container mounts `leads.csv` as a volume so lead data persists across restarts.

## Production Docker (Company Server)

This repository keeps production Docker config separate from local config:

- Local: `docker.yml` + `Dockerfile`
- Production: `docker-compose.prod.yml` + `Dockerfile.prod`

### Prerequisites on server

1. Ensure Docker network exists:

```bash
docker network create finxPortal
```

2. Create required host paths:

```bash
mkdir -p data logs
touch data/leads.csv
```

3. Ensure `data/leads.csv` is writable by container user `1001`.

### Start production stack

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### Stop production stack

```bash
docker compose -f docker-compose.prod.yml down
```

## Routes

- `GET /` health text
- `GET /ping` health json
- `GET /webhook` Meta verification
- `POST /webhook` webhook receiver
- `GET /dashboard` analytics dashboard
- `GET /analytics` raw analytics json
- `GET /admin/email/health` admin-only SMTP connectivity check


For higher scale next, add:

Postgres for leads instead of CSV.
Redis for dedup/session state (so multiple app instances stay consistent).
Queue/retry for outbound WhatsApp sends and observability logs.