# Design

This document records how the queue manager is built and why. Each section names the decision, the alternatives considered, and the reason for the choice.

## 1. Architecture

```
Browser (React SPA on Vercel)
   │  HTTPS, JSON, Authorization: Bearer <JWT>
   ▼
FastAPI (Render)  ──  SQLAlchemy  ──►  PostgreSQL (Neon)
```

- The frontend is static files. It can load instantly from a CDN even while the free-tier API server is asleep, and it shows a "waking the server" state instead of a blank page.
- The API is stateless. Every request carries a signed JWT, so any server instance can handle any request.
- PostgreSQL is the single source of truth. All queue state and all analytics come from it.

## 2. Data model

```
managers 1───* queues 1───* tokens 1───* token_events
```

| Table | Purpose | Key constraints |
|---|---|---|
| `managers` | Accounts | `email` unique, stored lower-case |
| `queues` | A named queue owned by one manager | `(manager_id, name)` unique; `next_token_number` counter |
| `tokens` | One person waiting / being served | `(queue_id, number)` unique; `(queue_id, position)` unique **deferrable**; at most one `serving` token per queue (partial unique index) |
| `token_events` | Append-only audit log of every action | indexed by `(queue_id, at)` |

Each token stores the timestamp of every state change (`created_at`, `serving_at`, `served_at`, `cancelled_at`). All analytics are computed from these facts rather than from stored counters, so the numbers can never drift out of sync with what actually happened.

## 3. Token lifecycle: a state machine

```
            serve next            complete / serve next
 waiting ─────────────► serving ───────────────────────► served
    │                      │
    │ cancel               │ cancel (no-show)
    ▼                      ▼
 cancelled              cancelled
```

Allowed transitions are listed in one table in `services/queue_service.py`. Any other transition (for example cancelling a token that was already served) is rejected with HTTP 409. Making illegal states unreachable is the main defence against bugs.

**One counter per queue.** Each queue serves one token at a time. "Serve next" completes the current token (if any) and calls the next one. A database index enforces "at most one serving token per queue", so even a bug in the code cannot produce two.

## 4. Ordering the queue

The brief requires moving tokens up and down. Three designs were considered:

| Design | Move up/down | Add to end | Problem |
|---|---|---|---|
| Integer `position`, renumber 1..n on every change | O(n) writes | O(1) | Cancelling the first token rewrites every row |
| Linked list (`next_token_id` per row) | O(1) writes, 3–4 rows | O(1) | Reading in order needs a recursive query; a broken pointer corrupts the whole queue |
| **Sort key, swap with neighbour** (chosen) | 2 writes | O(1) | Needs a deferrable unique constraint for the swap |

**How it works.** A new token gets `position = number`, which is always larger than any existing position, so it joins the end of the line. Moving up swaps `position` with the nearest *waiting* token above it. Cancelled and served tokens keep their position value. They are simply filtered out, so cancelling never renumbers anything.

Because positions are only ever swapped and never invented, the set of positions in a queue is always exactly the set of token numbers, so no two tokens can share one. The `UNIQUE (queue_id, position)` constraint is marked `DEFERRABLE INITIALLY DEFERRED`. Without that, PostgreSQL checks uniqueness after each row update, and a swap would fail on its first half when both rows briefly have the same value. With it, the check runs at commit, when the swap is complete.

## 5. Concurrency

Two clicks on "move up", two browser tabs pressing "serve next", or two requests adding tokens at the same moment can corrupt a queue if they interleave.

**Approach: a per-queue lock.** Every operation that changes a queue starts with

```sql
SELECT * FROM queues WHERE id = :id AND manager_id = :me FOR UPDATE;
```

That one statement does three jobs:

1. **Authorization.** If the queue belongs to someone else, no row comes back and the API returns 404. It returns 404 rather than 403 so it doesn't confirm the queue exists.
2. **Mutual exclusion.** The row lock makes concurrent operations on the same queue run one after another. The second request waits until the first commits, then sees its result.
3. **Atomic token numbers.** `next_token_number` is read and incremented while the lock is held, so two concurrent "add" requests can never get the same number.

Operations on *different* queues don't block each other. The lock is coarse, but contention is negligible because a human manager clicks a few times a minute. It also keeps the code simple enough to reason about. The database constraints (unique number, unique position, one serving token) are a second line of defence: if the lock were ever bypassed, the database would reject the bad write instead of storing it.

The test suite runs these operations from many threads at once and checks the invariants afterwards (`tests/test_concurrency.py`).

## 6. Analytics

| Metric | Definition |
|---|---|
| Wait time | `serving_at − created_at` for tokens that reached the counter |
| Service time | `served_at − serving_at` |
| Peak queue length | the most people in line at once during each hour/day |
| Throughput | tokens served per hour/day |
| Cancellation rate | cancelled ÷ (served + cancelled) |

**Peak queue length uses a sweep line.** Every arrival is a `+1` event and every departure from the line (called to the counter, or cancelled) is a `−1` event. Sorting all events by time and taking a running sum (`SUM(d) OVER (ORDER BY at)`) gives the exact length of the line after every event, in O(n log n). A bucket's peak is the largest running value inside it, or the value carried in from before it if nothing happened during the bucket.

An earlier version sampled the queue length at the *end* of each bucket. For daily buckets that sample lands at midnight, after closing, and always read 0, so it was replaced. The sweep line also catches a short spike that a sample would miss.

Buckets are generated by `generate_series` in the viewer's timezone (sent by the browser as an IANA name such as `Asia/Kolkata`), so "today" and hourly buckets line up with the user's clock rather than the server's UTC clock.

Median and p90 wait times are reported alongside the mean, because a few very long waits can drag the mean far above what a typical person experiences.

## 7. Authentication and security

- Passwords are hashed with **bcrypt** (salted, deliberately slow). Inputs longer than bcrypt's 72-byte limit are rejected rather than silently truncated.
- Login takes the same time whether or not the email exists. Without that, response timing would reveal which emails are registered.
- Sessions use a signed **JWT** (HS256) with an expiry. The secret comes from the environment, and the server refuses to start in production with a weak or default secret.
- **Bearer token vs cookie.** The frontend (Vercel) and API (Render) are on different sites. A session cookie would have to be `SameSite=None` third-party cookie, which Safari and privacy settings increasingly block. A bearer token in `localStorage` works everywhere. The trade-off is that a successful XSS attack could read it, which React's default output escaping and the absence of `dangerouslySetInnerHTML` mitigate.
- CORS only allows the configured frontend origin.

## 8. Keeping the UI correct

- The queue screen refreshes every 5 seconds (polling), so two tabs or two devices stay in sync. WebSockets would push changes instantly, but they need a persistent connection the free hosting tier drops when it sleeps. Polling is simpler and more than fast enough for a human-paced queue.
- Buttons are disabled while their request is in flight, which blocks most double-submits at the source; the server-side lock handles the rest.
- "Waited 12 min" is computed against the **server's** clock, not the browser's: each response includes `server_time`, and the UI corrects for the difference, so a wrong laptop clock can't produce negative or inflated wait times.

## 9. Out of scope

Multiple counters per queue, a public display screen for customers, SMS notifications, and staff roles below the manager. The data model leaves room for all four.
