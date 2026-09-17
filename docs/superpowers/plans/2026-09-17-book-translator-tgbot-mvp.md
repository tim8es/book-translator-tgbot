# Book Translator Telegram Bot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an importable n8n workflow and complete local setup documentation for a private Telegram book-translation task bot.

**Architecture:** One Telegram Trigger owns the bot update stream. Customer messages are authorized against an n8n `users` Data Table, supported books create rows in `tasks`, and files are passed with Telegram `file_id` rather than downloaded into n8n. Administrator replies to a task card with the translated document; the workflow maps the reply message ID back to the task and returns the document to the customer.

**Tech Stack:** Telegram Bot API through n8n Telegram nodes; n8n Data Tables; n8n Code/Switch nodes; JSON workflow export; Markdown/CSV setup assets.

**Spec:** `docs/superpowers/specs/2026-09-17-book-translator-tgbot-mvp-design.md`

## Global Constraints

- Use numeric Telegram `user_id` for authorization; `username` is display metadata only.
- Use the Russian word `Задача`, never `Заказ`, in bot-facing copy.
- User-facing task IDs are random unique six-digit numbers from `100000` through `999999`.
- Accept `.epub`, `.pdf`, `.docx`, `.txt` only for customer source documents.
- Store persistent state only in n8n Data Tables `users` and `tasks`.
- Do not store Telegram credentials or tokens in Git.
- Reuse Telegram `file_id` values; do not download books merely to forward them.
- MVP statuses are `NEW`, `PROCESSING`, `DONE`, `REJECTED`.
- No payment, translation engine, external DB, object storage, web panel, or multi-admin support.

---

### Task 1: Repository foundation and data contracts

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `examples/users.csv`
- Create: `examples/tasks.csv`
- Create: `docs/data-model.md`

**Interfaces:**
- Produces the exact Data Table schemas used by the workflow.
- `users.user_id + users.status` is the access-control lookup.
- `tasks.task_no` is the public task identifier.
- `tasks.admin_task_message_id` maps an admin reply back to a task.

- [ ] **Step 1:** Add secret/local-file ignores including `.env`.
- [ ] **Step 2:** Add a non-secret `.env.example`; document that n8n credentials and the workflow Config node are the actual MVP configuration surfaces.
- [ ] **Step 3:** Add example CSV rows with fake IDs only.
- [ ] **Step 4:** Document exact `users` and `tasks` columns, types, allowed statuses, uniqueness assumptions, and manual creation steps in n8n.
- [ ] **Step 5:** Verify example CSV headers match the documented schemas exactly.

### Task 2: Build the importable n8n workflow

**Files:**
- Create: `workflows/book-translator-mvp.json`

**Interfaces:**
- Consumes Telegram `message` updates from one Telegram Trigger.
- Reads/writes Data Tables by names `users` and `tasks`.
- Requires one Telegram credential to be assigned to all Telegram nodes after import.
- Requires Config node values `ADMIN_USER_ID` and `ADMIN_CHAT_ID` to be set locally.

- [ ] **Step 1:** Add Telegram Trigger configured for `message` updates with file download disabled.
- [ ] **Step 2:** Normalize Telegram updates into stable fields: sender/chat IDs, username/name, text, document `file_id`, filename/extension, reply message ID, `/start`, supported-document flags.
- [ ] **Step 3:** Add a Config node with non-secret placeholder admin IDs and route admin versus customer messages.
- [ ] **Step 4:** Customer branch: use `rowExists` and `rowNotExists` against `users` with `user_id = sender_id` and `status = ACTIVE`; unauthorized users receive access denied and stop.
- [ ] **Step 5:** Authorized customer branch: route `/start`, valid book document, and fallback/unsupported input to the appropriate Russian responses.
- [ ] **Step 6:** For a valid source document, generate multiple distinct random six-digit candidates, filter them through `tasks.rowNotExists(task_no)`, and select the first unused candidate. Fail clearly only if the candidate pool is exhausted.
- [ ] **Step 7:** Insert task as `NEW`, send administrator task card, persist its Telegram message ID and set `PROCESSING`, send the source document to the administrator by `file_id`, then confirm the task number to the customer.
- [ ] **Step 8:** Admin branch: require a document reply, look up `tasks.admin_task_message_id = reply_to_message_id`, distinguish not-found / already-DONE / deliverable tasks.
- [ ] **Step 9:** For a deliverable admin reply, send the translated document to `customer_chat_id` by `file_id`, then set `translated_file_id`, `status = DONE`, `completed_at`, and notify the administrator.
- [ ] **Step 10:** Ensure duplicate completion replies never re-send a `DONE` task automatically.
- [ ] **Step 11:** Inspect every Data Table node for explicit table names, filters, mappings, and schemas; inspect every Telegram node for absence of embedded credentials.

### Task 3: Setup, architecture, and manual verification docs

**Files:**
- Create: `README.md`
- Create: `docs/setup.md`
- Create: `docs/architecture.md`
- Create: `docs/testing.md`

**Interfaces:**
- Gives the repository consumer a deterministic sequence from BotFather to working local n8n workflow.

- [ ] **Step 1:** Document prerequisites and import steps.
- [ ] **Step 2:** Document how to create the Telegram bot, obtain numeric admin/customer user IDs, assign the Telegram credential to workflow nodes, and set Config node values.
- [ ] **Step 3:** Document creation of `users` and `tasks` Data Tables and first whitelist entry.
- [ ] **Step 4:** Document the runtime flow and why `file_id` is used instead of downloading source books.
- [ ] **Step 5:** Add the complete MVP manual test matrix from the approved spec, including access revocation, invalid formats, completion mapping, duplicate-DONE prevention, and task-number collision handling.
- [ ] **Step 6:** Document current MVP limitations and future automatic-translation extension point.

### Task 4: Static verification and release review

**Files:**
- Verify all files above; modify only where a check fails.

**Interfaces:**
- Produces a repository state that is safe to import for local testing, while clearly separating static verification from runtime n8n testing.

- [ ] **Step 1:** Parse `workflows/book-translator-mvp.json` as JSON and verify node names are unique.
- [ ] **Step 2:** Verify all workflow connection targets reference existing nodes and exactly one Telegram Trigger exists.
- [ ] **Step 3:** Search repository content for Telegram token-shaped secrets and real personal IDs; none may exist.
- [ ] **Step 4:** Verify workflow contains `users`/`tasks`, `100000`/`999999`, allowed file extensions, `ACTIVE`, `NEW`, `PROCESSING`, `DONE`, and Russian `Задача` copy.
- [ ] **Step 5:** Compare README/setup/data-model/testing docs against the approved spec for coverage and contradictions.
- [ ] **Step 6:** Re-fetch committed workflow and key docs from GitHub to verify persisted content.
- [ ] **Step 7:** Open a pull request from the implementation branch to `main` with runtime-local-testing caveat and exact setup checklist.