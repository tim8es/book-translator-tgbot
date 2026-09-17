import fs from 'node:fs';

const workflowPath = new URL('../workflows/book-translator-mvp.json', import.meta.url);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const removeNames = new Set([
  'Schedule Poll', 'Bot Config', 'Get Poll State', 'Telegram getUpdates',
  'Expand Telegram Update', 'Message Present Switch',
  'Ack Poll Offset', 'Ack New Task Offset', 'Ack Result Offset',
  'Poll State Exists', 'Poll State Missing', 'Initialize Poll State',
  'Prepare Poll Request', 'Can Poll Switch', 'Inspect Telegram Poll',
  'Poll Response Switch', 'Telegram deleteWebhook', 'Validate Webhook Clear',
  'Prepare Poll Lock', 'Acquire Poll Lock', 'Restore Locked Update',
]);

workflow.nodes = (workflow.nodes ?? []).filter((node) => !removeNames.has(node.name));
for (const name of removeNames) delete workflow.connections?.[name];
for (const [source, connection] of Object.entries(workflow.connections ?? {})) {
  for (const outputs of connection.main ?? []) {
    if (!Array.isArray(outputs)) continue;
    for (let i = outputs.length - 1; i >= 0; i -= 1) {
      if (removeNames.has(outputs[i]?.node)) outputs.splice(i, 1);
    }
  }
}

const stateTable = { __rl: true, value: 'bt_bot_state', mode: 'name' };
const id = (suffix) => `22222222-2222-4222-8222-${suffix}`;
const initialState = JSON.stringify({ offset: 0, lockToken: '', lockUntil: 0 });

