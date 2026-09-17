# Setup

This guide configures the resilient low-resource MVP in n8n.

## 1. Telegram bot and credential

Create a bot through `@BotFather` and obtain its token.

In n8n:

1. Open **Credentials**.
2. Create one **Telegram API** credential.
3. Paste the BotFather token.
4. Save it.

The token is stored only in the n8n credential. Do not paste it into **Admin Config** and never commit it to GitHub.

## 2. Public HTTPS endpoint

The workflow uses **Telegram Trigger**, not polling. Telegram must be able to reach your n8n webhook through public HTTPS.

For local testing, expose n8n through a suitable HTTPS tunnel/reverse proxy or test on an n8n instance that already has a public HTTPS URL.

Make sure n8n's externally advertised webhook URL is the public HTTPS URL before activating the workflow.

## 3. Create Data Tables

Create exactly:

- `bt_bot_users`
- `bt_bot_tasks`

Follow [`data-model.md`](data-model.md) exactly.

The old `bt_bot_state` table is not used by this version.

### Migrating an existing local test setup

If you created tables for the old polling workflow:

1. keep `bt_bot_users`;
2. add the new columns from `docs/data-model.md` to `bt_bot_tasks`;
3. inspect existing unfinished task rows before assigning their `delivery_step`;
4. remove `bt_bot_state` after migration.

For easiest MVP testing, starting with an empty `bt_bot_tasks` table is recommended.

## 4. Import workflow

Import:

```text
workflows/book-translator-mvp.json
```

The exported workflow is intentionally inactive and contains no credential binding.

## 5. Configure administrator

Open **Admin Config** and set the numeric Telegram IDs:

```js
let ADMIN_USER_ID = '123456789';
let ADMIN_CHAT_ID = '123456789';
```

For a private conversation with the bot these usually match.

Do not add the bot token to this node.

## 6. Assign Telegram credential

Assign the Telegram API credential to:

- `Telegram Trigger`;
- all Telegram message/document send nodes in the main path;
- all Telegram message/document send nodes reused by the recovery path.

The workflow export intentionally contains no credentials, so this must be done after every fresh import.

## 7. Add whitelist users

Add customers manually to `bt_bot_users`.

Example:

```text
user_id: 111111111
username: example_user
name: Example User
status: ACTIVE
created_at: 2026-09-17T12:00:00.000Z
```

Authorization uses numeric `user_id`, never username.

## 8. Activate workflow

When the Telegram credential and public webhook are configured, activate/publish the workflow.

The workflow has two entry points:

```text
Telegram Trigger
```

for real incoming bot updates, and:

```text
Recovery Schedule — every 5 minutes
```

for unfinished delivery recovery.

There is no 10-second polling job.

## 9. Reliability behavior

Critical Telegram sends use short node-level retry:

```text
3 tries
5 seconds between tries
```

If the problem lasts longer, the task remains in a durable pending state. Recovery checks it later using `delivery_step`, `retry_count` and `next_retry_at`.

The administrator's translated `file_id` is written to `bt_bot_tasks` before attempting delivery to the customer. This means a temporary network failure does not require the administrator to upload the translated file again.

## 10. Recovery cadence

The scheduled recovery pass runs every 5 minutes but does not blindly retry every task.

It selects only these steps:

```text
ADMIN_CARD_PENDING
SOURCE_PENDING
CUSTOMER_CONFIRM_PENDING
RESULT_PENDING
```

Then it skips tasks whose `next_retry_at` has not arrived or whose `retry_count` reached the automatic cap. At most 20 due tasks are selected per recovery run.

## 11. First test

Before using a real book, follow [`testing.md`](testing.md) with a tiny `.txt` or `.pdf` file.

At minimum verify:

1. `/start` for active and unauthorized users;
2. one source upload produces one task;
3. admin receives task card and source file;
4. admin reply with translated file reaches customer;
5. task ends in `DONE / COMPLETE`;
6. a simulated Telegram send failure leaves a pending step instead of losing the task/result.

## Troubleshooting

### Telegram Trigger does not receive messages

Check that:

- workflow is active;
- n8n has a public HTTPS webhook URL;
- Telegram Trigger has the correct credential;
- another workflow/bot integration is not currently owning the same bot webhook.

### Telegram action nodes fail but Trigger works

Check that every Telegram send node has the intended credential assigned.

### Task remains pending after network returns

Check:

- `delivery_step`;
- `retry_count`;
- `next_retry_at`;
- the execution log for `Recovery Schedule`.

If `next_retry_at` is in the future, the backoff is working as designed.

### Old `bt_bot_state` table still exists

It is harmless if left unused, but the new workflow does not reference it and it can be deleted after migration.
