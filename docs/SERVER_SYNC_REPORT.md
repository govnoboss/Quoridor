# Production source synchronization — 2026-11-23

## Git-based delivery reconciliation

The original checkpoint below is historical. Since it was taken, product metrics
and notification/support fixes were deployed and verified; their current contracts
are in `AI_ANALYTICS.md` and `AI_NOTIFICATIONS.md`.

Before publication, a fresh production inventory compared 571 source/reference
files with the local checkout. Application code matched after CRLF normalization;
the only difference was the additional local retention assessment in
`docs/AI_ANALYTICS.md`. New documentation/tests accompanying the deployed source
must be included in the Git checkpoint. The starting GitHub `main` was `cbcdb2e`,
and the server still pointed at its ancestor `a360008` with uncommitted source.

Restore delivery by publishing the reconciled source to GitHub `main`, preserving
server source and local-only operational files in a private backup, stashing only
the verified source edits, and fast-forwarding the server checkout. The stash is
a recovery checkpoint, not a patch to reapply. No reset/force-push/database restore
is needed. Source reconciliation does not require restarting an already matching
application image. Future changes use commit → push main → `./deploy.sh`.

The prior local CSS draft stash and `design-review/` remain preserved. Generated
`artifacts/`, environment variants and backup files are excluded from publication.
Do not commit production screenshots, credentials, database dumps or runtime data.

## Authority and scope

The owner designated the current production server as the source of truth.
Imported its source into the local `codex/server-source-sync` branch. This is a
source synchronization checkpoint, not a deployment or a retention feature release.

- Production checkout: `/opt/quoridor`, Git HEAD `a3600087f75f45fee644d331bdd0b7eb74a1d962`.
- Local/GitHub base: `cbcdb2e` (one documentation commit after the server HEAD).
- Production had 50 modified tracked files and 22 untracked files. Its effective
  version is therefore not represented by its HEAD commit alone.
- Imported 69 files: the 50 modified files, 18 new source/documentation/test files,
  and the server's `frontend/css/style.css` to replace the local draft safely.
- Excluded `.env.bak.pre-google`, `frontend/index.html.bak`,
  `disable_maintenance.sh`, and `maint-off.sh`. Production `.env`, credentials,
  databases, uploaded avatars and runtime state were not copied or changed.

## Preserved local work

The prior local CSS draft is preserved in Git stash:

- Commit: `d693d4760fd26c078e71a044ad2f97b2d2ded698`.
- Message: `preserve local CSS before production source sync 2026-11-23`.
- The existing `design-review/` directory remains in place and was not imported
  from production or modified by synchronization.

Inspect the saved draft with `git stash show -p d693d4760fd26c078e71a044ad2f97b2d2ded698`.
Do not automatically reapply it over the production baseline.

## Verification performed locally

| Check | Result |
|---|---|
| Imported archive vs local files | 69/69 byte-identical |
| All tracked production files vs local | 536/536 content-equivalent; 391 byte-identical, 145 differ only in Git-normalized line endings |
| Running container `src/`, `frontend/`, canonical rules vs local | 365 files checked; no content differences after CRLF normalization |
| `npm run test:once -- --runInBand` | 20 suites / 357 tests passed; exit 0; 207.345 seconds |
| `npm run perft:assert` in `quoridor-engine/` | All three golden-reference checks passed; exit 0 |
| `npm run lint` | Failed: 50 errors, 100 warnings in the imported baseline |
| `git diff --check` | Passed |
| Credential-signature scan of imported files | No matches for private-key blocks, GitHub tokens or AWS access-key signatures; not a comprehensive secrets audit |

Lint findings include missing browser globals in the configuration, existing empty
catch blocks, prototype-method access, test-global assignments and a control-character
validation regex. They were not suppressed or automatically rewritten as part of
reproducing the authoritative server source. Passing tests do not establish browser,
physical Android or production-data acceptance for future changes.

The production container was only inspected. It was not rebuilt, restarted or deployed.
No Git commit, merge or push was performed. Imported new files remain untracked until
explicitly included in a future commit; they must accompany the changed tracked files.

## Analytics implications

The production ingest already falls back to batch-level `deviceId`, `sessionId` and
`platform`. That correction is now present locally; the older local-only diagnosis
must not be used to add a duplicate fix. Historical identifier coverage still needs
measurement. D1/D7 and weekly-return reports have not been implemented in this checkpoint.

Future retention work must start from this synchronized branch, inspect the current
ingest/event contracts and test doubles, and distinguish guests, signed-in users,
test activity and automated accounts. Do not deploy the former GitHub baseline over
production: it does not contain the authoritative uncommitted production changes.
