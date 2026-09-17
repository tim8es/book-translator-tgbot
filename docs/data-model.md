# Data model

MVP uses two n8n Data Tables named exactly `users` and `tasks`.

> n8n automatically adds its own `id`, `createdAt`, and `updatedAt` system columns. Do not create those columns manually.

## `users`

Create these columns in this order:

| Column | n8n type | Required by workflow | Notes |
| --- | --- | --- | --- |
| `user_id` | String | yes | Numeric Telegram user ID stored as a string. Authorization key. Keep values unique. |
| `username` | String | no | Telegram username without `@`; metadata only. Never used for authorization. |
| `name` | String | no | Human-readable name for the administrator. |
| `status` | String | yes | `ACTIVE` or `BLOCKED`. Only `ACTIVE` grants access. |
| `created_at` | Date | yes | When the whitelist record was added. |

Example:

```text
user_id    111111111
username   example_user
name       Иван
status     ACTIVE
created_at 2026-09-17T12:00:00.000Z
```

The workflow checks both `user_id` and `status = ACTIVE` on every customer update. Changing the row to `BLOCKED` therefore takes effect on the next message.

## `tasks`

Create these columns in this order:

| Column | n8n type | Required by workflow | Notes |
| --- | --- | --- | --- |
| `task_no` | Number | yes | Public six-digit task number, `100000`–`999999`. Must be unique. |
| `user_id` | String | yes | Telegram user ID snapshot. |
| `customer_chat_id` | String | yes | Chat where the result must be returned. |
| `username` | String | no | Telegram username snapshot. |
| `source_file_id` | String | yes | Telegram `file_id` of the source document. |
| `source_filename` | String | yes | Original filename. |
| `translated_file_id` | String | no | Telegram `file_id` supplied by the administrator on completion. |
| `status` | String | yes | `NEW`, `PROCESSING`, `DONE`, or `REJECTED`. |
| `admin_task_message_id` | Number | no initially | Message ID of the administrator task card. Used to map replies. |
| `created_at` | Date | yes | Task creation time. |
| `completed_at` | Date | no | Set after successful result delivery. |

### State transitions

```text
NEW → PROCESSING → DONE
  └──────────────→ REJECTED   (reserved for later/manual use)
```

The imported workflow creates `NEW`, changes to `PROCESSING` after the administrator card is sent and its message ID is persisted, and changes to `DONE` only after Telegram successfully sends the translated document to the customer.

### Task number allocation

For each valid source file the workflow generates a batch of random six-digit candidates in `100000`–`999999`, removes candidates already present in `tasks`, and selects the first unused one. This is a simple collision-safe allocator for the low-volume private MVP. It prevents reuse of an existing number without requiring a separate database sequence.

### Admin reply mapping

The administrator must reply to the bot message containing the task card. Telegram then includes `reply_to_message.message_id`; the workflow looks up:

```text
tasks.admin_task_message_id = reply_to_message.message_id
```

A result is delivered only if exactly one matching task is found and its status is not `DONE`.

## Creating the tables

In n8n:

1. Open **Data tables**.
2. Create a table named exactly `users` and add the columns above.
3. Create a table named exactly `tasks` and add the columns above.
4. Add at least one `users` row with your test customer's numeric Telegram ID and `status = ACTIVE`.
5. Do not add the administrator to `users` unless the same account also needs to act as a customer; admin routing is configured separately in the workflow.

`examples/users.csv` and `examples/tasks.csv` show the expected column layout. All IDs in those files are fake examples.
