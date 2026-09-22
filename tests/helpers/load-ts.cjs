const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual route/library with explicit provider doubles. No network,
// credentials, database writes, or production test endpoints are used.
function loadTs(file, mocks = {}, cache = new Map()) {
  const absolute = path.resolve(__dirname, '../..', file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} };
  cache.set(absolute, module);
  const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/') || id.startsWith('.')) {
      const base = id.startsWith('@/') ? path.resolve(__dirname, '../../src', id.slice(2)) : path.resolve(path.dirname(absolute), id);
      return loadTs(base.endsWith('.ts') ? base : base + '.ts', mocks, cache);
    }
    return require(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: absolute })(localRequire, module, module.exports);
  return module.exports;
}
module.exports = { loadTs };
