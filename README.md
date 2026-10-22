# MLBB Item Coach v2.3.1 — single-pass screenshot coaching

Full source replacement for v2.3, preserving device pairing, iPhone Shortcut capture, persistent SQLite data, roster and YOU selection, MCP, PiP, and Web Push. This archive does **not** include `.env`, API keys, or the database.

## Changes

- **One AI request per screenshot** instead of a vision call followed by a second coaching call. One compact JSON response includes screen, unlocked hero slots, verified match signals, and a tactical `CORE:` (draft/loading) or `NEXT:` (scoreboard) recommendation.
- **Groq budget:** `max_completion_tokens` reduced from 2,200 per call to 700 for the single Groq call. The provider still has a 1,000 output-token/minute account limit, so repeated screenshots may be rate-limited. The application recognizes HTTP 429, reads the provider's suggested cooldown, skips Groq temporarily, and tries configured Gemini if available. It does not hammer the same model with immediate retries.
- **Provisional local fallback:** if no AI provider is available, use the **saved roster**, hero archetype, and confirmed enemy heroes to choose a conservative item for supported heroes. Fallback advice is explicitly marked low-confidence/provisional; no game statistics are fabricated. A previously recognized screen is retained when the provider is unavailable. On a brand-new match with no recognized screen or hero, the application waits rather than inventing context.
- **Vision validation:** clock must be MM:SS; invalid or unreadable counters become null. Ignore unsupported free-text notes and unverified enemy equipment. Reject obviously cross-role player inventory rather than accepting it as verified. The AI is instructed to return only legible information.
- **Notifications:** existing push and PiP pathways remain unchanged. Both can receive provisional fallback coaching when the roster and stage are known. The response retains `notificationQueued`, `notification`, `adviceStatus`, and `provider` fields.
- **TypeScript stream fix:** corrects the `ChildProcessWithoutNullStreams` mismatch in `src/stream.ts` reported on v2.3 deployment.

## Deploy to the existing Ubuntu server

Upload `mlbb-item-coach-v2.3.1.zip` to `/tmp/` first. Then:

```bash
sudo systemctl stop mlbb-coach
sudo cp -a /var/www/mlbb-item-guide /var/www/mlbb-item-guide.backup-$(date +%Y%m%d-%H%M%S)
cd /var/www/mlbb-item-guide
sudo unzip -o /tmp/mlbb-item-coach-v2.3.1.zip
npm install
npm run check
npm test
```

Only if both checks pass:

```bash
sudo systemctl start mlbb-coach
sudo systemctl status mlbb-coach --no-pager -l
curl -i https://mlbb.mtgrumble.com/health
```

**Keep** the existing `.env` and `data/` directory. No changes to the Shortcut, push subscriptions, pairing code, or Nginx are expected.

## Test

1. In the Home Screen app, send a **test notification**. Confirm the iPhone displays it.
2. Start another match, mark YOU, and send a draft/loading screenshot. Expect `CORE:` advice and a notification.
3. Send a scoreboard screenshot. Expect `NEXT:` advice, conservative match-state fields, and a notification if the recommendation or stage changes.
4. If Groq returns 429, the response should use `local:fallback` or `local:provisional` when a known hero and recognized stage are available. `confidence` is low and `adviceStatus` is provisional.
5. Check `sudo journalctl -u mlbb-coach -n 100 --no-pager -l` for unexpected provider errors. Redact secrets before sharing logs.

## Validation limitations

- Static TypeScript syntax transpilation and 11 focused coaching unit tests passed in the packaging environment. A full dependency-backed `npm run check` and `npm test` could not be completed here because npm dependencies were not installable in this environment. **Run both on Ubuntu before restarting the service.**
- Provider output and live iPhone notifications require server/device testing. Web Push gateway acceptance does not guarantee an iOS banner.
- Screenshot vision remains probabilistic; do not treat extracted score/objective numbers as independently verified. Local fallback uses only known hero matchups, not unverified match statistics.
