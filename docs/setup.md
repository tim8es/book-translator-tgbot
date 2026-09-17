# Setup

This guide assumes a local/self-hosted n8n instance and a Telegram bot created through `@BotFather`.

## 1. Telegram bot

Create a new bot in Telegram and obtain its token. Store the token only in an n8n Telegram credential. Do not paste it into workflow JSON, `.env.example`, screenshots or commits.

## 2. Administrator IDs

The workflow distinguishes the administrator by numeric Telegram user ID.

You need:

- `ADMIN_USER_ID` — numeric Telegram account ID of the administrator;
- `ADMIN_CHAT_ID` — chat where task cards and source books are sent.

For a private chat with the bot these values normally match.

Ways to determine your ID include using a Telegram ID helper bot or temporarily inspecting a Telegram Trigger execution after sending a message to your bot; the sender ID is `message.from.id` and the chat ID is `message.chat.id`.

## 3. Configure n8n

### Option A — environment variables

Expose the variables to the n8n process before starting it:

```bash
ADMIN_USER_ID=123456789
ADMIN_CHAT_ID=123456789
```

The workflow's **Normalize + Config** Code node reads `$env.ADMIN_USER_ID` and `$env.ADMIN_CHAT_ID`.

If your n8n security policy blocks environment access inside nodes, use option B.

### Option B — workflow fallback values

Open **Normalize + Config** and edit:

```js
const FALLBACK_ADMIN_USER_ID = '0';
const FALLBACK_ADMIN_CHAT_ID = '0';
```

Use numeric IDs as strings. These IDs are not bot secrets, but avoid committing personal values back to a public repository.

## 4. Telegram credential

In n8n:

1. Open **Credentials**.
2. Create a **Telegram API** credential.
3. Paste the BotFather token.
4. Save it.

The repository workflow contains no credential ID. After import, select the same Telegram credential on the **Telegram Trigger** and every **Telegram** action node.

## 5. Data Tables

Create Data Tables named exactly `users` and `tasks`. Follow [`data-model.md`](data-model.md) exactly for column names and types.

n8n automatically creates the system columns `id`, `createdAt` and `updatedAt`; do not add them manually.

If a Data Table write node displays `Currently no items exist` after import, reload/refresh the node's column mapping. The workflow JSON contains explicit `columns.value` and `columns.schema` mappings.

## 6. Import workflow

Import `workflows/book-translator-mvp.json` through the n8n workflow import UI.

Before activation verify:

- Telegram credential selected on all Telegram nodes;
- `users` and `tasks` tables exist with the documented schemas;
- admin IDs resolve to non-zero values;
- workflow remains inactive while you finish setup.

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

The workflow never authorizes by username. Users can change usernames; numeric `user_id` is stable for this purpose.

A blocked user should remain in the table with `status = BLOCKED` if you want to retain the record.

## 8. Activate

Telegram allows only one active webhook/Telegram Trigger per bot at a time. Make sure another n8n workflow is not using the same bot, then activate **Book Translator MVP**.

## 9. First end-to-end run

Use the scenario in [`testing.md`](testing.md):

1. unauthorized customer denied;
2. whitelisted customer accepted;
3. customer sends supported book;
4. admin receives task card + source book;
5. admin replies to the task card with a translated file;
6. customer receives it;
7. `tasks.status` becomes `DONE`.

## Notes on files

The Telegram Trigger has file downloading disabled. The workflow stores Telegram `file_id` values and uses **Send Document** with those IDs to forward source/result files. This avoids moving source books through n8n binary storage for the MVP.

Actual Telegram and n8n deployment limits still apply. If future automation must parse or modify the source book, add an explicit download/storage step at that stage rather than changing the customer-facing flow.
