# Data model

MVP uses three n8n Data Tables named exactly `bt_bot_users`, `bt_bot_tasks`, and `bt_bot_state`.

> n8n automatically adds its own `id`, `createdAt`, and `updatedAt` system columns. Do not create those columns manually.

## `bt_bot_users`

| Column | n8n type | Required | Notes |
| --- | --- | --- | --- |
| `user_id` | String | yes | Numeric Telegram user ID stored as a string. Authorization key. |
| `username` | String | no | Metadata only; never used for authorization. |
| `name` | String | no | Human-readable name. |
| `status` | String | yes | `ACTIVE` or `BLOCKED`. |
| `created_at` | Date | yes | Whitelist creation time. |

Example:

```text
user_id    111111111
username   example_user
name       Иван
status     ACTIVE
created_at 2026-09-17T12:00:00.000Z
```

## `bt_bot_tasks`

| Column | n8n type | Required | Notes |
| --- | --- | --- | --- |
| `task_no` | Number | yes | Public six-digit task number, `100000`–`999999`. |
| `telegram_update_id` | Number | yes | Telegram update that created this task. Used for idempotency/deduplication. |
| `user_id` | String | yes | Telegram user ID snapshot. |
| `customer_chat_id` | String | yes | Chat where the result must be returned. |
| `username` | String | no | Telegram username snapshot. |
| `source_file_id` | String | yes | Telegram `file_id` of the source document. |
| `source_filename` | String | yes | Original filename. |
| `translated_file_id` | String | no | Telegram `file_id` supplied by the administrator. |
| `status` | String | yes | `NEW`, `PROCESSING`, `DONE`, or `REJECTED`. |
| `admin_task_message_id` | Number | no initially | Message ID of the administrator task card. |
| `created_at` | Date | yes | Task creation time. |
| `completed_at` | Date | no | Set after successful result delivery. |

`telegram_update_id` is checked before task creation. If the same Telegram update is accidentally fetched again, `Task Update Not Seen` produces no output and no second task is created.

### State transitions

```text
NEW → PROCESSING → DONE
  └──────────────→ REJECTED
```

A task changes to `PROCESSING` only after the administrator task card has been sent and its `message_id` is saved. It changes to `DONE` only after the translated document is sent to the customer.

### Task number allocation

For each valid source file the workflow generates random six-digit candidates in `100000`–`999999`, filters out numbers already present in `bt_bot_tasks`, and selects the first unused one.

### Admin reply mapping

The administrator replies with the translated file to the task-card message. The workflow resolves:

```text
bt_bot_tasks.admin_task_message_id = reply_to_message.message_id
```

## `bt_bot_state`

Create exactly these columns:

| Column | n8n type | Required | Notes |
| --- | --- | --- | --- |
| `key` | String | yes | State key. |
| `value` | Number | yes | Numeric state value. |

Add one initial row:

```text
key               value
telegram_offset   0
```

The polling path reads `telegram_offset`, calls Telegram `getUpdates`, then immediately writes:

```text
telegram_offset = update_id + 1
```

This write happens before whitelist/task/message processing, so the next polling execution advances past the update even if the rest of the workflow takes longer.

## Creating the tables

1. Create `bt_bot_users` with the columns above.
2. Create `bt_bot_tasks` with the columns above, including `telegram_update_id`.
3. Create `bt_bot_state` with `key` and `value`.
4. Add `telegram_offset / 0` to `bt_bot_state`.
5. Add at least one test customer to `bt_bot_users` with `status = ACTIVE`.

`examples/users.csv`, `examples/tasks.csv`, and `examples/bot_state.csv` show the expected layouts. All IDs are fake examples.
