# Book Translator Telegram Bot — MVP

Private Telegram bot for accepting book-translation tasks and returning manually prepared translations.

## What it does

1. Telegram Trigger starts the workflow only when a real Telegram update arrives.
2. The bot checks the sender's numeric Telegram `user_id` against `bt_bot_users`.
3. A supported EPUB/PDF/DOCX/TXT upload creates one six-digit task in `bt_bot_tasks`.
4. The task persists its current delivery step so a network failure does not lose progress.
5. The administrator receives a task card and source book.
6. The customer receives a confirmation with the task number and current time estimate.
7. The administrator replies to the task card with the translated file.
8. The translated Telegram `file_id` is saved before customer delivery.
9. If delivery fails, the task remains `RESULT_PENDING` and a recovery pass retries later.
10. After successful customer delivery, the task becomes `DONE` / `COMPLETE`.

The MVP does **not** automatically translate books and does **not** process payments.

## Reliability model

The workflow is deliberately lightweight:

- no Redis;
- no RabbitMQ;
- no external queue;
- no external object storage;
- Telegram files are referenced by `file_id` rather than copied into n8n storage;
- critical Telegram operations use short built-in retries;
- one recovery schedule runs every 5 minutes and only touches unfinished tasks whose retry time has arrived.

The task row itself is the state machine and recovery source of truth.

```text
ADMIN_CARD_PENDING
      ↓
SOURCE_PENDING
      ↓
CUSTOMER_CONFIRM_PENDING
      ↓
WAITING_RESULT
      ↓
RESULT_PENDING
      ↓
COMPLETE
```

Short network failures are handled by node-level retry. Longer outages leave the task in its current pending step and recovery continues later.

## Runtime cost

The old polling version started the main workflow every 10 seconds even when idle (~8,640 executions/day).

The current version starts the main workflow only for Telegram updates. When idle, the only periodic work is the 5-minute recovery schedule (~288 lightweight executions/day).

## Quick start

### 1. Create Telegram credential

Create the bot with `@BotFather`, then create one n8n **Telegram API** credential using that token.

The workflow export contains no real token and no credential binding.

### 2. Create Data Tables

Create exactly:

- `bt_bot_users`
- `bt_bot_tasks`

`bt_bot_state` is no longer used.

Use [`docs/data-model.md`](docs/data-model.md) for the exact schema.

### 3. Import the workflow

Import:

```text
workflows/book-translator-mvp.json
```

### 4. Configure admin IDs

Open **Admin Config** and set:

```js
let ADMIN_USER_ID = '123456789';
let ADMIN_CHAT_ID = '123456789';
```

For a private admin chat these normally match.

### 5. Assign Telegram credential

Select the same Telegram API credential on:

- Telegram Trigger;
- every Telegram Send Message / Send Document node.

### 6. Provide public HTTPS access

Telegram Trigger uses a webhook. Your n8n instance must be reachable from Telegram through public HTTPS.

For local development use a supported tunnel/reverse proxy or test on a hosted/self-hosted n8n instance with a public HTTPS URL.

### 7. Add whitelist customers

Add a row to `bt_bot_users` with numeric `user_id` and `status = ACTIVE`.

## Expected upload behavior

For one customer upload:

```text
1 Telegram update
→ 1 task row
→ 1 admin task card
→ 1 source file to admin
→ 1 customer confirmation
```

A failure after task creation does not require the customer to resend the book: the task row keeps the pending delivery step for recovery.

## Result delivery safety

When the administrator uploads the translated document:

```text
admin file received
→ save translated_file_id
→ status = DELIVERY_PENDING
→ delivery_step = RESULT_PENDING
→ send to customer
→ success: DONE / COMPLETE
```

Therefore a network failure during customer delivery does not lose the translated file reference.

## Validation

```bash
npm test
```

The validator checks, among other things:

- Telegram Trigger is present;
- the old 10-second polling path is absent;
- recovery schedule exists and runs every 5 minutes;
- critical Telegram nodes use retry;
- `translated_file_id` is persisted before result delivery;
- the task state machine contains pending delivery steps;
- recovery selects pending tasks and applies bounded retry/backoff;
- workflow contains no real Telegram token or credential binding.

See [`docs/setup.md`](docs/setup.md) and [`docs/testing.md`](docs/testing.md) before the first real test.
