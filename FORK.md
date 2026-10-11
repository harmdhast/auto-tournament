# Fork

`custom` is upstream `main` plus the feature and fix branches kept in this fork, merged with `--no-ff`. Each branch also lives on its own, so it can go upstream as a pull request.

## Versions

Tags are `vX.Y.Z-custom.N`, where `X.Y.Z` is the upstream version `custom` is based on. Pushing a tag builds `ghcr.io/harmdhast/auto-tournament:<tag>` (and `:custom`) for linux/amd64 (`.github/workflows/custom-image.yml`). The tag is the version baked into the image.

CS2 ships as a signed module in the image's offline snapshot. The workflow signs it with the repository secret `MODULE_SIGNING_KEY` (Ed25519 private key, PEM) when set, and instances need `MODULE_TRUSTED_KEYS=<the public key>`. Without the secret a throwaway key is used and the job summary prints the key to trust.

## Migrations

`custom` keeps every branch migration's id and SQL unchanged, appended after upstream's list in merge order. Merging the same branch upstream later is then a no-op on a database that ran `custom`. If upstream ships a branch with different ids or SQL, the database needs a manual reconcile.

Fork-only migrations (`api/src/integrations/cs2/migrations.ts`, after upstream's `043-recorder-host-identity`):

| id | branch |
|---|---|
| `037-fleet-availability-reason` | feat/fleet-busy-reason |
| `040-server-failover-use` | feat/failover-server-opt-out |

Their numbers overlap upstream's `037-*` and `040-*` ids; ids are unique strings and the runner applies the list in array order, so only the full id matters.

## Workflow

- New work: branch from `upstream/main`, merge into `custom` with `git merge --no-ff`.
- Work that needs code only `custom` has: branch from `custom`, and rebase onto `upstream/main` before proposing it.
- Sync upstream: `git merge upstream/main` into `custom`. Never rebase `custom`.
- Keep `git config rerere.enabled true`.

## Branches

Conflicts are relative to upstream `main` at 98d57326 (2.4.15) and the branches merged before.

| Branch | Summary | Status | Conflicts vs upstream | Conflicts with other branches | Resolved in custom |
|---|---|---|---|---|---|
| fix/fleet-no-rcon-match-report | Skip the RCON match report on Ready Up servers | merged | none | none | |
| fix/delete-tournament-frees-servers | Ending a match on its server frees the server | merged | none | none | |
| fix/fleet-outbox-after-server-reset | A reset server gets pending platform messages renumbered | merged | none | none | |
| fix/match-modal-reopens | Closing a match's details closes it once | merged | none | none | |
| fix/reserve-ignores-practice-servers | Failover reserve ignores practice servers | merged | none | none | |
| feat/played-current-matches | Current matches in `/api/matches/played` | merged | none | none | |
| feat/fleet-assign-match-id | `match.assign` sends the DB match id as `config.id` | merged | none | none | |
| feat/fleet-busy-reason | Fleet views say why a server is busy or held as spare | merged | cs2 `migrations.ts` | none | Branch migration appended after upstream's list |
| feat/readyup-fleet-section | Ready Up fleet as a section with tabs, one panel per server | merged | `Servers.tsx` | none | Upstream's Fleet settings side sheet and button dropped (the section holds those panels), upstream's free-license server limit kept |
| feat/fleet-reset | Reset a Ready Up server and settle its match | merged | `docs/API-REFERENCE.md` | `docs/API-REFERENCE.md` | Regenerated |
| feat/fleet-rcon-parity | Kick, console and player list for Ready Up servers | merged | `docs/API-REFERENCE.md` | `docs/API-REFERENCE.md` | Regenerated |
| feat/servers-one-list | One server list, tiles and chips shared with Manage | merged | cs2 locales (10 files) | cs2 locales | Keys of both sides kept (3-way JSON merge) |
| fix/failover-confirm-before-fence | A live server is not superseded while its match moves; fence after accept | merged | `driver.ts`, `fleet-failover.spec.ts` | `driver.ts`, `fleet-failover.spec.ts` | Both helpers in `driver.ts`; both sets of tests kept |
| feat/failover-server-opt-out | Servers can opt out of failover | merged | cs2 `migrations.ts`, `allocation.ts`, `fleet/failover.ts`, `routes/failover.ts`, `fleet-failover.spec.ts` | `allocation.ts`, `failover.ts`, `routes/failover.ts`, `fleet-failover.spec.ts` | Migration appended; opted-out servers excluded from the reserve and from automatic targets; settings view uses `heldFleetSpares` plus `failoverFree`; tests kept |
| feat/failover-spares-and-chunks | The shown spare is the one failover picks; large backups sent in parts | merged | cs2 `fleet/protocol/v1/types.ts`, `migrations.ts` | `fleet/failover.ts`, `fleet-failover.spec.ts` | `heldIn` ignores opted-out servers, targets filtered with `failoverTargets` before `pickTarget`; tests kept |
| fix/round-backup-guards | Drop backups outside live play, cap the resume round | merged | fleet `README.md` | `fleet/failover.ts`, `failoverPlan.ts`, fleet `README.md`, `fleet-failover-plan.spec.ts` | Imports and docs of both sides kept |
| feat/fleet-key-auto-link | A fleet key links the servers it enrolls on first hello | superseded by #658 | | | not merged |
| feat/fleet-key-skins | A fleet key turns skins on for the servers it enrolls | superseded by #663 | | | not merged |
