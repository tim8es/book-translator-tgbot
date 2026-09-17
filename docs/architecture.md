# Architecture

## Scope

This MVP is a private Telegram task router for manual book translation. Telegram is the customer and administrator UI; n8n orchestrates access, task state and document routing.

## Main flow

```text
Telegram update
     |
     v
Normalize + Config
     |
     v
Role Switch
  /        \
admin      customer
 |            |
 |        whitelist check
 |          /       \
 |       denied     active
 |                    |
 |             /start or document
 |                    |
 |             task-number allocation
 |                    |
 |               tasks INSERT
 |                    |
 |              admin task card
 |                    |
 |             save card message_id
 |                    |
 |              source document
 |                    |
 |             customer confirmation
 |
admin replies to task card with document
 |
lookup tasks.admin_task_message_id
 |
DONE? -- yes --> refuse duplicate delivery
 |
 no
 |
send result document to customer
 |
mark task DONE
```

## Why one Telegram Trigger

Telegram bot webhooks effectively belong to one active consumer. The MVP uses one Telegram Trigger and routes both customer and administrator updates inside one workflow. This avoids competing workflows overwriting the bot webhook.

## Authorization

Customer authorization key:

```text
message.from.id -> users.user_id
```

Access requires the matching row to have `status = ACTIVE`.

`username` is never trusted for authorization because it can be changed or removed by the Telegram account holder.

Administrator routing uses configured numeric `ADMIN_USER_ID`. `ADMIN_CHAT_ID` controls where task cards and source files are delivered.

## Task IDs

Public task IDs are random integers from `100000` through `999999`.

For each new source document the workflow:

1. generates 32 distinct random candidates;
2. sends them through a Data Table `rowNotExists` filter on `tasks.task_no`;
3. selects the first free candidate;
4. inserts the task.

For a private low-volume MVP this is sufficient. It is collision-checked but not transaction-safe under high concurrency because n8n Data Tables do not provide a uniqueness constraint/transaction around the check-and-insert sequence.

At higher volume, use PostgreSQL/Supabase or another database with an internal primary key and uniqueness enforcement. The user-facing six-digit identifier can remain unchanged if desired.

## File handling

The Telegram Trigger uses `download = false`.

The workflow stores:

```text
source_file_id
translated_file_id
```

and passes these values to Telegram **Send Document** nodes. This keeps the MVP from downloading and re-uploading files only for routing.

A future automated translation pipeline will need to download/parse source files deliberately. That processing layer can be inserted after task creation without changing the customer-facing Telegram flow.

## State and failure boundaries

### `NEW`

Inserted before admin notification. If the admin task-card send fails, the row remains `NEW`, making the incomplete task visible for manual recovery.

### `PROCESSING`

Set only after the admin task card has been sent and Telegram's returned `message_id` is saved as `admin_task_message_id`.

### `DONE`

Set only after **Send Translation to Customer** succeeds.

This ordering avoids marking a task complete before the customer delivery call.

### Duplicate completion

When an administrator replies to a task card, the task is looked up by `admin_task_message_id`. If the row is already `DONE`, the workflow sends an admin warning and does not send the document to the customer again.

## Why n8n Data Tables

For the private MVP, state is small, inspectable and workflow-local. Data Tables avoid provisioning a database before demand is validated.

Move to a real database when any of these become true:

- task volume is materially higher;
- more than one workflow/service writes task state;
- strong uniqueness or transactions are required;
- independent backups/restores are required;
- a web admin panel or other application needs direct access;
- reporting/queries outgrow n8n's table interface.

## Future path

The manual admin translation step can later become:

```text
source file
   -> extraction/parser
   -> chunking
   -> translation model
   -> glossary/style consistency
   -> QA/verifier
   -> document rebuild
   -> Telegram delivery
```

The surrounding contract can stay the same:

```text
customer -> task -> processing -> result -> DONE
```

Additional future states could include `WAITING_PAYMENT`, `PAID`, `TRANSLATING`, `QA`, `FAILED` and `CANCELLED`, but they are intentionally omitted from the first MVP.
