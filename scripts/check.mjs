import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

for (const directory of ['bin', 'lib', 'extensions', 'hooks', 'scripts', 'test']) {
  for (const file of readdirSync(directory)) {
    if (file.endsWith('.mjs')) execFileSync(process.execPath, ['--check', `${directory}/${file}`]);
  }
}
const pkg = JSON.parse(readFileSync('package.json'));
for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'gemini-extension.json']) {
  const manifest = JSON.parse(readFileSync(path));
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
}
console.log(`titlewave ${pkg.version}: syntax and manifests pass`);
