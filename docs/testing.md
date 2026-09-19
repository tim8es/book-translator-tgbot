# Manual test matrix

Run `npm test` first, then test the imported workflow against local n8n and the Telegram bot.

## Preconditions

- workflow imported and active;
- no public URL is required;
- **Bot Config** contains the local bot token and admin ID;
- every Telegram send node has the intended Telegram API credential;
- `bt_bot_users`, `bt_bot_tasks`, and `bt_bot_state` exist;
- `bt_bot_state` has `key` = String and `value` = String; no initial row is required;
- one Telegram account absent from `bt_bot_users` is available for access-request tests;
- one active test customer exists;
- `bt_bot_users` includes the optional Date column `request_notified_at`;
- one small supported test document is available;
- no intentionally running second bot consumer exists.

## T00 — automatic polling-state initialization

Start with an empty `bt_bot_state` table and activate the workflow.

Expected after the first polling cycle:

```text
key = telegram_state
value contains offset, lockToken and lockUntil
```

No manual `telegram_offset = 0` row should be required.

## T01 — polling entrypoint

Send `/start` from admin.

Expected:

- `Schedule Poll` picks up the message within the next polling cycles;
- exactly one admin-mode response is sent;
- `telegram_state.offset` advances past the update;
- the state ends unlocked (`lockToken` empty and `lockUntil = 0`);
- no task is created.

## T02 — new user creates an access request

Send `/start` from a user absent from `bt_bot_users`.

Expected in `bt_bot_users`:

- exactly one row is inserted for that numeric `user_id`;
- `status = PENDING`;
- username/name metadata is captured when Telegram provides it;
- `created_at` is populated;
- after successful admin notification, `request_notified_at` is populated.

Expected in Telegram:

- administrator receives one access-request message containing name, username and numeric user ID;
- customer receives confirmation that the request was sent;
- no translation task is created.

## T02A — repeat pending request

Send `/start` again from the same user while the row is still `PENDING` and `request_notified_at` is populated.

Expected:

- no second `bt_bot_users` row;
- no normal duplicate admin request notification;
- customer receives the "already awaiting review" response;
- no translation task is created.

## T02B — missing user sends something other than /start

Use another user absent from `bt_bot_users` and send text or a document without first sending `/start`.

Expected:

- no user row is inserted;
- no task is created;
- bot instructs the user to send `/start` to request access.

## T03 — active user

Change the pending test user's `status` to `ACTIVE`, then send `/start`.

Expected: one access-confirmation response, no task, cursor advances only after the response succeeds.

## T03A — rejected or blocked user

Set the test user's status to `REJECTED` or `BLOCKED`, then send another message.

Expected: access denied immediately; no task and no new access-request row.

## T04 — unsupported file

Send a `.zip` or another unsupported document.

Expected: one format-help response, no task, cursor advances after the response succeeds.

## T05 — create one task

Send one EPUB/PDF/DOCX/TXT document.

Expected in `bt_bot_tasks`:

- exactly one row;
- six-digit `task_no`;
- `telegram_update_id`, `source_file_id`, filename and customer/admin IDs populated;
- task is inserted before `telegram_state.offset` advances;
- after notifications succeed: `status = PROCESSING`, `delivery_step = WAITING_RESULT`, `admin_task_message_id` populated.

Expected in Telegram:

- admin receives one task card and one source document;
- customer receives one confirmation with the same task number.

## T06 — duplicate inbound update

Replay the exact same customer document update in a disposable test path without changing `update_id`.

Expected: no second task row or task number; the duplicate path only advances the cursor.

## T07 — admin result without replying to task card

Send a result document directly as admin.

Expected: guidance response; customer receives nothing; task remains `PROCESSING / WAITING_RESULT`.

## T08 — wrong reply target

Reply with the result file to the source-document message instead of the task-card message.

Expected: task cannot be mapped; customer receives nothing; original task stays waiting.

## T09 — successful completion

Reply to the task card with the translated document.

Before customer delivery, verify:

