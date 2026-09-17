# Architecture

## Scope

This MVP is a private Telegram task router for manual book translation. Telegram is the customer/admin UI; n8n handles authorization, task state, document routing and recovery.

## Entry point

The main workflow is event-driven:

```text
Telegram Trigger
      ↓
Normalize + Config
      ↓
Role Switch
   ↙       ↘
admin    customer
```

There is no 10-second polling loop and no `bt_bot_state.telegram_offset` state.

The Telegram Trigger requires a public HTTPS webhook endpoint for n8n.

## Lightweight reliability model

`bt_bot_tasks` is both the business record and the delivery state machine. No external queue is required.

Each task tracks:

```text
status
delivery_step
retry_count
retry_at
last_error
```

Delivery steps:

```text
ADMIN_CARD_PENDING
      ↓
SOURCE_PENDING
      ↓
CUSTOMER_CONFIRM_PENDING
      ↓
WAITING_RESULT
      ↓
RESULT_PENDING
      ↓
COMPLETE
```

The current step means: **this is the next durable operation that still needs to finish**.

A critical Telegram send has two recovery layers:

1. n8n node retry: 3 attempts, 5 seconds between attempts;
2. persistent recovery: unfinished task remains in a pending step and a schedule retries it later.

## Recovery schedule

`Recovery Schedule` runs every 5 minutes.

It reads unfinished task rows, selects only rows whose `retry_at` is due, and processes a bounded batch (maximum 20 tasks per run).

Backoff is intentionally slow to avoid wasting resources during long outages:

```text
5 min
15 min
30 min
1 h
3 h
6 h
12 h
24 h
```

Automatic recovery is bounded. After the configured maximum retry count the task remains visible with its last error instead of spinning indefinitely.

## Customer flow

```text
Telegram Trigger
     ↓
Normalize + Config
     ↓
Role Switch → customer
     ↓
Whitelist ACTIVE?
   ↙          ↘
 no           yes
 ↓             ↓
deny      input routing
               ↓
        supported document
               ↓
       duplicate guard
               ↓
       allocate task_no
               ↓
        insert task row
 delivery_step=ADMIN_CARD_PENDING
               ↓
        send admin card
               ↓
 persist admin message id
 delivery_step=SOURCE_PENDING
               ↓
        send source file
               ↓
 delivery_step=CUSTOMER_CONFIRM_PENDING
               ↓
     confirm to customer
               ↓
 status=PROCESSING
 delivery_step=WAITING_RESULT
```

If a Telegram operation fails permanently for that execution, the persisted step remains recoverable.

## Administrator completion flow

```text
admin replies with translated file
               ↓
map reply_to_message_id
               ↓
find task
               ↓
persist translated_file_id FIRST
status=DELIVERY_PENDING
delivery_step=RESULT_PENDING
               ↓
send translated file to customer
               ↓
status=DONE
delivery_step=COMPLETE
completed_at=now
               ↓
admin completion confirmation
```

Persisting the result `file_id` before delivery is the critical safety property. If customer delivery fails, recovery still has everything required to retry.

## File handling

The workflow stores Telegram `file_id` values:

```text
source_file_id
translated_file_id
```

Books are not downloaded into persistent n8n binary storage just to be forwarded. This keeps disk and memory use low.

## Authorization

Customer authorization:

```text
message.from.id → bt_bot_users.user_id
```

Access requires `status = ACTIVE`. Username is metadata only.

Administrator authorization uses the numeric `ADMIN_USER_ID` configured locally in **Bot Config**.

## Task IDs

Public task IDs are random integers from `100000` through `999999`.

The workflow generates multiple candidates, removes candidates already present in `bt_bot_tasks`, then uses the first free six-digit value. `telegram_update_id` remains a duplicate guard for customer document updates.

For this private low-volume MVP this is sufficient. At higher concurrency the state should move to a database with uniqueness constraints/transactions.

## Resource profile

Idle behavior:

```text
Main workflow: 0 executions without Telegram updates
Recovery:       1 execution / 5 min
```

That is about 288 recovery executions per day instead of ~8,640 polling executions/day in the old design.

## Future path

The manual translation step can later become:

```text
source file
   → extraction/parser
   → character count / ETA / price
   → chunking
   → translation model
   → glossary/style consistency
   → QA/verifier
   → document rebuild
   → RESULT_PENDING
   → Telegram delivery
```

The surrounding durable contract remains:

```text
customer → task → processing → result pending → done
```
