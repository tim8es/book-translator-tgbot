# Book Translator Telegram Bot MVP Design

**Date:** 2026-09-17

## Goal

Build a private Telegram bot backed by n8n for manually processed book-translation tasks. Only explicitly whitelisted Telegram users may use the bot. A user sends a book to the bot, the bot creates a numbered task, notifies the administrator and delivers the source file to the administrator. After manual translation, the administrator replies to the task with the translated file, and the bot returns that file to the original user.

## MVP constraints

- Telegram is the only end-user interface.
- n8n is the workflow runtime.
- Use n8n Data Tables for persistent MVP state; no external database.
- Do not store Telegram bot tokens or other secrets in Git.
- Authorization is based only on immutable numeric Telegram `user_id` values.
- Telegram `username` is metadata only and must never grant access.
- The administrator is identified by numeric Telegram user/chat ID configured locally.
- Use the Russian term **"Задача"**, not "Заказ".
- User-facing task numbers are random six-digit numeric IDs in the range `100000`–`999999`, for example `482731`.
- Before inserting a task, the workflow must check that the generated `task_no` does not already exist in `tasks`. On collision, generate another six-digit number and retry.
- MVP task statuses are `NEW`, `PROCESSING`, `DONE`, `REJECTED`.
- Payments are outside the MVP state machine.
- Do not automatically translate books in this version.
- Prefer reusing Telegram file IDs / Telegram-side message copying over downloading source books into n8n when possible.

## User roles

### Customer

A Telegram user whose numeric `user_id` exists in the `users` Data Table with `status = ACTIVE`.

The customer can:

- run `/start`;
- receive access confirmation;
- send one supported book document per task;
- receive a confirmation containing the created task number;
- receive the translated document when the task is completed.

A non-whitelisted or blocked user receives a short access-denied response and no task is created.

### Administrator

A single administrator identified by configured numeric Telegram ID for the MVP.

The administrator receives:

- a task card with task number, customer metadata and source filename;
- the source book document;
- confirmation after a translated file has been delivered to the customer;
- an error message when an admin reply cannot be mapped to a task.

To complete a task, the administrator replies to the task card with the translated document. The bot maps the replied-to Telegram message ID to the stored task and sends the uploaded translated file back to that task's customer.

## Supported source files

For the MVP the bot accepts Telegram documents with these filename extensions:

- `.epub`
- `.pdf`
- `.docx`
- `.txt`

Unsupported documents receive a validation message and do not create a task.

The workflow should avoid downloading the source document solely for forwarding. The source Telegram `file_id` is stored and reused where n8n/Telegram permits it.

## Data model

### `users` Data Table

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `user_id` | number/string-safe integer | yes | Stable Telegram identity and authorization key |
| `username` | string | no | Current Telegram username for admin readability |
| `name` | string | no | Human-readable name |
| `status` | string | yes | `ACTIVE` or `BLOCKED` |
| `created_at` | datetime/string | yes | When whitelist entry was created |

Rules:

- `user_id` must be unique.
- The workflow checks this table on every customer message, not only `/start`.
- Changing `status` to `BLOCKED` immediately removes access on the next interaction.

### `tasks` Data Table

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `task_no` | number | yes | User-facing unique six-digit task number (`100000`–`999999`) |
| `user_id` | number/string-safe integer | yes | Customer Telegram ID |
| `customer_chat_id` | number/string-safe integer | yes | Chat to return the translated file to |
| `username` | string | no | Customer username snapshot |
| `source_file_id` | string | yes | Telegram file ID for source book |
| `source_filename` | string | yes | Original filename |
| `translated_file_id` | string | no | Telegram file ID uploaded by admin |
| `status` | string | yes | `NEW`, `PROCESSING`, `DONE`, `REJECTED` |
| `admin_task_message_id` | number | yes after notification | Telegram message ID of admin task card |
| `created_at` | datetime/string | yes | Task creation time |
| `completed_at` | datetime/string | no | Delivery completion time |

Rules:

- `task_no` is unique and always exactly six digits.
- Generate `task_no` randomly in `100000`–`999999` and verify uniqueness before insertion.
- `admin_task_message_id` is the primary mapping key for admin completion replies.
- A translated document may be delivered only when the replied-to admin message maps to exactly one non-DONE task.
- Once delivery succeeds, store the translated `file_id`, set `status = DONE`, and set `completed_at`.

## Workflow architecture

Use one main n8n workflow with one Telegram Trigger so only one Telegram webhook/trigger owns the bot update stream.

High-level routing:

1. Telegram Trigger receives update.
2. Normalize update into sender ID, chat ID, text, document metadata and reply metadata.
3. If sender is administrator, route to admin handler.
4. Otherwise route to customer authorization lookup.
5. Reject customer updates unless `users.user_id` exists with `status = ACTIVE`.
6. Handle `/start` separately from document submission.
7. Validate source extension before task creation.
8. Generate a random six-digit task number and verify that it is not already present in `tasks`; retry on collision.
9. Insert task row as `NEW`.
10. Send admin task card and capture its Telegram `message_id`.
11. Update `admin_task_message_id`; set task to `PROCESSING`.
12. Send/copy source document to admin.
13. Confirm created task number to customer.
14. For administrator document replies, find task by `reply_to_message.message_id = admin_task_message_id`.
15. Send the administrator's document to `customer_chat_id` using its Telegram `file_id`.
16. Mark task `DONE` only after the customer delivery call succeeds.

