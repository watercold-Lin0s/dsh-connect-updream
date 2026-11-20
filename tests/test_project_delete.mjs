/**
 * Manual check for updream_project_delete.
 *
 * Usage: node tests/test_project_delete.mjs <api-key> <project-id>
 *
 * Verifies the two halves that matter: without `confirm` the tool must only
 * report and leave the project alone; with `confirm` it must actually delete.
 */
import { registerTools } from '../src/tools.js';
import { UpdreamClient } from '../src/upstream.js';

const [key, projectId] = process.argv.slice(2);
if (!key || !projectId) {
  console.error('usage: node tests/test_project_delete.mjs <api-key> <project-id>');
  process.exit(2);
}

const client = new UpdreamClient({ apiKey: key, baseURL: 'https://www.updream.cn/api' });

const settings = {
  client,
  config: { allowProjectDelete: true, defaultProjectId: '' },
  models: {},
  taskTimeoutMs: 60_000,
  readMediaFile: async () => {
    throw new Error('unused in this test');
  },
};

let tool = null;
registerTools({ tools: { register: (definition) => { tool = definition; return () => {}; } } }, settings);

if (tool === null || tool.name !== 'updream_project_delete') {
  console.error('FAIL: updream_project_delete was not registered');
  process.exit(1);
}

const exec = { signal: AbortSignal.timeout(30_000) };

console.log('tool registered:', tool.name);
console.log('required params:', tool.parameters.required.join(', '));

const dry = await tool.execute({ project_id: projectId }, exec);
console.log('dry-run =>', JSON.stringify(dry));
if (dry.deleted !== false) {
  console.error('FAIL: dry-run reported a deletion');
  process.exit(1);
}

const survived = await client.canvas(projectId, {});
console.log('after dry-run, canvas still has', survived.nodes.length, 'node(s)');
if (survived.nodes.length === 0 && dry.node_count > 0) {
  console.error('FAIL: nodes vanished on a dry-run');
  process.exit(1);
}

const real = await tool.execute({ project_id: projectId, confirm: true }, exec);
console.log('confirm =>', JSON.stringify(real));
if (real.deleted !== true) {
  console.error('FAIL: confirm did not delete');
  process.exit(1);
}

let gone = false;
try {
  await client.canvas(projectId, {});
} catch {
  gone = true;
}
console.log('after delete, project readable:', !gone);
console.log(gone ? 'PASS' : 'FAIL: project still readable after delete');
process.exit(gone ? 0 : 1);
