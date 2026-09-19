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
const targets = (name, output = 0) => (connections[name]?.main?.[output] ?? []).map((entry) => entry.node);

const requiredNodes = [
  'Schedule Poll', 'Bot Config',
  'Poll State Exists', 'Poll State Missing', 'Initialize Poll State', 'Get Poll State',
  'Prepare Poll Request', 'Can Poll Switch', 'Telegram getUpdates', 'Inspect Telegram Poll',
  'Poll Response Switch', 'Telegram deleteWebhook', 'Validate Webhook Clear',
  'Prepare Poll Lock', 'Acquire Poll Lock', 'Restore Locked Update', 'Message Present Switch',
  'Normalize + Config', 'Role Switch',
  'Get User', 'Resolve User State', 'User Status Switch',
  'New User Input Switch', 'Insert Pending User', 'Pending Notification Switch',
  'Prepare Access Request Notification', 'Send Access Request to Admin',
  'Mark Access Request Notified', 'Send Access Request Confirmation',
  'Pending Access Reply', 'Access Request Required', 'Access Denied',
  'Customer Input Switch', 'Customer Start', 'Customer Help',
  'Task Update Not Seen', 'Task Update Seen', 'Generate Task Candidates', 'Unused Task Number',
  'Pick Task Number', 'Prepare Task Messages', 'Insert Task',
  'Ack Poll Offset', 'Ack New Task Offset',
  'Prepare Admin Card Delivery', 'Send Admin Task Card', 'Mark Admin Card Sent',
  'Prepare Source Delivery', 'Send Source to Admin', 'Mark Source Sent',
  'Prepare Customer Confirmation', 'Confirm Task to Customer', 'Mark Task Processing',
  'Admin Input Switch', 'Get Task by Admin Message', 'Admin Action Switch',
  'Task Not Found', 'Task Already Done', 'Task Delivery Pending',
  'Save Result Pending', 'Ack Result Offset', 'Prepare Result Delivery',
  'Send Translation to Customer', 'Mark Task Done', 'Confirm Completion to Admin',
  'Recovery Schedule', 'Get Pending Deliveries', 'Select Due Recoveries',
  'Stamp Recovery Attempt', 'Recovery Step Switch',
];

for (const name of requiredNodes) {
  if (!byName.has(name)) errors.push(`Missing node: ${name}`);
}

for (const node of nodes.filter((node) => node.type === 'n8n-nodes-base.code')) {
  try {
    new Function(node.parameters?.jsCode ?? '');
  } catch (error) {
    errors.push(`${node.name}: invalid JavaScript syntax: ${error.message}`);
  }
}

