import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);
const errors = [];

const nodes = workflow.nodes ?? [];
const byName = new Map(nodes.map((node) => [node.name, node]));
const connections = workflow.connections ?? {};

const requiredNodes = [
  'Telegram Trigger',
  'Bot Config',
  'Normalize + Config',
  'Role Switch',
  'Whitelist ACTIVE',
  'Whitelist Missing',
  'Access Denied',
  'Customer Input Switch',
  'Customer Start',
  'Customer Help',
  'Task Update Not Seen',
  'Generate Task Candidates',
  'Unused Task Number',
  'Pick Task Number',
  'Prepare Task Messages',
  'Insert Task',
  'Send Admin Task Card',
  'Persist Admin Card',
  'Send Source to Admin',
  'Persist Source Sent',
  'Confirm Task to Customer',
  'Mark Task Processing',
  'Admin Input Switch',
  'Get Task by Admin Message',
  'Admin Action Switch',
  'Persist Translation Pending',
  'Send Translation to Customer',
  'Mark Task Done',
  'Task Already Done',
  'Recovery Schedule',
  'Get Pending Tasks',
  'Select Due Recovery',
  'Recovery Step Switch',
];

for (const name of requiredNodes) {
  if (!byName.has(name)) errors.push(`Missing node: ${name}`);
}

for (const node of nodes.filter((node) => node.type === 'n8n-nodes-base.code')) {
  const code = node.parameters?.jsCode ?? '';
  try {
    new Function(code);
  } catch (error) {
    errors.push(`${node.name}: invalid JavaScript syntax: ${error.message}`);
  }
}

if (workflow.active !== false) errors.push('Exported workflow must be inactive');

// Event-driven entrypoint: no old polling stack.
const telegramTrigger = byName.get('Telegram Trigger');
if (telegramTrigger?.type !== 'n8n-nodes-base.telegramTrigger') {
  errors.push('Telegram Trigger must use n8n Telegram Trigger');
}
for (const forbidden of ['Schedule Poll', 'Get Poll State', 'Telegram getUpdates', 'Save Poll Offset', 'Restore Telegram Update']) {
  if (byName.has(forbidden)) errors.push(`Legacy polling node must be removed: ${forbidden}`);
}
if (raw.includes('bt_bot_state') || raw.includes('telegram_offset')) {
  errors.push('Workflow must not depend on legacy polling state');
}

const botConfigCode = byName.get('Bot Config')?.parameters?.jsCode ?? '';
for (const expected of ['ADMIN_USER_ID', 'ADMIN_CHAT_ID']) {
  if (!botConfigCode.includes(expected)) errors.push(`Bot Config missing ${expected}`);
}
if (botConfigCode.includes('TELEGRAM_BOT_TOKEN') || botConfigCode.includes('PASTE_TELEGRAM_BOT_TOKEN_HERE')) {
  errors.push('Bot Config must not store the Telegram bot token');
}

const normalizeCode = byName.get('Normalize + Config')?.parameters?.jsCode ?? '';
if (!normalizeCode.includes('telegram_update_id')) errors.push('Normalize + Config must preserve telegram_update_id');
for (const extension of ['epub', 'pdf', 'docx', 'txt']) {
  if (!normalizeCode.includes(`'${extension}'`)) errors.push(`Supported extension missing: ${extension}`);
}

const taskGuard = byName.get('Task Update Not Seen');
if (taskGuard?.parameters?.dataTableId?.value !== 'bt_bot_tasks') errors.push('Task Update Not Seen must use bt_bot_tasks');
const guardFilters = taskGuard?.parameters?.filters?.conditions ?? [];
if (!guardFilters.some((f) => f.keyName === 'telegram_update_id')) {
  errors.push('Task Update Not Seen must deduplicate on telegram_update_id');
}

const generateCode = byName.get('Generate Task Candidates')?.parameters?.jsCode ?? '';
if (!generateCode.includes('100000') || !generateCode.includes('900000')) {
  errors.push('Six-digit task-number generator is missing');
}

const insert = byName.get('Insert Task');
const insertValues = insert?.parameters?.columns?.value ?? {};
for (const field of ['telegram_update_id', 'delivery_step', 'retry_count', 'admin_task_text', 'source_caption', 'customer_confirmation_text']) {
  if (!insertValues[field]) errors.push(`Insert Task must persist ${field}`);
}
if (String(insertValues.delivery_step) !== 'ADMIN_CARD_PENDING') {
  errors.push('New tasks must start at ADMIN_CARD_PENDING');
}

const prepCode = byName.get('Prepare Task Messages')?.parameters?.jsCode ?? '';
for (const expected of ['admin_task_text', 'source_caption', 'customer_confirmation_text', 'до 15 минут на каждые 10 000 знаков']) {
  if (!prepCode.includes(expected)) errors.push(`Prepare Task Messages missing ${expected}`);
}

// Critical result safety: persist file before sending.
const persistTranslation = byName.get('Persist Translation Pending');
const persistTranslationValues = persistTranslation?.parameters?.columns?.value ?? {};
if (!persistTranslationValues.translated_file_id) errors.push('Persist Translation Pending must save translated_file_id');
if (String(persistTranslationValues.status) !== 'DELIVERY_PENDING') errors.push('Persist Translation Pending must set DELIVERY_PENDING');
if (String(persistTranslationValues.delivery_step) !== 'RESULT_PENDING') errors.push('Persist Translation Pending must set RESULT_PENDING');

const firstTarget = (name, output = 0) => connections[name]?.main?.[output]?.[0]?.node;
if (firstTarget('Persist Translation Pending') !== 'Send Translation to Customer') {
  errors.push('Translated file must be persisted before customer delivery');
}
if (firstTarget('Send Translation to Customer') !== 'Mark Task Done') {
  errors.push('Task must become DONE only after customer result delivery');
}

