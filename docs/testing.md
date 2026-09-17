# Manual test matrix

Run `npm test` first, then test against the local n8n instance and Telegram bot.

## Preconditions

- workflow imported;
- **Bot Config** contains local bot token, `ADMIN_USER_ID`, and `ADMIN_CHAT_ID`;
- Telegram API credential selected on all Telegram action nodes;
- `bt_bot_users`, `bt_bot_tasks`, and `bt_bot_state` exist;
- `bt_bot_state` contains `telegram_offset = 0` (or the current offset after prior tests);
- `bt_bot_tasks` includes the `telegram_update_id` Number column;
- any old Telegram webhook for this bot has been deleted once;
- one test customer and one small supported source file are available.

## T00 — polling entrypoint

1. Publish/activate the workflow.
2. Send `/start` from the administrator account.
3. Wait up to 10 seconds.

Expected:

- `Schedule Poll` runs every 10 seconds;
- `Get Poll State` reads `bot_state.telegram_offset`;
- `Telegram getUpdates` receives the update;
- `Save Poll Offset` writes `update_id + 1` before `Normalize + Config` runs;
- admin receives exactly one admin-mode message;
- the message does not contain the n8n attribution footer.

## T01 — unauthorized user

Send `/start` from a customer absent from `bt_bot_users` or with `status = BLOCKED`.

Expected:

- exactly one access-denied message;
- message includes numeric Telegram ID;
- no task is created.

## T02 — whitelist activation

Add the customer with `status = ACTIVE`, then send `/start`.

Expected:

- exactly one access-confirmation message;
- no task is created from `/start`.

## T03 — unsupported file

Send an unsupported document such as `.zip`.

Expected:

- exactly one unsupported-format message;
- no task row.

## T04 — create one task

Send one supported EPUB/PDF/DOCX/TXT document once.

Expected `bt_bot_tasks` result:

- exactly **one** new row;
- `telegram_update_id` is populated;
- `task_no` is six digits;
- `source_file_id` and `source_filename` are populated;
- after admin notification, status is `PROCESSING`;
- `admin_task_message_id` is populated.

Expected customer result:

- exactly **one** confirmation;
- it contains the same six-digit task number;
- it contains `до 15 минут на каждые 10 000 знаков`;
- no n8n attribution footer.

Expected admin result:

- exactly **one** task card;
- exactly **one** source document;
- both use the same task number;
- no n8n attribution footer on the task-card message.

## T05 — duplicate Telegram update guard

This verifies the bug where one upload previously created several tasks.

1. Note the `telegram_update_id` from the task created in T04.
2. In a disposable workflow copy, feed the same normalized update into `Task Update Not Seen` again, or temporarily replay the same captured update.

Expected:

- `Task Update Not Seen` produces no task-creation output;
- no second `bt_bot_tasks` row is created;
- admin/customer receive no duplicate task notifications.

Do not change `telegram_update_id` during this test.

## T06 — polling offset persistence

After any processed message, inspect `bt_bot_state`.

Expected:

```text
telegram_offset = last processed update_id + 1
```

The value must be written before the customer/admin business branch executes.

## T07 — admin document without task-card reply

Send a result file directly to the bot as admin without replying to the task card.

Expected:

- one guidance message;
- customer receives nothing;
- task remains `PROCESSING`.

## T08 — wrong reply target

Reply with the result file to the source-document message instead of the task-card message.

Expected:

- task cannot be mapped;
- customer receives nothing;
- task remains `PROCESSING`.

## T09 — successful completion

Reply to the **task card** with the translated/result document.

Expected:

- customer receives exactly one result document;
- caption contains the task number;
- `translated_file_id` is stored;
- status becomes `DONE`;
- `completed_at` is populated;
- admin receives one completion confirmation.

## T10 — duplicate completion protection

Reply to the same task card again with another document.

Expected:

- bot reports that the task is already complete;
- customer does not receive a second automatic result;
- task remains `DONE`.

## T11 — immediate block

Change customer status to `BLOCKED` and send another message.

Expected:

- access is denied on the next interaction;
- no new task is created.

## T12 — task-number collision path

In a disposable workflow copy, force one generated candidate to an existing `task_no` and another candidate to an unused value.

Expected:

- existing number is removed by `Unused Task Number`;
- an unused six-digit number is selected;
- no existing task is overwritten.

## Acceptance gate

Treat the MVP as locally verified when T00–T11 pass on the real local n8n instance. T12 is an optional controlled collision test.
