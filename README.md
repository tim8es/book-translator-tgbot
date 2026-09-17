# Book Translator Telegram Bot — MVP

Private Telegram bot for accepting book-translation tasks and returning manually prepared translations.

## What the MVP does

1. n8n polls Telegram for one new message every 5 seconds.
2. The bot checks the user's numeric Telegram `user_id` against the `users` n8n Data Table.
3. Only rows with `status = ACTIVE` get access.
4. The user sends an EPUB, PDF, DOCX or TXT file.
5. The bot creates a random unique six-digit task number, for example `#482731`.
6. The administrator receives a task card and the source book in Telegram.
7. The administrator translates the book outside the bot.
8. When ready, the administrator replies to the task card with the translated file.
9. The bot sends that file back to the original customer and marks the task `DONE`.

The MVP does **not** automatically translate books and does **not** process payments.

## Architecture

```text
Customer Telegram
       |
       v
Telegram Bot API
       ^
       | getUpdates every 5 sec
       |
      n8n
   /        \
users      tasks
Data Table Data Table
   \        /
       |
       v
Admin Telegram
       |
translated file
       |
       v
Customer Telegram
```

Incoming messages use Telegram polling, so a local n8n instance does **not** need a public HTTPS URL, domain, ngrok or Cloudflare Tunnel.

Source and translated books are reused through Telegram `file_id` values. The workflow does not download source books merely to forward them.

## Quick start

### 1. Create a Telegram bot

Create a bot through `@BotFather` and copy the bot token.

Do not commit the token to this repository.

### 2. Create the n8n Telegram credential

In n8n create a **Telegram API** credential using the bot token. The outgoing Telegram nodes use this credential.

### 3. Create the Data Tables

Create two n8n Data Tables named exactly:

- `users`
- `tasks`

Use the schemas in [`docs/data-model.md`](docs/data-model.md).

### 4. Configure local n8n

Expose the bot token to the n8n process for polling:

```bash
TELEGRAM_BOT_TOKEN=123456789:YOUR_BOT_TOKEN
```

Also configure the administrator:

```bash
ADMIN_USER_ID=123456789
ADMIN_CHAT_ID=123456789
```

For a private admin chat, `ADMIN_USER_ID` and `ADMIN_CHAT_ID` normally match.

`TELEGRAM_BOT_TOKEN` must be available through `$env` because the polling HTTP nodes call Telegram's Bot API directly. If your n8n security policy blocks environment access in nodes, allow environment-variable access for this workflow.

For the two admin IDs only, there is also a fallback: open **Normalize + Config** and replace:

```js
const FALLBACK_ADMIN_USER_ID = '0';
const FALLBACK_ADMIN_CHAT_ID = '0';
```

with your numeric IDs.

### 5. Import the workflow

Import:

```text
workflows/book-translator-mvp.json
```

The exported workflow intentionally contains no credential binding. After import, assign the Telegram credential created in step 2 to all **Telegram** action nodes.

The workflow starts with:

```text
Schedule Poll
  -> Prepare Poll State
  -> Webhook Setup Switch
  -> Telegram getUpdates
  -> Expand Telegram Update
  -> Normalize + Config
```

On the first successful polling run it automatically calls Telegram `deleteWebhook`, then stores that setup state. After that it uses `getUpdates` only. The last processed Telegram `update_id` is stored in n8n workflow static data so the same update is not intentionally processed again.

### 6. Add a user to the whitelist

Add a row to `users`:

```text
user_id: 111111111
username: example_user
name: Example User
status: ACTIVE
```

Authorization uses only `user_id`. `username` is metadata and may change.

An unauthorized user receives their numeric Telegram ID in the rejection message, making it easy to send that ID to the administrator for manual whitelisting.

### 7. Publish and test

Publish/activate the workflow and run the manual smoke test from [`docs/testing.md`](docs/testing.md).

No public webhook URL is required. While the workflow is active, new Telegram messages are normally picked up within about 5 seconds.

## Local validation

The repository includes a dependency-free static validator for the workflow JSON:

```bash
npm test
```

It checks the polling entrypoint, Telegram token handling, table references, six-digit task-number generator, write schemas, secret leakage and critical state transitions.

This does **not** replace an actual run against your n8n instance and Telegram bot.

## Task lifecycle

```text
NEW -> PROCESSING -> DONE
  \--------------> REJECTED   # reserved/manual for MVP
```

A task becomes `PROCESSING` only after the admin task card is successfully sent and its message ID is saved. It becomes `DONE` only after Telegram successfully sends the translated document to the customer.

## Files

```text
.
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── workflows/
│   └── book-translator-mvp.json
├── scripts/
│   └── validate-workflow.mjs
├── docs/
│   ├── setup.md
│   ├── data-model.md
│   ├── testing.md
│   └── architecture.md
└── examples/
    ├── users.csv
    └── tasks.csv
```

## MVP limitations

- one administrator identity;
- polling latency up to roughly 5 seconds;
- polling offset is stored in n8n workflow static data;
- manual translation outside n8n;
- no payment flow;
- no cancellation UI;
- no customer task-history screen;
- no external database;
- random six-digit task IDs are collision-checked but are not a transaction-safe allocator for high concurrency;
- Data Tables are suitable for this private low-volume MVP, not as a long-term system of record for large scale.

See [`docs/architecture.md`](docs/architecture.md) for the upgrade path.
