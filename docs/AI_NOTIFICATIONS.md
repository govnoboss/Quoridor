# Notifications and support conversations

Implementation: `src/notifications/service.js`, `routes.js`, registered from
`src/server.js`; shared clients `notifications.js` and `support-client.js`.

## API and ownership

Notification APIs require a session and are scoped to recipient. Missing/foreign
record mutations return 404, malformed IDs 400. GET `/api/notifications` accepts
page/limit (default 1/20, max 50)/unread and returns
`{notifications,total,unreadTotal,page,limit}`. Unread total is independent of the
page/filter. Newest first, `_id` breaks ties. Public records omit dedupe/email
internals and add actionable/expiry. Read is idempotent; read-all marks all. Cached
User.unreadNotifications is refreshed; badges use the actual API unread total.

GET/PATCH `/api/notifications/preferences` reads/sets boolean supportEmail. GET
also returns emailAvailable. Subscription defaults false; existing users are not
subscribed. Enabling requires RESEND_API_KEY and EMAIL_FROM. No marketing campaign.

POST `/api/reports` validates subject 3–200 and description 10–5000 characters,
saves the initial message and queues an administrator alert. Owner-only POST
`/api/reports/:id/reply` accepts `{text,clientRequestId?}`, max 5000 characters,
30 requests/hour; a reply reopens a closed ticket. Admin PATCH
`/api/admin/reports/:id` accepts `{status?,reply?,clientRequestId?}`. Request keys:
opaque letters/digits/underscore/hyphen, 1–80 chars. Exact retries append at most
one message; reusing a key for different text/role returns 409. Legacy clients
without keys remain supported but do not get retry deduplication.

GET `/api/reports/:id` permits owner/admin, includes server readThrough, hides
IP/device info from non-admins. GET `/api/my/reports` returns only owned reports.
POST `/api/reports/:id/read` accepts `{through?}` and marks only this recipient's
notifications for the report through that cutoff. Visible conversation rendering
acknowledges the fetched snapshot; hidden pages do not acknowledge unseen replies.
A read API action is not proof a human read the text.

## Persistence and delivery

Report messages add opaque id and notificationPending. Messages are atomically
appended with their pending flag. Historical messages are not backfilled or
re-notified. Drain runs after submission/reply and every 15 seconds after database
startup, up to 30 reports. Failure leaves the message pending. Notification keys
include report/message/recipient; sparse unique Notification.dedupeKey prevents
duplicate alerts. Deleted recipients are skipped. A busy drain defers new work to
its next run. Persistence precedes best-effort cache refresh/socket emission.
The report source message is its recoverable outbox; social operations do not have
a cross-document transactional outbox. Friend/request state remains authoritative
if its alert creation fails. Socket emit does not confirm client receipt.

Opted-in new support-reply notifications have a pending email job. The worker
rechecks subscription/banned/read state; unsubscribed/deleted/banned/read records
are skipped. Email contains a generic notice and authenticated report link, not
the conversation. Resend idempotency uses notification ID. Failure retains the job
with exponential backoff up to one hour. Provider idempotency has a retention
window: exactly-once email delivery is not guaranteed. Workers/recipient locks
assume the current single app process; replicas need shared job leases/coordination.
No FCM/Web Push/Android OS push integration is included.

## Clients and invitations

One centre on game/shared public/admin headers. Game Socket.IO events trigger an
HTTP refresh; standalone pages poll every 15 visible seconds, without opening a
gameplay socket (which would evict another tab). Manual refresh and history loading
are available. Errors are visible; failed reads keep unread state. Read state does
not remove reply/conversation actions. Pending guards, stable retry keys and
in-memory drafts protect replies during refresh/failure. Drafts are not persisted
across reload/crash. support-client.js handles both report pages, direct
`?report=<id>` links, polling, closed-ticket reply, stale-response rejection and
snapshot read cutoff. Failed conversation loads disable sending against stale UI.

Game invitations expire in 120 seconds; rematch alerts in 30 seconds. Old records
use createdAt plus the same TTL, without data deletion. acceptGameInvite payload
`{fromId,notificationId?}` checks the saved recipient/requester/type/expiry, current
friendship, both players free and clock version. Old clients resolve only a recent
matching saved invitation. Acknowledges `{ok:true}` or `{ok:false,error}` and still
emits inviteFailed `{reason}` for compatibility. Failed attempts stay unread;
accepted ones become accepted/read. Client waits for acknowledgement, surfaces
failures and asks refresh after timeout rather than assuming acceptance.

Refresh deployed pages for new scripts. Native wrapper/OS delivery still needs
acceptance on the actual installed build; web/email is distinct from native push.

## Verification — 2026-11-23

- Full regression: 27 suites / 393 tests, exit 0, 222.556 seconds. Jest printed
  its existing delayed-exit warning, then exited normally. Final focused checks
  after the mailer timeout/cache-header adjustments: 5 suites / 30 tests, exit 0;
  includes real isolated MongoDB, API ownership/idempotency, durable retry, opt-in,
  mailer provider options/errors, stale requests/drafts and invitation success/
  rejection/repeated acceptance. New code/tests pass ESLint and diff whitespace.
- First full attempt hit the isolated MongoDB 10-second process-launch timeout;
  increasing only that test harness startup allowance to 30 seconds resolved it.
- Browser on an isolated local database: game-page badge 26 with 20 history rows,
  load-more to older/expired records, reply textarea survives click/read/refresh,
  owner reply persists, admin reply persists, direct conversation link works,
  standalone/admin centre works. Sample data was explicitly labelled LOCAL TEST.
  No real users received fixture messages; email provider calls were mocked there.
- Deployed 2026-11-23 at 14:06 Asia/Yekaterinburg. Image
  `sha256:157a35c4e664898fa7d120170d11c0f6f5084e71bcbd04d23c6776292c31dfad`.
  Private backup: `/opt/quoridor-notifications-backup-20261123T090535Z` (source,
  actual application MongoDB dump, Redis snapshot and previous image ID).
  Previous tag: `quoridor-app:pre-notifications-20261123T090535Z`.
- Verified all 48 image files against the release manifest; normal image user can
  load modules. Only app recreated, dependencies/Mongo/Redis containers retained.
  Public health 200, six unauthorized GET/mutation checks 401, seven exact public
  script/style SHA-256 matches and main-page script versions confirmed.
- Real deployed Node/Mongoose/Express modules passed lifecycle checks against
  separate synthetic collections on the configured MongoDB: initial admin alert,
  saved admin reply, retry deduplication, owner/stranger permissions, snapshot read,
  counter and user follow-up alert. Email queue used a test sink. Synthetic records
  were removed only from those dedicated collections; no real users were messaged.
  The production dedupe index exists; no pending report deliveries at initial check.
  Evidence: `artifacts/notifications/production-verification.json` and
  `public-verification.json`.
- Authenticated production Chrome centre loaded history and expired-invitation
  labels in the admin header; opt-in was available/unchecked. A production
  screenshot is retained privately outside Git because it includes moderation
  records. No actual support reply was posted through that live account.
- At 15:10 Asia/Yekaterinburg, Resend accepted a control email to its official
  simulation recipient `delivered@resend.dev`, using the actual deployed mailer
  and configured sender/key. This proves provider submission, not real-user inbox
  delivery. The provider delivery-status query was unavailable. Official
  test address: https://resend.com/changelog/sending-test-emails .
- More than one hour after deployment: app running, restart count 0; no observed
  notification/API/startup/invitation error markers in the since-release logs.
  No native Android/OS push or physical-phone acceptance is claimed.
