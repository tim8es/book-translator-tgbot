# Data model

MVP uses **two** n8n Data Tables:

- `bt_bot_users`
- `bt_bot_tasks`

`bt_bot_state` from the polling version is obsolete and should be deleted after migration.

> n8n automatically adds its own `id`, `createdAt`, and `updatedAt` system columns. Do not create those manually.

## `bt_bot_users`

| Column | n8n type | Required | Notes |
| --- | --- | --- | --- |
| `user_id` | String | yes | Numeric Telegram user ID stored as a string. Authorization key. |
| `username` | String | no | Metadata only; never used for authorization. |
| `name` | String | no | Human-readable name. |
| `status` | String | yes | `ACTIVE` or `BLOCKED`. |
| `created_at` | Date | yes | Whitelist creation time. |

## `bt_bot_tasks`

| Column | n8n type | Required | Notes |
| --- | --- | --- | --- |
| `task_no` | Number | yes | Public six-digit task number, `100000`–`999999`. |
| `telegram_update_id` | Number | yes | Telegram update that created the task. Duplicate guard. |
| `user_id` | String | yes | Customer Telegram user ID snapshot. |
| `customer_chat_id` | String | yes | Chat where the result must be returned. |
| `username` | String | no | Telegram username snapshot. |
| `source_file_id` | String | yes | Telegram `file_id` of source book. |
| `source_filename` | String | yes | Original filename. |
| `translated_file_id` | String | no | Telegram `file_id` uploaded by admin; persisted before delivery. |
| `status` | String | yes | `NEW`, `PROCESSING`, `DELIVERY_PENDING`, `DONE`, `REJECTED`. |
| `admin_chat_id` | String | yes | Admin chat snapshot used by delivery and recovery. |
| `admin_task_message_id` | Number | no initially | Admin task-card message ID used to map completion replies. |
| `admin_task_text` | String | yes | Persisted task-card text for recovery. |
| `source_caption` | String | yes | Persisted source-file caption for recovery. |
| `customer_confirmation_text` | String | yes | Persisted customer confirmation for recovery. |
| `delivery_step` | String | yes | Durable next-step state; values below. |
| `retry_count` | Number | yes | Number of persistent recovery attempts; starts at `0`. |
| `next_retry_at` | Date | no | Earliest time recovery may retry this task; null while waiting for manual translation or after completion. |
| `created_at` | Date | yes | Task creation time. |
| `completed_at` | Date | no | Successful result delivery time. |

### `delivery_step`

Allowed values:

```text
ADMIN_CARD_PENDING
SOURCE_PENDING
CUSTOMER_CONFIRM_PENDING
WAITING_RESULT
RESULT_PENDING
COMPLETE
```

Meaning:

- `ADMIN_CARD_PENDING` — admin task card still needs to be delivered.
- `SOURCE_PENDING` — task card exists; source book still needs to reach admin.
- `CUSTOMER_CONFIRM_PENDING` — admin has source; customer still needs acceptance confirmation.
- `WAITING_RESULT` — normal manual-translation state; recovery does nothing.
- `RESULT_PENDING` — translated `file_id` is saved and customer delivery must complete.
- `COMPLETE` — result reached customer; no recovery work remains.

### State transitions

```text
NEW / ADMIN_CARD_PENDING
        ↓
NEW / SOURCE_PENDING
        ↓
NEW / CUSTOMER_CONFIRM_PENDING
        ↓
PROCESSING / WAITING_RESULT
        ↓ admin uploads result
DELIVERY_PENDING / RESULT_PENDING
        ↓ successful customer delivery
DONE / COMPLETE
```

### Critical persistence rule

For administrator results the order is:

```text
1. receive translated Telegram file_id
2. store translated_file_id
3. set status = DELIVERY_PENDING
4. set delivery_step = RESULT_PENDING
5. set next_retry_at
6. send document to customer
7. only on success set DONE / COMPLETE
```

This order prevents loss of the translated file reference during a network outage.

### Recovery fields

`Recovery Schedule` runs every 5 minutes. It queries only pending delivery steps, and `Select Due Recoveries` additionally checks `next_retry_at` and `retry_count`.

Backoff implemented by the workflow:

```text
retry 1  → +5 min
retry 2  → +15 min
retry 3  → +30 min
retry 4  → +1 h
retry 5  → +3 h
retry 6  → +6 h
retry 7  → +12 h
retry 8  → +24 h
```

At most 20 due tasks are selected per recovery run and automatic recovery is capped at 8 attempts.

### Task number allocation

The workflow generates random six-digit candidates, filters values already present in `bt_bot_tasks`, and selects the first unused value.

### Admin reply mapping

The administrator replies with the translated file to the task-card message. The workflow resolves:

```text
bt_bot_tasks.admin_task_message_id = reply_to_message.message_id
```

## Migration from the polling version

If you already created the old tables:

1. Keep `bt_bot_users`.
2. Add the new columns above to `bt_bot_tasks`.
3. Existing unfinished tasks should be reviewed manually before migration; set `delivery_step` to match what has actually been delivered.
4. Delete `bt_bot_state`; it is no longer referenced.
5. Import the new workflow and configure Telegram Trigger.

For a fresh test install, create only `bt_bot_users` and `bt_bot_tasks` using this schema.
