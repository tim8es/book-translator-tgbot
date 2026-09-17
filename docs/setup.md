# Setup

This guide assumes a local/self-hosted n8n instance and a Telegram bot created through `@BotFather`.

## 1. Telegram bot

Create a new bot in Telegram and obtain its token.

The same token is used in two places locally:

- an n8n **Telegram API** credential for outgoing messages/files;
- the `TELEGRAM_BOT_TOKEN` environment variable for incoming polling via Telegram `getUpdates`.

Do not commit the token to workflow JSON, screenshots or the repository.

## 2. Administrator IDs

The workflow distinguishes the administrator by numeric Telegram user ID.

You need:

- `ADMIN_USER_ID` — numeric Telegram account ID of the administrator;
- `ADMIN_CHAT_ID` — chat where task cards and source books are sent.

For a private chat with the bot these values normally match.

If you do not yet know your ID, you can use a Telegram ID helper bot. After polling is working, an unauthorized account also receives its numeric Telegram ID from this workflow.

## 3. Configure n8n environment

Expose these variables to the n8n process before starting it:

```bash
TELEGRAM_BOT_TOKEN=123456789:YOUR_BOT_TOKEN
ADMIN_USER_ID=123456789
ADMIN_CHAT_ID=123456789
```

Restart n8n after changing its environment.

The polling nodes reference `$env.TELEGRAM_BOT_TOKEN`. **Normalize + Config** reads `$env.ADMIN_USER_ID` and `$env.ADMIN_CHAT_ID`.

If your n8n security policy blocks environment-variable access inside nodes, allow it for this self-hosted instance. Polling cannot call Telegram without access to `TELEGRAM_BOT_TOKEN`.

For the two administrator IDs only, a workflow-local fallback exists. Open **Normalize + Config** and edit:

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

The repository workflow contains no credential ID. After import, select this Telegram credential on every **Telegram** action node. There is no Telegram Trigger anymore.

## 5. Data Tables

Create Data Tables named exactly `users` and `tasks`. Follow [`data-model.md`](data-model.md) exactly for column names and types.

n8n automatically creates the system columns `id`, `createdAt` and `updatedAt`; do not add them manually.

If a Data Table write node displays `Currently no items exist` after import, reload/refresh the node's column mapping. The workflow JSON contains explicit `columns.value` and `columns.schema` mappings.

## 6. Import workflow

Import `workflows/book-translator-mvp.json` through the n8n workflow import UI.

The input side should begin with this chain:

```text
Schedule Poll
  -> Prepare Poll State
  -> Webhook Setup Switch
       | first run
       v
     Delete Telegram Webhook
       -> Mark Webhook Deleted
       -> Telegram getUpdates

       later runs
       -> Telegram getUpdates
  -> Expand Telegram Update
  -> Normalize + Config
```

`Schedule Poll` runs every 5 seconds. `Telegram getUpdates` requests only one update per execution so the existing workflow continues to process one Telegram event at a time.

The first polling execution automatically calls `deleteWebhook`. This removes any old Telegram webhook registration, including one left by a previous Telegram Trigger. You do not need a public HTTPS URL.

The workflow stores the next Telegram `offset` in n8n workflow static data using `update_id + 1`.

Before activation verify:

- `TELEGRAM_BOT_TOKEN` is visible to n8n;
- Telegram credential is selected on all Telegram action nodes;
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

## 8. Publish

Publish/activate **Book Translator MVP**.

Unlike Telegram Trigger, `Schedule Poll` does not register a webhook. Localhost is sufficient as long as n8n itself can make outbound HTTPS requests to `api.telegram.org`.

After publishing, send `/start` to the bot. The message should normally be picked up within about 5 seconds.

## 9. First end-to-end run

Use the scenario in [`testing.md`](testing.md):

1. administrator sends `/start` and receives admin-mode guidance;
2. unauthorized customer is denied;
3. whitelisted customer is accepted;
4. customer sends a supported book;
5. admin receives task card + source book;
6. admin replies to the task card with a translated file;
7. customer receives it;
8. `tasks.status` becomes `DONE`.

## Notes on files

Polling receives Telegram message metadata, including document `file_id`, without downloading book contents. The workflow stores those `file_id` values and uses **Send Document** to forward source/result files.

Actual Telegram and n8n deployment limits still apply. If future automation must parse or modify the source book, add an explicit download/storage step at that stage rather than changing the customer-facing flow.
