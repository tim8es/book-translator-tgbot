# Book Translator Telegram Bot MVP Design

**Date:** 2026-09-17

## Goal

Build a private Telegram bot backed by n8n for manually processed book-translation tasks. Only explicitly whitelisted Telegram users may use the bot. A user sends a book, the bot creates a numbered task and delivers it to the administrator. After manual translation, the administrator replies to the task card with the translated file and the bot returns it to the original customer.

## Current architecture decision

The MVP is event-driven and optimized for low idle resource use.

- Telegram updates enter through **Telegram Trigger** / webhook.
- There is no 10-second polling loop and no `bt_bot_state` table.
- `bt_bot_tasks` is the durable delivery state machine.
- Critical Telegram operations use short built-in retries.
- A recovery schedule runs every 5 minutes and retries only due pending tasks.
- No Redis, RabbitMQ, external queue, PostgreSQL or external object storage is required for the MVP.
- Source and translated books are referenced by Telegram `file_id` values rather than persisted as n8n binary files.

## Authorization

Customer access is based only on immutable numeric Telegram `user_id` values in `bt_bot_users` with `status = ACTIVE`.

Telegram `username` is metadata only and never grants access.

The administrator is identified by numeric `ADMIN_USER_ID` and `ADMIN_CHAT_ID` configured locally in **Bot Config**.

## Supported files

Source documents:

- `.epub`
- `.pdf`
- `.docx`
- `.txt`

Unsupported files do not create a task.

## Task numbering

User-facing task numbers are random six-digit integers from `100000` through `999999`.

The workflow generates multiple candidates, filters numbers already present in `bt_bot_tasks`, and selects a free candidate. `telegram_update_id` is also stored as a duplicate guard.

## Durable state machine

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

Flow:

```text
NEW / ADMIN_CARD_PENDING
        ↓
NEW / SOURCE_PENDING
        ↓
NEW / CUSTOMER_CONFIRM_PENDING
        ↓
PROCESSING / WAITING_RESULT
        ↓ admin supplies translated file
DELIVERY_PENDING / RESULT_PENDING
        ↓ successful customer delivery
DONE / COMPLETE
```

The delivery state is persisted after each completed step so an execution failure or n8n restart does not require restarting the entire task.

## Critical translated-file safety rule

When the administrator replies with a translated document, the workflow must persist:

```text
translated_file_id
status = DELIVERY_PENDING
delivery_step = RESULT_PENDING
```

**before** attempting to send that document to the customer.

Only after the Telegram customer-delivery call succeeds may the workflow set:

```text
status = DONE
delivery_step = COMPLETE
completed_at = now
```

This is the central reliability guarantee of the MVP.

## Recovery

A recovery schedule runs every 5 minutes.

It processes a bounded number of due unfinished tasks and uses increasing backoff instead of retrying every pending row on every schedule tick.

Backoff sequence:

```text
5 min → 15 min → 30 min → 1 h → 3 h → 6 h → 12 h → 24 h
```

Recovery is capped so a permanently invalid Telegram chat/file does not consume resources forever. The failed task remains visible for manual inspection.

`WAITING_RESULT`, `DONE`, `COMPLETE` and rejected tasks are not active recovery work.

## Persisted message material

To recover notification steps without the original execution context, the task row stores:

```text
admin_task_text
source_caption
customer_confirmation_text
```

Together with `source_file_id`, `translated_file_id`, chat IDs and `delivery_step`, this is enough to continue a pending delivery after an n8n restart.

## Customer flow

1. Telegram Trigger receives update.
2. Normalize sender, chat, message/document and reply metadata.
3. Route admin/customer.
4. Check customer numeric ID in `bt_bot_users` on every customer interaction.
5. `/start` returns guidance only.
6. Supported source file passes duplicate guard.
7. Allocate six-digit task number.
8. Persist task with `ADMIN_CARD_PENDING`.
9. Send admin task card and store its Telegram message ID.
10. Send source file to admin.
11. Confirm task to customer.
12. Set `PROCESSING / WAITING_RESULT`.

## Admin completion flow

1. Administrator replies to the stored task-card Telegram message with a document.
2. Find task by `admin_task_message_id`.
3. Reject unknown or already completed tasks.
4. Persist the translated `file_id` and `RESULT_PENDING` state.
5. Attempt customer delivery.
6. On success mark `DONE / COMPLETE` and confirm completion to admin.
7. On longer network failure leave `RESULT_PENDING` for scheduled recovery.

## Resource goal

When nobody uses the bot, the Telegram-driven main path performs zero polling executions.

Only the recovery trigger runs every 5 minutes (~288 runs/day), and it exits quickly if no task is due.

This replaces the previous 10-second polling design (~8,640 executions/day even when idle).

## Data tables

The MVP uses:

```text
bt_bot_users
bt_bot_tasks
```

No `bt_bot_state` table is required.

The exact schemas are documented in `docs/data-model.md`.

## Secrets and configuration

- Telegram bot token lives in an n8n Telegram API credential.
- The workflow JSON must not contain a real bot token or credential binding.
- Admin numeric IDs are configured locally after import.
- The public repository contains placeholders/example IDs only.

## Deployment requirement

Telegram Trigger requires n8n to expose a public HTTPS webhook URL.

Local testing therefore requires an HTTPS tunnel/reverse proxy or an n8n instance that is already publicly reachable via HTTPS.

## Acceptance requirements

The MVP is acceptable when:

1. whitelist and supported-file behavior works;
2. one source upload creates exactly one task;
3. admin receives task card and source file;
4. customer receives task confirmation;
5. administrator reply maps to the correct task;
6. translated `file_id` is saved before customer delivery;
7. result delivery failure leaves a recoverable `RESULT_PENDING` task;
8. pending delivery survives n8n restart;
9. recovery completes due work after connectivity returns;
10. there is no continuous 10-second polling when idle;
11. `npm test` validates the exported workflow structure.

## Out of scope

- payments;
- automatic translation;
- text extraction and character pricing;
- multiple administrators;
- customer task history UI;
- cancellation UI;
- external object storage;
- Redis / RabbitMQ;
- PostgreSQL/Supabase;
- public bot access;
- high-concurrency distributed locking.

If volume grows significantly, the state model can move from n8n Data Tables to PostgreSQL while keeping the same task/delivery states and Telegram UX.
