import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);
const errors = [];

const nodes = workflow.nodes ?? [];
const byName = new Map(nodes.map((node) => [node.name, node]));
const connections = workflow.connections ?? {};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
const firstTarget = (name, output = 0) => connections[name]?.main?.[output]?.[0]?.node;

const requiredNodes = [
  'Telegram Trigger',
  'Admin Config',
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
  'Prepare Admin Card Delivery',
  'Send Admin Task Card',
  'Mark Admin Card Sent',
  'Prepare Source Delivery',
  'Send Source to Admin',
  'Mark Source Sent',
  'Prepare Customer Confirmation',
  'Confirm Task to Customer',
  'Mark Task Processing',
  'Admin Input Switch',
  'Get Task by Admin Message',
  'Admin Action Switch',
  'Task Not Found',
  'Task Already Done',
  'Task Delivery Pending',
  'Save Result Pending',
  'Prepare Result Delivery',
  'Send Translation to Customer',
  'Mark Task Done',
  'Confirm Completion to Admin',
  'Recovery Schedule',
  'Get Pending Deliveries',
  'Select Due Recoveries',
  'Stamp Recovery Attempt',
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

// Event-driven entrypoint: no legacy polling stack.
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

const adminConfigCode = byName.get('Admin Config')?.parameters?.jsCode ?? '';
for (const expected of ['ADMIN_USER_ID', 'ADMIN_CHAT_ID']) {
  if (!adminConfigCode.includes(expected)) errors.push(`Admin Config missing ${expected}`);
}
if (adminConfigCode.includes('TELEGRAM_BOT_TOKEN') || adminConfigCode.includes('PASTE_TELEGRAM_BOT_TOKEN_HERE')) {
  errors.push('Admin Config must not store the Telegram bot token');
}

const normalizeCode = byName.get('Normalize + Config')?.parameters?.jsCode ?? '';
if (!normalizeCode.includes("$('Admin Config').first().json")) errors.push('Normalize + Config must use Admin Config');
if (!normalizeCode.includes('telegram_update_id')) errors.push('Normalize + Config must preserve telegram_update_id');
for (const extension of ['epub', 'pdf', 'docx', 'txt']) {
  if (!normalizeCode.includes(`'${extension}'`)) errors.push(`Supported extension missing: ${extension}`);
}

// Customer duplicate and task-number guards.
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

const insertValues = byName.get('Insert Task')?.parameters?.columns?.value ?? {};
for (const field of [
  'telegram_update_id',
  'admin_chat_id',
  'delivery_step',
  'retry_count',
  'next_retry_at',
  'admin_task_text',
  'source_caption',
  'customer_confirmation_text',
]) {
  if (!hasOwn(insertValues, field)) errors.push(`Insert Task must persist ${field}`);
}
if (String(insertValues.delivery_step) !== 'ADMIN_CARD_PENDING') {
  errors.push('New tasks must start at ADMIN_CARD_PENDING');
}
if (Number(insertValues.retry_count) !== 0) errors.push('New tasks must start with retry_count=0');

const prepCode = byName.get('Prepare Task Messages')?.parameters?.jsCode ?? '';
for (const expected of ['admin_task_text', 'source_caption', 'customer_confirmation_text', 'до 15 минут на каждые 10 000 знаков']) {
  if (!prepCode.includes(expected)) errors.push(`Prepare Task Messages missing ${expected}`);
}

// Durable source-notification state transitions.
const adminCardValues = byName.get('Mark Admin Card Sent')?.parameters?.columns?.value ?? {};
if (!hasOwn(adminCardValues, 'admin_task_message_id') || String(adminCardValues.delivery_step) !== 'SOURCE_PENDING') {
  errors.push('Mark Admin Card Sent must save message id and advance to SOURCE_PENDING');
}
const sourceValues = byName.get('Mark Source Sent')?.parameters?.columns?.value ?? {};
if (String(sourceValues.delivery_step) !== 'CUSTOMER_CONFIRM_PENDING') {
  errors.push('Mark Source Sent must advance to CUSTOMER_CONFIRM_PENDING');
}
const processingValues = byName.get('Mark Task Processing')?.parameters?.columns?.value ?? {};
if (String(processingValues.status) !== 'PROCESSING' || String(processingValues.delivery_step) !== 'WAITING_RESULT') {
  errors.push('Customer confirmation must end at PROCESSING / WAITING_RESULT');
}

if (firstTarget('Insert Task') !== 'Prepare Admin Card Delivery') errors.push('Inserted task must enter admin-card delivery');
if (firstTarget('Prepare Admin Card Delivery') !== 'Send Admin Task Card') errors.push('Admin-card preparation must feed Send Admin Task Card');
if (firstTarget('Send Admin Task Card') !== 'Mark Admin Card Sent') errors.push('Admin card state must persist after send');
if (firstTarget('Mark Admin Card Sent') !== 'Prepare Source Delivery') errors.push('Admin-card persistence must feed source delivery');
if (firstTarget('Send Source to Admin') !== 'Mark Source Sent') errors.push('Source state must persist after send');
if (firstTarget('Confirm Task to Customer') !== 'Mark Task Processing') errors.push('Task may enter PROCESSING only after customer confirmation');

// Critical result safety: save translated file reference before delivery.
const resultPendingValues = byName.get('Save Result Pending')?.parameters?.columns?.value ?? {};
if (!hasOwn(resultPendingValues, 'translated_file_id')) errors.push('Save Result Pending must save translated_file_id');
if (String(resultPendingValues.status) !== 'DELIVERY_PENDING') errors.push('Save Result Pending must set DELIVERY_PENDING');
if (String(resultPendingValues.delivery_step) !== 'RESULT_PENDING') errors.push('Save Result Pending must set RESULT_PENDING');
if (Number(resultPendingValues.retry_count) !== 0) errors.push('Save Result Pending must reset retry_count');
if (!hasOwn(resultPendingValues, 'next_retry_at')) errors.push('Save Result Pending must persist next_retry_at');

if (firstTarget('Save Result Pending') !== 'Prepare Result Delivery') {
  errors.push('Translated file must be persisted before result-delivery preparation');
}
if (firstTarget('Prepare Result Delivery') !== 'Send Translation to Customer') {
  errors.push('Prepared result must feed customer delivery');
}
if (firstTarget('Send Translation to Customer') !== 'Mark Task Done') {
  errors.push('Task must become DONE only after customer result delivery');
}

const markDoneValues = byName.get('Mark Task Done')?.parameters?.columns?.value ?? {};
if (String(markDoneValues.status) !== 'DONE') errors.push('Mark Task Done must set DONE');
if (String(markDoneValues.delivery_step) !== 'COMPLETE') errors.push('Mark Task Done must set COMPLETE');
if (!hasOwn(markDoneValues, 'completed_at')) errors.push('Mark Task Done must set completed_at');

// Recovery should be infrequent, bounded and reuse the same durable delivery steps.
const recoverySchedule = byName.get('Recovery Schedule');
if (recoverySchedule?.type !== 'n8n-nodes-base.scheduleTrigger') errors.push('Recovery Schedule must use Schedule Trigger');
const intervals = recoverySchedule?.parameters?.rule?.interval ?? [];
if (!intervals.some((i) => i.field === 'minutes' && Number(i.minutesInterval) === 5)) {
  errors.push('Recovery Schedule must run every 5 minutes');
}

const pendingDeliveries = byName.get('Get Pending Deliveries');
if (pendingDeliveries?.parameters?.dataTableId?.value !== 'bt_bot_tasks') {
  errors.push('Get Pending Deliveries must use bt_bot_tasks');
}
const pendingConditions = pendingDeliveries?.parameters?.filters?.conditions ?? [];
const pendingSteps = new Set(pendingConditions.filter((c) => c.keyName === 'delivery_step').map((c) => c.keyValue));
for (const step of ['ADMIN_CARD_PENDING', 'SOURCE_PENDING', 'CUSTOMER_CONFIRM_PENDING', 'RESULT_PENDING']) {
  if (!pendingSteps.has(step)) errors.push(`Get Pending Deliveries missing ${step}`);
}

const selectRecoveryCode = byName.get('Select Due Recoveries')?.parameters?.jsCode ?? '';
for (const expected of [
  'MAX_RECOVERY_ATTEMPTS = 8',
  'MAX_RECOVERIES_PER_RUN = 20',
  'BACKOFF_MINUTES = [5, 15, 30, 60, 180, 360, 720, 1440]',
  'retry_count',
  'next_retry_at',
]) {
  if (!selectRecoveryCode.includes(expected)) errors.push(`Recovery selector missing ${expected}`);
}

const stampValues = byName.get('Stamp Recovery Attempt')?.parameters?.columns?.value ?? {};
for (const field of ['retry_count', 'next_retry_at']) {
  if (!hasOwn(stampValues, field)) errors.push(`Stamp Recovery Attempt must persist ${field}`);
}

if (firstTarget('Recovery Schedule') !== 'Get Pending Deliveries') errors.push('Recovery Schedule must read pending deliveries');
if (firstTarget('Get Pending Deliveries') !== 'Select Due Recoveries') errors.push('Pending deliveries must pass through due/backoff selection');
if (firstTarget('Select Due Recoveries') !== 'Stamp Recovery Attempt') errors.push('Due recovery must persist its attempt before sending');
if (firstTarget('Stamp Recovery Attempt') !== 'Recovery Step Switch') errors.push('Stamped recovery attempt must route by delivery step');

const recoveryTargets = [0, 1, 2, 3].map((index) => firstTarget('Recovery Step Switch', index));
const expectedRecoveryTargets = [
  'Prepare Admin Card Delivery',
  'Prepare Source Delivery',
  'Prepare Customer Confirmation',
  'Prepare Result Delivery',
];
for (let i = 0; i < expectedRecoveryTargets.length; i += 1) {
  if (recoveryTargets[i] !== expectedRecoveryTargets[i]) {
    errors.push(`Recovery Step Switch output ${i} must feed ${expectedRecoveryTargets[i]}`);
  }
}

// Critical Telegram sends need short retry. Recovery reuses these same nodes.
for (const name of [
  'Send Admin Task Card',
  'Send Source to Admin',
  'Confirm Task to Customer',
  'Send Translation to Customer',
]) {
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
