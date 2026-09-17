# Book Translator Telegram Bot MVP Design

**Date:** 2026-09-17

## Goal

Build a private Telegram bot backed by local n8n for manually processed book-translation tasks. Only explicitly whitelisted Telegram users may use it. A customer sends a book, the bot creates a six-digit task and routes it to the administrator. The administrator later replies to the task card with the translated file and the bot returns it to the original customer.

## Architecture decision

The MVP uses **Telegram polling through `getUpdates`**, not a webhook, because the target n8n instance has no public address.

- `Schedule Poll` runs every 30 seconds.
- `getUpdates` reads one update at a time (`limit=1`).
- `bt_bot_state.telegram_state` stores the polling cursor and processing lease as JSON.
- The polling state row is created automatically if missing.
- A compare-and-set lease serializes overlapping poll executions.
- A stale lease expires after 120 seconds so a crashed execution cannot deadlock the bot.
- Telegram webhook conflict `409` is handled automatically with `deleteWebhook(drop_pending_updates=false)`.
- `bt_bot_tasks` stores business state and recovery state.
- Source and result documents are referenced by Telegram `file_id` values.
- Critical Telegram sends use short built-in retries.
- A recovery schedule runs every 5 minutes for due pending deliveries.
- No Redis, RabbitMQ, PostgreSQL or external object storage is required for the MVP.

No public domain, HTTPS webhook, tunnel or reverse proxy is required.

## Authorization

Customer access uses numeric Telegram `user_id` in `bt_bot_users` with `status = ACTIVE`. Username is metadata only.

The administrator is identified by numeric `ADMIN_USER_ID` in `Bot Config`. `ADMIN_CHAT_ID` may fall back to the same value for a private bot conversation.

## Supported source files

- `.epub`
- `.pdf`
- `.docx`
- `.txt`

Unsupported files do not create tasks.

## Task numbering

User-facing task numbers are random six-digit integers from `100000` through `999999`. Multiple candidates are generated and values already present in `bt_bot_tasks` are rejected.

`telegram_update_id` is stored separately as an inbound duplicate guard.

## Polling state

`bt_bot_state` has two columns:

```text
key   String
value String
```

The workflow owns one row:

```text
key = telegram_state
value = {"offset":0,"lockToken":"","lockUntil":0}
```

The row is auto-created on first use.

Before processing a fetched update, the workflow attempts a compare-and-set update from the exact previously-read JSON value to a leased value containing a random `lockToken` and a `lockUntil` timestamp 120 seconds in the future. Only the execution that successfully updates that exact value continues into business logic.

Acknowledgement also uses compare-and-set against the exact lease value owned by that execution. A stale execution cannot overwrite newer polling state.

## Safe polling acknowledgement

The Telegram offset must never be advanced before the data required to recover the inbound update is durable.

Customer source upload:

```text
receive Telegram update
→ acquire processing lease
→ authorize + duplicate check
→ persist task row including source_file_id
→ persist next Telegram offset and release lease
→ deliver task card/source/customer confirmation
```

If the same source update is replayed after task persistence but before cursor persistence, `telegram_update_id` detects the existing task and the duplicate path only acknowledges the update.

Administrator result upload:

```text
receive translated file
→ acquire processing lease
→ resolve task from replied task-card message
→ persist translated_file_id
→ status = DELIVERY_PENDING
→ delivery_step = RESULT_PENDING
→ persist next Telegram offset and release lease
→ deliver result to customer
```

Simple conversational interactions such as `/start`, help and access-denied replies acknowledge the update only after the response send succeeds.

## Webhook conflict recovery

`getUpdates` exposes the full Telegram API response instead of treating non-2xx as an opaque node failure. If Telegram reports `409`, the workflow calls:

```text
deleteWebhook(drop_pending_updates=false)
```

No cursor is advanced by the conflict. Telegram's pending updates are preserved and the next polling cycle retries the same cursor.

## Durable task state

Task status values:

