# Book Translator Telegram Bot MVP Implementation Plan

**Goal:** Deliver a private, low-resource and recoverable n8n Telegram workflow for manual book translation on a local n8n instance without a public URL.

**Architecture:** Telegram updates are read with `getUpdates` every 30 seconds. `bt_bot_state.telegram_state` stores a JSON cursor and short compare-and-set processing lease. Critical inbound data is persisted before cursor acknowledgement. `bt_bot_tasks` persists business and delivery state; critical sends use short retries plus a 5-minute bounded recovery schedule. Telegram `file_id` values are reused so books are not persisted in n8n storage solely for routing.

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
- Serialize overlapping poll processing without requiring global n8n concurrency configuration.
- Recover automatically from an old Telegram webhook conflict.
- No real Telegram token or credential binding in exported workflow.

### Task 1: Local polling entrypoint

- [x] Use `Schedule Poll` every 30 seconds.
- [x] Call Telegram `getUpdates` with `limit=1`.
- [x] Remove webhook-based Telegram Trigger.
- [x] Keep real bot token out of the repository export.
- [x] Bound `getUpdates` HTTP timeout to 10 seconds with short network retry.

### Task 2: Self-initializing serialized polling

- [x] Store cursor + lease in `bt_bot_state.telegram_state` JSON.
- [x] Automatically create polling state if missing.
- [x] Use exact-value compare-and-set when acquiring the processing lease.
- [x] Use a 120-second lease TTL to recover from crashed executions.
- [x] Make cursor acknowledgement conditional on still owning the same lease.
- [x] Make overlapping schedule executions stop before processing while a valid lease is active.

### Task 3: Telegram webhook self-healing

- [x] Inspect full `getUpdates` API response.
- [x] Detect Telegram conflict `409`.
- [x] Call `deleteWebhook(drop_pending_updates=false)` automatically.
- [x] Preserve the cursor and queued updates during webhook cleanup.

### Task 4: Safe inbound acknowledgement

- [x] Preserve `next_offset` through normalization.
- [x] Persist a new task before acknowledging its customer upload update.
- [x] Detect already-persisted customer updates by `telegram_update_id` and acknowledge without creating a duplicate.
- [x] Persist admin `translated_file_id` / `RESULT_PENDING` before acknowledging the result upload.
- [x] Acknowledge simple conversational updates only after their Telegram response succeeds.

### Task 5: Durable delivery state

- [x] Persist `delivery_step`, `retry_count`, and `next_retry_at`.
- [x] Persist `admin_chat_id` and recovery-safe message text/captions.
- [x] Move tasks through admin-card, source, customer-confirmation and waiting-result states.

### Task 6: Safe result delivery

- [x] Persist `translated_file_id` before delivery.
- [x] Set `DELIVERY_PENDING / RESULT_PENDING` before the customer send.
- [x] Set `DONE / COMPLETE` only after successful customer delivery.
- [x] Validate ordering/invariants automatically.

### Task 7: Lightweight recovery

- [x] Run recovery every 5 minutes.
- [x] Recover only pending due tasks.
- [x] Bound each recovery batch to 20 tasks.
- [x] Use increasing retry backoff with an 8-attempt cap.
- [x] Keep `WAITING_RESULT` and completed tasks out of recovery work.

### Task 8: Telegram retry

- [x] Enable `Retry On Fail` on critical Telegram sends.
- [x] Use at least 3 attempts with 5 seconds between attempts.
- [x] Validate retry configuration automatically.

### Task 9: Documentation and cleanup

- [x] Document local polling/no-public-URL setup.
- [x] Document `telegram_state` String JSON schema and auto-initialization.
- [x] Document polling lease, webhook self-healing and acknowledgement ordering.
- [x] Add optional `examples/state.csv` example.
- [x] Document outage, concurrency, lease-expiry, duplicate-update and restart tests.
- [x] Remove temporary workflow-generation tooling after applying the hardening migration.

### Task 10: Verification

- [x] Validator first failed against the pre-hardening workflow, proving the new requirements are exercised.
- [x] Generated hardened workflow passed the validator before commit.
- [x] Ordinary GitHub Actions validation must pass on the clean final branch after migration tooling is removed.
- [ ] Perform manual n8n/Telegram acceptance tests from `docs/testing.md` in the owner's local environment.

## Known platform limitation

Telegram ordinary outbound `sendMessage` / `sendDocument` calls do not expose a generic exactly-once idempotency key. A rare ambiguous timeout after Telegram accepted a send but before n8n received the response may produce a duplicate retry. The workflow is designed to prevent data/task loss and duplicate task creation; it cannot prove exactly-once external Telegram delivery under that network ambiguity.
