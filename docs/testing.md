# Manual test matrix

Run `npm test` first to validate the exported workflow structure, then run these scenarios against your local n8n instance and Telegram bot.

Record the n8n execution result and inspect the `users` / `tasks` Data Tables after each state-changing test.

## Preconditions

- workflow imported but not yet trusted as production;
- Telegram credential selected on all Telegram nodes;
- `ADMIN_USER_ID` and `ADMIN_CHAT_ID` configured;
- `users` and `tasks` Data Tables exist;
- one test customer is available;
- one small EPUB/PDF/DOCX/TXT source file and one translated/result file are available.

## T01 — unauthorized user

1. Ensure the test customer's `user_id` is absent from `users` or has `status = BLOCKED`.
2. Send `/start`.

Expected:

- bot denies access;
- message includes the sender's numeric Telegram ID;
- no `tasks` row is created.

## T02 — whitelist activation

1. Add the customer to `users` with the numeric `user_id` and `status = ACTIVE`.
2. Send `/start` again.

Expected:

- bot confirms access;
- bot asks for EPUB/PDF/DOCX/TXT;
- no task is created from `/start`.

## T03 — unsupported file

1. As the active customer, send a document with an unsupported extension, for example `.zip`.

Expected:

- bot reports that the format is unsupported;
- no `tasks` row is created.

## T04 — create task

1. Send a supported source document.

Expected customer result:

- confirmation contains a six-digit number matching `100000–999999`;
- confirmation includes the original filename.

Expected Data Table result:

- one new `tasks` row;
- `task_no` is six digits;
- `user_id` and `customer_chat_id` match the sender;
- `source_file_id` is populated;
- `source_filename` matches;
- final state after admin notification is `PROCESSING`;
- `admin_task_message_id` is populated.

Expected admin result:

- admin receives a task card;
- task card number matches the customer confirmation;
- admin receives the source document separately.

## T05 — admin document without task-card reply

1. As administrator, send the result file directly to the bot without replying to a task card.

Expected:

- bot tells the administrator to reply to the task card;
- customer receives nothing;
- task remains `PROCESSING`.

## T06 — admin replies to wrong bot message

1. Reply with a document to the source-document message instead of the task-card message.

Expected:

- bot cannot map the reply to a task;
- customer receives nothing;
- task remains `PROCESSING`.

## T07 — successful completion

1. Reply to the **task card** with the translated/result document.

Expected:

- customer receives the document;
- caption contains the same task number;
- `translated_file_id` is stored;
- task status becomes `DONE`;
- `completed_at` is populated;
- administrator receives completion confirmation.

## T08 — duplicate completion protection

1. Reply to the same task card again with a document.

Expected:

- bot reports that the task is already complete;
- customer does not receive a second automatic delivery;
- stored task remains `DONE`.

## T09 — immediate block

1. Change the customer's `users.status` from `ACTIVE` to `BLOCKED`.
2. Send `/start` or another message from that customer.

Expected:

- access is denied on the very next interaction;
- no new task is created.

## T10 — task-number collision path

Normal collisions are rare. To test the filtering logic without waiting for one naturally:

1. Temporarily pin or modify `Generate Task Candidates` in a copy of the workflow so one candidate equals an existing `task_no` and another is unused.
2. Run the task-creation path.

Expected:

- the existing number is filtered by `Unused Task Number`;
- a different unused six-digit number is selected;
- existing task data is not overwritten.

Restore the original node before further testing.

## T11 — admin `/start`

1. Administrator sends `/start`.

Expected:

- bot shows admin-mode guidance;
- no lookup or task mutation occurs.

## Acceptance gate

Treat the MVP as locally verified only after T01–T09 and T11 pass on your actual n8n instance. T10 is a useful collision-path check but can be done with a disposable workflow copy.
