# Book Translator Telegram Bot — MVP

Private Telegram bot for accepting book-translation tasks and returning manually prepared translations.

## What it does

1. n8n polls Telegram every 10 seconds with `getUpdates`.
2. The next Telegram offset is stored immediately in `bt_bot_state` before the business logic runs.
3. The bot checks the customer's numeric Telegram `user_id` against the `bt_bot_users` Data Table.
4. A supported EPUB/PDF/DOCX/TXT upload is deduplicated by `telegram_update_id`.
5. The bot creates one six-digit task number.
6. The administrator receives one task card and the source book.
7. The customer receives one confirmation with the current time estimate: up to 15 minutes per 10,000 characters.
8. The administrator replies to the task card with the translated file.
9. The bot sends it to the original customer and marks the task `DONE`.

The MVP does **not** automatically translate books and does **not** process payments.

## Why polling

The workflow does not use Telegram Trigger/webhooks, so a local n8n instance does not need a public HTTPS URL, domain, ngrok, or Cloudflare Tunnel.

```text
Schedule Poll
  -> Bot Config
  -> Get Poll State
  -> Telegram getUpdates
  -> Expand Telegram Update
  -> Save Poll Offset
  -> Restore Telegram Update
  -> Normalize + Config
```

The offset is persisted to the `bt_bot_state` Data Table before customer/admin processing. `bt_bot_tasks.telegram_update_id` provides an additional task-level duplicate guard.

## Quick start

### 1. Create a Telegram bot and credential

Create a bot with `@BotFather`, then create an n8n **Telegram API** credential using that token.

### 2. Create Data Tables

Create exactly:

- `bt_bot_users`
- `bt_bot_tasks`
- `bt_bot_state`

The workflow references these exact table names; no unprefixed `users`, `tasks`, or `bot_state` tables are expected.

Use [`docs/data-model.md`](docs/data-model.md). Add this initial `bt_bot_state` row:

```text
key               value
telegram_offset   0
```

### 3. Import the workflow

Import:

```text
workflows/book-translator-mvp.json
```

The export contains no real token, personal admin ID, or credential binding.

### 4. Configure one node

Open **Bot Config** and replace:

```js
const TELEGRAM_BOT_TOKEN = 'PASTE_TELEGRAM_BOT_TOKEN_HERE';
const ADMIN_USER_ID = '0';
let ADMIN_CHAT_ID = '0';
```

with your local values.

The workflow intentionally does **not** depend on `$env` or paid n8n Variables.

### 5. Assign Telegram credential

Select the Telegram API credential on every Telegram action node.

All Send Message nodes have `Append n8n Attribution = false`.

### 6. Remove an old webhook once

If the same bot was previously used with Telegram Trigger, call once:

```text
https://api.telegram.org/bot<YOUR_TOKEN>/deleteWebhook
```

Then publish the polling workflow.

### 7. Add whitelist customers

Add a row to `bt_bot_users` with numeric `user_id` and `status = ACTIVE`.

## Expected upload behavior

For one customer book upload:

```text
1 Telegram update
-> 1 tasks row
-> 1 admin task card
-> 1 source file to admin
-> 1 customer confirmation
```

If the same Telegram update is encountered again, `Task Update Not Seen` prevents a second task.

## Message construction

Complex dynamic task texts are built in **Prepare Task Messages**. Telegram nodes reference simple finished fields such as `admin_task_text`. This avoids the expression syntax error previously seen in `Send Admin Task Card`.

## Validation

```bash
npm test
```

The validator checks:

- no Telegram Trigger/webhook dependency;
- compatible Schedule Trigger version;
- `bt_bot_state` offset persistence before business logic;
- `telegram_update_id` deduplication;
- the three Data Table references;
- disabled n8n attribution on Send Message nodes;
- no `$env` dependency;
- no embedded real Telegram token;
- critical task state transitions.

See [`docs/setup.md`](docs/setup.md) for setup and [`docs/testing.md`](docs/testing.md) for the smoke-test matrix.
