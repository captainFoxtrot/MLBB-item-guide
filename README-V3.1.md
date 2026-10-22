# MLBB Item Coach 3.1

Landscape-first eight-item optimizer: six recommended items (purchase order), two alternatives. Five enemy threat toggles plus five relative-strength options. Repeated updates **do not** advance an assumed inventory.

Push notifications are sent on initial build or meaningful top-six changes (entry/exit or first-four priority reorder). Unchanged routes are displayed without duplicate pushes. Existing subscriptions, Shortcut pairing, device tokens, DB and legacy PiP are retained. Existing threat-state JSON is migrated lazily when an update is sent.

## Install

```bash
sudo systemctl stop mlbb-coach
sudo cp -a /var/www/mlbb-item-guide /var/www/mlbb-item-guide.backup-$(date +%Y%m%d-%H%M%S)
cd /var/www/mlbb-item-guide
sudo unzip -o /tmp/mlbb-item-coach-v3.1.zip
bash scripts/cache-item-icons.sh
npm install
npm run check && npm test
sudo systemctl start mlbb-coach
curl -i https://mlbb.mtgrumble.com/health
```

Upload the ZIP to `/tmp` **before** running unzip. The script downloads MLBB item artwork from [Ceplin03's MIT-licensed dataset](https://github.com/Ceplin03/database-mlbb.Mobile-Legends-Bang-Bang). Icons are served locally if downloaded; browser tries the source repository as a fallback and then a placeholder if unavailable. The item data is community-maintained, so confirm artwork and game mechanics against the current patch. Icons are not bundled in the ZIP.

Note: the coach is deterministic, matchup-category-based and is **not** a full patch-specific hero build AI. Review advice for individual heroes, especially atypical builds.