const markDoneValues = byName.get('Mark Task Done')?.parameters?.columns?.value ?? {};
if (String(markDoneValues.status) !== 'DONE') errors.push('Mark Task Done must set DONE');
if (String(markDoneValues.delivery_step) !== 'COMPLETE') errors.push('Mark Task Done must set COMPLETE');
if (!markDoneValues.completed_at) errors.push('Mark Task Done must set completed_at');

// Normal source-delivery state transitions.
const adminCardValues = byName.get('Persist Admin Card')?.parameters?.columns?.value ?? {};
if (!adminCardValues.admin_task_message_id || String(adminCardValues.delivery_step) !== 'SOURCE_PENDING') {
  errors.push('Persist Admin Card must save message id and advance to SOURCE_PENDING');
}
const sourceValues = byName.get('Persist Source Sent')?.parameters?.columns?.value ?? {};
if (String(sourceValues.delivery_step) !== 'CUSTOMER_CONFIRM_PENDING') {
  errors.push('Persist Source Sent must advance to CUSTOMER_CONFIRM_PENDING');
}
const processingValues = byName.get('Mark Task Processing')?.parameters?.columns?.value ?? {};
if (String(processingValues.status) !== 'PROCESSING' || String(processingValues.delivery_step) !== 'WAITING_RESULT') {
  errors.push('Customer confirmation must end at PROCESSING / WAITING_RESULT');
}

// Recovery should be infrequent and bounded.
const recoverySchedule = byName.get('Recovery Schedule');
if (recoverySchedule?.type !== 'n8n-nodes-base.scheduleTrigger') errors.push('Recovery Schedule must use Schedule Trigger');
const intervals = recoverySchedule?.parameters?.rule?.interval ?? [];
const fiveMinuteRecovery = intervals.some((i) => i.field === 'minutes' && Number(i.minutesInterval) === 5);
if (!fiveMinuteRecovery) errors.push('Recovery Schedule must run every 5 minutes');

const selectRecoveryCode = byName.get('Select Due Recovery')?.parameters?.jsCode ?? '';
for (const expected of ['retry_at', 'retry_count', '20', 'ADMIN_CARD_PENDING', 'SOURCE_PENDING', 'CUSTOMER_CONFIRM_PENDING', 'RESULT_PENDING']) {
  if (!selectRecoveryCode.includes(expected)) errors.push(`Recovery selector missing ${expected}`);
}
if (!selectRecoveryCode.includes('WAITING_RESULT') && !selectRecoveryCode.includes('allowed')) {
  errors.push('Recovery selector must explicitly constrain recoverable delivery steps');
}

const recoveryCodeNodes = nodes.filter((node) => node.type === 'n8n-nodes-base.code' && /Recovery/.test(node.name));
const recoveryCode = recoveryCodeNodes.map((n) => n.parameters?.jsCode ?? '').join('\n');
for (const expected of ['5', '15', '30', '60', '180', '360', '720', '1440']) {
  if (!recoveryCode.includes(expected)) errors.push(`Recovery backoff missing ${expected}-minute tier`);
}

// Critical Telegram sends need short retry.
const criticalTelegramNodes = [
  'Send Admin Task Card',
  'Send Source to Admin',
  'Confirm Task to Customer',
  'Send Translation to Customer',
];
for (const name of criticalTelegramNodes) {
  const node = byName.get(name);
  if (!node || node.type !== 'n8n-nodes-base.telegram') continue;
  if (node.retryOnFail !== true) errors.push(`${name}: Retry On Fail must be enabled`);
  if (Number(node.maxTries ?? 0) < 3) errors.push(`${name}: Max Tries must be at least 3`);
  if (Number(node.waitBetweenTries ?? 0) < 5000) errors.push(`${name}: Wait Between Tries must be at least 5000ms`);
}

const dataTableNodes = nodes.filter((node) => node.type === 'n8n-nodes-base.dataTable');
const tableNames = new Set(dataTableNodes.map((node) => node.parameters?.dataTableId?.value));
for (const table of ['bt_bot_users', 'bt_bot_tasks']) {
  if (!tableNames.has(table)) errors.push(`Workflow must reference Data Table: ${table}`);
}
if (tableNames.has('bt_bot_state')) errors.push('Workflow must not reference bt_bot_state');

for (const node of dataTableNodes) {
  if (['insert', 'update', 'upsert'].includes(node.parameters?.operation)) {
    if (!node.parameters?.columns?.value || !node.parameters?.columns?.schema?.length) {
      errors.push(`${node.name}: Data Table write must include value and schema mappings`);
    }
  }
}

const sendMessageNodes = nodes.filter(
  (node) => node.type === 'n8n-nodes-base.telegram' && node.parameters?.operation === 'sendMessage',
);
for (const node of sendMessageNodes) {
  if (node.parameters?.additionalFields?.appendAttribution !== false) {
    errors.push(`${node.name}: Append n8n Attribution must be disabled`);
  }
}

if (raw.includes('$env.')) errors.push('Workflow must not depend on n8n environment access');
if (/["']?\d{8,12}:[A-Za-z0-9_-]{30,}["']?/.test(raw)) {
  errors.push('Possible real Telegram bot token detected in workflow JSON');
}
if (nodes.some((node) => Object.prototype.hasOwnProperty.call(node, 'credentials'))) {
  errors.push('Workflow export must not contain credential bindings');
}

if (errors.length) {
  console.error('Workflow validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Workflow validation passed: ${nodes.length} nodes, ${dataTableNodes.length} Data Table nodes.`);
