import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const removeNames = new Set([
  'Telegram Trigger',
  'Admin Config',
  'Schedule Poll',
  'Bot Config',
  'Get Poll State',
  'Telegram getUpdates',
  'Expand Telegram Update',
  'Message Present Switch',
  'Ack Poll Offset',
  'Ack New Task Offset',
  'Ack Result Offset',
  'Task Update Seen',
]);
workflow.nodes = (workflow.nodes ?? []).filter((node) => !removeNames.has(node.name));

const dataTableId = (value) => ({ __rl: true, value, mode: 'name' });
const stateSchema = [{
  id: 'value', displayName: 'value', required: false, defaultMatch: false,
  display: true, type: 'number', canBeUsedToMatch: true,
}];
const stateFilter = { conditions: [{ keyName: 'key', condition: 'eq', keyValue: 'telegram_offset' }] };
const ackValue = "={{ Number($json.next_offset ?? $('Expand Telegram Update').first().json.next_offset) }}";
const ackNode = (name, id, position) => ({
  parameters: {
    resource: 'row', operation: 'update', dataTableId: dataTableId('bt_bot_state'),
    matchType: 'allConditions', filters: stateFilter,
    columns: { mappingMode: 'defineBelow', value: { value: ackValue }, schema: stateSchema },
    options: {},
  },
  type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position, id, name,
});

workflow.nodes.unshift(
  {
    parameters: { rule: { interval: [{ field: 'seconds', secondsInterval: 30 }] } },
    type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
    position: [-3000, 0], id: '11111111-1111-4111-8111-111111111101', name: 'Schedule Poll',
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const TELEGRAM_BOT_TOKEN = 'PASTE_TELEGRAM_BOT_TOKEN_HERE';
const ADMIN_USER_ID = '0';
let ADMIN_CHAT_ID = '0';

const isUnset = (value) => !value || String(value).trim() === '0';

if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'PASTE_TELEGRAM_BOT_TOKEN_HERE') {
  throw new Error('Setup required: open Bot Config and paste the Telegram bot token.');
}
if (isUnset(ADMIN_USER_ID)) {
  throw new Error('Setup required: open Bot Config and set ADMIN_USER_ID.');
}
if (isUnset(ADMIN_CHAT_ID)) ADMIN_CHAT_ID = ADMIN_USER_ID;

return [{ json: {
  bot_token: TELEGRAM_BOT_TOKEN,
  admin_user_id: String(ADMIN_USER_ID),
  admin_chat_id: String(ADMIN_CHAT_ID)
} }];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [-2780, 0], id: '11111111-1111-4111-8111-111111111102', name: 'Bot Config',
  },
  {
    parameters: {
      resource: 'row', operation: 'get', dataTableId: dataTableId('bt_bot_state'),
      matchType: 'allConditions', filters: stateFilter, returnAll: false, limit: 1,
    },
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [-2560, 0], id: '11111111-1111-4111-8111-111111111103', name: 'Get Poll State',
    alwaysOutputData: true,
  },
  {
    parameters: {
      url: "={{ 'https://api.telegram.org/bot' + $('Bot Config').first().json.bot_token + '/getUpdates' }}",
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'offset', value: '={{ Number($json.value || 0) }}' },
        { name: 'limit', value: '1' },
        { name: 'timeout', value: '0' },
        { name: 'allowed_updates', value: '["message"]' },
      ] },
      options: {},
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
    position: [-2340, 0], id: '11111111-1111-4111-8111-111111111104', name: 'Telegram getUpdates',
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const response = $input.first().json;
if (response.ok !== true) {
  throw new Error('Telegram getUpdates failed: ' + JSON.stringify(response));
}
const update = Array.isArray(response.result) ? response.result[0] : null;
if (!update) return [];
const updateId = Number(update.update_id);
if (!Number.isFinite(updateId)) throw new Error('Telegram update has no valid update_id.');
return [{ json: {
  ...update,
  telegram_update_id: updateId,
  next_offset: updateId + 1,
  has_message: Boolean(update.message)
} }];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [-2120, 0], id: '11111111-1111-4111-8111-111111111105', name: 'Expand Telegram Update',
  },
  {
    parameters: { mode: 'expression', numberOutputs: 2, output: '={{ $json.has_message ? 0 : 1 }}' },
    type: 'n8n-nodes-base.switch', typeVersion: 3.4,
    position: [-1900, 0], id: '11111111-1111-4111-8111-111111111106', name: 'Message Present Switch',
  },
);

workflow.nodes.push(
  {
    parameters: {
      resource: 'row', operation: 'rowExists', dataTableId: dataTableId('bt_bot_tasks'),
      matchType: 'allConditions', filters: { conditions: [
        { keyName: 'telegram_update_id', condition: 'eq', keyValue: '={{ $json.telegram_update_id }}' },
      ] },
    },
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [-1240, 340], id: '11111111-1111-4111-8111-111111111107', name: 'Task Update Seen',
  },
  ackNode('Ack Poll Offset', '11111111-1111-4111-8111-111111111108', [-260, 700]),
  ackNode('Ack New Task Offset', '11111111-1111-4111-8111-111111111109', [200, 260]),
  ackNode('Ack Result Offset', '11111111-1111-4111-8111-111111111110', [-760, -40]),
);

