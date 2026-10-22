# MLBB Item Coach v2.3 — match-aware decisions and delivery diagnostics

Full replacement source package upgrading v2.2. Retains device pairing, iOS Shortcut capture, hero roster and YOU selection, SQLite, MCP, Groq/Gemini, Web Push, and HLS PiP. No `.env` or database files are included.

## What changed

- **Draft/loading:** if YOU and hero are known, a second AI pass proposes a tactical **CORE** item with three core and up to three situational items. A meaningful initial CORE recommendation can generate a push notification.
- **Scoreboard:** vision extracts time, kills, team gold, tower/turtle/Lord counters, player level/KDA/gold and visible enemy equipment when readable. Unreadable values are `null`, never invented. Coaching uses this match state, ordered teams and the authoritative YOU slot to recommend a specific **NEXT** item. Unknown inventory yields provisional advice rather than automatic refusal.
- **Live PiP:** every successful screenshot updates the instruction when its text changes, including draft/loading and waiting states. It is not gated by push eligibility.
- **Push:** mode changes no longer unsubscribe the phone. Existing subscriptions are re-registered for the current match on opening the app; starting another round retains the same match token and subscription. Initial, changed, and CORE-to-NEXT recommendations can push. Repeated identical advice is suppressed **only if the previous push was accepted**; failed/zero-subscription delivery is eligible to retry.
- **Delivery diagnostics:** the screenshot response includes `notificationQueued` and `notification:{enabled,attempted,delivered,failed,expired,errors}`. `delivered` means the push gateway accepted the request, **not** that iOS displayed it. New owner-authenticated endpoints `GET /api/devices/:id/push-status` and `POST /api/devices/:id/test-push` help verify subscriptions and gateway delivery. The app has a **Send test notification** button.
- **UI:** shows extracted match state, item suggestions, and last push result. `detectedHero` is always resolved from saved YOU slot, not the model's independent guess.

## Deploy on Ubuntu

Copy `mlbb-item-coach-v2.3.zip` to `/tmp/mlbb-item-coach-v2.3.zip` on the Ubuntu server. Stop service before backing up SQLite (WAL mode):

```bash
sudo systemctl stop mlbb-coach
sudo cp -a /var/www/mlbb-item-guide /var/www/mlbb-item-guide.backup-$(date +%Y%m%d-%H%M%S)
cd /var/www/mlbb-item-guide
sudo unzip -o /tmp/mlbb-item-coach-v2.3.zip -d /var/www/mlbb-item-guide
npm install
npm run check
npm test
```

Only after both checks pass:

```bash
sudo systemctl start mlbb-coach
sudo systemctl status mlbb-coach --no-pager
curl -fsS https://mlbb.mtgrumble.com/health
```

If validation fails, restore the backed-up directory before starting the service. Keep existing `.env` and `data/` untouched. No Shortcut changes required; keep posting raw PNG/JPEG to `/api/devices/capture` with `Authorization: Bearer <captureKey>`.

## Test push before playing

1. Open the **installed Home Screen web app** on iPhone, select Push notifications, and tap **Enable notifications** (again if necessary).
2. Tap **Send test notification**. The app shows `accepted / attempted`. If `0 / 0`, the server has no subscription. If `0 / 1`, read the returned error. If `1 / 1` but iOS shows nothing, investigate iOS notification permissions, Focus mode and Home Screen PWA context.
3. Select PiP; switching modes **must not** disable notifications. Switch back and repeat the test.
4. Start another match, set your hero with **This is me**, capture draft/loading. Expect `screen=loading|draft`, `adviceType=core`, `nextItem` populated and a concise `CORE:` push if subscribed.
5. Capture scoreboard. Expect `adviceType=next`, matchState fields (unknown fields null), concise `NEXT:` push if the recommendation changes, and PiP updating independently.
6. Run `sudo journalctl -u mlbb-coach -n 120 --no-pager` if provider or push errors occur. Redact API keys and credentials before sharing.

## Operational limits

- Vision/AI recommendations are probabilistic. Confirm item names and tactical accuracy in actual games. Objective values are not trusted when unreadable. A CORE suggestion at loading is a strategic priority, not a confirmed immediate purchase.
- `notification.delivered` counts HTTP acceptance by the push gateway; actual on-device display cannot be guaranteed by a server-side test. Real device testing is still necessary.
- The existing Shortcut install link still requires a separately published iCloud Shortcut; this package does not pretend to install it automatically.
- Live typecheck, dependency install, and tests must run on Ubuntu if unavailable in the packaging environment. The original project has no lockfile, so `npm install` may resolve newer compatible dependency versions.
