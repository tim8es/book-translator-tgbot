import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);
const errors = [];

const nodes = workflow.nodes ?? [];
const byName = new Map(nodes.map((node) => [node.name, node]));
const requiredNodes = [
  'Schedule Poll',
  'Bot Config',
  'Get Poll State',
  'Telegram getUpdates',
  'Expand Telegram Update',
  'Save Poll Offset',
  'Restore Telegram Update',
  'Normalize + Config',
  'Role Switch',
  'Whitelist ACTIVE',
  'Whitelist Missing',
  'Access Denied',
  'Customer Input Switch',
  'Task Update Not Seen',
  'Generate Task Candidates',
  'Unused Task Number',
  'Pick Task Number',
  'Prepare Task Messages',
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

if (workflow.active !== false) errors.push('Exported workflow must be inactive');

const telegramTriggers = nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger');
if (telegramTriggers.length !== 0) errors.push('Polling workflow must not contain Telegram Trigger');

const schedule = byName.get('Schedule Poll');
if (schedule?.type !== 'n8n-nodes-base.scheduleTrigger') errors.push('Schedule Poll must use Schedule Trigger');
if (schedule?.typeVersion !== 1.2) errors.push('Schedule Poll must use compatible typeVersion 1.2');
const scheduleInterval = schedule?.parameters?.rule?.interval?.[0] ?? {};
if (scheduleInterval.field !== 'seconds' || scheduleInterval.secondsInterval !== 10) {
  errors.push('Schedule Poll must run every 10 seconds');
}

const botConfigCode = byName.get('Bot Config')?.parameters?.jsCode ?? '';
for (const expected of ['PASTE_TELEGRAM_BOT_TOKEN_HERE', 'ADMIN_USER_ID', 'ADMIN_CHAT_ID']) {
  if (!botConfigCode.includes(expected)) errors.push(`Bot Config missing ${expected}`);
}
if (botConfigCode.includes('$env')) errors.push('Bot Config must not depend on $env');

const getPollState = byName.get('Get Poll State');
if (getPollState?.parameters?.dataTableId?.value !== 'bot_state') errors.push('Get Poll State must use bot_state');
const pollStateFilters = getPollState?.parameters?.filters?.conditions ?? [];
if (!pollStateFilters.some((f) => f.keyName === 'key' && f.keyValue === 'telegram_offset')) {
  errors.push('Get Poll State must read key=telegram_offset');
}

const getUpdates = byName.get('Telegram getUpdates');
const getUpdatesUrl = getUpdates?.parameters?.url ?? '';
if (!getUpdatesUrl.includes("$('Bot Config').first().json.bot_token") || !getUpdatesUrl.includes('/getUpdates')) {
  errors.push('Telegram getUpdates must use Bot Config token');
}
const pollQuery = getUpdates?.parameters?.queryParameters?.parameters ?? [];
if (!pollQuery.some((p) => p.name === 'limit' && String(p.value) === '1')) {
  errors.push('Telegram getUpdates must request one update per execution');
}
if (!pollQuery.some((p) => p.name === 'offset')) errors.push('Telegram getUpdates must send offset');

const expandCode = byName.get('Expand Telegram Update')?.parameters?.jsCode ?? '';
for (const expected of ['telegram_update_id', 'next_offset', 'update_id']) {
  if (!expandCode.includes(expected)) errors.push(`Expand Telegram Update missing ${expected}`);
}
if (expandCode.includes('$getWorkflowStaticData')) errors.push('Polling offset must not use workflow static data');

const savePoll = byName.get('Save Poll Offset');
if (savePoll?.parameters?.dataTableId?.value !== 'bot_state') errors.push('Save Poll Offset must use bot_state');
if (savePoll?.parameters?.columns?.value?.value !== '={{ $json.next_offset }}') {
  errors.push('Save Poll Offset must persist next_offset');
}

const normalizeCode = byName.get('Normalize + Config')?.parameters?.jsCode ?? '';
if (!normalizeCode.includes("$('Bot Config').first().json")) errors.push('Normalize + Config must use Bot Config');
if (normalizeCode.includes('$env')) errors.push('Normalize + Config must not depend on $env');
if (!normalizeCode.includes('telegram_update_id')) errors.push('Normalize + Config must preserve telegram_update_id');
for (const extension of ['epub', 'pdf', 'docx', 'txt']) {
  if (!normalizeCode.includes(`'${extension}'`)) errors.push(`Supported extension missing: ${extension}`);
}

const taskGuard = byName.get('Task Update Not Seen');
if (taskGuard?.parameters?.dataTableId?.value !== 'tasks') errors.push('Task Update Not Seen must use tasks');
const taskGuardFilters = taskGuard?.parameters?.filters?.conditions ?? [];
if (!taskGuardFilters.some((f) => f.keyName === 'telegram_update_id')) {
  errors.push('Task Update Not Seen must deduplicate on telegram_update_id');
}

const generateCode = byName.get('Generate Task Candidates')?.parameters?.jsCode ?? '';
if (!generateCode.includes('100000') || !generateCode.includes('900000')) {
  errors.push('Six-digit task-number generator is missing');
}

const insert = byName.get('Insert Task');
if (!insert?.parameters?.columns?.value?.telegram_update_id) errors.push('Insert Task must store telegram_update_id');
if (!(insert?.parameters?.columns?.schema ?? []).some((c) => c.id === 'telegram_update_id')) {
  errors.push('Insert Task schema must contain telegram_update_id');
}

const messageCode = byName.get('Prepare Task Messages')?.parameters?.jsCode ?? '';
for (const expected of ['admin_task_text', 'customer_confirmation_text', 'до 15 минут на каждые 10 000 знаков']) {
  if (!messageCode.includes(expected)) errors.push(`Prepare Task Messages missing ${expected}`);
}
if (byName.get('Send Admin Task Card')?.parameters?.text !== "={{ $('Prepare Task Messages').first().json.admin_task_text }}") {
  errors.push('Send Admin Task Card must use prebuilt admin_task_text');
}
if (byName.get('Confirm Task to Customer')?.parameters?.text !== "={{ $('Prepare Task Messages').first().json.customer_confirmation_text }}") {
  errors.push('Confirm Task to Customer must use prebuilt customer_confirmation_text');
}

const dataTableNodes = nodes.filter((node) => node.type === 'n8n-nodes-base.dataTable');
const tableNames = new Set(dataTableNodes.map((node) => node.parameters?.dataTableId?.value));
for (const table of ['users', 'tasks', 'bot_state']) {
  if (!tableNames.has(table)) errors.push(`Workflow must reference Data Table: ${table}`);
}
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

const connections = workflow.connections ?? {};
const firstTarget = (name, output = 0) => connections[name]?.main?.[output]?.[0]?.node;
const expectedPath = [
  ['Schedule Poll', 'Bot Config'],
  ['Bot Config', 'Get Poll State'],
  ['Get Poll State', 'Telegram getUpdates'],
  ['Telegram getUpdates', 'Expand Telegram Update'],
  ['Expand Telegram Update', 'Save Poll Offset'],
  ['Save Poll Offset', 'Restore Telegram Update'],
  ['Restore Telegram Update', 'Normalize + Config'],
];
for (const [from, to] of expectedPath) {
  if (firstTarget(from) !== to) errors.push(`${from} must feed ${to}`);
}
if (firstTarget('Customer Input Switch', 1) !== 'Task Update Not Seen') {
  errors.push('Supported customer documents must pass through Task Update Not Seen');
}
if (firstTarget('Task Update Not Seen') !== 'Generate Task Candidates') {
  errors.push('Task Update Not Seen must feed Generate Task Candidates');
}
if (firstTarget('Pick Task Number') !== 'Prepare Task Messages') {
  errors.push('Pick Task Number must feed Prepare Task Messages');
}
if (firstTarget('Prepare Task Messages') !== 'Insert Task') {
  errors.push('Prepare Task Messages must feed Insert Task');
}
if (firstTarget('Send Admin Task Card') !== 'Mark Task Processing') {
  errors.push('Task must enter PROCESSING only after admin card is sent');
}
if (firstTarget('Send Translation to Customer') !== 'Mark Task Done') {
  errors.push('Task must enter DONE only after translated document is sent');
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
