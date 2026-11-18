import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = process.env.PLAYWRIGHT_PATH || 'C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const parserRequire = createRequire(require.resolve(playwright));
const { babelParse, traverse } = parserRequire('./lib/transform/babelBundle.js');
const root = resolve('docs/js');
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}
const key = path => relative(root, path).replaceAll('\\', '/');
const files = await walk(root), known = new Set(files);
const modules = [];
for (const file of files) {
  const source = await readFile(file, 'utf8'), imports = new Set();
  const add = value => {
    if (typeof value !== 'string' || !value.startsWith('.')) return;
    const path = resolve(dirname(file), value.split(/[?#]/)[0]);
    if (known.has(path)) imports.add(key(path));
  };
  traverse(babelParse(source, file), {
    ImportDeclaration({ node }) { add(node.source.value); },
    ExportNamedDeclaration({ node }) { add(node.source?.value); },
    ExportAllDeclaration({ node }) { add(node.source.value); },
    CallExpression({ node }) { if (node.callee.type === 'Import') add(node.arguments[0]?.value); },
  });
  modules.push({ file: key(file), lines: source.split('\n').length, imports: [...imports].sort() });
}
const graph = new Map(modules.map(module => [module.file, module.imports]));
const indices = new Map(), low = new Map(), stack = [], stacked = new Set(), cycles = [];
let next = 0;
function visit(file) {
  indices.set(file, next); low.set(file, next++); stack.push(file); stacked.add(file);
  for (const dependency of graph.get(file)) {
    if (!indices.has(dependency)) { visit(dependency); low.set(file, Math.min(low.get(file), low.get(dependency))); }
    else if (stacked.has(dependency)) low.set(file, Math.min(low.get(file), indices.get(dependency)));
  }
  if (low.get(file) !== indices.get(file)) return;
  const component = [];
  let current;
  do { current = stack.pop(); stacked.delete(current); component.push(current); } while (current !== file);
  if (component.length > 1 || graph.get(file).includes(file)) cycles.push(component.sort());
}
for (const file of graph.keys()) if (!indices.has(file)) visit(file);
cycles.sort((a, b) => b.length - a.length);
const summary = { moduleCount: modules.length, dependencyCount: modules.reduce((sum, module) => sum + module.imports.length, 0),
  cyclicComponents: cycles.length, modulesInCycles: cycles.reduce((sum, group) => sum + group.length, 0),
  largestCycle: cycles[0]?.length || 0 };
const report = { summary, cycles, modules: modules.sort((a, b) => a.file.localeCompare(b.file)) };
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(output ? { ...summary, output } : report, null, 2));
