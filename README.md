# Polymath

**An exocortex for learning anything.** Polymath is an adaptive AI tutor: name any skill, it maps the load-bearing concepts, teaches each one Socratically (explain → probe → adapt to your answers), and reinforces it with spaced-repetition review. All tutoring, grading, and flashcard generation are live Claude API calls.

## Architecture

- **Frontend** (`src/App.jsx`) — React, self-styled, no build-time CSS framework. Calls `/api/claude`.
- **Backend** (`server.js`) — a tiny Express proxy that holds your API key and forwards requests to Anthropic. **The key never reaches the browser.**
- **Dev** — Vite serves the frontend on `:5173` and proxies `/api` to the Express server on `:8787`.

## Setup

Requires Node 18+ (for built-in `fetch`).

```bash
# 1. install dependencies
npm install

# 2. add your API key
cp .env.example .env
#    then edit .env and paste your real key

# 3. run frontend + backend together
npm run dev
```

Open http://localhost:5173

## How to test

1. **Skill:** `Negotiation`  ·  **Level:** Total beginner  ·  **Goal:** `close my first salary negotiation` → **Build my path**.
   Expect a short load, then 6–8 ordered concepts and a 0/N progress bar.
2. **Click the first concept.** Expect a 2-paragraph lesson, a "THINK OF IT LIKE" analogy, and one question.
3. **Answer it** (try a half-right answer first). Expect specific feedback with a colored dot, then a follow-up. Two good answers flips it to "Concept locked in" and adds 3 cards.
4. **Back to path → Review N cards.** Reveal a card, then "Got it" / "Missed it" — the strength bar rises or resets.

### Edge cases
- Empty skill → "Build my path" stays disabled.
- Server not running / no key → you see a red error line, not a crash (handled by `try/catch` + the proxy's error JSON).
- Bad/malformed model output → `parseJSON` throws and surfaces a friendly error.

## Status & next steps

This is an MVP. The full adaptive engine works. Not yet built:
- Persistence (progress resets on refresh) — add a DB or browser storage.
- Real time-based spaced-repetition scheduling (currently an in-session Leitner box).
- Accounts.

## Security note

Never put an API key in frontend code. This project keeps it server-side in `.env` (which is gitignored). If you deploy, set the key as an environment variable on your host.

## Tech

React · Vite · Express · lucide-react · Claude API (`claude-sonnet-4`)
