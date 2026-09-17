# Architecture

## Scope

This MVP is a private Telegram task router for manual book translation. Telegram is the customer/admin UI; n8n handles polling, access, task state and document routing.

## Polling entrypoint

```text
Schedule Poll (10 sec)
      |
      v
Bot Config
      |
      v
Get Poll State (bot_state.telegram_offset)
      |
      v
Telegram getUpdates(limit=1, offset=...)
      |
      v
Expand Telegram Update
      |
      v
Save Poll Offset = update_id + 1
      |
      v
Restore Telegram Update
      |
      v
Normalize + Config
```

The offset is stored in the `bot_state` Data Table **before** whitelist checks, task creation, or Telegram sends. This is intentionally different from workflow static data: a long-running downstream execution no longer delays offset persistence until the rest of the workflow completes.

The workflow does not use Telegram Trigger, webhooks, `$env`, or paid n8n Variables.

## Customer flow

```text
Normalize + Config
     |
     v
Role Switch
     |
 customer
     |
 whitelist ACTIVE?
   /          \
 no           yes
 |             |
deny      /start or document
               |
        supported document
               |
      Task Update Not Seen
   (tasks.telegram_update_id)
               |
      task-number allocation
               |
       Prepare Task Messages
               |
          tasks INSERT
               |
        admin task card
               |
     save card message_id
               |
        source document
               |
     customer confirmation
```

For one Telegram book upload, the intended invariant is:

```text
1 update -> 1 task -> 1 admin card -> 1 source forward -> 1 customer confirmation
```

## Duplicate protection

There are two layers:

1. `bot_state.telegram_offset` advances immediately after the update is received.
2. `tasks.telegram_update_id` is checked by `Task Update Not Seen` before task allocation.

The second layer specifically prevents the previously observed failure where one Telegram upload produced several task numbers.

For this private low-volume MVP, this is sufficient. A high-concurrency production system should move idempotency/claiming into a database with uniqueness constraints or transactions.

## Authorization

Customer authorization:

```text
message.from.id -> users.user_id
```

Access requires `status = ACTIVE`. Username is metadata only.

Administrator routing uses numeric `ADMIN_USER_ID` and `ADMIN_CHAT_ID` from the workflow-local **Bot Config** node.

## Task IDs

Public task IDs are random integers from `100000` through `999999`.

For each new source document the workflow:

1. generates 32 distinct random candidates;
2. filters candidates already present in `tasks.task_no`;
3. selects the first unused candidate;
4. inserts the task together with `telegram_update_id`.

## Message construction

Dynamic task text is built in the **Prepare Task Messages** Code node. Telegram nodes reference simple fields:

```text
admin_task_text
source_caption
customer_confirmation_text
```

This avoids fragile large inline Telegram expressions and the `invalid syntax` failure previously seen in `Send Admin Task Card`.

All Telegram `sendMessage` nodes set:

```text
Append n8n Attribution = false
```

## File handling

Polling receives Telegram document metadata and `file_id`. The workflow stores and reuses:

```text
source_file_id
translated_file_id
```

Source files are forwarded to the administrator through Telegram without downloading/re-uploading them through n8n binary storage.

## Task states

### `NEW`

Inserted before admin notification. If the admin card fails, the row remains visible as `NEW` for recovery.

### `PROCESSING`

Set only after Telegram successfully sends the admin task card and its `message_id` is stored as `admin_task_message_id`.

### `DONE`

Set only after the result document is successfully sent to the customer.

### Duplicate completion

Admin result files are mapped by `admin_task_message_id`. If the task is already `DONE`, the workflow refuses duplicate delivery.

## Future path

The manual translation step can later become:

```text
source file
   -> extraction/parser
   -> character count / ETA / price
   -> chunking
   -> translation model
   -> glossary/style consistency
   -> QA/verifier
   -> document rebuild
   -> Telegram delivery
```

The surrounding contract can stay:

```text
customer -> task -> processing -> result -> DONE
```
