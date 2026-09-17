# Book Translator Telegram Bot — MVP

Private Telegram bot for accepting book-translation tasks and returning manually prepared translations. The MVP is designed for a **local n8n instance without a public URL**.

## Flow

1. `Schedule Poll` checks Telegram every 30 seconds with `getUpdates` (`limit=1`).
2. Access is checked by numeric Telegram `user_id` in `bt_bot_users`.
3. EPUB/PDF/DOCX/TXT upload creates one six-digit task in `bt_bot_tasks`.
4. The task and `source_file_id` are persisted before the Telegram offset is advanced.
5. Admin receives the task card and source file; customer receives confirmation.
6. Admin replies to the task card with the translated document.
7. `translated_file_id` and `RESULT_PENDING` are persisted before that update is acknowledged.
8. The result is sent to the customer; successful delivery ends at `DONE / COMPLETE`.

No webhook, tunnel, reverse proxy, domain, or public HTTPS endpoint is required.

## Reliability

`bt_bot_tasks` is the durable delivery state machine:

```text
ADMIN_CARD_PENDING
→ SOURCE_PENDING
→ CUSTOMER_CONFIRM_PENDING
→ WAITING_RESULT
→ RESULT_PENDING
→ COMPLETE
```

Critical Telegram calls use 3 short retries with a 5-second delay. A recovery schedule runs every 5 minutes and retries unfinished delivery steps with bounded backoff.

Telegram documents are stored and forwarded by `file_id`; the bot does not need to keep book binaries in persistent n8n storage just for routing.

## Local setup

Create one Telegram bot and one n8n **Telegram API** credential for its send nodes. Then create these Data Tables:

- `bt_bot_users`
- `bt_bot_tasks`
- `bt_bot_state`

`bt_bot_state` needs `key` (String) and `value` (Number), with one initial row:

```text
key: telegram_offset
value: 0
```

Import `workflows/book-translator-mvp.json` and open **Bot Config**. Locally fill the bot-token placeholder and `ADMIN_USER_ID`; `ADMIN_CHAT_ID` may stay `0` to use the same private admin chat.

The repository export intentionally contains no real token and no credential binding. Do not commit your locally configured secret.

Assign the Telegram API credential to all Telegram Send Message / Send Document nodes, add allowed customers to `bt_bot_users` with `status = ACTIVE`, and activate the workflow.

If this bot was previously configured to use a Telegram webhook, clear that old webhook before using polling because Telegram does not serve `getUpdates` while a webhook is active.

## Runtime cost

At idle the two scheduled paths are approximately:

- polling every 30 seconds: 2,880 executions/day;
- recovery every 5 minutes: 288 executions/day.

## Validation

```bash
npm test
```

Then follow [`docs/testing.md`](docs/testing.md) with a small test document.

More details:

- [`docs/setup.md`](docs/setup.md)
- [`docs/data-model.md`](docs/data-model.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/testing.md`](docs/testing.md)
