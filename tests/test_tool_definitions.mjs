/**
 * Every tool definition this plugin can register, checked for the properties
 * the registry and the model both depend on.
 *
 * The registry rejects a definition whose `required` names a property it does
 * not declare, and the model only ever sees the description and parameters —
 * so a schema mistake is silent at runtime and shows up as a tool the model
 * declines to call. This walks the whole surface instead of one happy path.
 *
 * Run: node tests/test_tool_definitions.mjs
 */
import { registerTools } from '../src/tools.js';

/** Every capability switched on, so every tool family is exercised. */
const settings = {
  client: {},
  config: {
    allowImageTools: true,
    allowVideoTools: true,
    allowTextTool: true,
    allowCanvasTools: true,
    allowProjectDelete: true,
    defaultProjectId: 'p1',
  },
  models: {},
  taskTimeoutMs: 300_000,
  async readMediaFile() {
    return { name: 'x.png', mimeType: 'image/png', bytes: new Uint8Array() };
  },
};

function collect() {
  const definitions = [];
  registerTools({ tools: { register: (definition) => { definitions.push(definition); return () => {}; } } }, settings);
  return definitions;
}

const definitions = collect();
const names = definitions.map((definition) => definition.name);
console.log(`registered ${String(definitions.length)} tool(s):`);
for (const name of names) console.log(`  - ${name}`);

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
};

// The tools the README and DETAIL.md promise. A silent rename would leave the
// docs pointing at a tool that does not exist.
const PROMISED = [
  'updream_generate_image',
  'updream_generate_video',
  'updream_generate_text',
  'updream_canvas',
  'updream_node_create',
  'updream_node_connect',
  'updream_node_delete',
  'updream_asset_upload',
  'updream_project_delete',
  'updream_task',
  'updream_projects',
  'updream_node_update',
  'updream_node_disconnect',
];
for (const name of PROMISED) check(names.includes(name), `declares ${name}`);

check(new Set(names).size === names.length, 'tool names are unique');

for (const definition of definitions) {
  const properties = definition.parameters?.properties ?? {};
  const declared = Object.keys(properties);
  const required = definition.parameters?.required ?? [];
  const missing = required.filter((name) => !declared.includes(name));

  check(missing.length === 0, `${definition.name}: required names are declared${missing.length === 0 ? '' : ` (missing ${missing.join(', ')})`}`);
  check(definition.parameters?.additionalProperties === false, `${definition.name}: additionalProperties is false`);
  check(Object.keys(properties).length > 0, `${definition.name}: declares parameters`);
  check(typeof definition.description === 'string' && definition.description.length > 0, `${definition.name}: has a description`);
  check(definition.output?.schema !== undefined, `${definition.name}: has an output schema`);
  check(typeof definition.output?.render === 'function', `${definition.name}: has an output render()`);
  check(typeof definition.execute === 'function', `${definition.name}: has execute()`);
  check(typeof definition.timeoutMs === 'number' && Number.isFinite(definition.timeoutMs), `${definition.name}: has a finite timeoutMs`);

  // The host kills a tool at 600 s. Declaring a budget at or above that means
  // the host wins the race, and it wins without the task id.
  check(definition.timeoutMs < 600_000, `${definition.name}: timeout stays under the host cap`);

  // A render() that throws is worse than no render at all: it fails the call
  // after the tool already did its work.
  try {
    const value = sampleValueFor(definition);
    const blocks = definition.output.render({}, value);
    check(Array.isArray(blocks) && blocks.length > 0, `${definition.name}: render() returns blocks`);
  } catch (cause) {
    check(false, `${definition.name}: render() threw (${String(cause?.message ?? cause)})`);
  }
}

/**
 * A minimal output value shaped like this tool's schema, for exercising render.
 * @param definition - one tool definition.
 * @returns a value every required field of `definition.output.schema` is present in.
 */
function sampleValueFor(definition) {
  const schema = definition.output.schema ?? {};
  const value = {};
  for (const key of schema.required ?? []) {
    const field = schema.properties?.[key] ?? {};
    if (field.type === 'string') value[key] = '';
    else if (field.type === 'integer' || field.type === 'number') value[key] = 0;
    else if (field.type === 'boolean') value[key] = false;
    else if (field.type === 'array') value[key] = [];
    else value[key] = {};
  }
  return value;
}

// A switched-off family must be ABSENT, not registered-and-refusing: a tool the
// model cannot see is a tool it cannot spend money on.
const offDefinitions = [];
registerTools({ tools: { register: (definition) => { offDefinitions.push(definition); return () => {}; } } }, {
  ...settings,
  config: { defaultProjectId: 'p1' },
});
check(offDefinitions.length === 0, 'every family off registers no tools');

// Canvas alone must not pull in generation.
const canvasOnly = [];
registerTools({ tools: { register: (definition) => { canvasOnly.push(definition.name); return () => {}; } } }, {
  ...settings,
  config: { allowCanvasTools: true, defaultProjectId: 'p1' },
});
check(canvasOnly.includes('updream_canvas'), 'canvas switch registers updream_canvas');
check(!canvasOnly.includes('updream_generate_image'), 'canvas switch does not register generation');

// The disposer must be callable and idempotent-safe.
try {
  const disposer = registerTools({ tools: { register: () => () => {} } }, settings);
  disposer();
  check(true, 'disposer runs without throwing');
} catch (cause) {
  check(false, `disposer threw (${String(cause?.message ?? cause)})`);
}

if (failed > 0) {
  console.error(`\n${String(failed)} check(s) failed`);
  process.exit(1);
}
console.log('\nPASS');
