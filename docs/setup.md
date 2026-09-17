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

Important for `bt_bot_state`:

```text
key   String
value String
```

You do **not** need to create an initial state row. On first run the workflow creates `telegram_state` automatically.

If you created the older version where `value` was Number and the row was `telegram_offset = 0`, recreate/change `bt_bot_state.value` to String. The old `telegram_offset` row is ignored by the current workflow.

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

- polling uses generic HTTP Request nodes for Telegram Bot API methods and reads the token from `Bot Config`;
- outgoing Telegram message/document nodes use the n8n Telegram API credential.

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

## 7. Activate the workflow

The workflow has two scheduled entry points:

```text
Schedule Poll      every 30 seconds
Recovery Schedule every 5 minutes
```

No tunnel, reverse proxy, public domain, or public HTTPS endpoint is needed.

### What happens automatically

The workflow now handles two setup/runtime concerns itself:

1. **Polling state initialization.** If `telegram_state` does not exist in `bt_bot_state`, it is created automatically.
2. **Old Telegram webhook.** If `getUpdates` receives Telegram error `409`, the workflow calls `deleteWebhook` with `drop_pending_updates=false`. Queued updates remain available and polling continues on the next cycle.

Do not deliberately run another poller or webhook workflow for the same bot at the same time.

## 8. Poll serialization

Before processing a fetched update, the workflow uses the single `telegram_state` row as a compare-and-set lease.

```text
read previous state
→ create 120-second lease token
→ update only if previous state is still unchanged
→ only the execution that acquired the lease continues
```

A second overlapping poll cannot process the update while the lease is active. If an execution crashes, the lease expires automatically after 120 seconds and later polling may recover.

The cursor is released/advanced only by an execution still owning that same lease.

## 9. Reliability behavior

Critical Telegram sends use:

```text
3 attempts
5 seconds between attempts
```

`getUpdates` itself uses a shorter network policy:

```text
10-second HTTP timeout
2 network attempts
```

This avoids n8n's long default HTTP timeout holding an idle poll execution for minutes.

Longer delivery failures remain represented in `bt_bot_tasks` and are retried by the recovery path.

For a customer source upload, the task row and `source_file_id` are saved before cursor acknowledgement. For the administrator's translated file, `translated_file_id` and `RESULT_PENDING` are saved before cursor acknowledgement.

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

### First poll creates no state

Check that `bt_bot_state` exists and its `value` column is **String**. The row itself should be created automatically.

### Poll runs but receives nothing

Check:

- workflow is active;
- `Bot Config` uses the intended bot token;
- no other active process is continuously polling the same bot;
- the Telegram bot itself receives the message.

An old webhook does not require manual cleanup: a `409` response should route through `Telegram deleteWebhook` automatically.

### Sends fail while polling works

Polling and sending use different n8n mechanisms. Check the Telegram API credential on every send node.

### Same task appears after a retry

Inspect `telegram_update_id` and `bt_bot_state.telegram_state`. A replay of the same customer document update should match the existing task and acknowledge it rather than creating another row.

### Polling pauses after a failed execution

Inspect `telegram_state.lockUntil`. The processing lease lasts up to 120 seconds. This pause is intentional: after expiry the next scheduled poll can recover the same unacknowledged update.

### Task stays pending

Inspect `delivery_step`, `retry_count`, `next_retry_at`, and the Recovery Schedule execution log. A future `next_retry_at` means bounded backoff is working.
