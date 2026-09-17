import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);
const errors = [];

const nodes = workflow.nodes ?? [];
const byName = new Map(nodes.map((node) => [node.name, node]));
const requiredNodes = [
  'Telegram Trigger',
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

const triggers = nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger');
if (triggers.length !== 1) errors.push(`Expected one Telegram Trigger, found ${triggers.length}`);
if (triggers[0]?.parameters?.additionalFields?.download !== false) {
  errors.push('Telegram Trigger must not download source files');
}
if (workflow.active !== false) errors.push('Exported workflow must be inactive');

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
