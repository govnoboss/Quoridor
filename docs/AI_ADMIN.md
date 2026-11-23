# Administration: stage 1 reliability

## Notifications and support audit — 2026-11-23

Historical read-only production inspection and local reproductions. The audit
below describes the pre-fix behaviour. The subsequent implementation and current
contracts are in `AI_NOTIFICATIONS.md`; deployment evidence is recorded there.

Production source hashes matched local source for `src/server.js`, `ui.js`,
`net.js`, `site-shell.js`, `reports.html`, `admin-reports.html`, `Notification.js`
and `mailer.js`. Database inspection returned aggregates only, without ticket
contents, usernames, email addresses or account identifiers.

### Confirmed defects and gaps

1. **High — HTTP notification loading ignores successful responses.**
   `GET /api/notifications` returns `{notifications,total,page,limit}`;
   `UI.loadNotificationsFromServer` accepts only an array. Socket connection can
   mask the bug by loading up to 20 unread notifications; it does not restore the
   complete read/unread history. Fix the envelope handling and provide pagination
   or a notification history page; maintain one consistent API/socket store.
2. **High — quick reply is destroyed when its textarea is clicked.**
   An unread notification's ancestor click calls `markNotifRead`, which removes
   `.notif-actions`. Reply/Send stop propagation, but the textarea does not.
   Read admin messages also have no reply action or link to their report. Preserve
   actions independently of read state and make the report conversation reachable.
3. **High — new bug/support report does not alert administrators.**
   `POST /api/reports` saves the ticket without calling `createNotification`.
   Follow-up user replies do create `bug_report_update`; player complaints use a
   separate `user_report` notification. Add an administrator notification for new
   support tickets and a link to the precise ticket, with retry-safe delivery.
4. **Medium — read/send failure is hidden and can lose actions/drafts.**
   `markNotifRead`/`markAllNotifRead` update UI immediately and ignore failed HTTP
   status; quick reply ignores non-2xx/network errors and has no pending guard.
   Keep drafts, surface errors and apply read/action changes after acknowledgement
   or roll them back. The administrator reply button also lacks a pending guard.
5. **Medium — expired/failed game invitations remain misleadingly actionable.**
   Stored game invitations have no expiry field/filter. Join marks read before
   acceptance; server emits `inviteFailed` for offline/version failures, but the
   client has no handler. Add acknowledgement/error UI and explicit invitation
   lifecycle/expiry; do not mark a failed action as successfully handled.
6. **Medium — notifications are absent from the shared standalone header.**
   `site-shell.js` renders authentication/profile links but no notification centre
   or socket subscription. Replies on `/profile/reports` do not refresh live and
   do not mark the associated notification read. Closed tickets hide the reply UI,
   although the reply API permits the owner to reopen by replying. Align the flows.
7. **Capability gap — no offline re-engagement delivery was found.**
   Notifications are MongoDB records delivered over Socket.IO while connected,
   then loaded when returning to the main app. No Web Push subscription/service
   worker, FCM/Capacitor push integration or support-reply email sender was found
   in the audited source. The mailer only handles password reset. This does not
   establish the behaviour of a different installed Android build.

`createNotification` saves the record, increments the cached unread count and
emits sequentially; failures are caught and return null, without retry/outbox.
Database persistence therefore does not prove socket receipt or human reading.
`Notification.read` represents an API mark-read action, not confirmed message view.

### Evidence

- Five local VM/DOM reproductions confirmed envelope loss, textarea click bubbling,
  hidden HTTP-500 read failure, missing actions after read, and replacement of
  cached history by a 20-row socket snapshot. They reproduce defects; they are
  not five passing acceptance cases for correct product behaviour.
- Seven isolated Express checks, executing the actual route source with mocked
  persistence/sockets, confirmed the new-ticket notification gap, admin/user reply
  notification paths, HTTP envelope, foreign/anonymous reply rejection and closed
  ticket reopening. They do not prove actual email/push/socket delivery to a device.
- Production: 801 existing account unread caches matched their actual unread
  records, with zero negative caches. Notification totals: 9 admin replies (2
  unread), 67 friend requests, 15 accepted requests, 858 game invites (774 unread;
  none created in the last 28 days), 507 rematch requests and 1 player complaint.
- Support: 11 tickets, 10 closed and 1 in progress; 9 tickets have an admin reply,
  2 have none and are older than 48 hours. Median time to first recorded admin
  reply among the 9 answered tickets: 16.1 hours. Of 11 admin messages, 9 have a
  matching retained notification. This historical mismatch does **not** prove
  delivery failure: notifications may have been deleted or older code may differ.