if (workflow.active !== false) errors.push('Exported workflow must be inactive');
if (byName.has('Telegram Trigger')) errors.push('Webhook Telegram Trigger must not be present');
if (raw.includes('$env.')) errors.push('Workflow must not depend on n8n environment access');
if (/["']?\d{8,12}:[A-Za-z0-9_-]{30,}["']?/.test(raw)) errors.push('Possible real Telegram bot token detected');
if (nodes.some((node) => hasOwn(node, 'credentials'))) errors.push('Workflow export must not contain credential bindings');

// Polling cadence and local configuration.
const pollSchedule = byName.get('Schedule Poll');
const pollIntervals = pollSchedule?.parameters?.rule?.interval ?? [];
if (pollSchedule?.type !== 'n8n-nodes-base.scheduleTrigger') errors.push('Schedule Poll must use Schedule Trigger');
if (!pollIntervals.some((i) => i.field === 'seconds' && Number(i.secondsInterval) === 30)) {
  errors.push('Schedule Poll must run every 30 seconds');
}

const configCode = byName.get('Bot Config')?.parameters?.jsCode ?? '';
for (const expected of ['TELEGRAM_BOT_TOKEN', 'PASTE_TELEGRAM_BOT_TOKEN_HERE', 'ADMIN_USER_ID', 'ADMIN_CHAT_ID']) {
  if (!configCode.includes(expected)) errors.push(`Bot Config missing ${expected}`);
}

// State must self-initialize and use one JSON state record for cursor + lease.
for (const name of ['Poll State Exists', 'Poll State Missing', 'Get Poll State', 'Initialize Poll State']) {
  const node = byName.get(name);
  if (node?.parameters?.dataTableId?.value !== 'bt_bot_state') errors.push(`${name} must use bt_bot_state`);
}
for (const name of ['Poll State Exists', 'Poll State Missing', 'Get Poll State']) {
  const conditions = byName.get(name)?.parameters?.filters?.conditions ?? [];
  if (!conditions.some((c) => c.keyName === 'key' && c.keyValue === 'telegram_state')) {
    errors.push(`${name} must address telegram_state`);
  }
}
const initValues = byName.get('Initialize Poll State')?.parameters?.columns?.value ?? {};
if (String(initValues.key) !== 'telegram_state') errors.push('Initialize Poll State must insert telegram_state');
for (const expected of ['offset', 'lockToken', 'lockUntil']) {
  if (!String(initValues.value ?? '').includes(expected)) errors.push(`Initial poll state missing ${expected}`);
}
if (!targets('Bot Config').includes('Poll State Exists') || !targets('Bot Config').includes('Poll State Missing')) {
  errors.push('Bot Config must check both existing and missing poll state');
}
if (firstTarget('Poll State Exists') !== 'Get Poll State') errors.push('Existing poll state must feed Get Poll State');
if (firstTarget('Poll State Missing') !== 'Initialize Poll State') errors.push('Missing poll state must initialize');
if (firstTarget('Initialize Poll State') !== 'Get Poll State') errors.push('Initialized state must feed Get Poll State');

const preparePollCode = byName.get('Prepare Poll Request')?.parameters?.jsCode ?? '';
for (const expected of ['offset', 'lockToken', 'lockUntil', 'can_poll']) {
  if (!preparePollCode.includes(expected)) errors.push(`Prepare Poll Request missing ${expected}`);
}
if (!preparePollCode.includes('Date.now()')) errors.push('Prepare Poll Request must honor lock TTL');
if (firstTarget('Get Poll State') !== 'Prepare Poll Request') errors.push('Get Poll State must feed Prepare Poll Request');
if (firstTarget('Prepare Poll Request') !== 'Can Poll Switch') errors.push('Prepared poll state must feed Can Poll Switch');
if (firstTarget('Can Poll Switch', 0) !== 'Telegram getUpdates') errors.push('Unlocked polling must feed getUpdates');

// getUpdates must be bounded and inspect non-2xx so webhook conflicts self-heal.
const getUpdates = byName.get('Telegram getUpdates');
if (getUpdates?.type !== 'n8n-nodes-base.httpRequest') errors.push('Telegram getUpdates must use HTTP Request');
const getUpdatesText = JSON.stringify(getUpdates?.parameters ?? {});
for (const expected of ['/getUpdates', 'offset', 'limit', '"1"', 'allowed_updates', 'message']) {
  if (!getUpdatesText.includes(expected)) errors.push(`Telegram getUpdates missing ${expected}`);
}
const httpResponseOptions = getUpdates?.parameters?.options?.response?.response ?? {};
if (httpResponseOptions.neverError !== true) errors.push('Telegram getUpdates must enable Never Error');
if (httpResponseOptions.fullResponse !== true) errors.push('Telegram getUpdates must include full response');
if (Number(getUpdates?.parameters?.options?.timeout ?? 0) <= 0 || Number(getUpdates?.parameters?.options?.timeout) > 10000) {
  errors.push('Telegram getUpdates timeout must be explicitly <= 10 seconds');
}
if (getUpdates?.retryOnFail !== true || Number(getUpdates?.maxTries ?? 0) < 2) errors.push('Telegram getUpdates must retry network failures');

const inspectCode = byName.get('Inspect Telegram Poll')?.parameters?.jsCode ?? '';
for (const expected of ['409', 'webhook_conflict', 'next_offset', 'telegram_update_id']) {
  if (!inspectCode.includes(expected)) errors.push(`Inspect Telegram Poll missing ${expected}`);
}
if (firstTarget('Telegram getUpdates') !== 'Inspect Telegram Poll') errors.push('getUpdates must feed Inspect Telegram Poll');
if (firstTarget('Inspect Telegram Poll') !== 'Poll Response Switch') errors.push('Poll inspection must feed response switch');
if (firstTarget('Poll Response Switch', 0) !== 'Prepare Poll Lock') errors.push('Update response must acquire poll lock');
if (firstTarget('Poll Response Switch', 1) !== 'Telegram deleteWebhook') errors.push('409 response must clear webhook automatically');

const deleteWebhook = byName.get('Telegram deleteWebhook');
const deleteText = JSON.stringify(deleteWebhook?.parameters ?? {});
if (deleteWebhook?.type !== 'n8n-nodes-base.httpRequest' || !deleteText.includes('/deleteWebhook')) {
  errors.push('Telegram deleteWebhook must call Bot API deleteWebhook');
}
if (!deleteText.includes('drop_pending_updates') || !deleteText.includes('false')) {
  errors.push('deleteWebhook must preserve pending updates');
}
if (firstTarget('Telegram deleteWebhook') !== 'Validate Webhook Clear') errors.push('deleteWebhook must be validated');

// CAS lease: only one overlapping execution may process a fetched update.
const prepareLockCode = byName.get('Prepare Poll Lock')?.parameters?.jsCode ?? '';
for (const expected of ['expected_state_raw', 'locked_state_raw', 'lockToken', 'lockUntil', '120000']) {
  if (!prepareLockCode.includes(expected)) errors.push(`Prepare Poll Lock missing ${expected}`);
}
const acquire = byName.get('Acquire Poll Lock');
if (acquire?.parameters?.dataTableId?.value !== 'bt_bot_state') errors.push('Acquire Poll Lock must use bt_bot_state');
const acquireFilters = acquire?.parameters?.filters?.conditions ?? [];
if (!acquireFilters.some((c) => c.keyName === 'key' && c.keyValue === 'telegram_state')) errors.push('Acquire Poll Lock must match telegram_state');
if (!acquireFilters.some((c) => c.keyName === 'value' && String(c.keyValue).includes('expected_state_raw'))) {
  errors.push('Acquire Poll Lock must compare-and-set the previous state');
}
const acquireValues = acquire?.parameters?.columns?.value ?? {};
if (!String(acquireValues.value ?? '').includes('locked_state_raw')) errors.push('Acquire Poll Lock must persist locked_state_raw');
if (firstTarget('Prepare Poll Lock') !== 'Acquire Poll Lock') errors.push('Prepared lock must feed Acquire Poll Lock');
if (firstTarget('Acquire Poll Lock') !== 'Restore Locked Update') errors.push('Only successful lock acquisition may restore update');
if (firstTarget('Restore Locked Update') !== 'Message Present Switch') errors.push('Locked update must feed message routing');

const normalizeCode = byName.get('Normalize + Config')?.parameters?.jsCode ?? '';
for (const expected of ['telegram_update_id', 'next_offset']) {
  if (!normalizeCode.includes(expected)) errors.push(`Normalize + Config must preserve ${expected}`);
}
for (const extension of ['epub', 'pdf', 'docx', 'txt']) {
  if (!normalizeCode.includes(`'${extension}'`)) errors.push(`Supported extension missing: ${extension}`);
}

// Customer access request lifecycle.
if (firstTarget('Role Switch', 1) !== 'Get User') errors.push('Customer role must resolve bt_bot_users row first');
const getUser = byName.get('Get User');
if (getUser?.parameters?.dataTableId?.value !== 'bt_bot_users') errors.push('Get User must use bt_bot_users');
if (!(getUser?.parameters?.filters?.conditions ?? []).some((c) => c.keyName === 'user_id')) errors.push('Get User must match user_id');
if (getUser?.alwaysOutputData !== true) errors.push('Get User must keep missing-user branch alive');

const resolveUserCode = byName.get('Resolve User State')?.parameters?.jsCode ?? '';
for (const expected of ['user_status', 'MISSING', 'request_notified_at']) {
  if (!resolveUserCode.includes(expected)) errors.push(`Resolve User State missing ${expected}`);
}
if (firstTarget('Get User') !== 'Resolve User State') errors.push('Get User must feed Resolve User State');
if (firstTarget('Resolve User State') !== 'User Status Switch') errors.push('Resolved user state must feed User Status Switch');
if (firstTarget('User Status Switch', 0) !== 'Customer Input Switch') errors.push('ACTIVE user must enter customer flow');
if (firstTarget('User Status Switch', 1) !== 'Pending Notification Switch') errors.push('PENDING user must enter pending flow');
if (firstTarget('User Status Switch', 2) !== 'Access Denied') errors.push('Blocked/rejected/unknown status must be denied');
if (firstTarget('User Status Switch', 3) !== 'New User Input Switch') errors.push('Missing user must enter request gate');
if (firstTarget('New User Input Switch', 0) !== 'Insert Pending User') errors.push('Unknown /start must insert pending user');
if (firstTarget('New User Input Switch', 1) !== 'Access Request Required') errors.push('Unknown non-/start input must not create a user');

const pendingInsert = byName.get('Insert Pending User');
if (pendingInsert?.parameters?.dataTableId?.value !== 'bt_bot_users') errors.push('Insert Pending User must use bt_bot_users');
const pendingValues = pendingInsert?.parameters?.columns?.value ?? {};
for (const field of ['user_id','username','name','status','created_at','request_notified_at']) {
  if (!hasOwn(pendingValues, field)) errors.push(`Insert Pending User must persist ${field}`);
}
if (String(pendingValues.status) !== 'PENDING') errors.push('New access requests must start as PENDING');
if (firstTarget('Insert Pending User') !== 'Prepare Access Request Notification') errors.push('Pending user must feed access notification');
if (firstTarget('Pending Notification Switch', 0) !== 'Prepare Access Request Notification') errors.push('Unnotified PENDING user must retry admin notification');
if (firstTarget('Pending Notification Switch', 1) !== 'Pending Access Reply') errors.push('Notified PENDING user must not send normal duplicate admin notification');

const accessTextCode = byName.get('Prepare Access Request Notification')?.parameters?.jsCode ?? '';
for (const expected of ['username', 'sender_id', 'PENDING', 'ACTIVE']) {
  if (!accessTextCode.includes(expected)) errors.push(`Access request notification missing ${expected}`);
}
if (firstTarget('Prepare Access Request Notification') !== 'Send Access Request to Admin') errors.push('Prepared access request must notify admin');
if (firstTarget('Send Access Request to Admin') !== 'Mark Access Request Notified') errors.push('Admin notification must be recorded before customer confirmation');
const notifyValues = byName.get('Mark Access Request Notified')?.parameters?.columns?.value ?? {};
if (!hasOwn(notifyValues, 'request_notified_at')) errors.push('Admin access notification must persist request_notified_at');
if (firstTarget('Mark Access Request Notified') !== 'Send Access Request Confirmation') errors.push('Recorded access request must confirm to customer');
if (firstTarget('Send Access Request Confirmation') !== 'Ack Poll Offset') errors.push('New access request must acknowledge only after confirmation');
if (firstTarget('Pending Access Reply') !== 'Ack Poll Offset') errors.push('Pending reply must acknowledge only after successful send');
if (firstTarget('Access Request Required') !== 'Ack Poll Offset') errors.push('Request guidance must acknowledge only after successful send');

// Every offset write must release only the lease owned by this execution.
for (const name of ['Ack Poll Offset', 'Ack New Task Offset', 'Ack Result Offset']) {
  const node = byName.get(name);
  if (node?.parameters?.dataTableId?.value !== 'bt_bot_state') errors.push(`${name} must use bt_bot_state`);
  const filters = node?.parameters?.filters?.conditions ?? [];
  if (!filters.some((c) => c.keyName === 'key' && c.keyValue === 'telegram_state')) errors.push(`${name} must match telegram_state`);
  if (!filters.some((c) => c.keyName === 'value' && String(c.keyValue).includes('locked_state_raw'))) {
    errors.push(`${name} must release only its own CAS lease`);
  }
  const values = node?.parameters?.columns?.value ?? {};
  const stateExpr = String(values.value ?? '');
  for (const expected of ['next_offset', 'lockToken', 'lockUntil']) {
    if (!stateExpr.includes(expected)) errors.push(`${name} state update missing ${expected}`);
  }
}

// Customer duplicate guard and durable new-task checkpoint.
for (const name of ['Task Update Not Seen', 'Task Update Seen']) {
  const node = byName.get(name);
  if (node?.parameters?.dataTableId?.value !== 'bt_bot_tasks') errors.push(`${name} must use bt_bot_tasks`);
  if (!(node?.parameters?.filters?.conditions ?? []).some((c) => c.keyName === 'telegram_update_id')) errors.push(`${name} must match telegram_update_id`);
}
if (!targets('Customer Input Switch', 1).includes('Task Update Not Seen') || !targets('Customer Input Switch', 1).includes('Task Update Seen')) {
  errors.push('Customer document branch must check seen and unseen update IDs');
}
if (firstTarget('Task Update Seen') !== 'Ack Poll Offset') errors.push('Seen customer update must only acknowledge cursor');

const generateCode = byName.get('Generate Task Candidates')?.parameters?.jsCode ?? '';
if (!generateCode.includes('100000') || !generateCode.includes('900000')) errors.push('Six-digit task-number generator is missing');
const insertValues = byName.get('Insert Task')?.parameters?.columns?.value ?? {};
for (const field of ['telegram_update_id','source_file_id','delivery_step','retry_count','next_retry_at','admin_task_text','source_caption','customer_confirmation_text']) {
  if (!hasOwn(insertValues, field)) errors.push(`Insert Task must persist ${field}`);
}
if (String(insertValues.delivery_step) !== 'ADMIN_CARD_PENDING') errors.push('New tasks must start at ADMIN_CARD_PENDING');
if (firstTarget('Insert Task') !== 'Ack New Task Offset') errors.push('New task must be durable before cursor acknowledgement');
if (firstTarget('Ack New Task Offset') !== 'Prepare Admin Card Delivery') errors.push('New-task acknowledgement must feed delivery state machine');

// Durable outbound state transitions.
const adminCardValues = byName.get('Mark Admin Card Sent')?.parameters?.columns?.value ?? {};
if (!hasOwn(adminCardValues, 'admin_task_message_id') || String(adminCardValues.delivery_step) !== 'SOURCE_PENDING') errors.push('Admin card send must persist message id and SOURCE_PENDING');
if (String(byName.get('Mark Source Sent')?.parameters?.columns?.value?.delivery_step) !== 'CUSTOMER_CONFIRM_PENDING') errors.push('Source send must advance to CUSTOMER_CONFIRM_PENDING');
const processing = byName.get('Mark Task Processing')?.parameters?.columns?.value ?? {};
if (String(processing.status) !== 'PROCESSING' || String(processing.delivery_step) !== 'WAITING_RESULT') errors.push('Customer confirmation must end at PROCESSING / WAITING_RESULT');

// Translated file reference must be durable before cursor ack and customer send.
const resultValues = byName.get('Save Result Pending')?.parameters?.columns?.value ?? {};
if (!hasOwn(resultValues, 'translated_file_id')) errors.push('Save Result Pending must save translated_file_id');
if (String(resultValues.status) !== 'DELIVERY_PENDING' || String(resultValues.delivery_step) !== 'RESULT_PENDING') errors.push('Result must enter DELIVERY_PENDING / RESULT_PENDING');
if (firstTarget('Save Result Pending') !== 'Ack Result Offset') errors.push('Result file_id must be durable before cursor acknowledgement');
if (firstTarget('Ack Result Offset') !== 'Prepare Result Delivery') errors.push('Result acknowledgement must feed customer delivery');
if (firstTarget('Prepare Result Delivery') !== 'Send Translation to Customer') errors.push('Prepared result must feed customer delivery');
if (firstTarget('Send Translation to Customer') !== 'Mark Task Done') errors.push('Task may be DONE only after result send succeeds');
const done = byName.get('Mark Task Done')?.parameters?.columns?.value ?? {};
if (String(done.status) !== 'DONE' || String(done.delivery_step) !== 'COMPLETE' || !hasOwn(done, 'completed_at')) errors.push('Completion must persist DONE / COMPLETE / completed_at');

// Conversational messages acknowledge only after successful send.
for (const name of ['Access Denied','Pending Access Reply','Access Request Required','Send Access Request Confirmation','Customer Start','Customer Help','Admin Start','Admin Guidance','Task Not Found','Task Already Done','Task Delivery Pending']) {
  if (firstTarget(name) !== 'Ack Poll Offset') errors.push(`${name} must acknowledge cursor only after successful send`);
}

// Recovery remains bounded and lightweight.
const recoveryIntervals = byName.get('Recovery Schedule')?.parameters?.rule?.interval ?? [];
if (!recoveryIntervals.some((i) => i.field === 'minutes' && Number(i.minutesInterval) === 5)) errors.push('Recovery Schedule must run every 5 minutes');
const pending = byName.get('Get Pending Deliveries');
if (pending?.parameters?.dataTableId?.value !== 'bt_bot_tasks') errors.push('Get Pending Deliveries must use bt_bot_tasks');
const pendingSteps = new Set((pending?.parameters?.filters?.conditions ?? []).filter((c) => c.keyName === 'delivery_step').map((c) => c.keyValue));
for (const step of ['ADMIN_CARD_PENDING','SOURCE_PENDING','CUSTOMER_CONFIRM_PENDING','RESULT_PENDING']) {
  if (!pendingSteps.has(step)) errors.push(`Get Pending Deliveries missing ${step}`);
}
const recoveryCode = byName.get('Select Due Recoveries')?.parameters?.jsCode ?? '';
for (const expected of ['MAX_RECOVERY_ATTEMPTS = 8','MAX_RECOVERIES_PER_RUN = 20','BACKOFF_MINUTES = [5, 15, 30, 60, 180, 360, 720, 1440]']) {
  if (!recoveryCode.includes(expected)) errors.push(`Recovery selector missing ${expected}`);
}

for (const name of ['Send Access Request to Admin','Send Access Request Confirmation','Send Admin Task Card','Send Source to Admin','Confirm Task to Customer','Send Translation to Customer']) {
  const node = byName.get(name);
  if (node?.retryOnFail !== true || Number(node?.maxTries ?? 0) < 3 || Number(node?.waitBetweenTries ?? 0) < 5000) {
    errors.push(`${name} must use 3 short Telegram retries`);
  }
}

const dataTableNodes = nodes.filter((node) => node.type === 'n8n-nodes-base.dataTable');
const tableNames = new Set(dataTableNodes.map((node) => node.parameters?.dataTableId?.value));
for (const table of ['bt_bot_users','bt_bot_tasks','bt_bot_state']) {
  if (!tableNames.has(table)) errors.push(`Workflow must reference Data Table: ${table}`);
}
for (const node of dataTableNodes) {
  if (['insert','update','upsert'].includes(node.parameters?.operation) && (!node.parameters?.columns?.value || !node.parameters?.columns?.schema?.length)) {
    errors.push(`${node.name}: Data Table write must include value and schema mappings`);
  }
}

for (const node of nodes.filter((n) => n.type === 'n8n-nodes-base.telegram' && n.parameters?.operation === 'sendMessage')) {
  if (node.parameters?.additionalFields?.appendAttribution !== false) errors.push(`${node.name}: Append n8n Attribution must be disabled`);
}

if (errors.length) {
  console.error('Workflow validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Workflow validation passed: ${nodes.length} nodes, ${dataTableNodes.length} Data Table nodes.`);
