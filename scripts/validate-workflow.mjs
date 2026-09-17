import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);
const errors = [];

const nodes = workflow.nodes ?? [];
const byName = new Map(nodes.map((node) => [node.name, node]));
const requiredNodes = [
  'Schedule Poll',
  'Prepare Poll State',
  'Webhook Setup Switch',
  'Delete Telegram Webhook',
  'Mark Webhook Deleted',
  'Telegram getUpdates',
  'Expand Telegram Update',
  'Normalize + Config',
  'Role Switch',
  'Whitelist ACTIVE',
  'Whitelist Missing',
  'Access Denied',
  'Customer Input Switch',
  'Generate Task Candidates',
  'Unused Task Number',
  'Pick Task Number',
  'Insert Task',
  'Send Admin Task Card',
  'Mark Task Processing',
  'Send Source to Admin',
  'Confirm Task to Customer',
  'Admin Input Switch',
  'Get Task by Admin Message',
  'Admin Action Switch',
  'Send Translation to Customer',
  'Mark Task Done',
  'Task Already Done',
];

for (const name of requiredNodes) {
  if (!byName.has(name)) errors.push(`Missing node: ${name}`);
}

const telegramTriggers = nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger');
if (telegramTriggers.length !== 0) errors.push('Polling workflow must not contain Telegram Trigger');

const scheduleTriggers = nodes.filter((node) => node.type === 'n8n-nodes-base.scheduleTrigger');
if (scheduleTriggers.length !== 1) errors.push(`Expected one Schedule Trigger, found ${scheduleTriggers.length}`);
const scheduleInterval = scheduleTriggers[0]?.parameters?.rule?.interval?.[0] ?? {};
if (scheduleInterval.field !== 'seconds' || scheduleInterval.secondsInterval !== 5) {
  errors.push('Schedule Poll must run every 5 seconds');
}
if (workflow.active !== false) errors.push('Exported workflow must be inactive');

const preparePollCode = byName.get('Prepare Poll State')?.parameters?.jsCode ?? '';
if (!preparePollCode.includes("$getWorkflowStaticData('global')") || !preparePollCode.includes('telegram_offset')) {
  errors.push('Prepare Poll State must read persistent telegram_offset');
}

const getUpdates = byName.get('Telegram getUpdates');
const getUpdatesUrl = getUpdates?.parameters?.url ?? '';
if (!getUpdatesUrl.includes('$env.TELEGRAM_BOT_TOKEN') || !getUpdatesUrl.includes('/getUpdates')) {
  errors.push('Telegram getUpdates must use TELEGRAM_BOT_TOKEN from environment');
}
const pollQuery = getUpdates?.parameters?.queryParameters?.parameters ?? [];
if (!pollQuery.some((p) => p.name === 'limit' && String(p.value) === '1')) {
  errors.push('Telegram getUpdates must request one update per execution');
}
if (!pollQuery.some((p) => p.name === 'offset')) {
  errors.push('Telegram getUpdates must send offset');
}

const deleteWebhook = byName.get('Delete Telegram Webhook');
const deleteWebhookUrl = deleteWebhook?.parameters?.url ?? '';
if (!deleteWebhookUrl.includes('$env.TELEGRAM_BOT_TOKEN') || !deleteWebhookUrl.includes('/deleteWebhook')) {
  errors.push('Delete Telegram Webhook must use TELEGRAM_BOT_TOKEN from environment');
}

const expandCode = byName.get('Expand Telegram Update')?.parameters?.jsCode ?? '';
for (const expected of ["$getWorkflowStaticData('global')", 'update_id', 'telegram_offset']) {
  if (!expandCode.includes(expected)) errors.push(`Expand Telegram Update missing ${expected}`);
}

const normalizeCode = byName.get('Normalize + Config')?.parameters?.jsCode ?? '';
for (const expected of ['$env.ADMIN_USER_ID', '$env.ADMIN_CHAT_ID', 'FALLBACK_ADMIN_USER_ID', 'FALLBACK_ADMIN_CHAT_ID']) {
  if (!normalizeCode.includes(expected)) errors.push(`Normalize + Config missing ${expected}`);
}
for (const extension of ['epub', 'pdf', 'docx', 'txt']) {
  if (!normalizeCode.includes(`'${extension}'`)) errors.push(`Supported extension missing: ${extension}`);
}

const generateCode = byName.get('Generate Task Candidates')?.parameters?.jsCode ?? '';
if (!generateCode.includes('100000') || !generateCode.includes('900000')) {
  errors.push('Six-digit task-number generator is missing');
}

const customerConfirmation = byName.get('Confirm Task to Customer')?.parameters?.text ?? '';
if (!customerConfirmation.includes("$('Pick Task Number').first().json.task_no")) {
  errors.push('Customer confirmation must include the dynamic task number');
}
if (!customerConfirmation.includes('до 15 минут на каждые 10 000 знаков')) {
  errors.push('Customer confirmation must include the translation-speed estimate');
}

const dataTableNodes = nodes.filter((node) => node.type === 'n8n-nodes-base.dataTable');
const tableNames = new Set(dataTableNodes.map((node) => node.parameters?.dataTableId?.value));
if (!tableNames.has('users') || !tableNames.has('tasks')) {
  errors.push('Workflow must reference both users and tasks Data Tables');
}

for (const node of dataTableNodes) {
  if (['insert', 'update', 'upsert'].includes(node.parameters?.operation)) {
    if (!node.parameters?.columns?.value || !node.parameters?.columns?.schema?.length) {
      errors.push(`${node.name}: Data Table write must include value and schema mappings`);
    }
  }
}

const whitelistActive = byName.get('Whitelist ACTIVE');
const whitelistFilters = whitelistActive?.parameters?.filters?.conditions ?? [];
if (!whitelistFilters.some((f) => f.keyName === 'user_id') ||
    !whitelistFilters.some((f) => f.keyName === 'status' && f.keyValue === 'ACTIVE')) {
  errors.push('Whitelist ACTIVE must match user_id and ACTIVE status');
}

const connections = workflow.connections ?? {};
const firstTarget = (name, output = 0) => connections[name]?.main?.[output]?.[0]?.node;
if (firstTarget('Schedule Poll') !== 'Prepare Poll State') {
  errors.push('Schedule Poll must feed Prepare Poll State');
}
if (firstTarget('Telegram getUpdates') !== 'Expand Telegram Update') {
  errors.push('Telegram getUpdates must feed Expand Telegram Update');
}
if (firstTarget('Expand Telegram Update') !== 'Normalize + Config') {
  errors.push('Expand Telegram Update must feed Normalize + Config');
}
if (firstTarget('Send Admin Task Card') !== 'Mark Task Processing') {
  errors.push('Task must enter PROCESSING only after admin card is sent');
}
if (firstTarget('Send Translation to Customer') !== 'Mark Task Done') {
  errors.push('Task must enter DONE only after translated document is sent');
}

if (/["']?\d{8,12}:[A-Za-z0-9_-]{30,}["']?/.test(raw)) {
  errors.push('Possible Telegram bot token detected in workflow JSON');
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
