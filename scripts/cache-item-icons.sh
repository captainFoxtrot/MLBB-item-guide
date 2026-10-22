#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
mkdir -p public/item-icons
BASE='https://raw.githubusercontent.com/Ceplin03/database-mlbb.Mobile-Legends-Bang-Bang/master/logo-equipment'
items='arcane_boots genius_wand holy_crystal swift_boots corrosion_scythe demon_hunter_sword tough_boots hunter_strike blade_of_despair flask_of_the_oasis enchanted_talisman dominance_ice athenas_shield queens_wings war_axe golden_staff malefic_roar sea_halberd wind_of_nature rose_gold_meteor immortality haass_claws malefic_gun endless_battle antique_cuirass divine_glaive blood_wings glowing_wand winter_crown wishing_lantern concentrated_energy lightning_truncheon starlium_scythe sky_piercer oracle radiant_armor blade_armor cursed_helmet guardian_helmet twilight_armor'
count=0
for item in $items; do
  file="public/item-icons/$item.png"
  if [ -s "$file" ]; then continue; fi
  if curl -fsSL --retry 2 --connect-timeout 5 --max-time 15 "$BASE/$item.png" -o "$file"; then
    count=$((count+1))
  else
    rm -f "$file"
    printf 'Icon unavailable: %s\n' "$item" >&2
  fi
done
printf 'Downloaded %s icons. Existing icons retained.\n' "$count"
