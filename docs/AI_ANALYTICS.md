# Product analytics v2

Implementation: `src/analytics/product-metrics.js`, `frontend/js/admin-product-metrics.js`.
Read-only API: `GET /api/admin/product-metrics?days=1..30` (default 28, admin only,
no-store). Dashboard: `/admin/metrics`. CLI: `node scripts/retention_report.js [days]`
prints the same report as JSON (dotenv may print its startup line).

## Definitions

- Reports cover full calendar days in **Asia/Yekaterinburg (UTC+05)**. Today is excluded.
  `current` contains the requested days; `previous` the equally sized preceding period.
- Identity is `deviceId`, with `userId` fallback only when the device is absent.
  Guest-to-login on one device stays one identity. Different devices are not merged;
  shared devices/cleared storage can under/overcount people. No raw actor IDs are returned.
- New player = first **recorded** `game-started` across all available history, including
  legacy events with an identity. This is not registration retention or proof of a
  person's first-ever game. Missing historical IDs cannot be recovered. A fallback
  account identity later gaining a device ID can appear twice; do not interpret these
  approximations as verified unique humans.
- D1 / D7 = an identity starts a game on exactly calendar day 1 / 7 after its first
  recorded game. Return during days 1–7 = at least one start in that inclusive range.
  Visits, finishes and reconnect-only snapshots do not count as game-start returns.
- Each metric has its **own** eligible denominator: the entire target day must have
  ended. A per-day immature cohort returns `null`; eligible=0 gives percent=null,
  never an invented 0%. Counts are always shown with percentages.
- Activation = identities with a start / identities with any included event in that
  period. It is not a landing-page funnel or first-visit conversion.
- Tracked game = one actor's participation identified by `props.gameId` and
  `props.measurementVersion:2`. Repeated starts/finishes are deduplicated. Online IDs
  use the lobby code; local attempts have a new random ID. Both participants of an
  online match can therefore count separately. Legacy events without v2 IDs remain
  in event counts and retention, but **not** linked completion rates.
- Completion = tracked starts in that period with a matching subsequent finish
  received before today's cutoff. Abandonment followed by completion is completed;
  otherwise it is shown as an abandon signal. No terminal event = open/unknown,
  not automatically a lost or abandoned game. Recent starts have less observation
  time than old starts, so compare with caution.
- First completion / second-game rate uses only new identities whose first recorded
  start is linked to a v2 attempt. The denominator does not include unmeasurable
  legacy first games. The second game must start before the end of that period.
- Search rates use a client-generated `searchId`, generated on search-started and
  attached to the first terminal event. Outcomes without a start in the loaded
  range are not successful attempts. p50/p95 use matched client timestamps; times
  are approximate, not server latency measurements. Legacy outcomes are not
  divided by unrelated start counters.
- Modes normalize `normal` to `online`. Platform/mode tables concern linked game
  starts. Platform is measured by the client; historical Android values may be wrong.

## Exclusions and quality

Reports exclude current admin/bot account IDs and all devices ever associated with
them in recorded analytics. This intentionally also excludes guest use of a shared
admin device. Configure additional comma-separated `ANALYTICS_EXCLUDED_USER_IDS`
and `ANALYTICS_EXCLUDED_DEVICE_IDS` for test activity. Unknown testers cannot be
automatically identified. Playing *against* a bot does not exclude the human player.

`localStorage.setItem('analytics.disabled','1')` suppresses future internal **and**
custom Umami events in that browser; it does not delete existing data or disable
Umami pageviews (use the existing `umami.disabled` switch for that). `/admin` pages
do not emit internal events. The metrics page no longer embeds an Umami tracker.

Quality counters cover the entire two-period extraction: unidentified/excluded
events, legacy game events, duplicate game starts, and search outcomes lacking IDs.
These counters and sample sizes must accompany any interpretation. Events are
client-reported, not anti-fraud or billing records. Older browsers can still send
legacy events until refreshed. No historical backfill or data deletion is performed.

## Storage, limits and rollout

Existing batch metadata fallback remains unchanged. New linkage fields live in
`AnalyticsEvent.props`; an additive `{name:1,timestamp:1}` index supports history
and range queries. No destructive schema migration. Index building depends on the
deployment's Mongoose autoIndex policy; verify/build the additive index operationally
if autoIndex is disabled. Linkage properties contain opaque IDs, no account PII.

The loader requests at most 200001 recent events across both periods and 200001
historical first-actor groups, with 15-second query limits. Exceeding 200000 returns
503 rather than partial percentages. Larger deployments need materialized daily
aggregates; a shorter period only reduces the recent-event side of the limit.
The administrator/device exclusion lookup still reads relevant historical records.

Deploy backend/service, dashboard JS/HTML, updated game/client scripts and model
together. Old browsers are supported but do not provide new linked-game coverage.
CLI, API and dashboard share the same calculator. The old `/api/admin/metrics`
remains compatible: it contains unfiltered rolling raw diagnostics including today,
not the new full-day report. Never compare those windows as if identical.

This change was deployed on 2026-11-23; see the production verification below.
Verify linkage coverage first, then wait for completed D1/D7 days.
Automated validation uses pure cohort tests, real isolated MongoDB aggregation,
authenticated API checks and client reporting/rendering tests.