```text
translated_file_id is populated
status = DELIVERY_PENDING
delivery_step = RESULT_PENDING
telegram_state.offset has advanced past the admin upload
```

After successful delivery:

```text
status = DONE
delivery_step = COMPLETE
completed_at is populated
next_retry_at is empty/null
```

Customer should receive one result document and admin should receive completion confirmation.

## T10 — duplicate completion protection

Reply to the same task card again after `DONE`.

Expected: bot reports already completed; no second normal customer result.

## T11 — blocked user takes effect immediately

Change the active customer's status to `BLOCKED`, then send another message.

Expected: access denied on the next interaction; no new task.

## T12 — old webhook self-healing

Temporarily configure the same Telegram bot with a webhook or reproduce Telegram `getUpdates` error `409`, then leave the polling workflow active.

Expected:

- `Telegram getUpdates` does not crash on the HTTP 409 response;
- `Poll Response Switch` routes to `Telegram deleteWebhook`;
- `deleteWebhook` uses `drop_pending_updates=false`;
- no cursor is advanced by the conflict;
- on a later polling cycle the queued update is still received.

No manual webhook cleanup should be necessary.

## T13 — overlapping poll serialization

Create conditions where one poll holds `telegram_state` long enough for another 30-second schedule tick to start. This can be simulated in a disposable copy by temporarily delaying the path after `Acquire Poll Lock`.

Expected:

- first execution writes a non-empty `lockToken` and future `lockUntil`;
- second scheduled execution exits at `Can Poll Switch` without calling `getUpdates` while the lease is active;
- only the lease owner processes the update;
- acknowledgement clears the lease.

## T14 — abandoned lease recovery

In a disposable test copy, stop/fail an execution after `Acquire Poll Lock` but before any acknowledgement.

Expected:

- `telegram_state` remains locked temporarily;
- polls during the 120-second lease do not process the update;
- after `lockUntil` expires, a later poll can acquire a new lease and process the same unacknowledged update;
- no permanent deadlock remains.

## T15 — source delivery outage

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

## T16 — result delivery outage — critical test

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

Also verify `telegram_state.offset` has advanced past the admin upload. This proves the update was acknowledged only after its `file_id` became durable.

Restore connectivity and wait until recovery is due.

Expected: stored result is delivered without another admin upload, then task becomes `DONE / COMPLETE`.

## T17 — restart safety

Create a pending state such as `SOURCE_PENDING` or `RESULT_PENDING`, then restart n8n.

Expected after restart: task state and Telegram `file_id` remain in Data Tables and recovery continues from the saved step.

If the restart occurred while a poll lease was held, polling should resume after the lease TTL expires.

## T18 — recovery backoff

Keep a pending delivery failing across recovery runs.

Expected:

- `retry_count` rises;
- `next_retry_at` follows increasing backoff;
- a task is not retried every 5-minute tick before its due time;
- no more than 20 due tasks are selected per recovery run;
- automatic persistent retry stops after 8 attempts.

## T19 — idle behavior

Leave the active workflow idle for at least 10 minutes.

Expected:

- poll execution approximately every 30 seconds;
- recovery execution every 5 minutes;
- no Telegram webhook trigger executions;
- empty polls terminate without creating tasks or advancing the cursor;
- no execution remains stuck for the HTTP node's old five-minute default timeout.

## Acceptance gate

Treat the MVP as ready for private/limited use when:

- `npm test` passes;
- T00–T11 pass;
- T12 proves webhook conflict self-healing;
- T13–T14 prove poll serialization and lease expiry;
- T16 proves result `file_id` survives a delivery outage;
- T17 proves pending work survives an n8n restart;
- T19 confirms the intended resource profile.

One limitation remains intrinsic to Telegram Bot API: `sendMessage`/`sendDocument` have no general idempotency key. In a rare ambiguous network timeout where Telegram accepted an outbound send but n8n never received its response, recovery may prefer a duplicate delivery over silently losing the message. This is different from duplicate task creation, which the workflow actively guards against.
