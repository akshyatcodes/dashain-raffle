# Dashain Raffle

A self-hosted company raffle website. One small Node server (no npm dependencies) and one data folder.

- **Live board** (public): prizes, live odds, bundle prices, team leaderboard, recent-purchase ticker, "find my tickets", winners.
- **Get tickets** (public, company code): staff reserve their own tickets, pay a collector (cash, eSewa, Khalti, bank, QR) and get a live receipt.
- **Draw stage** (for the projector): random draw with a synced reel on every screen, or a **physical draw**, where an organiser types the number pulled from the bowl. There is also a prizes-and-winners list.
- **Organisers console** (password): sell tickets, print paper ticket books and draw slips, keep the sales ledger, manage prizes and settings, and run the draw.
- **Finance role** (separate password): confirm payments from a queue, set prices and collectors, upload payment QR codes, see money totals and export CSV.

Guides:

| Read this | If you are |
|---|---|
| [docs/ORGANISER-GUIDE.md](docs/ORGANISER-GUIDE.md) | running the raffle (organisers and finance) |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | deploying, backing up, upgrading or handing it over |
| [docs/MULTI-TENANT-PLAN.md](docs/MULTI-TENANT-PLAN.md) | planning a multi-company version |

---

## Quick start (Docker)

**Prerequisites:** Docker + Docker Compose v2. That's it — no database, no npm install, no build tooling.

1. **Clone and enter the repo:**
   ```bash
   git clone https://github.com/akshyatcodes/dashain-raffle.git raffle && cd raffle
   ```
2. **Create your secrets** — copy the template and generate three values:
   ```bash
   cp .env.example .env
   echo "RAFFLE_ADMIN_PASSWORD=$(openssl rand -base64 18)"    >> .env
   echo "RAFFLE_FINANCE_PASSWORD=$(openssl rand -base64 18)"  >> .env
   echo "RAFFLE_SESSION_SECRET=$(openssl rand -hex 32)"       >> .env
   chmod 600 .env
   ```
   Open `.env` and check each `RAFFLE_*` line only has one value (the `echo` above appends — remove the original blank line for that variable if you kept it). Never commit this file.
3. **Set up the compose file:**
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   ```
   Edit it if you want a named volume instead of a bind mount, or to add Traefik labels (see the commented-out block inside).
4. **Start it:**
   ```bash
   docker compose up -d --build
   curl -s http://127.0.0.1:8080/healthz     # {"ok":true,...}
   ```
5. **Put HTTPS in front of it.** Use Traefik, nginx, Caddy, or your platform's ingress, pointed at container port 8080. Don't expose 8080 to the internet directly — see [Reverse proxy notes](#reverse-proxy-notes) below (SSE buffering matters).
6. **First sign-in:** open `https://your-host/`, go to **Organisers**, and sign in with the **finance** password first (finance can configure everything; organiser can't). Then work through the [first-time setup checklist](docs/ORGANISER-GUIDE.md#first-time-setup) — event name, prizes, dates, payment collectors, company code.
7. **Smoke test:** sign in as finance in one browser, open the public board in another, record a test sale, confirm it appears live, then void it.

For a step-by-step deployment/handover checklist (including backups, upgrades, moving servers, and troubleshooting), see [docs/OPERATIONS.md](docs/OPERATIONS.md).

**Without Docker** (Node 20+):
```bash
npm run check   # syntax check, no dependencies to install
RAFFLE_ADMIN_PASSWORD=… RAFFLE_FINANCE_PASSWORD=… RAFFLE_SESSION_SECRET=… DATA_DIR=./data node server.js
```

## Configuration

Everything about the event (name, prices, dates, prizes, collectors, self-service) is set **in the app** and stored in the data folder. The environment only holds secrets:

| Variable | Required | What it does |
|---|---|---|
| `RAFFLE_ADMIN_PASSWORD` | yes (12+ chars) | Organiser sign-in |
| `RAFFLE_FINANCE_PASSWORD` | yes (12+ chars, different) | Finance sign-in |
| `RAFFLE_SESSION_SECRET` | yes (32+ chars) | Signs login cookies. Changing it signs everyone out. |
| `PORT` | no (8080) | Listen port inside the container |
| `DATA_DIR` | no (`/data` in the image, `./data` otherwise) | Where state lives |
| `RAFFLE_ROLL_MS` | no (4000) | How long the random-draw reel spins |

The server refuses to start if a secret is missing or too short.

## Data

Everything lives in `DATA_DIR`:

```
raffle.json          all state: settings, prizes, sales, books, draws, audit log (written atomically)
snapshots/           hourly copies of raffle.json, last 72 kept
uploads/             collector QR images
```

**Back up this folder.** A restore means putting the folder back and starting the container. See [OPERATIONS.md](docs/OPERATIONS.md#backup-and-restore).

## Reverse proxy notes

- The live updates use **Server-Sent Events** on `/api/events`. Turn off response buffering for that path:
  - nginx: `proxy_buffering off; proxy_read_timeout 1h;`
  - Cloudflare and Traefik work as they are. The server sends a keep-alive every 25 seconds.
- Serve over **HTTPS only**. The login cookie is `Secure; HttpOnly; SameSite=Strict`, so sign-in won't stick over plain http.
- Rate limits read the client IP from `CF-Connecting-IP`, then `X-Forwarded-For`, then the socket address. Make sure your proxy sets one of them.

## Security model (short version)

- **Public:** board, draw stage, receipts (the receipt link acts as the key), and the self-service form. Prices, payment collectors and the form itself are locked until the visitor enters the company code (signed 30-day cookie; `POST /api/unlock`).
  - Buyer names are shortened to "First L." on public pages. A buyer can choose to show as "Someone from <team>".
  - The company code is never sent to the browser; the cookie is an HMAC of it, so changing the code locks everyone out.
- **Organisers:** everything except money controls. Sales they record are always saved **unpaid**.
- **Finance:** payment status, voiding paid sales, prices, collectors and QR codes, totals, CSV. The server enforces this. Hiding it in the page is just convenience.
- **Draws:** random draws use `crypto.randomInt` on the server, over paid, non-void tickets that haven't already won. Physical draws check the ticket is sold, paid and not already a winner.
- **Protections:**
  - Writes need a custom header (CSRF protection) plus the session cookie.
  - Sign-in is rate-limited to 8 tries per 15 minutes per IP.
  - Self-service is rate-limited per IP.
  - Uploads are checked by their file signature and capped at 2 MB.
- **Audit log:** every action is recorded with the person's name, and the last 1,000 entries are kept in `raffle.json`.

## Project layout

```
server.js                 HTTP server, store, rules, draw engine (no dependencies)
public/index.html         markup
public/app.js             front end
public/styles.css         styles, including the print layouts (tickets, draw slips)
Dockerfile                image build (official node:22 slim + 3 files)
docker-compose.example.yml
.env.example
scripts/build-image.sh    build, export as a tar, or push a multi-arch image
docs/                     guides
```

Check syntax before shipping a change: `npm run check`

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, adapt it for your own event.
