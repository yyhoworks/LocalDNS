// Compile maintained ESM sources only for the existing Node/VM regression harnesses.
const path = require('node:path');
const Module = require('node:module');
const {buildSync} = require('../frontend/node_modules/esbuild');
const root = path.resolve(__dirname, '../frontend/src');

function bundleFeature(file, name, target = `window.${name}`, initialize = true) {
  const contents = `import { ${name}${initialize ? ', initialize' : ''} } from ${JSON.stringify('./' + file)}; ${initialize ? 'initialize();' : ''} ${target} = ${name};`;
  return buildSync({stdin:{contents,resolveDir:root,sourcefile:'test-entry.js'},bundle:true,format:'iife',write:false,platform:'browser',target:'es2020'}).outputFiles[0].text;
}
function loadFeature(file, name, initialize = true) {
  const contents = `import { ${name}${initialize ? ', initialize' : ''} } from ${JSON.stringify('./' + file)}; ${initialize ? 'initialize();' : ''} module.exports = ${name};`;
  const text = buildSync({stdin:{contents,resolveDir:root,sourcefile:'test-entry.js'},bundle:true,format:'cjs',write:false,platform:'node',target:'node24'}).outputFiles[0].text;
  const compiled = new Module(path.join(root,'test-entry.cjs'), module);
  compiled.filename = path.join(root,'test-entry.cjs');
  compiled.paths = module.paths;
  compiled._compile(text, compiled.filename);
  return compiled.exports;
}
module.exports = {bundleFeature,loadFeature};