- Existing reply creation/persistence and cached counts work in observed cases;
  complete delivery, visibility and response usability do not work consistently.
  No messages were sent to production users during this audit.

Recommended implementation order: envelope/history + reply usability; new-ticket
alerts + visible errors/acknowledgement; invitation expiry and shared access;
then opt-in offline reply/invitation delivery with delivery/open/action metrics.

Deployed on 2026-11-22; release/backup details are in `DEPLOY.md` and post-deployment verification is recorded below. Routes remain in `src/server.js`; pure settings/complaint policies live in `src/admin/policy.js`. The source audit and reproductions preceding the fix are in `artifacts/admin-audit/` and describe the old behavior.

## Bans and session revocation

`POST /api/admin/users/:id/ban` validates the ObjectId, optional string reason and duration. Duration is an integer 0–36500 days; omitted/null/0 means permanent. Reasons are stored up to 500 characters. Self, administrator and bot bans are rejected.

The database update sets the ban and increments `User.sessionVersion` atomically. The current process's session-version cache is updated using the canonical database user ID. Every matching connected socket receives `forceDisconnect` and is then disconnected **by the server**, irrespective of client cooperation. Ordinary disconnect/game-clock policy still governs the remaining match; a ban does not reset or refund clocks.

Old HTTP sessions fail their `sv` check on subsequent requests. Login checks the ban; unbanning never decrements the version or revives revoked cookies. A fresh login is required. Active legacy bans/missing users also invalidate HTTP sessions when the version cache refreshes. `requireAdmin` independently checks the current ban even when the version cache was primed.

Socket authentication additionally checks remembered token-to-account mappings. A banned/deleted account's existing token cannot reconnect with cookies cleared. Full game recovery and move application check token ownership's ban status as well. Fresh anonymous guests are not an IP/device ban.

The existing version cache is local with a 60-second TTL. Immediate cache invalidation and socket disconnection described here apply to the current single-app deployment. Multi-process/replica revocation needs shared invalidation and cross-instance socket coordination before scaling.

## Bot settings

MongoDB `BotSettings` is authoritative after initial creation. Environment values are defaults only; startup and GET no longer overwrite saved flags/delays. Valid environment zeroes remain zeroes. Startup calls `applyPersistedBotSettings()`, also exported for integration tests.

`GET /api/admin/bots` reads the saved configuration, or returns defaults when no record exists. It neither creates a settings record nor changes runtime configuration. Startup persists initial defaults when necessary.

`PUT /api/admin/bots/settings` accepts partial updates: omitted configuration fields retain their saved values. Boolean fields must be JSON booleans; numeric fields must be safe integers no greater than 2147483647. Negative numbers retain the previous normalization to zero, maximum delays are raised to their corresponding minimum, and `recentWindowMs` is at least 60000. IDs/document metadata from the request are ignored. Invalid input returns 400. Mongoose validators run on update.

Runtime configuration is applied only after persistence succeeds. A database failure returns 500 and does not apply the requested runtime change. Concurrent administrative saves still use last-write-wins; this stage does not add a settings revision protocol.

The bot page polls every ten seconds without filling an already loaded settings form or replacing its status message. Inputs and Save remain disabled until a successful initial load; a background poll can recover an initial failure, fill the form once and enable editing. Input edits mark the form dirty. Reload asks before discarding dirty values. A save response fills inputs only if they were not edited while it was pending; otherwise it confirms the saved snapshot and keeps newer unsaved edits.

`POST /api/admin/bots/recalc` returns the **actual number** of updated bots. Calculation/persistence failure returns 500 rather than a success count. Recalculation at startup remains explicitly best effort. Batch recalculation is not transactional: a failure can occur after some bots were updated.

## Player complaint transitions

`PATCH /api/admin/user-reports/:id` accepts `in_progress`, `resolved` or `dismissed`. Any current status can move to these statuses; moving a completed complaint to `in_progress` reopens it.

