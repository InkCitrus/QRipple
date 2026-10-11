import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const notices = read('../public/third-party-notices.txt');
const LICENSE_NAMES = { MIT: 'MIT License', 'Apache-2.0': 'Apache License 2.0' };

test('every package the site sends to browsers has a notice with its license', () => {
  // server/static.js serves these packages' files under /vendor/.
  const served = new Set([...read('../server/static.js').matchAll(/require\.resolve\('([^'/]+)/g)].map((m) => m[1]));
  assert.ok(served.size >= 3, `found the served packages: ${[...served]}`);
  for (const name of served) {
    const pkg = JSON.parse(read(`../node_modules/${name}/package.json`));
    const repo = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url)
      .replace(/^git\+/, '')
      .replace(/\.git$/, '');
    const start = notices.toLowerCase().indexOf(repo.toLowerCase());
    assert.notEqual(start, -1, `${name}: no notice for ${repo}`);
    const entry = notices.slice(start, notices.indexOf('\n\n', start));
    assert.ok(LICENSE_NAMES[pkg.license], `${name}: unexpected license ${pkg.license}`);
    assert.ok(entry.includes(LICENSE_NAMES[pkg.license]), `${name}: notice should name the ${pkg.license} license`);
  }
});

test('the notices include the full license texts', () => {
  assert.match(notices, /Permission is hereby granted, free of charge/);
  assert.match(notices, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(notices, /END OF TERMS AND CONDITIONS/);
});
