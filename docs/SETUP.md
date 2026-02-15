# Setup Guide

## Prerequisites

- Python 3.11+
- Node.js 18+
- ffmpeg available on PATH
- Redis (required for Twilio async call analysis only)

## 1) Backend setup

From repository root:

```powershell
cd backend
copy .env.example .env
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

If `uv` is unavailable, use your virtualenv and install via `pip` from `pyproject.toml` dependencies.

## 2) Frontend setup

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Default frontend URL: `http://localhost:3000`

## 3) Worker setup (optional but required for Twilio call post-processing)

```powershell
cd backend
uv run rq worker calls --path .
```

## 4) Verify core health

- Backend: `GET http://127.0.0.1:8000/health`
- Frontend loads home page and can navigate to `/session`

## Feature dependency map

- **OpenAI credentials required:** live conversation session and AI report generation
- **RunPod credentials required:** stress + phoneme/disfluency model endpoints
- **Twilio credentials required:** call flow + SMS/MMS forwarding
- **Redis required:** queued call analysis worker flow
- **ffmpeg required:** audio conversion and pitch extraction paths

## Troubleshooting

### `ffmpeg` not found

Install ffmpeg and confirm:

```powershell
ffmpeg -version
```

### Redis connection errors

Ensure Redis is running and backend queue configuration matches your instance.

### Session starts but no AI voice

Validate backend AI credentials and confirm outbound network access to OpenAI realtime endpoints.

### RunPod timeouts

Cold starts can be long for the DysfluentWFST endpoint. Retry once and check endpoint warm state.