const nodes = [
  {
    parameters: { rule: { interval: [{ field: 'seconds', secondsInterval: 30 }] } },
    type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-3600, 0],
    id: id('000000000101'), name: 'Schedule Poll',
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const TELEGRAM_BOT_TOKEN = 'PASTE_TELEGRAM_BOT_TOKEN_HERE';\nconst ADMIN_USER_ID = '0';\nlet ADMIN_CHAT_ID = '0';\n\nconst isUnset = (value) => !value || String(value).trim() === '0';\nif (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'PASTE_TELEGRAM_BOT_TOKEN_HERE') {\n  throw new Error('Setup required: open Bot Config and paste the Telegram bot token.');\n}\nif (isUnset(ADMIN_USER_ID)) throw new Error('Setup required: open Bot Config and set ADMIN_USER_ID.');\nif (isUnset(ADMIN_CHAT_ID)) ADMIN_CHAT_ID = ADMIN_USER_ID;\nreturn [{ json: { bot_token: TELEGRAM_BOT_TOKEN, admin_user_id: String(ADMIN_USER_ID), admin_chat_id: String(ADMIN_CHAT_ID) } }];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [-3380, 0],
    id: id('000000000102'), name: 'Bot Config',
  },
  {
    parameters: {
      resource: 'row', operation: 'rowExists', dataTableId: stateTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'key', condition: 'eq', keyValue: 'telegram_state' }] },
    },
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [-3160, -80],
    id: id('000000000103'), name: 'Poll State Exists',
  },
  {
    parameters: {
      resource: 'row', operation: 'rowNotExists', dataTableId: stateTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'key', condition: 'eq', keyValue: 'telegram_state' }] },
    },
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [-3160, 100],
    id: id('000000000104'), name: 'Poll State Missing',
  },
  {
    parameters: {
      resource: 'row', operation: 'insert', dataTableId: stateTable,
      columns: {
        mappingMode: 'defineBelow',
        value: { key: 'telegram_state', value: initialState },
        schema: [
          { id: 'key', displayName: 'key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'value', displayName: 'value', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [-2940, 100],
    id: id('000000000105'), name: 'Initialize Poll State',
  },
  {
    parameters: {
      resource: 'row', operation: 'get', dataTableId: stateTable, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'key', condition: 'eq', keyValue: 'telegram_state' }] },
      returnAll: false, limit: 1,
    },
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [-2720, 0],
    id: id('000000000106'), name: 'Get Poll State', alwaysOutputData: true,
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const row = $input.first().json;\nif (row.value === undefined || row.value === null || row.value === '') {\n  throw new Error('Polling state could not be initialized. Check bt_bot_state schema.');\n}\nconst raw = String(row.value);\nlet state;\ntry {\n  state = JSON.parse(raw);\n} catch {\n  const legacyOffset = Number(raw);\n  state = { offset: Number.isFinite(legacyOffset) ? legacyOffset : 0, lockToken: '', lockUntil: 0 };\n}\nconst offset = Math.max(0, Number(state.offset) || 0);\nconst lockToken = String(state.lockToken || '');\nconst lockUntil = Number(state.lockUntil) || 0;\nconst can_poll = !(lockToken && lockUntil > Date.now());\nreturn [{ json: { ...$('Bot Config').first().json, state_raw: raw, offset, lockToken, lockUntil, can_poll } }];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [-2500, 0],
    id: id('000000000107'), name: 'Prepare Poll Request',
  },
  {
    parameters: { mode: 'expression', numberOutputs: 2, output: '={{ $json.can_poll ? 0 : 1 }}' },
    type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [-2280, 0],
    id: id('000000000108'), name: 'Can Poll Switch',
  },
  {
    parameters: {
      url: "={{ 'https://api.telegram.org/bot' + $('Bot Config').first().json.bot_token + '/getUpdates' }}",
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'offset', value: '={{ $json.offset }}' },
        { name: 'limit', value: '1' },
        { name: 'timeout', value: '0' },
        { name: 'allowed_updates', value: '["message"]' },
      ] },
      options: {
        timeout: 10000,
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [-2060, 0],
    id: id('000000000109'), name: 'Telegram getUpdates', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const response = $input.first().json;\nconst status = Number(response.statusCode ?? 200);\nconst body = response.body ?? response;\nconst errorCode = Number(body?.error_code ?? status);\nif (status === 409 || errorCode === 409) return [{ json: { action: 'webhook_conflict' } }];\nif (status < 200 || status >= 300 || body?.ok !== true) {\n  throw new Error('Telegram getUpdates failed: ' + JSON.stringify({ status, body }));\n}\nconst update = Array.isArray(body.result) ? body.result[0] : null;\nif (!update) return [{ json: { action: 'idle' } }];\nconst updateId = Number(update.update_id);\nif (!Number.isFinite(updateId)) throw new Error('Telegram update has no valid update_id.');\nreturn [{ json: { action: 'update', ...update, telegram_update_id: updateId, next_offset: updateId + 1, has_message: Boolean(update.message) } }];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1840, 0],
    id: id('000000000110'), name: 'Inspect Telegram Poll',
  },
  {
    parameters: {
      mode: 'expression', numberOutputs: 3,
      output: "={{ $json.action === 'update' ? 0 : ($json.action === 'webhook_conflict' ? 1 : 2) }}",
    },
    type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [-1620, 0],
    id: id('000000000111'), name: 'Poll Response Switch',
  },
  {
    parameters: {
      method: 'POST',
      url: "={{ 'https://api.telegram.org/bot' + $('Bot Config').first().json.bot_token + '/deleteWebhook' }}",
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'drop_pending_updates', value: 'false' }] },
      options: {
        timeout: 10000,
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [-1400, -180],
    id: id('000000000112'), name: 'Telegram deleteWebhook', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const response = $input.first().json;\nconst status = Number(response.statusCode ?? 200);\nconst body = response.body ?? response;\nif (status < 200 || status >= 300 || body?.ok !== true) {\n  throw new Error('Telegram deleteWebhook failed: ' + JSON.stringify({ status, body }));\n}\nreturn [];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1180, -180],
    id: id('000000000113'), name: 'Validate Webhook Clear',
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const update = $input.first().json;\nconst prepared = $('Prepare Poll Request').first().json;\nconst expected_state_raw = String(prepared.state_raw);\nlet state;\ntry { state = JSON.parse(expected_state_raw); } catch { state = { offset: Number(prepared.offset) || 0 }; }\nconst lockToken = Date.now() + '-' + Math.random().toString(36).slice(2, 12);\nconst lockUntil = Date.now() + 120000;\nconst locked_state_raw = JSON.stringify({ offset: Math.max(0, Number(state.offset) || 0), lockToken, lockUntil });\nreturn [{ json: { ...update, expected_state_raw, locked_state_raw, lockToken, lockUntil } }];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1400, 100],
    id: id('000000000114'), name: 'Prepare Poll Lock',
  },
  {
    parameters: {
      resource: 'row', operation: 'update', dataTableId: stateTable, matchType: 'allConditions',
      filters: { conditions: [
        { keyName: 'key', condition: 'eq', keyValue: 'telegram_state' },
        { keyName: 'value', condition: 'eq', keyValue: '={{ $json.expected_state_raw }}' },
      ] },
      columns: {
        mappingMode: 'defineBelow', value: { value: '={{ $json.locked_state_raw }}' },
        schema: [{ id: 'value', displayName: 'value', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }],
      }, options: {},
    },
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [-1180, 100],
    id: id('000000000115'), name: 'Acquire Poll Lock',
  },
  {
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const locked = $('Prepare Poll Lock').first().json;\nreturn [{ json: { ...locked } }];`,
    },
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [-960, 100],
    id: id('000000000116'), name: 'Restore Locked Update',
  },
  {
    parameters: { mode: 'expression', numberOutputs: 2, output: '={{ $json.has_message ? 0 : 1 }}' },
    type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [-740, 100],
    id: id('000000000117'), name: 'Message Present Switch',
  },
];

const ackNode = (name, nodeId, position) => ({
  parameters: {
    resource: 'row', operation: 'update', dataTableId: stateTable, matchType: 'allConditions',
    filters: { conditions: [
      { keyName: 'key', condition: 'eq', keyValue: 'telegram_state' },
      { keyName: 'value', condition: 'eq', keyValue: "={{ $('Prepare Poll Lock').first().json.locked_state_raw }}" },
    ] },
    columns: {
      mappingMode: 'defineBelow',
      value: { value: "={{ JSON.stringify({ offset: Number($('Inspect Telegram Poll').first().json.next_offset), lockToken: '', lockUntil: 0 }) }}" },
      schema: [{ id: 'value', displayName: 'value', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }],
    }, options: {},
  },
  type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position,
  id: nodeId, name,
});

nodes.push(
  ackNode('Ack Poll Offset', id('000000000118'), [-200, 700]),
  ackNode('Ack New Task Offset', id('000000000119'), [200, 260]),
  ackNode('Ack Result Offset', id('000000000120'), [-760, -40]),
);
workflow.nodes.push(...nodes);

const connect = (from, to, output = 0) => {
  workflow.connections[from] ??= { main: [] };
  workflow.connections[from].main ??= [];
  workflow.connections[from].main[output] ??= [];
  workflow.connections[from].main[output].push({ node: to, type: 'main', index: 0 });
};
const replace = (from, outputs) => {
  workflow.connections[from] = { main: outputs.map((items) => items.map((to) => ({ node: to, type: 'main', index: 0 }))) };
};

replace('Schedule Poll', [['Bot Config']]);
replace('Bot Config', [['Poll State Exists', 'Poll State Missing']]);
replace('Poll State Exists', [['Get Poll State']]);
replace('Poll State Missing', [['Initialize Poll State']]);
replace('Initialize Poll State', [['Get Poll State']]);
replace('Get Poll State', [['Prepare Poll Request']]);
replace('Prepare Poll Request', [['Can Poll Switch']]);
replace('Can Poll Switch', [['Telegram getUpdates'], []]);
replace('Telegram getUpdates', [['Inspect Telegram Poll']]);
replace('Inspect Telegram Poll', [['Poll Response Switch']]);
replace('Poll Response Switch', [['Prepare Poll Lock'], ['Telegram deleteWebhook'], []]);
replace('Telegram deleteWebhook', [['Validate Webhook Clear']]);
replace('Validate Webhook Clear', [[]]);
replace('Prepare Poll Lock', [['Acquire Poll Lock']]);
replace('Acquire Poll Lock', [['Restore Locked Update']]);
replace('Restore Locked Update', [['Message Present Switch']]);
replace('Message Present Switch', [['Normalize + Config'], ['Ack Poll Offset']]);
replace('Insert Task', [['Ack New Task Offset']]);
replace('Ack New Task Offset', [['Prepare Admin Card Delivery']]);
replace('Save Result Pending', [['Ack Result Offset']]);
replace('Ack Result Offset', [['Prepare Result Delivery']]);
replace('Task Update Seen', [['Ack Poll Offset']]);
for (const name of ['Access Denied', 'Customer Start', 'Customer Help', 'Admin Start', 'Admin Guidance', 'Task Not Found', 'Task Already Done', 'Task Delivery Pending']) {
  replace(name, [['Ack Poll Offset']]);
}
replace('Ack Poll Offset', [[]]);

// Normalize from the restored locked Telegram update and keep cursor metadata.
const normalize = workflow.nodes.find((node) => node.name === 'Normalize + Config');
if (!normalize) throw new Error('Normalize + Config not found');
normalize.parameters.jsCode = `const update = $input.first().json;\nconst m = update.message ?? {};\nconst f = m.from ?? {};\nconst c = m.chat ?? {};\nconst d = m.document ?? null;\nconst cfg = $('Bot Config').first().json;\nconst filename = d?.file_name ?? '';\nconst ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';\nconst text = String(m.text ?? m.caption ?? '');\nreturn [{ json: {\n  telegram_update_id: Number(update.telegram_update_id ?? update.update_id ?? 0),\n  next_offset: Number(update.next_offset ?? 0),\n  sender_id: String(f.id ?? ''), chat_id: String(c.id ?? ''), username: String(f.username ?? ''),\n  name: [f.first_name, f.last_name].filter(Boolean).join(' '), text,\n  document_file_id: String(d?.file_id ?? ''), document_filename: filename, document_extension: ext,\n  reply_to_message_id: m.reply_to_message?.message_id ?? null,\n  is_start: /^\\/start(?:@\\w+)?(?:\\s|$)/i.test(text),\n  has_document: Boolean(d?.file_id),\n  is_supported_document: Boolean(d?.file_id && ['epub','pdf','docx','txt'].includes(ext)),\n  received_at: new Date().toISOString(),\n  admin_user_id: String(cfg.admin_user_id), admin_chat_id: String(cfg.admin_chat_id),\n  is_admin: String(f.id ?? '') === String(cfg.admin_user_id)\n} }];`;

// Keep workflow inactive in the repository export.
workflow.active = false;
fs.writeFileSync(workflowPath, JSON.stringify(workflow), 'utf8');
console.log(`Hardened polling workflow written with ${workflow.nodes.length} nodes.`);