## Customer UX

### `/start` for active user

Response:

> Доступ подтверждён.\n\nОтправьте книгу файлом EPUB, PDF, DOCX или TXT. После получения я создам задачу и пришлю готовый перевод сюда.

### `/start` or any message for unauthorized user

Response:

> Доступ к боту закрыт. Обратитесь к администратору, чтобы получить доступ.

No task data is created.

### Valid source document

Response example:

> Книга получена.\n\nЗадача #482731\nФайл: book.epub\n\nЗадача передана на обработку. Готовый перевод придёт в этот чат.

### Invalid source document

Response:

> Этот формат пока не поддерживается. Отправьте EPUB, PDF, DOCX или TXT.

## Administrator UX

Task card example:

> 📚 Новая задача #482731\n\nКлиент: @username\nUser ID: 123456789\nФайл: book.epub\nСтатус: PROCESSING\n\nКогда перевод будет готов, ответьте на это сообщение готовым файлом.

The source document is sent immediately after the card.

On successful translated-file delivery:

> Задача #482731 завершена. Файл отправлен клиенту.

If the administrator sends a document without replying to a known task card:

> Не удалось определить задачу. Ответьте готовым файлом именно на сообщение с карточкой задачи.

If the mapped task is already `DONE`, do not resend automatically; tell the administrator it is already completed.

## Error handling and idempotency

- Unauthorized updates must stop before any task-table mutation.
- Missing document filename or unsupported extension must stop before task creation.
- A `task_no` collision must never overwrite or reuse an existing task; generate a new six-digit number before insertion.
- If admin notification fails after task insertion, keep the task in `NEW` so it is visibly incomplete in the table; n8n execution logs contain the failure.
- Change task to `PROCESSING` only after the admin task card is successfully sent and its message ID stored.
- Change task to `DONE` only after translated document delivery to the customer succeeds.
- Admin replies to completed tasks do not automatically redeliver the document.
- Unknown customer text should return usage guidance rather than create a task.
- Unknown admin messages should be ignored or return minimal admin guidance; they must not affect customer data.

## Configuration and secrets

Repository files may contain placeholders and setup instructions but no actual secrets.

Local setup requires:

- Telegram Bot credential in n8n (`TELEGRAM_BOT_TOKEN` conceptually; preferably stored as an n8n credential rather than plain workflow JSON).
- `ADMIN_USER_ID` / admin chat ID configured locally.
- `users` and `tasks` Data Tables created with the documented schema.
- At least one `ACTIVE` whitelist row for testing.

An `.env.example` may document variable names, but `.env` must be ignored.

## Repository deliverables

After implementation the repository should contain at minimum:

- `README.md` — purpose, quick start and local test flow.
- `.gitignore` — ignores local secrets and temporary files.
- `.env.example` — non-secret configuration example.
- `workflows/book-translator-mvp.json` — importable n8n workflow without credentials/secrets.
- `docs/setup.md` — detailed n8n + Telegram setup.
- `docs/data-model.md` — exact Data Table schemas.
- `docs/testing.md` — end-to-end manual MVP test matrix.
- `docs/architecture.md` — flow and future migration notes.
- `examples/users.csv` — example whitelist rows without real personal IDs.
- `examples/tasks.csv` — illustrative task rows.

## Testing requirements

The repository must provide a repeatable validation path covering at least:

1. Unauthorized user sends `/start` and is denied.
2. Active user sends `/start` and is accepted.
3. Active user sends unsupported file and no task is created.
4. Active user sends supported book and receives a unique six-digit task number.
5. Administrator receives task card and source book.
6. Administrator sends translated document without replying to task card and receives mapping error.
7. Administrator replies to task card with translated document; customer receives file and task becomes `DONE`.
8. Administrator repeats completion reply for a `DONE` task and no automatic duplicate delivery occurs.
9. Blocking an existing user prevents their next interaction from creating a task.
10. If a generated six-digit task number already exists, the workflow generates another number and does not create a duplicate.

## Out of scope for MVP

- Payments and payment verification.
- Automatic text extraction or translation.
- Pricing by character count.
- Multiple administrators / role management.
- Customer task history UI.
- Cancellation workflow.
- External object storage.
- PostgreSQL/Supabase.
- Web admin panel.
- Public bot access.
- Strong distributed task-ID allocation beyond uniqueness checking in the private low-volume MVP.

## Future-compatible extension points

The MVP deliberately keeps customer-facing interaction independent from translation execution. Later, the manual administrator step can be replaced with an automated pipeline that parses EPUB/PDF/DOCX/TXT, translates, performs QA, rebuilds the document and returns it through the same task record and Telegram delivery flow.

If volume grows, migrate `users` and `tasks` from Data Tables to PostgreSQL while preserving the same six-digit user-facing `task_no` interface; an internal database primary key may be added separately if needed.
