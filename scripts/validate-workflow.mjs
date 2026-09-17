import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);
const errors = [];

const nodes = workflow.nodes ?? [];
const byName = new Map(nodes.map((node) => [node.name, node]));
const connectionTarget = (name, output = 0) => workflow.connections?.[name]?.main?.[output]?.[0]?.node;
const node = (name) => byName.get(name);

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
  'Admin Start',
  'Admin Guidance',
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

for (const codeNode of nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
  const code = codeNode.parameters?.jsCode ?? '';
  try {
    new Function(code);
  } catch (error) {
    errors.push(`${codeNode.name}: invalid JavaScript syntax: ${error.message}`);
  }
}

if (workflow.active !== false) errors.push('Exported workflow must be inactive');

const telegramTriggers = nodes.filter((n) => n.type === 'n8n-nodes-base.telegramTrigger');
if (telegramTriggers.length !== 1) errors.push('Workflow must contain exactly one Telegram Trigger');
const trigger = node('Telegram Trigger');
if (trigger?.type !== 'n8n-nodes-base.telegramTrigger') errors.push('Telegram Trigger must use the Telegram Trigger node');
if (trigger?.typeVersion !== 1.2) errors.push('Telegram Trigger must use typeVersion 1.2');
if (!(trigger?.parameters?.updates ?? []).includes('message')) errors.push('Telegram Trigger must subscribe to message updates');
if (!trigger?.webhookId) errors.push('Telegram Trigger must have a webhookId');

if (nodes.some((n) => n.name === 'Schedule Poll')) errors.push('Polling Schedule must be removed');
if (nodes.some((n) => n.name === 'Telegram getUpdates')) errors.push('Telegram getUpdates polling must be removed');
if (raw.includes('/getUpdates')) errors.push('Workflow must not call Telegram getUpdates');
if (raw.includes('bt_bot_state')) errors.push('bt_bot_state is obsolete in webhook mode');

const recoverySchedule = node('Recovery Schedule');
const recoveryInterval = recoverySchedule?.parameters?.rule?.interval?.[0] ?? {};
if (recoverySchedule?.type !== 'n8n-nodes-base.scheduleTrigger') errors.push('Recovery Schedule must use Schedule Trigger');
if (recoverySchedule?.typeVersion !== 1.2) errors.push('Recovery Schedule must use typeVersion 1.2');
if (recoveryInterval.field !== 'minutes' || recoveryInterval.minutesInterval !== 5) {
  errors.push('Recovery Schedule must run every 5 minutes');
}

const adminConfigCode = node('Admin Config')?.parameters?.jsCode ?? '';
for (const expected of ['ADMIN_USER_ID', 'ADMIN_CHAT_ID']) {
  if (!adminConfigCode.includes(expected)) errors.push(`Admin Config missing ${expected}`);
}
if (adminConfigCode.includes('TELEGRAM_BOT_TOKEN')) errors.push('Bot token must live only in the n8n Telegram credential');
if (adminConfigCode.includes('$env')) errors.push('Admin Config must not depend on $env');

const normalizeCode = node('Normalize + Config')?.parameters?.jsCode ?? '';
if (!normalizeCode.includes("$('Admin Config').first().json")) errors.push('Normalize + Config must use Admin Config');
if (!normalizeCode.includes('telegram_update_id')) errors.push('Normalize + Config must preserve telegram_update_id');
for (const extension of ['epub', 'pdf', 'docx', 'txt']) {
  if (!normalizeCode.includes(`'${extension}'`)) errors.push(`Supported extension missing: ${extension}`);
}

const taskGuard = node('Task Update Not Seen');
if (taskGuard?.parameters?.dataTableId?.value !== 'bt_bot_tasks') errors.push('Task Update Not Seen must use bt_bot_tasks');
if (!(taskGuard?.parameters?.filters?.conditions ?? []).some((f) => f.keyName === 'telegram_update_id')) {
  errors.push('Task Update Not Seen must deduplicate on telegram_update_id');
}

const generateCode = node('Generate Task Candidates')?.parameters?.jsCode ?? '';
if (!generateCode.includes('100000') || !generateCode.includes('900000')) errors.push('Six-digit task-number generator is missing');