- `in_progress`: `resolvedBy` and `resolvedAt` are null, including on reopen.
- `resolved`/`dismissed`: record the acting administrator and completion time on transition.
- An omitted `adminNote` preserves its value; a supplied note must be a string of at most 1000 characters and is trimmed. The UI pre-fills the existing note.
- Repeating the same status/note does not change timestamps or add a duplicate audit entry. Editing only a closed complaint's note preserves its original completion metadata.
- A legacy `in_progress` complaint with erroneous completion metadata is repaired when saved again. There is no automatic bulk migration.
- The current UI sends optional `version` (the card's loaded Mongoose `__v`). A stale card returns 409 rather than overwriting a later decision; an identical already-applied status/note remains a safe no-op even on retry. Version must be a non-negative integer. Old clients omitting it retain the server-side compare-and-update guard. Updates also compare the server-loaded status and `__v`, then increment `__v`, preventing simultaneous write conflicts. Missing records return 404 and invalid input/IDs return 400.

Audit actions distinguish `user_report_in_progress`, `user_report_resolved`, `user_report_dismissed` and `user_report_note_updated`. `AdminLog.target` references the reported **User**; `details.reportId` identifies the complaint and details contain previous/new status. New enum values require no data migration. Historical incorrectly classified log entries are unchanged.

## Client errors and repeated submissions

All seven admin pages load `frontend/js/admin-api.js?v=1.0.0` before their inline code. `AdminAPI.fetch(url,options)` wraps fetch, preserves successful Response objects and rejects non-2xx responses with an Error containing the server's message and numeric `status`. Network and non-JSON proxy errors receive readable fallback messages. There are no automatic mutation retries.

Identical pending mutation method/URL pairs are blocked; the initiating focused button is disabled during the request and restored on success/failure. Existing page success handlers run only for successful HTTP responses. Failed operations leave dialogs, notes/replies and edited settings available, and show the failure. A 409 does not silently reload and erase notes. This is not general idempotency for all admin endpoints or a replacement for server concurrency controls.

Stage 1 did not redesign layouts, user filtering/pagination, metric definitions, role/delete workflows or the full audit-log coverage. The subsequent local UI revision below addresses layouts and online filtering. No production admin data was changed during development.

## Validation

- `tests/admin-stage1.test.js`: real Express/session/Socket.IO integration with isolated Mongo-model and Redis doubles; ban/cache/session/token revocation, settings persistence/runtime behavior, permissions, complaint lifecycle/concurrency and recalculation failure/count.
- `tests/admin-client.test.js`: existing inline page functions in a DOM fixture plus the shared HTTP helper; error statuses, proxy/network failure, repeat submissions, dirty settings, in-flight edits and text retention.
- Run these with the existing API, Socket.IO and Google-auth suites, followed by the full suite.

Verified on 2026-11-22: **20 suites / 355 tests passed**, including 35 new admin integration/client cases. Full results are in `artifacts/admin-audit/stage1-full-results.json`; focused new cases are in `stage1-new-results.json`. ESLint passed for the new policy, shared HTTP helper and both new test files; syntax checks passed for the server and all seven inline admin scripts, as did `git diff --check`. This is not a claim of repository-wide lint cleanliness. The test runner reports a delayed-exit/open-handles warning; all assertions pass and it exits successfully.

These automated checks do not establish authenticated production UI acceptance or physical Android/WebView behavior. Deploy backend, model, the new policy module, all admin HTML files and `admin-api.js` together; preserve MongoDB/Redis data.

## Production deployment and verification — 2026-11-22

Deployed 20 selected source/client/test/documentation files, after comparing existing changes on the server. Rebuilt/recreated only `app`; MongoDB and Redis containers/volumes remained running. Backup: `/opt/quoridor-admin-stage1-backup-20261122T175756Z`; previous image: `quoridor-app:pre-admin-stage1-20261122T175756Z`; deployed image: `sha256:882b393a2861f14bf6e6ced733f03c869f1bc5bb7bea387eedc51d9e70e3f4e3`. New source directories/files were explicitly made readable by the image's normal user before switching.

Post-deploy public HTTPS checks passed: health, all eight admin HTML/JS asset hashes, 14 unauthorized page/API GETs and three unauthorized mutation attempts returning 401. A separate untimed guest room accepted a legal move and completed by surrender. Report: `artifacts/admin-audit/deployment-public-20261122.json`.

The 35 new admin tests also passed **on the server**, in an isolated image derived from the deployed app. Test tooling lives separately under `/test-tools`, preserving production dependencies under `/app/node_modules`. It ran read-only, with networking disabled, writable temporary test output and mocked data/session stores; it had no production credentials or database access. This covered authenticated admin/user permissions, bans and token/session revocation, settings/polling/failures, complaint versions/statuses and client error behavior. Report: `artifacts/admin-audit/deployment-image-tests-20261122.json`.

Read-only snapshots of the real saved bot configuration, including `updatedAt`, had identical hashes before and after startup. No working bot settings, users or complaints were changed by admin verification. The synthetic guest game creates its ordinary guest archive entry. Observed container restart count was 0 and no matching admin/auth/rating error markers were found in the post-startup log window. Authenticated UI checks against the live database and physical-phone acceptance remain manual checks; no production admin account/session was created for testing.

## Administration UI revision — deployed 2026-11-22

All seven pages share `/css/admin.css?v=1.0.0` and deferred `/js/admin-shell.js?v=1.0.0`, with the existing design tokens. The shell owns grouped navigation, the current-page indicator, mobile menu, skip link, table scroll regions and modal accessibility. Page scripts retain data loading and mutations through AdminAPI. Do not duplicate the shell in individual pages.

- Desktop: persistent sidebar, breadcrumbs, summary cards and consistent panels. Overview labels distinguish human accounts, bot accounts, registered online users and registrations including bots; underlying metric definitions are unchanged.
- At widths up to 1023px navigation becomes a drawer with a backdrop. Keyboard focus moves into the menu, is trapped while it is open and returns to the trigger on Escape. Main content is inert while a menu or dialog is open.
- Detail dialogs use side panels on desktop and full-width panels on phones. Nested ban confirmation stays above the player panel; only the top dialog is interactive. Escape closes one layer, Tab remains inside it and focus returns to its initiating control. Tables scroll inside their own labeled keyboard-accessible regions.
- Players: search/filter resets pagination; Online uses `GET /api/admin/users?online=true`, applied by MongoDB before pagination/count. Page count uses the returned limit. A rating of zero remains zero.
- Bots: activity and presence are separate from settings; settings retain the stage-1 dirty-form protections. The account table has local name/seed search and uses DOM text nodes/listeners for names, including apostrophes. Population maintenance is collapsed and asks for confirmation before seed/recalculation operations.
- Support reply, complaint note and ban fields have explicit labels. Existing role/delete flows and mutation dialogs retain their original server policies.

Validation: **20 suites / 357 tests passed**, including **37 admin client/integration cases** (`artifacts/admin-audit/redesign-full.json`). New regression cases cover online filtering before pagination and safe bot rendering/search with apostrophes and zero ratings. ESLint passed for the shell and both admin test files. Browser checks covered all seven pages using an isolated local fixture with sample data, phone layouts at 390px and nested dialogs at 320px, menu focus, Escape, Tab wrapping and focus restoration. No console errors were observed in the preview. Screenshots: `artifacts/admin-audit/admin-redesign-desktop.jpg` and `admin-redesign-mobile.jpg`.

Preview checks do not establish authenticated production UI or physical Android/WebView acceptance. The redesign was deployed after the stage-1 release described above. No database migration is needed.

### UI production deployment and verification

Deployed 16 selected source, test and documentation files after comparing against the previous production payload on the server. The seven HTML pages, shared CSS/shell and server online-filter change were released together. Unrelated local game styles were excluded. Only `app` was rebuilt/recreated; MongoDB, Redis and their volumes remained running.

Backup: `/opt/quoridor-admin-ui-backup-20261122T184320Z`, containing project and actual production MongoDB/Redis snapshots (private permissions). Previous image: `quoridor-app:pre-admin-ui-20261122T184320Z`; deployed image: `sha256:ff22f1f9c8a57bceb40bfd930b40be17e741b470196503643c62b7e618da90e7`.

Post-deploy HTTPS verification passed: health, **9 exact asset hashes**, **17 anonymous authorization checks** (14 GETs and 3 denied mutation attempts), plus an untimed guest room/legal move/surrender. Report: `artifacts/admin-audit/deployment-ui-public-20261122.json`. The first health check encountered the startup window; the complete retry passed after initialization.

The deployed image also passed **2 suites / 37 tests** in a separate derived image with no network, read-only filesystem, temporary output and mocked persistence. The test process emitted the known delayed-exit warning and exited successfully. Server results: `/tmp/admin-ui-test-output/results.json`; summary: `/tmp/admin-ui-release-20261122/verification.json`. Saved bot settings and `updatedAt` hashes were identical before/after startup. Container restart count: 0.

No privileged production UI writes were used for acceptance; authenticated live UI and physical Android/WebView checks remain unverified. Prior responsive screenshots show local sample data. Deployment documentation was synchronized on the host after verification without another application restart.
