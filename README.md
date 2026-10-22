# MLBB Item Coach — automatic screenshots, PiP or push (v2)

Upgrade of the existing Fastify/SQLite/MCP/HLS project. No ChatGPT MCP plugin or paid OpenAI API is required. iOS Shortcut posts screenshots to a server-side free-tier vision provider (Groq primary, Gemini fallback); recommendation is stored in SQLite and appears in PiP or a Web Push notification.

## Requirements

Node >=20, FFmpeg (for PiP), HTTPS (already configured on mlbb.mtgrumble.com), at least one API key. Free-tier quotas/model availability can change. Confirm your model supports image input before deploying. Do not enable provider billing unless you intend to pay. Keep API keys on the server.

## Upgrade the existing Ubuntu instance

1. **Back up** the current app and database (`/var/www/mlbb-item-guide/data/mlbb-coach.sqlite`, including SQLite WAL/SHM if present; safest is to stop the service first).
2. Extract the new ZIP to `/var/www/mlbb-item-guide`, preserving `data/` and your existing `.env`. The DB migration is additive: creates `push_subscriptions` table. Existing games/instructions remain.
3. `cd /var/www/mlbb-item-guide && npm install && npm run check && npm test`
4. Configure environment variables in your systemd service using `EnvironmentFile=/var/www/mlbb-item-guide/.env` (or `Environment=` lines), then `sudo systemctl daemon-reload && sudo systemctl restart mlbb-coach.service`.
5. Verify `curl https://mlbb.mtgrumble.com/health` and test with a real screenshot.
6. To enable push, run `npx web-push generate-vapid-keys` **once**. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:YOUR_EMAIL`. Keep private key secret and persistent. If keys change, existing browser subscriptions must be renewed.

Set at least one of `GROQ_API_KEY` or `GEMINI_API_KEY`. `AI_PRIMARY=groq` by default. Defaults are `GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct` and `GEMINI_MODEL=gemini-2.5-flash-lite`; provider availability can change. On 429/errors, the next configured provider is attempted. API request timeout is 25 seconds per provider. No keys are ever sent to the browser.

## One-tap iPhone Shortcut

1. On `https://mlbb.mtgrumble.com`, create a match, choose PiP or Notifications, open the dashboard. **Treat the match token as a password.**
2. In Apple Shortcuts create: **Take Screenshot → Get Contents of URL**. URL is `https://mlbb.mtgrumble.com/api/games/YOUR_TOKEN/analyze`. Set Method **POST**, Request Body **File** with Screenshot as the input. Set headers `X-MLBB-Token: YOUR_TOKEN` and `Content-Type: image/png` (or `image/jpeg` if converted to JPEG). Configure double Back Tap to trigger this Shortcut. Note: iOS Shortcuts capabilities and screenshots while playing vary by OS/game; test on your device.
3. Screenshot is resized to fit 1400x1400 and sent to Groq/Gemini. AI chooses next item and explanation, then the server writes the instruction and sends push if subscribed.
4. Match page polls the current advice every 2.5 seconds. PiP requires FFmpeg and working Safari HLS PiP. **iPhone PiP is not verified on-device and iOS may suspend playback or reject PiP.**
5. For notifications, install the website using Safari **Share → Add to Home Screen**, launch from Home Screen, choose Notifications and tap Enable. Web Push on iOS requires iOS/iPadOS 16.4+ and a Home Screen web app; users must grant permission. Delivery is subject to iOS settings/Focus and not guaranteed instant. The server sends Web Push; the browser does not need to stay foregrounded.

## API

- `POST /api/games`: create game/token
- `GET /api/games/:token`: latest instruction
- `POST /api/games/:token/analyze`: **raw** PNG/JPEG/WebP bytes; header `X-MLBB-Token: TOKEN`; optional `X-Hero-Hint: Pharsa`; max 5 MiB; cooldown 12 seconds per token. Returns parsed recommendation and provider.
- `GET /api/push/key`: public VAPID key and availability
- `POST /api/games/:token/push`: JSON `{ "subscription": PushSubscription }`
- `DELETE /api/games/:token/push`: JSON `{ "endpoint": "..." }`
- `POST /api/games/:token/new`: start next round
- `/mcp`: original MCP endpoint retained
- `/health`: health check

## Operational considerations

- **Privacy/security:** A match token grants read/write access and is visible in URL paths and possibly server logs. Use long random tokens (existing 18-character hex tokens), HTTPS, don't share links, consider adding per-user authentication before public launch. Provider API requests transmit screenshot images to the selected third party. Disable lock-screen notification previews if desired. Never commit `.env`.
- **Rate limits:** 12-second cooldown and session creation throttle are basic protections, not complete abuse prevention. For a public multi-user service add global/IP quota, auth, bounded concurrent requests, daily usage caps, and user consent for third-party image processing. The current implementation has no automatic provider-spend cap; configure free-tier-only accounts.
- **Model limitations:** Vision may misidentify hero, scoreboard details, items, or current meta. Verify game advice. No official MLBB live API is used. The model is instructed to report low confidence on unreadable screenshots.
- **Push caveat:** MCP-originated `set_instruction` does not currently trigger push; automatic screenshot analyses do. Notifications are per match token and can be disabled from the match page.
- **Testing:** `npm run check`, `npm test`, then a real iPhone test for Shortcut upload, PiP, Home Screen installation and push delivery. These platform behaviors cannot be validated from a Linux development container.
