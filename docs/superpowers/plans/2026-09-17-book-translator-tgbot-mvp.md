# Book Translator Telegram Bot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a private, low-resource and recoverable n8n Telegram workflow for manual book translation.

**Architecture:** Telegram updates enter through a webhook-based Telegram Trigger. `bt_bot_tasks` persists both business state and the next delivery step; critical sends use short retries and a 5-minute bounded recovery schedule. Telegram `file_id` values are reused so books are not persisted in n8n storage.

**Tech Stack:** n8n, Telegram Bot API, n8n Data Tables, Node.js validator.

**Spec:** `docs/superpowers/specs/2026-09-17-book-translator-tgbot-mvp-design.md`

## Global Constraints

- Private allowlist only.
- Numeric Telegram `user_id` is the authorization key.
- No Redis/RabbitMQ/external queue for MVP.
- No external object storage for book forwarding.
- Persist translated `file_id` before customer delivery.
- No 10-second idle polling.
- No real Telegram token or credential binding in exported workflow.

---

### Task 1: Event-driven entrypoint

- [x] Replace continuous polling with Telegram Trigger.
- [x] Remove `bt_bot_state` dependency.
- [x] Validate that exported workflow contains no legacy polling nodes.
- [x] Validate that Telegram Trigger exists.

### Task 2: Durable delivery state

- [x] Persist `delivery_step`, `retry_count`, and `next_retry_at`.
- [x] Persist `admin_chat_id` and recovery-safe message text/captions.
- [x] Move task through admin-card, source, customer-confirmation and waiting-result states.

### Task 3: Safe result delivery

- [x] Persist `translated_file_id` before delivery.
- [x] Set `DELIVERY_PENDING / RESULT_PENDING` before the Telegram send.
- [x] Set `DONE / COMPLETE` only after successful customer delivery.
- [x] Add validator checks for ordering/invariants.

### Task 4: Lightweight recovery

- [x] Add 5-minute recovery trigger.
- [x] Recover only pending due tasks.
- [x] Bound each recovery batch to 20 tasks.
- [x] Apply increasing retry backoff and an 8-attempt cap.
- [x] Keep `WAITING_RESULT` and completed tasks out of recovery work.

### Task 5: Short Telegram retry

- [x] Add `Retry On Fail` to critical Telegram sends.
- [x] Use at least 3 attempts with 5 seconds between attempts.
- [x] Validate critical sends automatically.

### Task 6: Documentation and migration

- [x] Document webhook/public HTTPS requirement.
- [x] Document the exact two-table schema and migration from polling version.
- [x] Document network outage and n8n restart tests.
- [x] Remove obsolete `examples/bot_state.csv`.
- [x] Remove temporary workflow-payload generation tooling.

### Task 7: Verification

- [x] Run repository validator against generated workflow before commit.
- [x] Confirm generated workflow passes validator in GitHub Actions.
- [x] Confirm the clean branch passes the regular validation workflow after temporary generation artifacts are removed.
- [ ] Perform manual n8n/Telegram acceptance tests from `docs/testing.md` in the owner's environment.
