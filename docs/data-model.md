# Data model

The MVP uses three n8n Data Tables:

- `bt_bot_users`
- `bt_bot_tasks`
- `bt_bot_state`

n8n adds its own system `id`, `createdAt`, and `updatedAt` columns; do not create them manually.

## `bt_bot_state`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `key` | String | yes | State key. |
| `value` | Number | yes | Numeric state value. |

Create exactly one initial row:

```text
key = telegram_offset
value = 0
```

`telegram_offset` is the next Telegram update ID that polling may request. It is advanced only after the current update reaches a safe checkpoint.

## `bt_bot_users`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `user_id` | String | yes | Numeric Telegram user ID; authorization key. |
| `username` | String | no | Metadata only. |
| `name` | String | no | Human-readable name. |
| `status` | String | yes | `ACTIVE` or `BLOCKED`. |
| `created_at` | Date | yes | Whitelist creation time. |

## `bt_bot_tasks`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `task_no` | Number | yes | Six-digit public task number. |
| `telegram_update_id` | Number | yes | Customer update that created the task; duplicate guard. |
| `user_id` | String | yes | Customer Telegram ID. |
| `customer_chat_id` | String | yes | Destination chat for result. |
| `username` | String | no | Customer username snapshot. |
| `source_file_id` | String | yes | Telegram `file_id` of source book. |
| `source_filename` | String | yes | Original filename. |
| `translated_file_id` | String | no | Admin result `file_id`; persisted before delivery. |
| `status` | String | yes | `NEW`, `PROCESSING`, `DELIVERY_PENDING`, `DONE`, `REJECTED`. |
| `admin_chat_id` | String | yes | Admin chat used for delivery/recovery. |
| `admin_task_message_id` | Number | no | Task-card message ID used to map admin replies. |
| `admin_task_text` | String | yes | Persisted task-card text. |
| `source_caption` | String | yes | Persisted source caption. |
| `customer_confirmation_text` | String | yes | Persisted customer confirmation. |
| `delivery_step` | String | yes | Durable delivery state. |
| `retry_count` | Number | yes | Persistent recovery-attempt count. |
| `next_retry_at` | Date | no | Earliest next recovery time. |
| `created_at` | Date | yes | Task creation time. |
| `completed_at` | Date | no | Successful customer-delivery time. |

## Delivery state machine

```text
NEW / ADMIN_CARD_PENDING
→ NEW / SOURCE_PENDING
→ NEW / CUSTOMER_CONFIRM_PENDING
→ PROCESSING / WAITING_RESULT
→ DELIVERY_PENDING / RESULT_PENDING
→ DONE / COMPLETE
```

Recovery handles only:

```text
ADMIN_CARD_PENDING
SOURCE_PENDING
CUSTOMER_CONFIRM_PENDING
RESULT_PENDING
```

`WAITING_RESULT` means the bot is waiting for the administrator to translate manually. `COMPLETE` needs no recovery.

## Safe offset rules

For a new customer document:

```text
receive update
→ insert bt_bot_tasks row including source_file_id
→ update bt_bot_state.telegram_offset
→ deliver task card/source/confirmation
```

If the update is replayed before the offset was saved, `telegram_update_id` prevents a second task row; the duplicate path only advances the offset.

For an administrator result:

```text
receive translated file
→ save translated_file_id
→ status = DELIVERY_PENDING
→ delivery_step = RESULT_PENDING
→ update bt_bot_state.telegram_offset
→ send result to customer
→ success: DONE / COMPLETE
```

Thus both source and translated Telegram `file_id` references are durable before their inbound updates are acknowledged.

## Recovery backoff

`Recovery Schedule` runs every 5 minutes. Automatic persistent attempts are capped at 8, at most 20 due tasks are selected per run, and delays are:

```text
5 min → 15 min → 30 min → 1 h → 3 h → 6 h → 12 h → 24 h
```

## Examples

CSV headers/examples live in:

- `examples/users.csv`
- `examples/tasks.csv`
- `examples/state.csv`