## Implementation verification — 2026-11-23

- Full repository run: `npm run test:once -- --runInBand --silent` — **24 suites,
  379 tests passed**, exit 0, 206.207 seconds. Jest printed the delayed-exit warning
  and subsequently exited normally. No forced-exit flag was used.
- Final focused run: product calculator, real in-memory MongoDB, dashboard renderer,
  event client, authenticated analytics API and game clock/session client —
  **6 suites / 40 tests passed**. Covers mature denominators, UTC+05 boundaries,
  historical first games, admin/bot/test exclusions, account ObjectId casting,
  duplicate linkage, legacy coverage, oversized-report rejection, guest/login
  continuity, all queued batches on page exit, recovery/restart IDs, authorization,
  request races and failed refresh handling.
- New modules/tests and the rewritten CLI pass ESLint. Repository-wide lint remains
  at **50 errors / 99 warnings** (synchronized baseline: 50 / 100); errors were not
  suppressed. `git diff --check` passes.
- Browser verification used a localhost fixture explicitly marked **LOCAL SAMPLE
  DATA**, not production data: desktop rendering, 390px mobile layout, 28→7-day
  period change, cohort maturity labels, no browser console errors. Desktop/mobile
  checks do not establish physical Android/WebView acceptance.
- Initial isolated-Mongo test timed out downloading its binary on a cold machine.
  With the binary cached and a documented cold-start allowance, the real database
  integration and complete suite passed. This did not use production MongoDB.
- At implementation verification, source changes were local in
  `codex/server-source-sync`, on top of the imported production snapshot. The
  subsequent production release is recorded below; no commit or push was made.

## Production verification — 2026-11-23

- Released at 12:07 Asia/Yekaterinburg. Only the application container was recreated;
  MongoDB and Redis were not restarted. The image inherits the previous production
  image and overlays the 42 verified release files, preserving installed dependencies.
  Image: `sha256:5e874c2a067d518676a187144af751e40c52982aa391388e300f4415eb30a598`.
- Private backup on the server: `/opt/quoridor-metrics-backup-20261123T070652Z`.
  Contains source, MongoDB archive, Redis snapshot and previous image ID. Previous
  image tag: `quoridor-app:pre-metrics-20261123T070652Z`. Never copy backups into Git.
- Public health returned 200; unauthenticated report/API routes returned 401.
  Three deployed analytics/game/dashboard scripts matched local SHA-256 hashes.
  Five synthetic events were accepted (204) and independently found in MongoDB with
  session/platform metadata, v2 game linkage and search linkage. Their reserved
  device `metrics-smoke-20261123` is configured in server-side exclusions.
- Verified the additive report index and calculated real 7/28-day reports in
  3.254/6.370 seconds. Authenticated production dashboard loaded the report and
  exposed the period selector. This verifies ingestion and rendering; no physical
  Android client acceptance or complete human-play session was performed here.
- Historical 28-day report (2026-10-26 through 2026-11-22): 310 active identities,
  234 starters, D1 31/156 (19.9%), D7 2/64 (3.1%). These are partial historical
  observations, not a reliable complete audience baseline: across both compared
  periods, 100253 events lacked identity and 11173 game events lacked new linkage.
  Do not interpret coverage changes as audience growth.
- New linked outcomes are absent from these historical full-day windows by design.
  The first release-day activity enters the report on November 24. For a first
  game on November 23, its complete D1 becomes observable November 25 and D7
  December 1 (UTC+05), assuming a nonempty cohort and successful collection.
- Existing weekly automation `playquor` was updated in place: Monday 10:00
  Asia/Yekaterinburg, with 7/28-day product reports, mature denominators, quality
  counters and a read-only production CLI fallback. Existing marketing sources
  remain included. API failure and unavailable data must not be reported as zeros.

## Initial retention assessment — 2026-11-23

The historical 28-day mature samples show D1 31/156 (19.9%), exact D7 2/64
(3.1%) and return on any day 1–7 of 23/64 (35.9%). Exact D7 does not imply that
96.9% never returned during the week. Small samples and missing historical identity
prevent causal attribution to onboarding, game difficulty, acquisition or messaging.
Do not compare raw Umami visitors with internal identified players as a conversion.

After release, non-control-device v2 starts/finishes and linked searches were found
in production. These are event counts, potentially including other test/admin
activity, not a deduplicated completion rate or a new retention cohort result.

First fix the confirmed notification/support usability defects documented in
`AI_ADMIN.md`. The first product experiment should reduce friction between a
first completed game and another attempt: local New Game currently returns to the
menu (`Game.startNewGame`), whereas online New Game repeats matchmaking. Test a
one-click repeat preserving local mode/difficulty and a clear short learning goal.
Rematch, New Game, analysis, rating/history and friend invitations already exist;
do not describe them as missing features. Assess linked first completion/second
game and mature D1 against a new, consistently measured baseline. A short series
or daily challenge is a subsequent hypothesis, not an established remedy.

Notification delivery/open/action events are not currently measured. Before
re-engagement campaigns, add the relevant measurement, explicit opt-in channel
preferences, frequency limits and report/invitation deep links. No automatic
campaign, email or push was enabled by this audit.
