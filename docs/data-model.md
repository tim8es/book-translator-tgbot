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
| `value` | String | yes | JSON-encoded state. |

The workflow automatically creates this row if it is missing:

```text
key = telegram_state
value = {"offset":0,"lockToken":"","lockUntil":0}
```

Meaning:

- `offset` — next Telegram update ID eligible for polling;
- `lockToken` — owner token of the active poll lease, empty when unlocked;
- `lockUntil` — lease expiration timestamp in milliseconds.

A poll obtains the lease with a compare-and-set update: the Data Table row is updated only if its complete previous JSON value is still unchanged. This prevents two overlapping executions from both owning the same update. The lease lasts 120 seconds; if an execution crashes before acknowledgement, a later poll may continue after expiration.

Older `telegram_offset` rows are ignored by the current workflow and may be deleted. If an older `bt_bot_state.value` column was created as **Number**, recreate/change it to **String** before importing this workflow.

## `bt_bot_users`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `user_id` | String | yes | Numeric Telegram user ID; unique authorization key. |
| `username` | String | no | Metadata only; refreshed only by explicit workflow changes. |
| `name` | String | no | Human-readable name. |
| `status` | String | yes | `PENDING`, `ACTIVE`, `BLOCKED`, or `REJECTED`. |
| `created_at` | Date | yes | First access-request time or manual whitelist creation time. |
| `request_notified_at` | Date | no | Set after the administrator notification for a pending request succeeds. |

### Access lifecycle

`bt_bot_users` is both the access registry and the access-request queue:

```text
new user + /start
→ PENDING
→ administrator reviews the row
→ ACTIVE   (approved)
   or
→ REJECTED / BLOCKED
```

Rules:

- a user absent from `bt_bot_users` is not authorized;
- the first `/start` from an absent user inserts exactly one row with `status = PENDING`;
- the row stores the Telegram `user_id`, current username/name metadata and request time;
- after the administrator notification succeeds, `request_notified_at` is set;
- a `PENDING` user cannot create translation tasks;
- repeated `/start` from an already-notified `PENDING` user does not create another row or another normal admin notification;
- approval is manual: change `status` from `PENDING` to `ACTIVE` in the Data Table;
- `BLOCKED` and `REJECTED` are denied immediately on the next interaction;
- authorization always depends on numeric `user_id`, never on username.

If an access-request notification fails before `request_notified_at` is stored, the unacknowledged Telegram update may be retried and the admin notification is attempted again. The `PENDING` row remains the durable source of truth even if Telegram notification delivery is temporarily unavailable.

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

## Safe inbound acknowledgement

For a first access request:

```text
receive /start from unknown user
→ acquire telegram_state lease
→ insert bt_bot_users row as PENDING
→ notify administrator
→ set request_notified_at
→ confirm request to user
→ acknowledge Telegram cursor
```

If notification fails before `request_notified_at` is set, the update remains unacknowledged. On replay, the existing `PENDING` row is reused rather than duplicated.

For a new customer document:

```text
receive update
→ acquire telegram_state lease
→ insert bt_bot_tasks row including source_file_id
→ CAS-update telegram_state to next offset and release lease
→ deliver task card/source/confirmation
```

If the task row was persisted but cursor acknowledgement failed, the update can be received again. `telegram_update_id` detects the already-created task and only acknowledges that update rather than creating a second task.

For an administrator result:

```text
receive translated file
→ acquire telegram_state lease
→ save translated_file_id
→ status = DELIVERY_PENDING
→ delivery_step = RESULT_PENDING
→ CAS-update telegram_state to next offset and release lease
→ send result to customer
→ success: DONE / COMPLETE
```

Thus both source and translated Telegram `file_id` references become durable before their inbound updates are acknowledged.

## Telegram webhook conflict

Polling is incompatible with an active Telegram webhook. `Telegram getUpdates` is configured to expose non-2xx responses. If Telegram returns `409`, the workflow automatically calls:

```text
deleteWebhook(drop_pending_updates=false)
```

Queued Telegram updates are preserved, and the next polling cycle retries normally.

## Recovery backoff

`Recovery Schedule` runs every 5 minutes. Automatic persistent attempts are capped at 8, at most 20 due tasks are selected per run, and delays are:

```text
5 min → 15 min → 30 min → 1 h → 3 h → 6 h → 12 h → 24 h
```

## Examples

CSV headers/examples live in:

- `examples/users.csv`
- `examples/tasks.csv`
- `examples/state.csv` — optional state example; no initial row is required for a fresh setup.
