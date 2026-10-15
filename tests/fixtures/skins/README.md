# Skin catalogue fixture

`skins.json` is a trimmed copy of csm's skin export, `skin_images/skins.json` in
https://github.com/Auto-Tournament/cs2-server-manager (master, fetched 2026-10-14): one skin per
rarity for every weapon, plus the Karambit Doppler and Sapphire finishes. The `weapon_decoy` entry
is made up: it has no definition index, so tests can check that such weapons are refused.

The names and paint kits describe Valve's game content; the repository's licence does not cover
them. The fixture only serves tests (`scripts/serve-skins-fixture.mjs`, `SKINS_JSON_URL`).
