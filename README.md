# MLBB Item Coach v2.1 — Device pairing + editable draft lineup

Upgrade of v2.0 (Fastify, SQLite, MCP, Groq/Gemini, push, HLS PiP). Designed for the deployed instance at `mlbb.mtgrumble.com`. The original `/mcp`, legacy `/api/games/:token/analyze`, game page and push endpoints remain available.

## What changed

- Browser creates a persistent device with an **owner credential** (stored in the Home Screen web app's localStorage).
- Pairing creates a **separate capture credential** for the iPhone Shortcut, using a **single-use 10-minute pairing code**. The server stores SHA-256 hashes of credentials, not the raw secrets.
- `POST /api/devices/capture` accepts raw screenshot bytes with `Authorization: Bearer CAPTURE_KEY`. It resolves the active game automatically. Existing match-token capture remains for migration.
- Draft/loading/scoreboard AI responses include ordered hero slots, 0–4 for allies and enemies. Slots are rendered in two five-row columns and do not reorder between screens.
- Searchable hero picker and explicit **This is me** selector. The selected ally receives a gold **YOU** outline. Manual hero and player-slot selections are locked against AI changes until the next match.
- Low-confidence, draft and loading screenshots update the roster but **do not replace actionable advice or send push notifications**.
- Database migration is additive (`devices`, `pairing_codes`, `hero_rosters`); existing matches, push subscriptions and instructions remain.
- Default Groq model changed to `qwen/qwen3.8-27b`, but `.env` settings override it.

## Safe deployment on Ubuntu

**Back up the entire project and SQLite database before replacing files.** Stop the service first for a consistent SQLite backup (including any WAL data):

```bash
sudo systemctl stop mlbb-coach
sudo cp -a /var/www/mlbb-item-guide /var/www/mlbb-item-guide.backup-$(date +%Y%m%d-%H%M%S)
cd /var/www/mlbb-item-guide
# Upload ZIP to /tmp/mlbb-item-coach-v2.1.zip first.
sudo unzip -o /tmp/mlbb-item-coach-v2.1.zip -d /var/www/mlbb-item-guide
# The ZIP deliberately excludes .env and data/.
npm install
npm run check
npm test
sudo systemctl start mlbb-coach
sudo systemctl status mlbb-coach --no-pager
curl -fsS https://mlbb.mtgrumble.com/health
```

If check or tests fail, **do not start the upgraded service**; restore the backup first. Keep `.env` and `data/` from the existing installation. Ensure the systemd `EnvironmentFile` still loads your Groq and VAPID keys. Nginx `client_max_body_size 10M` is already configured; Fastify limits are 10 MiB.

## Device onboarding

1. Open the website from the **Home Screen web app**. Existing v2 users may need to navigate to `/` and create a v2.1 device; legacy token sessions remain accessible but cannot be retroactively assumed to belong to a new device.
2. Tap **Create my device**. A browser-only owner credential is stored locally and the device's first match is created.
3. On the match page, tap **Generate pairing code**. Code expires after 10 minutes and is single-use.
4. Install/create a Shortcut. On first run it POSTs `{ "code": "..." }` as JSON to `/api/devices/claim`, receives `{ "captureKey": "..." }`, and saves the key privately in Shortcuts' iCloud Drive folder.
5. On future runs it takes a screenshot and POSTs it as a raw file to `/api/devices/capture` with `Authorization: Bearer CAPTURE_KEY` and `Content-Type: image/png`.
6. Set **Settings → Accessibility → Touch → Back Tap → Double Tap** to the capture Shortcut. Use the site's notification control to enable push for the device's match.
7. Each new match clears hero slots while preserving device pairing and push subscription.

The on-site `/shortcut-setup.html` provides the manual Shortcut actions. The optional `SHORTCUT_INSTALL_URL` environment variable adds an **Install MLBB Shortcut** link to a published iCloud Shortcut. **The ZIP does not contain a signed or published iOS Shortcut**; the installation/pairing cannot be one-tap until that link and first-run storage workflow have been created and tested on an iPhone. Apple also requires explicit user approval for installing Shortcuts and selecting Back Tap.

## API additions

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| POST | `/api/devices` | creation rate limit | Create device + initial match, return `{id, ownerKey, gameToken}` once |
| GET | `/api/devices/:id` | `Authorization: Bearer OWNER_KEY` | Device state, active game and roster |
| POST | `/api/devices/:id/pair-code` | owner | Generate 10-minute single-use code |
| POST | `/api/devices/claim` | one-time code in JSON body | Exchange code for capture credential |
| DELETE | `/api/devices/:id/pair` | owner | Revoke capture credential |
| POST | `/api/devices/:id/new` | owner | Reset current match and lineup |
| PATCH | `/api/devices/:id/roster` | owner | `{index:0..9,hero:"Pharsa"}` or `{you:0..4}` |
| POST | `/api/devices/capture` | capture Bearer credential | Raw PNG/JPEG/WebP bytes, active match inferred |
| GET | `/api/heroes` | public | Searchable canonical hero names |
| GET | `/api/setup` | public | Optional published Shortcut install URL |

## Security and caveats

- **Treat owner and capture keys as passwords.** The owner key is stored in localStorage; browser-data deletion loses access. The capture key is kept in a private iCloud Shortcuts file. Never log or screenshot either key.
- Pairing code is valid for 10 minutes and consumed once; generating another invalidates the previous code. Revocation invalidates the Shortcut key immediately.
- Existing token-based endpoints remain for compatibility and are not protected by the new device owner credential. Before launching publicly, add global rate limits, authenticated users, storage quotas, CSRF/origin protection where appropriate, and remove or restrict legacy endpoints.
- Hero detection from screenshots is probabilistic. The AI may misread the screenshot's visual orientation or player highlight. Manual corrections take precedence. The roster does not rely on an official MLBB API.
- **Unverified here:** full npm install/check/test on Ubuntu, on-device iOS Shortcut pairing, notification delivery after v2.1 migration, and exact draft layout across all MLBB modes. Test on the live device before relying on it.
