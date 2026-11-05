# Beanstalk Lab

A test dummy app for learning **AWS Elastic Beanstalk** by doing. Deploy it, break it on purpose and watch how Beanstalk responds.

## What's inside

| Page | What it teaches |
|---|---|
| **Overview** | Which EC2 instance, availability zone, version, process and environment variables served each request. Also shows proxy headers and whether your `.ebextensions`, hooks and nginx customisations ran. |
| **Chaos lab** | Fail or slow the health check, return 5xx errors, make slow requests, burn CPU (for auto scaling), leak memory (OOM), freeze the event loop, crash the process, write logs. |
| **Deploy watcher** | Polls the app continuously and draws one square per request, coloured by version or instance. Lets you see rolling, immutable, blue/green, scaling and outages. |
| **Worker & DB** | SQS worker endpoint (`/worker/task`, `/worker/cron`, and `/`) with retry/DLQ behaviour, plus a TCP check against RDS/your database. |
| **Labs** | 18 step-by-step labs from first deploy to HTTPS, with progress saved in your browser. |

The `labs/` folder holds real Beanstalk config (`.ebextensions`, `.platform` hooks, nginx, `cron.yaml`). The labs tell you when to copy each piece into place. Only `.ebextensions/healthcheck.config` is active from the start.

## Run locally

```powershell
npm install
npm start      # http://localhost:8080
npm test
```

Then open **Labs → Lab 0**.

## Environment properties the app understands

| Name | Effect |
|---|---|
| `APP_VERSION` | Overrides the version shown (defaults to `package.json` version) |
| `APP_COLOR` | Recolours the UI (any CSS colour, e.g. `crimson`). Useful for blue/green. |
| `GREETING` | Shown on Overview |
| `LAB_KEY` | If set, chaos endpoints need the header `x-lab-key` (enter it in the Chaos lab) |
| `CHAOS_ENABLED=false` | Disables all chaos endpoints |
| `DB_HOST`, `DB_PORT`, `DB_NAME` / `RDS_*` | Database connectivity check |

## API

`GET /api/health` · `GET /api/info` · `GET /api/db` · `GET /api/worker/tasks` · `POST /api/log`
Chaos: `POST /api/chaos/health {mode: ok|fail|slow, revertAfterMinutes}` · `GET /api/chaos/error` · `GET /api/chaos/slow?ms=` · `POST /api/chaos/cpu {cores, seconds}` · `POST /api/chaos/cpu/stop` · `POST /api/chaos/memory {mb}` · `POST /api/chaos/memory/release` · `POST /api/chaos/block {seconds}` · `POST /api/chaos/crash`

> ⚠️ The chaos endpoints are open to anyone who has your environment URL. Set `LAB_KEY` (Lab 3) and terminate environments when you're done.
