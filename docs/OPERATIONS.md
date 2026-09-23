# Operations & Handover

For whoever hosts the raffle: IT, the company platform team, or the next maintainer.

## What you're running

- One container, `node:22-bookworm-slim` plus three app files. No database, no npm packages, no outbound network calls.
- Resource use is tiny: about 40 MB RAM and next to no CPU. One process handles a few hundred concurrent viewers easily.
- State is one folder (`/data`). Secrets are three environment variables. See the [README](../README.md#configuration).

## Deploying on a company server

1. **Get the code:** clone the repo, or copy the folder.
2. **Create `.env`:** copy it from `.env.example`, generate the values, then `chmod 600 .env`:
   ```bash
   echo "RAFFLE_ADMIN_PASSWORD=$(openssl rand -base64 18)"
   echo "RAFFLE_FINANCE_PASSWORD=$(openssl rand -base64 18)"
   echo "RAFFLE_SESSION_SECRET=$(openssl rand -hex 32)"
   ```
3. **Start it:** `cp docker-compose.example.yml docker-compose.yml`, adjust the proxy section, then `docker compose up -d --build`.
4. **Route HTTPS** to the container's port 8080, e.g. `raffle.company.com`. Keep SSE unbuffered (see README).
5. **Tell it its address:** in the app, go to **Settings → Web address printed on tickets** and enter the new domain.
6. **Smoke test:**
   - `/healthz` returns ok.
   - The page loads and the header says **Live**.
   - Sign in as finance, then open a second browser on the board and record a test sale. It should pop up on the board.
   - Void the test sale.

### Sharing the image instead of the source

```bash
scripts/build-image.sh                       # local image dashain-raffle:<version>
scripts/build-image.sh --save                # also writes dashain-raffle-<version>-<arch>.tar.gz
scripts/build-image.sh --push ghcr.io/org/dashain-raffle   # amd64 + arm64, needs docker buildx
```

- On the receiving machine: `docker load < dashain-raffle-*.tar.gz`, then set `image: dashain-raffle:<version>` in compose instead of `build: .`.
- A `--save` tarball only works on the **same CPU architecture** it was built on. An image built on an ARM server won't run on a typical x86 company server.
- For other architectures, use `--push` with buildx, or just run `docker compose up -d --build` on the target. It takes seconds, because there's nothing to install.

## Backup and restore

- **Back up:** copy `DATA_DIR` (`raffle.json`, `snapshots/`, `uploads/`). It's safe to copy while the app is running, because writes are atomic renames. A nightly copy is enough, and the app keeps 72 hourly snapshots of its own.
- **Restore:**
  1. `docker compose stop`
  2. Put the folder back. To roll back to a point in time, copy `snapshots/raffle-YYYYMMDDHH.json` over `raffle.json`.
  3. `docker compose start`
- **The app keeps state in memory.** Always stop it before replacing `raffle.json`, or the running app will overwrite your file on its next save.

## Moving from one server to another

1. On the old host: `docker compose stop`, then copy the data folder (or the named volume's contents) to the new host.
2. On the new host: deploy (above) with the data in place, then start it.
3. Point DNS at the new host and update **Settings → Web address printed on tickets**.
4. Keep the same three secrets if you want people to stay signed in. New secrets just mean everyone signs in again.
5. Receipt links already sent to buyers contain the old domain. They work again as soon as the old domain redirects to the new one, so either keep a redirect or tell people.

## Upgrading

```bash
git pull                      # or copy the new files over
docker compose up -d --build  # restart takes about 2 seconds; open pages reconnect by themselves
```

Newer versions fill in missing settings when they start, so older data folders keep working. Take a backup before upgrading anyway.

## Changing passwords

Edit `.env`, then run `docker compose up -d`. Changing the finance password signs out finance only on their next action. Changing `RAFFLE_SESSION_SECRET` signs everyone out at once.

## Starting a new event

Pick one:

- **Keep settings, clear sales.**
  1. Stop the app.
  2. In `raffle.json`, set `sales`, `batches` and `draws` to `[]`, `counter` to `1`, and `stage` to `{"state":"idle"}`.
  3. Start the app.
  4. Review prizes, dates and prices in the app.
- **Completely fresh.** Stop the app, move `raffle.json` aside and start it. Sample prizes are created, and collectors and settings go back to their defaults. Delete `uploads/` too if the QR codes should go.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Container exits immediately | Missing or short secret. The log says which. |
| Header says "Reconnecting…" forever | The proxy is buffering `/api/events`, or blocks long requests |
| Can't stay signed in | Site served over plain http (the cookie is Secure-only) |
| Everyone shares one rate limit | Proxy doesn't pass `X-Forwarded-For` / `CF-Connecting-IP` |
| QR image doesn't show | Uploaded before its collector was saved, or the file is over 2 MB |
| "Ticket sales have closed" | Past **Settings → Ticket sales close**. Clear the field or move the date. |
