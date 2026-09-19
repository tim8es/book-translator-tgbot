# Book Translator Telegram Bot — MVP

Private Telegram bot for accepting book-translation tasks and returning manually prepared translations. It is designed for a **local n8n instance without a public URL**.

## Flow

1. `Schedule Poll` checks Telegram every 30 seconds with `getUpdates` (`limit=1`).
2. A short lease in `bt_bot_state` prevents overlapping poll executions from processing the same update.
3. Access is checked by numeric Telegram `user_id` in `bt_bot_users`.
4. A first `/start` from an unknown user creates a `PENDING` row and notifies the administrator; it does **not** grant access.
5. The administrator approves manually by changing that row to `ACTIVE`.
6. Only an `ACTIVE` user can upload EPUB/PDF/DOCX/TXT and create a six-digit task in `bt_bot_tasks`.
7. The task and `source_file_id` are persisted before the Telegram cursor is acknowledged.
8. Admin receives the task card and source file; customer receives confirmation.
9. Admin replies to the task card with the translated document.
10. `translated_file_id` and `RESULT_PENDING` are persisted before that inbound update is acknowledged.
11. The result is sent to the customer; successful delivery ends at `DONE / COMPLETE`.

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

Critical Telegram sends use 3 short retries with a 5-second delay. A recovery schedule runs every 5 minutes and retries unfinished delivery steps with bounded backoff.

Polling state uses one JSON record in `bt_bot_state`:

```json
{"offset":0,"lockToken":"","lockUntil":0}
```

The workflow creates that row automatically if it is missing. Before an update is processed, the workflow obtains a compare-and-set lease for 120 seconds. Another overlapping poll sees the lease and exits. If an execution crashes, the lease expires automatically and polling resumes.

If Telegram reports error `409` because an old webhook is still attached to the bot, the workflow calls `deleteWebhook` itself with `drop_pending_updates=false`. The next polling cycle then continues normally without losing queued updates.

Telegram documents are stored and forwarded by `file_id`; the bot does not keep book binaries in persistent n8n storage just for routing.

## Local setup

Create one Telegram bot and one n8n **Telegram API** credential for its send nodes. Then create these Data Tables:

- `bt_bot_users`
- `bt_bot_tasks`
- `bt_bot_state`

For `bt_bot_state`, create only the columns:

```text
key   String
value String
```

No initial state row is required: the workflow initializes `telegram_state` itself.

Import `workflows/book-translator-mvp.json` and open **Bot Config**. Locally fill the bot-token placeholder and `ADMIN_USER_ID`; `ADMIN_CHAT_ID` may stay `0` to use the same private admin chat.

The repository export intentionally contains no real token and no credential binding. Do not commit your locally configured secret.

Assign the Telegram API credential to all Telegram Send Message / Send Document nodes and activate the workflow. You may pre-seed trusted customers with `status = ACTIVE`, but new users can instead request access through `/start`; they are stored as `PENDING` until you manually approve them.

## Runtime cost

At idle the two scheduled paths are approximately:

- polling every 30 seconds: 2,880 lightweight executions/day;
- recovery every 5 minutes: 288 lightweight executions/day.

Each empty poll performs only the state check and one short Telegram `getUpdates` request. The HTTP request has an explicit 10-second timeout and two network attempts so a stalled Telegram connection cannot hold an execution for the default five-minute HTTP timeout.

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
