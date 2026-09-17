# Book Translator Telegram Bot MVP Implementation Plan

**Goal:** Deliver a private, low-resource and recoverable n8n Telegram workflow for manual book translation on a local n8n instance without a public URL.

**Architecture:** Telegram updates are read with `getUpdates` every 30 seconds. `bt_bot_state.telegram_offset` is acknowledged only after a safe checkpoint. `bt_bot_tasks` persists business and delivery state; critical sends use short retries plus a 5-minute bounded recovery schedule. Telegram `file_id` values are reused so books are not persisted in n8n storage solely for routing.

**Tech Stack:** n8n, Telegram Bot API, n8n Data Tables, Node.js validator.

**Spec:** `docs/superpowers/specs/2026-09-17-book-translator-tgbot-mvp-design.md`

## Global constraints

- Private allowlist only.
- Numeric Telegram `user_id` is the authorization key.
- No public webhook requirement.
- No Redis/RabbitMQ/external queue for MVP.
- No external object storage for book forwarding.
- Persist source/result `file_id` before acknowledging the corresponding critical inbound update.
- Poll every 30 seconds, not every 10 seconds.
- No real Telegram token or credential binding in exported workflow.

### Task 1: Local polling entrypoint

- [x] Use `Schedule Poll` every 30 seconds.
- [x] Read `bt_bot_state.telegram_offset`.
- [x] Call Telegram `getUpdates` with `limit=1`.
- [x] Remove webhook-based Telegram Trigger.
- [x] Keep real bot token out of the repository export.

### Task 2: Safe inbound acknowledgement

- [x] Preserve `next_offset` through normalization.
- [x] Persist a new task before acknowledging its customer upload update.
- [x] Detect already-persisted customer updates by `telegram_update_id` and acknowledge without creating a duplicate.
- [x] Persist admin `translated_file_id` / `RESULT_PENDING` before acknowledging the result upload.
- [x] Acknowledge simple conversational updates only after their Telegram response succeeds.

### Task 3: Durable delivery state

- [x] Persist `delivery_step`, `retry_count`, and `next_retry_at`.
- [x] Persist `admin_chat_id` and recovery-safe message text/captions.
- [x] Move tasks through admin-card, source, customer-confirmation and waiting-result states.

### Task 4: Safe result delivery

- [x] Persist `translated_file_id` before delivery.
- [x] Set `DELIVERY_PENDING / RESULT_PENDING` before the customer send.
- [x] Set `DONE / COMPLETE` only after successful customer delivery.
- [x] Validate ordering/invariants automatically.

### Task 5: Lightweight recovery

- [x] Run recovery every 5 minutes.
- [x] Recover only pending due tasks.
- [x] Bound each recovery batch to 20 tasks.
- [x] Use increasing retry backoff with an 8-attempt cap.
- [x] Keep `WAITING_RESULT` and completed tasks out of recovery work.

### Task 6: Telegram retry

- [x] Enable `Retry On Fail` on critical Telegram calls.
- [x] Use at least 3 attempts with 5 seconds between attempts.
- [x] Validate retry configuration automatically.

### Task 7: Documentation and cleanup

- [x] Document local polling/no-public-URL setup.
- [x] Document three Data Tables including `bt_bot_state`.
- [x] Add `examples/state.csv`.
- [x] Document outage, duplicate-update and restart tests.
- [x] Remove one-shot migration action/script after generation.

### Task 8: Verification

- [x] Repository validator requires the polling architecture and safe acknowledgement order.
- [x] GitHub Actions runs `npm test` successfully on the clean branch.
- [ ] Perform manual n8n/Telegram acceptance tests from `docs/testing.md` in the owner's local environment.
