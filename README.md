# Queue Manager

A full-stack queue management app. A manager signs in, creates queues, issues tokens to people as they arrive, reorders the line, calls the next person to the counter, and sees how long people wait.

**Live app:** https://frontend-seven-psi-28.vercel.app
**Demo account:** `demo@queuemanager.app` / `demo1234` (or press "Open the demo account" on the sign-in page). It has three queues with two weeks of simulated history, so the dashboard has real data to show.

> The API runs on a free hosting tier that sleeps when idle. The first request after a quiet period can take up to a minute; the app shows a "starting the server" notice while it wakes.

## What it does

| Requirement | Where |
|---|---|
| 1. Manager can log in and create queues | Sign up / sign in, then **Queues** → *New queue* |
| 2. Each queue has a name | Names are unique per manager; whitespace is normalised |
| 3. Add people; a token is created | *Add a person* (name optional) issues the next token number |
| 4. List the people waiting | The *Waiting* list, front of the line first, with how long each person has waited |
| 5. Move tokens up and down | ↑ / ↓ on each row (disabled at the ends) |
| 6. Assign the top token for service | **Call next** finishes the current person and calls the front of the line |
| 7. Cancel a token | ✕ on a waiting row, or *Didn't show up* for the person at the counter, both confirmed first |
| 8. Analytics dashboard | **Dashboard**: typical (median) and long (90th percentile) waits, time at the counter, longest line per hour/day, arrivals vs served, busiest hours, per-queue breakdown, over 24 h / 7 d / 30 d |

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts |
| Backend | Python, FastAPI, SQLAlchemy 2, Alembic, Pydantic |
| Database | PostgreSQL |
| Auth | bcrypt password hashing, JWT bearer tokens |
| AI (optional) | Claude Fable 5.2 via the Anthropic Python SDK, for the dashboard summary |
| Tests | pytest (55 tests, including concurrency, CORS and the AI summary), Playwright end-to-end |
| Hosting | Vercel (frontend), Render (API), Neon (PostgreSQL), all free tiers |

```
Browser ── React SPA (Vercel) ──HTTPS/JSON──► FastAPI (Render) ──► PostgreSQL (Neon)
```

## Engineering notes

The full reasoning is in [docs/DESIGN.md](docs/DESIGN.md). The short version:

- **Concurrent clicks can't corrupt a queue.** Every change to a queue first takes a row lock on it (`SELECT … FOR UPDATE`), so two requests on the same queue run one after another. The same query also checks ownership, so another manager's queue returns 404. Database constraints back this up: unique token numbers, unique positions, and at most one token at the counter per queue. `tests/test_concurrency.py` fires operations from 12+ threads at once. With the lock removed, all three tests fail (duplicate numbers, two people at the counter, a deadlock).
- **Reordering is two writes, not n.** Each token has a sort key; moving swaps it with the nearest waiting neighbour. The uniqueness constraint is `DEFERRABLE INITIALLY DEFERRED`, so the swap can pass through an intermediate state and is checked at commit.
- **Tokens follow a state machine:** `waiting → serving → served`, with `cancelled` from either of the first two. Every other transition is rejected with 409.
- **Analytics come from facts, not counters.** Each token records when it joined, was called, finished or was cancelled. "Longest line" is computed with a sweep line (`+1` per arrival, `−1` per departure, running sum ordered by time) in SQL. Time buckets follow the viewer's timezone.
- **The UI stays correct under polling.** The queue screen refreshes every 5 s to stay in sync across tabs. Each action cancels any refresh already in flight, so an older response can't overwrite a newer one, and every action returns the full updated queue. Wait times use the server's clock, so a wrong laptop clock doesn't skew them.

## AI summary (optional)

The dashboard can add a short written read of the period on screen: a headline, two to four observations and one thing to try next. It is written by **Claude Fable 5.2** from the same numbers the charts show.

- **Off unless configured.** Set `ANTHROPIC_API_KEY` on the API server to turn it on. Without it the dashboard looks exactly as it does today; `GET /api/features` tells the frontend which it is.
- **Only numbers leave the server.** No names people gave, no emails, no ids. The request uses structured output (a JSON schema) so the answer always has the same shape, low effort (it summarises given numbers), and server-side refusal fallbacks.
- **Bounded cost.** Nothing is sent until someone presses *Summarize*; one answer per view is reused for the rest of the hour; an empty period is answered without a model call; and `INSIGHTS_DAILY_LIMIT` (default 50) caps model calls per day across the server. Each call is a few thousand tokens, roughly $0.05 to $0.10 at Fable 5.2 prices.
- **Failures are plain.** No key, a busy service, a timeout, a refusal or an unreadable answer each show one clear sentence in the panel; the charts are never affected.

Code: `backend/app/services/insights.py`, `backend/app/routers/insights.py`, `frontend/src/components/InsightsPanel.tsx`. Tests: `backend/tests/test_insights.py` (a fake client, so they need no key).

## Run it locally

Requirements: Python 3.12+, Node 20+, PostgreSQL 14+.

```bash
# 1. Database
createdb queue_manager

# 2. API (http://localhost:8000, interactive docs at /docs)
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env            # edit DATABASE_URL if needed
alembic upgrade head
python -m app.seed              # optional: demo account with history
uvicorn app.main:app --reload

# 3. Frontend (http://localhost:5173)
cd ../frontend
npm install
cp .env.example .env
npm run dev
```

## Tests

```bash
# Backend: needs a separate empty database
createdb queue_manager_test
cd backend && pytest

# End-to-end: with both servers running
cd frontend
npm install --no-save playwright && npx playwright install chromium
npm run e2e
```

## Deploying (free tiers)

1. **Database:** create a project on [Neon](https://neon.tech) and copy its connection string.
2. **API:** on [Render](https://render.com), *New → Blueprint* and pick this repo; it reads `render.yaml`. Set `DATABASE_URL` (from Neon) and `CORS_ORIGINS` (the main Vercel URL). `CORS_ORIGIN_REGEX` in `render.yaml` also allows the project's per-deployment Vercel URLs; change the team suffix if you fork this. `JWT_SECRET` is generated automatically. Each start applies migrations and rebuilds the demo account if its data is more than an hour old, so the demo's waiting times stay realistic (the rebuild adds a few seconds to that start).
   To turn on the AI summary, also set `ANTHROPIC_API_KEY` there.
3. **Frontend:** on [Vercel](https://vercel.com), import the repo with root directory `frontend` and set `VITE_API_URL` to the Render URL.

## Project layout

```
backend/
  app/
    main.py              FastAPI app, CORS, error handling
    models.py            tables and constraints
    services/
      queue_service.py   state machine, reordering, locking
      analytics.py       dashboard queries
    routers/             HTTP endpoints (thin)
    seed.py              demo data (single-server queue simulation)
  alembic/               migrations
  tests/                 pytest suite
frontend/
  src/
    pages/               sign-in, queues, queue, dashboard
    lib/api.ts           every request goes through one function
  e2e/smoke.cjs          browser test of each requirement
docs/DESIGN.md           design decisions and trade-offs
```
