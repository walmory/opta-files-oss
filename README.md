# Opta Files

A web PDF toolkit: 50+ tools (merge, split, compress, convert, sign, OCR…), a page-by-page
visual editor and a local document history — in a single React app.

```
browser → web-app (Vite, :5173) → backend (Express, :3001) → PDF engine (Stirling-PDF, :8082)
```

The heavy PDF processing is done by **[Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF)**,
running as a Docker container. Opta Files adds its own interface, editor, accounts and an Express
gateway in front of it: the browser only talks to the backend, which streams uploads to the engine
and turns its responses and errors into friendly, translated messages.

> 🇧🇷 Projeto brasileiro. A interface tem português, inglês, espanhol, francês, italiano e alemão.

## Structure

| Path | What it is |
|---|---|
| `web-app/` | Frontend: React + Vite + TypeScript + Tailwind v4 |
| `web-app/src/pages/EasyPDF.tsx` | App shell: **Tools**, **Editor**, **Studio** and **Documents** tabs |
| `web-app/src/features/easypdf/` | Tool registry (`tools.ts`), engine client (`engineClient.ts`), hub, runner and history |
| `web-app/src/features/studio/` | Visual editor (canvas, text, images, shapes, signatures) |
| `web-app/src/features/workspace/` | Multi-document workspace (pages, reordering, splitting, tools) |
| `web-app/src/features/auth/` | Sign-up, login and verification screens |
| `backend/` | Engine gateway, Google Fonts (TTF) service, per-account JSON store and accounts |
| `docker-compose.yml` | Starts the PDF engine locally |

## Run locally

Requires Docker and **Node ≥ 22.13** (the backend uses Node's built-in SQLite).

```bash
# 1. PDF engine (Stirling-PDF)
docker compose up -d

# 2. backend
cd backend && cp .env.example .env && npm i && npm run dev   # http://127.0.0.1:3001

# 3. frontend
cd web-app && cp .env.example .env && npm i && npm run dev   # http://localhost:5173
```

Backend tests: `cd backend && npm test`.

## Backend endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Backend health |
| `GET /pdf/health` | `{ ok: true }` when processing is available |
| `ALL /pdf/api/*` | Gateway to the engine (streaming multipart, sanitized headers) |
| `GET /api/fonts/*` | Google Fonts as TTF for the editor |
| `GET\|PUT /api/store/*` | Per-account JSON store (login required) |
| `/auth/*` | Sign-up, login, session and verification |

All settings live in `backend/.env.example` (engine URL, CORS, accounts, limits and verification).

## Accounts and limits

Sign-up with **e-mail + mobile number + password**, designed for one account per person
(`backend/auth/`):

- **Canonical e-mail:** `j.o.a.o+x@gmail.com`, `joao@googlemail.com` and `joao@gmail.com` are the
  same account; disposable e-mail domains are rejected.
- **Unique mobile number** normalized to E.164; landlines are rejected.
- **Device and network limits:** `MAX_ACCOUNTS_PER_DEVICE` per browser and `MAX_SIGNUPS_PER_IP_DAY`.
- **Passwords and sessions:** scrypt with salt; opaque session tokens (only the SHA-256 is stored);
  15-minute lockout after 5 wrong passwords.
- **Optional verification:** 6-digit codes by e-mail (Resend) and phone (WhatsApp via Evolution API,
  or Twilio SMS) — off by default.
- **Daily limits:** `ANON_DAILY_LIMIT`, `FREE_DAILY_LIMIT` and `PRO_DAILY_LIMIT` operations per day
  (0 = unlimited).

## Privacy

Files are processed and discarded; the document history stays in the user's browser (IndexedDB).

## Credits

- [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) — the PDF processing engine.
  It is pulled as a Docker image, is not included in this repository and keeps its own license.
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF rendering in the browser.

## License

[MIT](LICENSE) © 2026 João Victor Walmory da Silva — covers the code in this repository only.
