# Santé

Voice-based exploratory health signal platform with real-time conversational capture, acoustic biomarker extraction, disfluency detection, safety triage, and clinician alert workflows.

![System Architecture](architecture.png)

## Who this is for

- Developers and OSS contributors extending frontend, backend, and ML integrations.
- Clinicians and non-technical stakeholders reviewing report outputs and signal interpretation.

## Fast start

1. Read [Setup Guide](docs/SETUP.md)
2. Copy [backend/.env.example](backend/.env.example) to `backend/.env`
3. Start backend from `backend/`
4. Start frontend from `frontend/`

## Architecture

- System design and data flows: [Architecture](docs/ARCHITECTURE.md)
- API and WebSocket contracts: [API Reference](docs/API_REFERENCE.md)

## External integrations

### RunPod

- Primary guide: [RunPod Integration](docs/integrations/RUNPOD.md)

### Other services

- OpenAI Realtime + Chat APIs: [OpenAI Integration](docs/integrations/OPENAI.md)
- Twilio voice + SMS/MMS: [Twilio Integration](docs/integrations/TWILIO.md)
- Redis + rq async jobs: [Redis Integration](docs/integrations/REDIS.md)
- openSMILE acoustic extraction: [openSMILE Integration](docs/integrations/OPENSMILE.md)

## Documentation index

- [Setup Guide](docs/SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API_REFERENCE.md)
- [RunPod Integration](docs/integrations/RUNPOD.md)
- [OpenAI Integration](docs/integrations/OPENAI.md)
- [Clinician Guide](docs/CLINICIAN_GUIDE.md)
- [Benchmark Results](BENCHMARK_RESULTS.md)

## Current stack

- Frontend: Next.js 16, React 19, Zustand, Tailwind CSS
- Backend: FastAPI, websockets, openSMILE, fpdf2
- Async: Redis + rq worker jobs
- External AI/ML: OpenAI APIs + RunPod serverless endpoints

## Clinical/research framing

Santé outputs are exploratory signal estimates and quality-weighted summaries intended for screening support and structured follow-up. They are not standalone diagnoses.