const messageCode = node('Prepare Task Messages')?.parameters?.jsCode ?? '';
for (const expected of ['admin_task_text', 'source_caption', 'customer_confirmation_text', 'до 15 минут на каждые 10 000 знаков']) {
  if (!messageCode.includes(expected)) errors.push(`Prepare Task Messages missing ${expected}`);
}

const insertValues = node('Insert Task')?.parameters?.columns?.value ?? {};
const requiredInsertValues = {
  telegram_update_id: true,
  admin_chat_id: true,
  admin_task_text: true,
  source_caption: true,
  customer_confirmation_text: true,
  delivery_step: 'ADMIN_CARD_PENDING',
  retry_count: 0,
  next_retry_at: true,
};
for (const [key, expected] of Object.entries(requiredInsertValues)) {
  const value = insertValues[key];
  if (expected === true && value === undefined) errors.push(`Insert Task must store ${key}`);
  if (expected !== true && value !== expected) errors.push(`Insert Task ${key} must be ${expected}`);
}
if (insertValues.status !== 'NEW') errors.push('New tasks must start with status NEW');

const dataTableNodes = nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable');
const tableNames = new Set(dataTableNodes.map((n) => n.parameters?.dataTableId?.value));
for (const table of ['bt_bot_users', 'bt_bot_tasks']) {
  if (!tableNames.has(table)) errors.push(`Workflow must reference Data Table: ${table}`);
}
for (const n of dataTableNodes) {
  if (['insert', 'update', 'upsert'].includes(n.parameters?.operation)) {
    if (!n.parameters?.columns?.value || !n.parameters?.columns?.schema?.length) {
      errors.push(`${n.name}: Data Table write must include value and schema mappings`);
    }
  }
}

const telegramNodes = nodes.filter((n) => n.type === 'n8n-nodes-base.telegram');
for (const n of telegramNodes) {
  if (n.retryOnFail !== true) errors.push(`${n.name}: Retry On Fail must be enabled`);
  if (n.maxTries !== 3) errors.push(`${n.name}: maxTries must be 3`);
  if (n.waitBetweenTries !== 5000) errors.push(`${n.name}: waitBetweenTries must be 5000ms`);
  if (n.parameters?.operation === 'sendMessage' && n.parameters?.additionalFields?.appendAttribution !== false) {
    errors.push(`${n.name}: Append n8n Attribution must be disabled`);
  }
}

const markAdmin = node('Mark Admin Card Sent')?.parameters?.columns?.value ?? {};
if (markAdmin.delivery_step !== 'SOURCE_PENDING') errors.push('Admin card success must advance to SOURCE_PENDING');
const markSource = node('Mark Source Sent')?.parameters?.columns?.value ?? {};
if (markSource.delivery_step !== 'CUSTOMER_CONFIRM_PENDING') errors.push('Source success must advance to CUSTOMER_CONFIRM_PENDING');
const markProcessing = node('Mark Task Processing')?.parameters?.columns?.value ?? {};
if (markProcessing.status !== 'PROCESSING' || markProcessing.delivery_step !== 'WAITING_RESULT') {
  errors.push('Customer confirmation success must advance task to PROCESSING / WAITING_RESULT');
}

const saveResult = node('Save Result Pending')?.parameters?.columns?.value ?? {};
if (!saveResult.translated_file_id) errors.push('Save Result Pending must persist translated_file_id before delivery');
if (saveResult.status !== 'DELIVERY_PENDING') errors.push('Save Result Pending must set status DELIVERY_PENDING');
if (saveResult.delivery_step !== 'RESULT_PENDING') errors.push('Save Result Pending must set delivery_step RESULT_PENDING');

const markDone = node('Mark Task Done')?.parameters?.columns?.value ?? {};
if (markDone.status !== 'DONE' || markDone.delivery_step !== 'COMPLETE' || !markDone.completed_at) {
  errors.push('Successful result delivery must mark task DONE / COMPLETE with completed_at');
}

