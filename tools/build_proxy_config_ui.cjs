const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'tools/proxy-config-ui');
let esbuild;
try { esbuild = require(path.join(directory, 'node_modules/esbuild')); }
catch { esbuild = require(path.join(root, 'design-proposals/proxy-config-editor/deps/node_modules/esbuild')); }
const result = esbuild.buildSync({
  entryPoints: [path.join(directory, 'entry.js')],
  nodePaths: [path.join(directory, 'node_modules'), path.join(root, 'design-proposals/proxy-config-editor/deps/node_modules')],
  bundle: true, minify: true, metafile: true, format: 'iife', globalName: 'LocalDNSConfigEditor',
  target: ['chrome110', 'safari16'], legalComments: 'eof',
  outfile: path.join(root, '_src/ui/assets/js/proxy-config-editor.vendor.js')
});
const notices = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  let parent = path.dirname(path.resolve(input));
  while (parent !== path.dirname(parent)) {
    const metadata = path.join(parent, 'package.json');
    if (fs.existsSync(metadata)) {
      const value = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      if (!value.name) { parent = path.dirname(parent); continue; }
      for (const filename of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE']) {
        const file = path.join(parent, filename);
        if (fs.existsSync(file)) { notices.set(value.name + '@' + value.version, fs.readFileSync(file, 'utf8')); break; }
      }
      break;
    }
    parent = path.dirname(parent);
  }
}
const licenseDirectory = path.join(root, '_src/ui/assets/licenses');
fs.mkdirSync(licenseDirectory, {recursive:true});
fs.writeFileSync(path.join(licenseDirectory, 'proxy-config-editor.txt'), [...notices].sort().map(([name,notice]) => name + '\n\n' + notice).join('\n\n--------------------\n\n'));
console.log('Built proxy configuration editor bundle.');