const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const normalize = byName.get('Normalize + Config');
if (!normalize) throw new Error('Normalize + Config node is missing');
normalize.parameters.jsCode = `const update = $input.first().json;
const m = update.message ?? {};
const f = m.from ?? {};
const c = m.chat ?? {};
const d = m.document ?? null;
const cfg = $('Bot Config').first().json;

const filename = d?.file_name ?? '';
const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
const text = String(m.text ?? m.caption ?? '');

return [{ json: {
  telegram_update_id: Number(update.telegram_update_id ?? update.update_id ?? 0),
  next_offset: Number(update.next_offset ?? 0),
  sender_id: String(f.id ?? ''),
  chat_id: String(c.id ?? ''),
  username: String(f.username ?? ''),
  name: [f.first_name, f.last_name].filter(Boolean).join(' '),
  text,
  document_file_id: String(d?.file_id ?? ''),
  document_filename: filename,
  document_extension: ext,
  reply_to_message_id: m.reply_to_message?.message_id ?? null,
  is_start: /^\\/start(?:@\\w+)?(?:\\s|$)/i.test(text),
  has_document: Boolean(d?.file_id),
  is_supported_document: Boolean(d?.file_id && ['epub','pdf','docx','txt'].includes(ext)),
  received_at: new Date().toISOString(),
  admin_user_id: String(cfg.admin_user_id),
  admin_chat_id: String(cfg.admin_chat_id),
  is_admin: String(f.id ?? '') === String(cfg.admin_user_id)
} }];`;
normalize.position = [-1680, 0];

const prepareAdmin = byName.get('Prepare Admin Card Delivery');
if (!prepareAdmin) throw new Error('Prepare Admin Card Delivery node is missing');
prepareAdmin.type = 'n8n-nodes-base.code';
prepareAdmin.typeVersion = 2;
prepareAdmin.parameters = {
  mode: 'runOnceForAllItems', language: 'javaScript',
  jsCode: `const input = $input.first().json;
if (input.task_no) return [{ json: input }];
const task = $('Insert Task').first().json;
return [{ json: { ...task } }];`,
};

const prepareResult = byName.get('Prepare Result Delivery');
if (!prepareResult) throw new Error('Prepare Result Delivery node is missing');
prepareResult.type = 'n8n-nodes-base.code';
prepareResult.typeVersion = 2;
prepareResult.parameters = {
  mode: 'runOnceForAllItems', language: 'javaScript',
  jsCode: `const input = $input.first().json;
if (input.task_no) return [{ json: input }];
const task = $('Save Result Pending').first().json;
return [{ json: { ...task } }];`,
};

const prepareMessages = byName.get('Prepare Task Messages');
if (prepareMessages?.parameters?.jsCode) {
  prepareMessages.parameters.jsCode = prepareMessages.parameters.jsCode.replace('2 * 60 * 1000', '5 * 60 * 1000');
}
for (const name of ['Mark Admin Card Sent', 'Mark Source Sent', 'Save Result Pending']) {
  const node = byName.get(name);
  const value = node?.parameters?.columns?.value;
  if (value?.next_retry_at) value.next_retry_at = String(value.next_retry_at).replace('minutes: 2', 'minutes: 5');
}

const connections = workflow.connections ?? {};
for (const name of removeNames) delete connections[name];
const set = (name, outputs) => {
  connections[name] = { main: outputs.map((targets) => targets.map((node) => ({ node, type: 'main', index: 0 }))) };
};

set('Schedule Poll', [['Bot Config']]);
set('Bot Config', [['Get Poll State']]);
set('Get Poll State', [['Telegram getUpdates']]);
set('Telegram getUpdates', [['Expand Telegram Update']]);
set('Expand Telegram Update', [['Message Present Switch']]);
set('Message Present Switch', [['Normalize + Config'], ['Ack Poll Offset']]);
set('Normalize + Config', [['Role Switch']]);
set('Customer Input Switch', [['Customer Start'], ['Task Update Not Seen', 'Task Update Seen'], ['Customer Help']]);
set('Task Update Seen', [['Ack Poll Offset']]);
set('Insert Task', [['Ack New Task Offset']]);
set('Ack New Task Offset', [['Prepare Admin Card Delivery']]);
set('Save Result Pending', [['Ack Result Offset']]);
set('Ack Result Offset', [['Prepare Result Delivery']]);
for (const name of [
  'Access Denied', 'Customer Start', 'Customer Help', 'Admin Start', 'Admin Guidance',
  'Task Not Found', 'Task Already Done', 'Task Delivery Pending',
]) set(name, [['Ack Poll Offset']]);

workflow.connections = connections;
workflow.active = false;
workflow.settings = { ...(workflow.settings ?? {}), executionOrder: 'v1' };
fs.writeFileSync(workflowPath, JSON.stringify(workflow));
console.log(`Restored local polling workflow: ${workflow.nodes.length} nodes.`);
