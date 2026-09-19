# Architecture

## Scope

The MVP is a private Telegram task router for manual book translation. Telegram is the customer/admin UI; n8n handles authorization, durable task state, document routing and recovery.

It is intentionally compatible with **local n8n without a public address**.

## Inbound transport

```text
Schedule Poll (30 s)
        ↓
Bot Config
        ↓
ensure bt_bot_state.telegram_state exists
        ↓
read offset / active lease
        ↓
Telegram getUpdates (limit=1)
        ↓
inspect response
   ↙        ↓        ↘
 idle     update      409
           ↓           ↓
       CAS lease   deleteWebhook
           ↓       preserve queue
     normalize/route
```

There is no Telegram Trigger. Polling requires only outbound HTTPS access from n8n to Telegram.

## Poll state and serialization

`bt_bot_state` contains one JSON state record:

```text
key = telegram_state
value = {"offset":0,"lockToken":"","lockUntil":0}
```

The workflow creates it automatically if missing.

Before a fetched update enters business logic, `Prepare Poll Lock` creates a random token and a 120-second lease. `Acquire Poll Lock` performs a compare-and-set update using both:

```text
key = telegram_state
value = exact previously-read JSON
```

Only one overlapping execution can successfully replace that exact previous value. An execution that loses the race produces no item and stops before business processing.

While a lease is active, later scheduled polls exit before calling Telegram. If the owner crashes, `lockUntil` eventually expires and a later poll can acquire a new lease for the still-unacknowledged offset.

Cursor acknowledgement is also compare-and-set: an ack node updates `telegram_state` only if the row still contains the lease value owned by that execution. A stale execution therefore cannot overwrite newer state.

## Telegram webhook self-healing

`Telegram getUpdates` uses:

```text
Never Error = true
Include Full Response = true
HTTP timeout = 10 seconds
network attempts = 2
```

This lets the workflow inspect Telegram API error codes itself. If Telegram returns `409` because a webhook is registered, the workflow calls:

```text
deleteWebhook(drop_pending_updates=false)
```

No update has been leased or acknowledged at that point, and queued Telegram updates are preserved. The next polling cycle resumes with the same offset.

## Safe acknowledgement boundary

For a new customer document:

```text
Telegram update
→ acquire CAS lease
→ normalize + authorize
→ duplicate guard by telegram_update_id
→ allocate six-digit task number
→ persist bt_bot_tasks row + source_file_id
→ CAS-ack next offset and release lease
→ deliver admin card/source/customer confirmation
```

If execution fails before task persistence, the cursor is not advanced. If it fails after task persistence but before acknowledgement, the update can be received again and `telegram_update_id` routes it to acknowledgement without creating a second task.

For an administrator result:

```text
Telegram result update
→ acquire CAS lease
→ resolve task from replied task-card message
→ persist translated_file_id
→ status = DELIVERY_PENDING
→ delivery_step = RESULT_PENDING
→ CAS-ack next offset and release lease
→ deliver result to customer
→ DONE / COMPLETE
```

Thus the data required for recovery exists before an inbound update becomes acknowledged.

Non-durable conversational replies such as active-user `/start`, help and access-denied messages acknowledge the update only after the corresponding Telegram send succeeds. A first access request is different: its `PENDING` user row is persisted before notification/confirmation, so the application itself is not lost.

## Task delivery state

`bt_bot_tasks` is both the business record and delivery state machine:

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

A pending step describes the durable operation that still needs to finish.

## Two recovery layers

Critical Telegram sends have short node-level retry:

```text
3 attempts
5 seconds between attempts
```

For longer failures, `Recovery Schedule` runs every 5 minutes. It selects at most 20 due tasks, caps automatic persistent attempts at 8 and uses:

```text
5 min → 15 min → 30 min → 1 h → 3 h → 6 h → 12 h → 24 h
```

Recovery ignores `WAITING_RESULT` and `COMPLETE`.

## File handling

The workflow keeps Telegram file references rather than persistent copies:

```text
source_file_id
translated_file_id
```

Source and result documents can therefore be forwarded without storing book binaries in n8n solely for routing.

## Authorization and access requests

`bt_bot_users` is both the authorization registry and the access-request queue.

```text
message.from.id
→ lookup bt_bot_users.user_id
   ├─ ACTIVE   → normal customer flow
   ├─ PENDING  → request is waiting; no task creation
   ├─ BLOCKED  → deny
   ├─ REJECTED → deny
   └─ missing
        ├─ /start → insert PENDING + notify admin
        └─ other  → ask user to send /start
```

For a new request the durable order is:

```text
insert PENDING row
→ send admin request notification
→ set request_notified_at
→ confirm request to customer
→ acknowledge Telegram offset
```

Because the row is inserted first, the administrator can still see the application in `bt_bot_users` even if a later Telegram send fails. If the admin notification was not confirmed, `request_notified_at` remains empty and a replay can retry that notification.

Once `request_notified_at` is populated, repeated `/start` from the same `PENDING` user returns the pending-state message without creating another row or normal duplicate admin notification.

Approval is intentionally manual for the MVP: the administrator changes `status` from `PENDING` to `ACTIVE` in the Data Table. No Telegram command automatically grants access.

Username and name are display metadata only. Authorization always uses numeric Telegram `user_id`.

Administrator authorization uses numeric `ADMIN_USER_ID` from `Bot Config`. In a private bot chat `ADMIN_CHAT_ID` normally resolves to the same ID.

## Task numbers

Public task numbers are random integers from `100000` to `999999`. The workflow generates multiple candidates and keeps the first value not already present in `bt_bot_tasks`.

`telegram_update_id` is a separate inbound duplicate guard.

For this private, low-volume MVP this is sufficient. Higher concurrency would justify a database uniqueness constraint/transaction instead.

## Resource profile

At idle:

```text
polling:  every 30 seconds ≈ 2,880 executions/day
recovery: every 5 minutes  ≈   288 executions/day
```

An empty poll performs a small Data Table read plus one bounded Telegram request. An active processing lease makes overlapping scheduled polls terminate before making another Telegram request.

## Delivery semantics limitation

The task state machine prevents normal retries from losing source/result references. Telegram Bot API does not provide a generic idempotency key for `sendMessage`/`sendDocument`, so a rare ambiguous network failure where Telegram accepted a send but n8n never received the response cannot be made mathematically exactly-once. The design intentionally prefers recoverability over silent loss.

## Future automation

The manual translation step can later be replaced by:

```text
source file
→ extraction / character count
→ price / ETA
→ chunking
→ translation
→ glossary/style consistency
→ QA/verifier
→ document rebuild
→ RESULT_PENDING
→ Telegram delivery
```

The durable outer contract can remain unchanged: customer → task → processing → result pending → done.
