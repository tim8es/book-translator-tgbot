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

**Files:**
- Modify: `workflows/book-translator-mvp.json`
- Modify: `scripts/validate-workflow.mjs`

- [x] Replace continuous polling with Telegram Trigger.
- [x] Remove `bt_bot_state` dependency.
- [x] Validate that exported workflow contains no legacy polling nodes.
- [x] Validate that Telegram Trigger exists.

### Task 2: Durable delivery state

**Files:**
- Modify: `workflows/book-translator-mvp.json`
- Modify: `docs/data-model.md`

- [x] Persist `delivery_step`, `retry_count`, `retry_at`, and `last_error`.
- [x] Persist recovery-safe message text/captions.
- [x] Move task through admin-card, source, customer-confirmation and waiting-result states.

### Task 3: Safe result delivery

**Files:**
- Modify: `workflows/book-translator-mvp.json`
- Modify: `scripts/validate-workflow.mjs`

- [x] Persist `translated_file_id` before delivery.
- [x] Set `DELIVERY_PENDING / RESULT_PENDING` before the Telegram send.
- [x] Set `DONE / COMPLETE` only after successful customer delivery.
- [x] Add validator checks for ordering/invariants.

### Task 4: Lightweight recovery

**Files:**
- Modify: `workflows/book-translator-mvp.json`
- Modify: `scripts/validate-workflow.mjs`

- [x] Add 5-minute recovery trigger.
- [x] Recover only pending due tasks.
- [x] Bound each recovery batch.
- [x] Apply increasing retry backoff and retry cap.
- [x] Keep `WAITING_RESULT` and completed tasks out of recovery work.

### Task 5: Short Telegram retry

**Files:**
- Modify: `workflows/book-translator-mvp.json`
- Modify: `scripts/validate-workflow.mjs`

- [x] Add short `Retry On Fail` configuration to critical Telegram sends.
- [x] Validate critical sends have retries configured.

### Task 6: Documentation and migration

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`
- Modify: `docs/setup.md`
- Modify: `docs/testing.md`
- Modify: `examples/tasks.csv`
- Remove: `examples/bot_state.csv`

- [x] Document webhook/public HTTPS requirement.
- [x] Document two-table schema and migration from polling version.
- [x] Document network outage and n8n restart tests.
- [x] Remove obsolete polling-state example.

### Task 7: Verification

- [x] Run repository validator against generated workflow before commit.
- [x] Confirm generated workflow passes validator in GitHub Actions.
- [ ] Confirm clean final branch passes the regular validation workflow after temporary generation artifacts are removed.
- [ ] Perform manual n8n/Telegram tests from `docs/testing.md` (owner/local environment).
