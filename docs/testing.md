# Manual test matrix

Run `npm test` first, then test the imported workflow against local n8n and the Telegram bot.

## Preconditions

- workflow imported and active;
- no public URL is required;
- **Bot Config** contains the local bot token and admin ID;
- every Telegram send node has the intended Telegram API credential;
- `bt_bot_users`, `bt_bot_tasks`, and `bt_bot_state` exist;
- `bt_bot_state` contains `telegram_offset = 0` for a fresh test;
- one active test customer exists;
- one small supported test document is available;
- no webhook or second poller is active for the same bot.

## T00 — polling entrypoint

1. Activate the workflow.
2. Send `/start` from admin.

Expected:

- `Schedule Poll` picks up the message within the next polling cycles;
- exactly one admin-mode response is sent;
- `telegram_offset` advances past the update;
- no task is created.

## T01 — unauthorized user

Send `/start` from a user absent from `bt_bot_users` or marked `BLOCKED`.

Expected: one access-denied response, numeric Telegram ID shown, no task, then offset advances.

## T02 — active user

Add the customer with `status = ACTIVE`, then send `/start`.

Expected: one access-confirmation response, no task, offset advances after the response succeeds.

## T03 — unsupported file

Send a `.zip` or another unsupported document.

Expected: one format-help response, no task, offset advances after the response succeeds.

## T04 — create one task

Send one EPUB/PDF/DOCX/TXT document.

Expected in `bt_bot_tasks`:

- exactly one row;
- six-digit `task_no`;
- `telegram_update_id`, `source_file_id`, filename and customer/admin IDs populated;
- task is inserted before `bt_bot_state.telegram_offset` advances;
- after notifications succeed: `status = PROCESSING`, `delivery_step = WAITING_RESULT`, `admin_task_message_id` populated.

Expected in Telegram:

- admin receives one task card and one source document;
- customer receives one confirmation with the same task number.

## T05 — duplicate inbound update

Replay the exact same customer document update in a disposable test path without changing `update_id`.

Expected: no second task row or task number; the duplicate path only advances the offset.

## T06 — admin result without replying to task card

Send a result document directly as admin.

Expected: guidance response; customer receives nothing; task remains `PROCESSING / WAITING_RESULT`.

## T07 — wrong reply target

Reply with the result file to the source-document message instead of the task-card message.

Expected: task cannot be mapped; customer receives nothing; original task stays waiting.

## T08 — successful completion

Reply to the task card with the translated document.

Before customer delivery, verify:

```text
translated_file_id is populated
status = DELIVERY_PENDING
delivery_step = RESULT_PENDING
telegram_offset has advanced past the admin upload
```

After successful delivery:

```text
status = DONE
delivery_step = COMPLETE
completed_at is populated
next_retry_at is empty/null
```

Customer should receive one result document and admin should receive completion confirmation.

## T09 — duplicate completion protection

Reply to the same task card again after `DONE`.

Expected: bot reports already completed; no second automatic customer result.

## T10 — blocked user takes effect immediately

Change the active customer's status to `BLOCKED`, then send another message.

Expected: access denied on the next interaction; no new task.

## T11 — source delivery outage

Force the Telegram source send to fail after the task row exists.

Expected while unavailable:

```text
delivery_step = ADMIN_CARD_PENDING
```

or, if the card already succeeded:

```text
delivery_step = SOURCE_PENDING
```

After connectivity returns and recovery becomes due, delivery resumes from the persisted step without a new task.

## T12 — result delivery outage — critical test

1. Reach `PROCESSING / WAITING_RESULT`.
2. Make outbound Telegram delivery unavailable.
3. Admin replies to the task card with a translated document.
4. Let immediate send retries fail.

Expected before connectivity returns:

```text
translated_file_id is populated
status = DELIVERY_PENDING
delivery_step = RESULT_PENDING
```

Also verify `bt_bot_state.telegram_offset` has advanced past the admin upload. This proves the update was acknowledged only after its `file_id` became durable.

Restore connectivity and wait until recovery is due.

Expected: stored result is delivered without another admin upload, then task becomes `DONE / COMPLETE`.

## T13 — restart safety

Create a pending state such as `SOURCE_PENDING` or `RESULT_PENDING`, then restart n8n.

Expected after restart: task state and Telegram `file_id` remain in Data Tables and recovery continues from the saved step.

## T14 — recovery backoff

Keep a pending delivery failing across recovery runs.

Expected:

- `retry_count` rises;
- `next_retry_at` follows increasing backoff;
- a task is not retried every 5-minute tick before its due time;
- no more than 20 due tasks are selected per recovery run;
- automatic persistent retry stops after 8 attempts.

## T15 — idle behavior

Leave the active workflow idle for at least 10 minutes.

Expected:

- poll execution approximately every 30 seconds;
- recovery execution every 5 minutes;
- no Telegram webhook trigger executions;
- empty polls terminate without creating tasks or changing the offset.

## Acceptance gate

Treat the MVP as ready for local limited use when:

- `npm test` passes;
- T00–T10 pass;
- T12 proves result `file_id` survives a delivery outage;
- T13 proves pending work survives an n8n restart;
- T15 confirms the intended polling cadence.
