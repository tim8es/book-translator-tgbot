# Manual test matrix

Run `npm test` first, then test the imported workflow against your n8n instance and Telegram bot.

## Preconditions

- workflow imported and active;
- n8n has a public HTTPS webhook URL;
- Telegram Trigger uses the intended Telegram API credential;
- all Telegram action nodes use the intended Telegram API credential;
- **Bot Config** contains the local `ADMIN_USER_ID` and `ADMIN_CHAT_ID`;
- `bt_bot_users` and `bt_bot_tasks` exist with the schema from `docs/data-model.md`;
- one active test customer exists;
- one small supported source file is available;
- `bt_bot_tasks` is empty or contains only rows you intentionally want to keep.

## T00 — webhook entrypoint

1. Activate the workflow.
2. Send `/start` from the administrator account.

Expected:

- `Telegram Trigger` receives the update without waiting for a polling interval;
- admin receives exactly one admin-mode response;
- no `bt_bot_state` table is read or written;
- no task is created.

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

Expected in `bt_bot_tasks`:

- exactly one new row;
- `telegram_update_id` is populated;
- `task_no` is six digits;
- `source_file_id` and `source_filename` are populated;
- `admin_task_text`, `source_caption` and `customer_confirmation_text` are persisted;
- `retry_count = 0` initially;
- after the full notification flow succeeds, `status = PROCESSING`;
- after the full notification flow succeeds, `delivery_step = WAITING_RESULT`;
- `admin_task_message_id` is populated.

Expected customer result:

- exactly one confirmation;
- it contains the same six-digit task number;
- it contains `до 15 минут на каждые 10 000 знаков`.

Expected admin result:

- exactly one task card;
- exactly one source document;
- both use the same task number.

## T05 — duplicate Telegram update guard

Replay the exact same captured customer document update in a disposable workflow/test path.

Expected:

- no second `bt_bot_tasks` row;
- no second task number;
- no duplicate admin/customer task notification.

Do not alter the original `telegram_update_id` during this test.

## T06 — admin document without task-card reply

Send a result file directly to the bot as admin without replying to the task card.

Expected:

- one guidance message;
- customer receives nothing;
- task remains `PROCESSING / WAITING_RESULT`.

## T07 — wrong reply target

Reply with the result file to the source-document message instead of the task-card message.

Expected:

- task cannot be mapped;
- customer receives nothing;
- task remains `PROCESSING / WAITING_RESULT`.

## T08 — successful completion

Reply to the **task card** with the translated/result document.

Expected transition before customer delivery:

```text
translated_file_id = Telegram file_id from admin upload
status = DELIVERY_PENDING
delivery_step = RESULT_PENDING
```

Expected after successful customer delivery:

- customer receives exactly one result document;
- caption contains the task number;
- `status = DONE`;
- `delivery_step = COMPLETE`;
- `completed_at` is populated;
- admin receives one completion confirmation.

## T09 — duplicate completion protection

Reply to the same task card again with another document after the task is `DONE`.

Expected:

- bot reports that the task is already complete;
- customer does not receive a second automatic result;
- task remains `DONE / COMPLETE`.

## T10 — immediate block

Change customer status to `BLOCKED` and send another message.

Expected:

- access is denied on the next interaction;
- no new task is created.

## T11 — task-number collision path

In a disposable workflow copy, force one generated candidate to an existing `task_no` and another candidate to an unused value.

Expected:

- existing number is rejected;
- an unused six-digit number is selected;
- no existing task is overwritten.

## T12 — short network failure

Temporarily cause a critical Telegram send to fail for less than the node retry window, then restore connectivity.

Expected:

- Telegram node retries automatically;
- no duplicate task row is created;
- the operation completes without waiting for scheduled recovery.

## T13 — admin card delivery outage

Test on a disposable task or controlled environment.

1. Make Telegram outbound delivery unavailable after the task row has been inserted but before the admin card succeeds.
2. Keep the outage longer than the short node retry window.
3. Restore connectivity.

Expected while unavailable:

```text
status = NEW
delivery_step = ADMIN_CARD_PENDING
```

Expected after a due recovery pass:

- admin card is delivered;
- `admin_task_message_id` is saved;
- workflow proceeds to the next pending step rather than creating a new task.

## T14 — source delivery outage

Cause the source-document send to admin to fail after the admin card has succeeded.

Expected while unavailable:

```text
admin_task_message_id is populated
delivery_step = SOURCE_PENDING
```

After recovery:

- source file is delivered from saved `source_file_id`;
- task advances to customer-confirmation step;
- no new task/card is created.

## T15 — customer confirmation outage

Cause customer confirmation to fail after admin has received the source file.

Expected while unavailable:

```text
delivery_step = CUSTOMER_CONFIRM_PENDING
```

After recovery:

- saved `customer_confirmation_text` is delivered;
- task becomes `PROCESSING / WAITING_RESULT`.

## T16 — result delivery outage — critical acceptance test

This is the most important reliability test.

1. Complete a task normally up to `PROCESSING / WAITING_RESULT`.
2. Make outbound Telegram delivery unavailable.
3. Reply to the task card with a translated document.
4. Let the immediate Telegram retries fail.

Expected **before connectivity is restored**:

```text
translated_file_id is populated
status = DELIVERY_PENDING
delivery_step = RESULT_PENDING
```

The translated `file_id` must remain stored even though the customer has not received the file.

5. Restore connectivity.
6. Wait until the task is eligible for recovery.

Expected:

- recovery sends the saved translated file to the original customer;
- task becomes `DONE / COMPLETE`;
- admin does not need to upload the translation again.

## T17 — n8n restart with pending delivery

Create any durable pending state (`SOURCE_PENDING`, `CUSTOMER_CONFIRM_PENDING` or `RESULT_PENDING`), then restart n8n before delivery succeeds.

Expected after n8n returns:

- pending state is still present in `bt_bot_tasks`;
- a later recovery run continues from the saved step;
- original Telegram file references are reused;
- no duplicate task is created.

## T18 — recovery backoff

Force a pending delivery to fail across multiple recovery runs.

Expected:

- `retry_count` increases;
- `retry_at` moves forward using increasing backoff;
- recovery does not retry the same task on every 5-minute tick when `retry_at` is still in the future;
- automatic retries eventually stop at the configured cap instead of spinning forever.

## T19 — idle resource behavior

Leave the bot idle for at least 10 minutes.

Expected:

- main Telegram flow has no executions caused by polling;
- only scheduled recovery executions occur;
- recovery exits quickly when there are no due pending tasks.

## Acceptance gate

Treat the MVP as ready for normal local/limited use when:

- `npm test` passes;
- T00–T10 pass;
- T16 passes — translated file survives a delivery outage;
- T17 passes — pending delivery survives an n8n restart;
- T19 confirms there is no continuous 10-second polling.

T11–T15 and T18 are recommended controlled resilience tests.