```text
NEW
PROCESSING
DELIVERY_PENDING
DONE
REJECTED
```

Delivery states:

```text
ADMIN_CARD_PENDING
SOURCE_PENDING
CUSTOMER_CONFIRM_PENDING
WAITING_RESULT
RESULT_PENDING
COMPLETE
```

Normal flow:

```text
NEW / ADMIN_CARD_PENDING
→ NEW / SOURCE_PENDING
→ NEW / CUSTOMER_CONFIRM_PENDING
→ PROCESSING / WAITING_RESULT
→ DELIVERY_PENDING / RESULT_PENDING
→ DONE / COMPLETE
```

## Critical translated-file guarantee

`translated_file_id` and `RESULT_PENDING` are persisted before customer delivery and before the admin upload update is acknowledged. A temporary outbound failure therefore does not require the administrator to upload the translation again.

Only a successful customer Telegram send may advance the task to `DONE / COMPLETE`.

## Recovery

`Recovery Schedule` runs every 5 minutes and considers only:

```text
ADMIN_CARD_PENDING
SOURCE_PENDING
CUSTOMER_CONFIRM_PENDING
RESULT_PENDING
```

At most 20 due tasks are selected per run. Automatic persistent recovery is capped at 8 attempts with:

```text
5 min → 15 min → 30 min → 1 h → 3 h → 6 h → 12 h → 24 h
```

`WAITING_RESULT` and `COMPLETE` are not recovery work.

## Persisted recovery material

Each task stores enough context to resume after an n8n restart:

```text
customer_chat_id
admin_chat_id
admin_task_message_id
admin_task_text
source_file_id
source_caption
customer_confirmation_text
translated_file_id
delivery_step
retry_count
next_retry_at
```

## Secrets and configuration

- The committed workflow contains only a bot-token placeholder.
- The real bot token is filled locally in `Bot Config` for Bot API HTTP requests.
- The same bot token is stored in an n8n Telegram API credential for outgoing Telegram nodes.
- The export contains no real bot token and no credential binding.
- Real administrator IDs are configured locally.

## Resource profile

Idle scheduled executions are approximately:

```text
polling every 30 seconds ≈ 2,880/day
recovery every 5 minutes ≈ 288/day
```

`getUpdates` uses an explicit 10-second HTTP timeout and two network attempts. This avoids a transient connection problem holding a polling execution for the much longer generic HTTP-node default timeout.

## Delivery semantics

Normal duplicate task creation is guarded by `telegram_update_id`, durable cursor acknowledgement and the polling lease.

Telegram Bot API does not expose a generic exactly-once idempotency key for ordinary `sendMessage` / `sendDocument` calls. In the rare ambiguous case where Telegram accepted an outbound send but the network response was lost before n8n could persist the next state, a retry can duplicate that outbound message. The design chooses recoverability and possible duplicate delivery over silent data loss.

## Acceptance requirements

The MVP is acceptable when:

1. whitelist and supported-file behavior works;
2. polling state initializes itself;
3. overlapping poll executions are serialized by the lease;
4. abandoned lease expires and processing recovers;
5. old webhook conflict self-heals without dropping queued updates;
6. one source upload creates exactly one task;
7. task persistence occurs before cursor acknowledgement;
8. admin receives task card and source file;
9. administrator reply maps to the correct task;
10. translated `file_id` and `RESULT_PENDING` are stored before result-update acknowledgement;
11. result delivery failure remains recoverable after network restoration or n8n restart;
12. recovery applies bounded retry/backoff;
13. no public URL is needed;
14. repository validation passes;
15. manual n8n/Telegram acceptance tests pass in the owner's environment.

## Out of scope

- payments;
- automatic translation;
- text extraction and pricing;
- multiple administrators;
- customer task-history UI;
- cancellation UI;
- external object storage;
- Redis/RabbitMQ;
- PostgreSQL/Supabase;
- public bot access;
- mathematically exactly-once Telegram outbound delivery.
