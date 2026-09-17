# Book Translator Telegram Bot MVP Design

**Date:** 2026-09-17

## Goal

Build a private Telegram bot backed by local n8n for manually processed book-translation tasks. Only explicitly whitelisted Telegram users may use it. A customer sends a book, the bot creates a six-digit task and routes it to the administrator. The administrator later replies to the task card with the translated file and the bot returns it to the original customer.

## Architecture decision

The MVP uses **Telegram long polling through `getUpdates`**, not a webhook, because the target n8n instance has no public address.

- `Schedule Poll` runs every 30 seconds.
- `getUpdates` reads one update at a time (`limit=1`).
- `bt_bot_state.telegram_offset` stores the durable polling cursor.
- `bt_bot_tasks` stores business state and recovery state.
- Source and result documents are referenced by Telegram `file_id` values.
- Critical Telegram calls use short built-in retries.
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

## Safe polling acknowledgement

The Telegram offset must never be advanced before the data required to recover the inbound update is durable.

Customer source upload:

```text
receive Telegram update
→ authorize + duplicate check
→ persist task row including source_file_id
→ persist next Telegram offset
→ deliver task card/source/customer confirmation
```

If the same source update is replayed after task persistence but before offset persistence, `telegram_update_id` detects the existing task and the duplicate path only acknowledges the offset.

Administrator result upload:

```text
receive translated file
→ resolve task from replied task-card message
→ persist translated_file_id
→ status = DELIVERY_PENDING
→ delivery_step = RESULT_PENDING
→ persist next Telegram offset
→ deliver result to customer
```

Simple conversational interactions such as `/start`, help and access-denied replies acknowledge the update only after the response send succeeds.

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

## Data tables

The MVP uses:

```text
bt_bot_users
bt_bot_tasks
bt_bot_state
```

`bt_bot_state` starts with:

```text
key = telegram_offset
value = 0
```

Exact schemas are in `docs/data-model.md`.

## Secrets and configuration

- The committed workflow contains only a bot-token placeholder.
- The real bot token is filled locally in `Bot Config` for `getUpdates`.
- The same bot token is stored in an n8n Telegram API credential for outgoing Telegram nodes.
- The export contains no real bot token and no credential binding.
- Real administrator IDs are configured locally.

## Resource profile

Idle scheduled executions are approximately:

```text
polling every 30 seconds ≈ 2,880/day
recovery every 5 minutes ≈ 288/day
```

The 30-second cadence replaces the earlier 10-second polling design and reduces idle polling executions by roughly two thirds while keeping normal response delay bounded to about one polling interval.

## Acceptance requirements

The MVP is acceptable when:

1. whitelist and supported-file behavior works;
2. one source upload creates exactly one task;
3. task persistence occurs before offset acknowledgement;
4. admin receives task card and source file;
5. administrator reply maps to the correct task;
6. translated `file_id` and `RESULT_PENDING` are stored before result-update acknowledgement;
7. result delivery failure remains recoverable after network restoration or n8n restart;
8. recovery applies bounded retry/backoff;
9. no webhook/public URL is needed;
10. repository validation passes;
11. manual n8n/Telegram acceptance tests pass in the owner's environment.

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
- high-concurrency distributed locking.
