# MLBB Item Coach 3.0 — Landscape Threat Board

This is a drop-in upgrade from 2.3.1. It retains your existing SQLite database, paired screenshot Shortcut, existing push subscriptions, screenshot analysis and legacy PiP page.

## Workflow

1. Open the Home Screen app (landscape is recommended), or `https://mlbb.mtgrumble.com/`.
2. Send **one loading-screen screenshot** using the paired Shortcut. If hero detection misses a slot, use **Edit draft** to select **your hero** and **five opponents** manually. Allied teammates are not needed.
3. Once the core is purchased, mark opponents **Weak**, **Gaining** or **Strong**. Unmarked means no special observation. Ratings persist until changed.
4. Tap **Send update**. The coach assumes its three-item core is already owned, selects `NEXT`, `SWAP` or `KEEP`, and sends a push notification.
5. On the **following** update, the previous NEXT/SWAP is assumed completed. Core slots are protected when possible; with a full inventory, the coach will only swap for a sufficiently strong counter. Use **Correct** to remove an incorrect assumption or cancel a pending purchase.
6. **New match** resets draft, threat ratings, core and inventory. Device pairing and push subscriptions remain.

The v3 threat engine is deterministic, built from hero roles, threat categories and item effects. It does **not** invoke Groq for threat-button updates. This prevents screenshot misreads and rate limits during gameplay. The optional loading screenshot still uses the v2.3.1 vision path. Counter rules are a practical baseline, not patch-verified live item statistics; review the item catalog as MLBB patches change.

## Deploy on Ubuntu

```bash
sudo systemctl stop mlbb-coach
sudo cp -a /var/www/mlbb-item-guide /var/www/mlbb-item-guide.backup-$(date +%Y%m%d-%H%M%S)
cd /var/www/mlbb-item-guide
sudo unzip -o /tmp/mlbb-item-coach-v3.0.zip
npm install
npm run check
npm test
sudo systemctl start mlbb-coach
sudo systemctl status mlbb-coach --no-pager
curl -i https://mlbb.mtgrumble.com/health
```

If `npm run check` or `npm test` fails, **do not restart the service**. Restore from the backup and share the error. The new `threat_states` SQLite table is created automatically and leaves existing tables intact.

## Routes

- `/game/:token` — new landscape threat board
- `/classic/:token` — preserved v2.3.1 screenshot, roster and PiP page
- `POST /api/devices/:id/threats` — authenticated threat update and push
- `PATCH /api/devices/:id/inventory` — authenticated assumption correction

## Important caveats

- The device owner credential remains stored in browser localStorage; don't share your match URL or credentials.
- A screenshot might still misread a hero. Check the five enemy names before first send.
- iOS Home Screen push support depends on installation and notification permission; use the existing push test in Settings.
- The game itself is never read or controlled; this is an external advisory tool.
