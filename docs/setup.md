# Setup

This guide assumes a local/self-hosted n8n instance and a Telegram bot created through `@BotFather`.

## 1. Telegram bot

Create a bot in Telegram and obtain its token.

The token is used locally in two places:

- an n8n **Telegram API** credential for outgoing messages/files;
- the workflow node **Bot Config** for polling through Telegram `getUpdates`.

The repository contains only the placeholder `PASTE_TELEGRAM_BOT_TOKEN_HERE`. Never commit your real token back to GitHub.

## 2. Import the workflow

Import:

```text
workflows/book-translator-mvp.json
```

The workflow uses polling, not Telegram Trigger/webhooks, so localhost is enough. n8n only needs outbound HTTPS access to `api.telegram.org`.

The polling chain is:

```text
Schedule Poll (10 sec)
  -> Bot Config
  -> Get Poll State
  -> Telegram getUpdates
  -> Expand Telegram Update
  -> Save Poll Offset
  -> Restore Telegram Update
  -> Normalize + Config
```

`Save Poll Offset` runs **before** the business logic. This prevents a slow task flow from causing the same Telegram update to be fetched again on the next schedule tick.

## 3. Configure Bot Config

Open **Bot Config** and replace only these three values:

```js
const TELEGRAM_BOT_TOKEN = 'PASTE_TELEGRAM_BOT_TOKEN_HERE';
const ADMIN_USER_ID = '0';
let ADMIN_CHAT_ID = '0';
```

Example for a private admin chat:

```js
const TELEGRAM_BOT_TOKEN = '123456789:YOUR_REAL_TOKEN';
const ADMIN_USER_ID = '123456789';
let ADMIN_CHAT_ID = '123456789';
```

For a private chat with the bot, `ADMIN_USER_ID` and `ADMIN_CHAT_ID` normally match.

This workflow intentionally does **not** use `$env` or paid n8n Variables.

## 4. Telegram credential

In n8n:

1. Open **Credentials**.
2. Create a **Telegram API** credential.
3. Paste the same BotFather token.
4. Save it.
5. Select this credential on every Telegram action node in the imported workflow.

There is no Telegram Trigger.

## 5. Remove an old webhook once

Telegram does not allow `getUpdates` while a webhook is active. If this bot was previously used with Telegram Trigger, remove the webhook once before publishing the polling workflow.

Use:

```text
https://api.telegram.org/bot<YOUR_TOKEN>/deleteWebhook
```

A successful response contains `"ok": true`.

## 6. Data Tables

Create exactly three Data Tables:

- `users`
- `tasks`
- `bot_state`

Follow [`data-model.md`](data-model.md) for column names and types.

For `bot_state`, add this initial row:

```text
key               value
telegram_offset   0
```

The workflow reads this value before `getUpdates` and immediately writes `update_id + 1` after receiving an update.

The `tasks` table also needs the `telegram_update_id` column. It is a second idempotency guard: the same Telegram upload must not create a second task even if it is accidentally seen again.

## 7. Add whitelist users

Add customers manually to `users`.

Example:

```text
user_id: 111111111
username: example_user
name: Example User
status: ACTIVE
created_at: 2026-09-17T12:00:00.000Z
```

Authorization uses numeric `user_id`, never username.

## 8. Check Telegram message nodes

The exported workflow intentionally contains no credential binding. After import, select the Telegram API credential on all Telegram action nodes.

All **Send Message** nodes have `Append n8n Attribution = false`, so the `This message was sent automatically with n8n` footer should not appear.

Dynamic task texts are prepared in the **Prepare Task Messages** Code node. Telegram message nodes only reference the finished strings, avoiding the expression syntax error previously seen in `Send Admin Task Card`.

## 9. Publish and test

Publish/activate **Book Translator MVP** and send `/start`.

Polling runs every 10 seconds, so the normal response delay is up to about 10 seconds.

Then run the scenarios in [`testing.md`](testing.md).

For one customer book upload, the expected result is strictly:

```text
1 Telegram upload
-> 1 tasks row
-> 1 admin task card
-> 1 source book to admin
-> 1 customer confirmation
```

If the same Telegram `update_id` is seen again, `Task Update Not Seen` stops task creation.

## Notes on files

Polling receives Telegram message metadata, including document `file_id`, without downloading the book. The workflow reuses that `file_id` to forward the source/result document through Telegram.