const pending = node('Get Pending Deliveries');
if (pending?.parameters?.dataTableId?.value !== 'bt_bot_tasks') errors.push('Get Pending Deliveries must use bt_bot_tasks');
if (pending?.parameters?.returnAll !== true) errors.push('Get Pending Deliveries must return all matching rows');
if (pending?.parameters?.matchType !== 'anyCondition') errors.push('Get Pending Deliveries must use anyCondition');
const pendingSteps = new Set((pending?.parameters?.filters?.conditions ?? []).map((f) => f.keyValue));
for (const step of ['ADMIN_CARD_PENDING', 'SOURCE_PENDING', 'CUSTOMER_CONFIRM_PENDING', 'RESULT_PENDING']) {
  if (!pendingSteps.has(step)) errors.push(`Recovery query missing delivery step ${step}`);
}

const recoveryCode = node('Select Due Recoveries')?.parameters?.jsCode ?? '';
for (const expected of ['MAX_RECOVERY_ATTEMPTS', '8', 'MAX_RECOVERIES_PER_RUN', '20', 'next_retry_at', 'retry_count']) {
  if (!recoveryCode.includes(expected)) errors.push(`Select Due Recoveries missing ${expected}`);
}
const stampValues = node('Stamp Recovery Attempt')?.parameters?.columns?.value ?? {};
if (!stampValues.retry_count || !stampValues.next_retry_at) errors.push('Stamp Recovery Attempt must persist retry_count and next_retry_at');

const expectedConnections = [
  ['Telegram Trigger', 0, 'Admin Config'],
  ['Admin Config', 0, 'Normalize + Config'],
  ['Normalize + Config', 0, 'Role Switch'],
  ['Task Update Not Seen', 0, 'Generate Task Candidates'],
  ['Pick Task Number', 0, 'Prepare Task Messages'],
  ['Prepare Task Messages', 0, 'Insert Task'],
  ['Insert Task', 0, 'Prepare Admin Card Delivery'],
  ['Prepare Admin Card Delivery', 0, 'Send Admin Task Card'],
  ['Send Admin Task Card', 0, 'Mark Admin Card Sent'],
  ['Mark Admin Card Sent', 0, 'Prepare Source Delivery'],
  ['Prepare Source Delivery', 0, 'Send Source to Admin'],
  ['Send Source to Admin', 0, 'Mark Source Sent'],
  ['Mark Source Sent', 0, 'Prepare Customer Confirmation'],
  ['Prepare Customer Confirmation', 0, 'Confirm Task to Customer'],
  ['Confirm Task to Customer', 0, 'Mark Task Processing'],
  ['Save Result Pending', 0, 'Prepare Result Delivery'],
  ['Prepare Result Delivery', 0, 'Send Translation to Customer'],
  ['Send Translation to Customer', 0, 'Mark Task Done'],
  ['Recovery Schedule', 0, 'Get Pending Deliveries'],
  ['Get Pending Deliveries', 0, 'Select Due Recoveries'],
  ['Select Due Recoveries', 0, 'Stamp Recovery Attempt'],
  ['Stamp Recovery Attempt', 0, 'Recovery Step Switch'],
];
for (const [from, output, to] of expectedConnections) {
  if (connectionTarget(from, output) !== to) errors.push(`${from} output ${output} must feed ${to}`);
}

const recoveryRoutes = [
  ['Prepare Admin Card Delivery', 0],
  ['Prepare Source Delivery', 1],
  ['Prepare Customer Confirmation', 2],
  ['Prepare Result Delivery', 3],
];
for (const [to, output] of recoveryRoutes) {
  if (connectionTarget('Recovery Step Switch', output) !== to) {
    errors.push(`Recovery Step Switch output ${output} must feed ${to}`);
  }
}

if (raw.includes('$env.')) errors.push('Workflow must not depend on n8n environment access');
if (raw.includes('PASTE_TELEGRAM_BOT_TOKEN_HERE')) errors.push('Workflow must not embed a Telegram bot-token placeholder');
if (/["']?\d{8,12}:[A-Za-z0-9_-]{30,}["']?/.test(raw)) errors.push('Possible real Telegram bot token detected');
if (nodes.some((n) => Object.prototype.hasOwnProperty.call(n, 'credentials'))) {
  errors.push('Workflow export must not contain credential bindings');
}

if (errors.length) {
  console.error('Workflow validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Workflow validation passed: ${nodes.length} nodes, ${dataTableNodes.length} Data Table nodes, ${telegramNodes.length} Telegram action nodes.`);
