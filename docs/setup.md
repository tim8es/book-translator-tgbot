# Local n8n setup

This workflow is built for a local n8n instance. **No public URL or Telegram webhook is required.**

## 1. Create the Telegram bot

Create a bot through `@BotFather` and keep its token private.

In n8n, create one **Telegram API** credential with that token. The credential is used by Telegram Send Message / Send Document nodes.

## 2. Create Data Tables

Create:

- `bt_bot_users`
- `bt_bot_tasks`
- `bt_bot_state`

Use [`data-model.md`](data-model.md) for the exact schemas.

`bt_bot_state` must contain this row before activation:

```text
key: telegram_offset
value: 0
```

`examples/state.csv` contains the same initial value.

## 3. Import the workflow

Import:

```text
workflows/book-translator-mvp.json
```

The repository export is intentionally inactive and contains no real bot token or n8n credential binding.

## 4. Configure `Bot Config`

Open **Bot Config**. Replace the local placeholders with your bot token and administrator Telegram ID.

`ADMIN_CHAT_ID` can remain `0` when the administrator uses a private chat with the bot; the workflow then falls back to `ADMIN_USER_ID`.

Do not commit your locally edited workflow containing the real token.

Why both token configuration and an n8n credential are needed:

- polling uses a generic HTTP Request to Telegram `getUpdates`, so it reads the token from `Bot Config`;
- outgoing Telegram nodes use the n8n Telegram API credential.

## 5. Assign the Telegram credential

Assign the same Telegram API credential to every Telegram Send Message / Send Document node.

There is no Telegram Trigger node in this version.

## 6. Add allowed customers

Add rows to `bt_bot_users` manually. Example:

```text
user_id: 111111111
username: example_user
name: Example User
status: ACTIVE
created_at: 2026-09-17T12:00:00.000Z
```

Authorization uses `user_id`, not username.

## 7. Make sure webhook mode is not active

Telegram does not allow `getUpdates` while a webhook is registered for the same bot. If this bot was previously connected to a webhook-based workflow, clear that webhook first. Do not run the old webhook workflow and this polling workflow at the same time.

## 8. Activate the workflow

The workflow has two scheduled entry points:

```text
Schedule Poll      every 30 seconds
Recovery Schedule every 5 minutes
```

No tunnel, reverse proxy, public domain, or public HTTPS endpoint is needed.

The poll path reads one update at a time. `bt_bot_state.telegram_offset` advances only after a safe checkpoint, so a failed execution can retry the same inbound update instead of silently skipping it.

## 9. Reliability behavior

Critical Telegram operations use:

```text
3 attempts
5 seconds between attempts
```

Longer delivery failures remain represented in `bt_bot_tasks` and are retried by the recovery path.

For a customer source upload, the task row and `source_file_id` are saved before offset acknowledgement. For the administrator's translated file, `translated_file_id` and `RESULT_PENDING` are saved before offset acknowledgement.

## 10. First test

Run:

```bash
npm test
```

Then use [`testing.md`](testing.md) and a small `.txt` or `.pdf` test document.

At minimum verify:

1. `/start` from admin, active customer and unauthorized customer;
2. one supported upload creates exactly one six-digit task;
3. admin receives task card and source document;
4. replying to the task card with a result reaches the original customer;
5. task finishes at `DONE / COMPLETE`;
6. a failed result delivery leaves `translated_file_id` stored in `RESULT_PENDING` for recovery.

## Troubleshooting

### `getUpdates` reports a webhook conflict

A webhook is still registered for the bot. Disable the old webhook integration before polling.

### Poll runs but receives nothing

Check:

- workflow is active;
- `Bot Config` uses the intended bot token;
- `bt_bot_state` contains `telegram_offset`;
- no other process is polling the same bot;
- the Telegram bot itself receives the message.

### Sends fail while polling works

Polling and sending use different n8n mechanisms. Check the Telegram API credential on every send node.

### Same task appears after a retry

Inspect `telegram_update_id` and `bt_bot_state.telegram_offset`. A replay of the same document update should match the existing task and only acknowledge the offset, not create another row.

### Task stays pending

Inspect `delivery_step`, `retry_count`, `next_retry_at`, and the Recovery Schedule execution log. A future `next_retry_at` means bounded backoff is working.
