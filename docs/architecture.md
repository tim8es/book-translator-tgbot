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
Get Poll State
bt_bot_state.telegram_offset
        ↓
Telegram getUpdates
limit = 1
        ↓
Expand Telegram Update
        ↓
Normalize + Config
        ↓
Role Switch
```

There is no Telegram Trigger/webhook. Polling requires only outbound HTTPS access from n8n to Telegram.

## Offset safety

`telegram_offset` is an acknowledgement boundary, not just a cursor.

For a new customer document:

```text
Telegram update
→ normalize + authorize
→ duplicate guard by telegram_update_id
→ allocate six-digit task number
→ persist bt_bot_tasks row + source_file_id
→ acknowledge next_offset in bt_bot_state
→ deliver admin card/source/customer confirmation
```

If execution fails before task persistence, the offset is not advanced. If it fails after task persistence but before offset acknowledgement, the same update can be received again and the duplicate guard routes it to offset acknowledgement without creating a second task.

For an administrator result:

```text
Telegram result update
→ resolve task from replied task-card message
→ persist translated_file_id
→ status = DELIVERY_PENDING
→ delivery_step = RESULT_PENDING
→ acknowledge next_offset
→ deliver result to customer
→ DONE / COMPLETE
```

Thus the data required for recovery exists before an inbound update becomes acknowledged.

Non-durable conversational replies such as `/start`, help and access-denied messages acknowledge the offset after the corresponding Telegram send succeeds.

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

Critical Telegram calls have short node-level retry:

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

## Authorization

Customer authorization:

```text
message.from.id
→ bt_bot_users.user_id
→ status = ACTIVE
```

Username is metadata only.

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

This trades a maximum normal inbound latency of roughly 30 seconds for a much lower idle execution count than the earlier 10-second polling version.

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
