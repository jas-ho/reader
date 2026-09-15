import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assemble, CORE_ASSETS } from '../assemble.mjs';

const minimal = () => ({ schemaVersion: 1, id: 'fixture', title: 'Synthetic fixture', sections: [{ id: 'section', title: 'Read', items: [{ id: 'book', title: 'An invented book' }] }] });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reader-assemble-'));
  const engineDir = path.join(root, 'engine'), instanceDir = path.join(root, 'instance'), outDir = path.join(root, 'output');
  await mkdir(engineDir); await mkdir(instanceDir);
  for (const file of CORE_ASSETS) await writeFile(path.join(engineDir, file), file === 'index.html' ? '<!doctype html><title>Fixture</title>' : `/* fixture: ${file} */`);
  await writeFile(path.join(instanceDir, 'config.json'), JSON.stringify({ content: 'list.json' }));
  await writeFile(path.join(instanceDir, 'list.json'), JSON.stringify(minimal()));
  return { root, engineDir, instanceDir, outDir };
}

async function absent(file) {
  await assert.rejects(lstat(file), { code: 'ENOENT' });
}

async function setConfig(f, config) {
  await writeFile(path.join(f.instanceDir, 'config.json'), JSON.stringify(config));
}

test('packages only allowlisted assets and exact nested references, excluding unrelated private files', async () => {
  const f = await fixture();
  await mkdir(path.join(f.instanceDir, 'content'));
  await mkdir(path.join(f.instanceDir, 'visual'));
  await writeFile(path.join(f.instanceDir, 'content/list.json'), JSON.stringify(minimal()));
  await writeFile(path.join(f.instanceDir, 'visual/custom.css'), ':root { --accent: blue; }');
  await writeFile(path.join(f.instanceDir, 'private-notes.txt'), 'synthetic DO NOT PUBLISH marker');
  await writeFile(path.join(f.engineDir, 'private-file.txt'), 'synthetic engine extra');
  await setConfig(f, { content: 'content/list.json', theme: 'visual/custom.css' });
  const result = await assemble(f);
  assert.equal(await readFile(path.join(f.outDir, 'visual/custom.css'), 'utf8'), ':root { --accent: blue; }');
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outDir, 'content/list.json'), 'utf8')), minimal());
  assert.equal(await readFile(path.join(f.outDir, 'LICENSE'), 'utf8'), await readFile(path.join(f.engineDir, 'LICENSE'), 'utf8'));
  await absent(path.join(f.outDir, 'private-notes.txt'));
  await absent(path.join(f.outDir, 'private-file.txt'));
  await absent(path.join(f.outDir, 'list.json'));
  const metadata = JSON.parse(await readFile(path.join(f.outDir, 'release.json'), 'utf8'));
  assert.deepEqual(metadata, { schemaVersion: 1, readerRevision: null });
  assert.equal(result.files.length, CORE_ASSETS.length + 4);
});

test('invalid content is rejected before output creation with an actionable field path', async () => {
  const f = await fixture(), list = minimal();
  list.sections[0].items[0].titlle = 'Typo';
  await writeFile(path.join(f.instanceDir, 'list.json'), JSON.stringify(list));
  await assert.rejects(assemble(f), /list\.sections\[0\]\.items\[0\]\.titlle.*unknown field/);
  await absent(f.outDir);
});

test('malformed JSON and missing references leave no output', async () => {
  const f = await fixture();
  await writeFile(path.join(f.instanceDir, 'list.json'), '{');
  await assert.rejects(assemble(f), /list\.json:/);
  await absent(f.outDir);
  await setConfig(f, { content: 'missing.json' });
  await assert.rejects(assemble(f), /ENOENT/);
  await absent(f.outDir);
});

test('existing output is never overwritten', async () => {
  const f = await fixture();
  await mkdir(f.outDir);
  await writeFile(path.join(f.outDir, 'keep.txt'), 'keep');
  await assert.rejects(assemble(f), /already exists/);
  assert.equal(await readFile(path.join(f.outDir, 'keep.txt'), 'utf8'), 'keep');
});

test('rejects path traversal, absolute paths, URL encoding and core collisions', async () => {
  const f = await fixture();
  for (const content of ['../outside.json', '/outside.json', '%2e%2e/outside.json', 'index.html', 'reader.js/child.json']) {
    await setConfig(f, { content });
    await assert.rejects(assemble(f), /relative file path|collides/);
    await absent(f.outDir);
  }
});

test('rejects symlink files, symlink directories and a symlink instance root', async () => {
  const f = await fixture();
  await symlink(path.join(f.instanceDir, 'list.json'), path.join(f.instanceDir, 'linked.json'));
  await setConfig(f, { content: 'linked.json' });
  await assert.rejects(assemble(f), /Symlinks/);
  await mkdir(path.join(f.instanceDir, 'real'));
  await writeFile(path.join(f.instanceDir, 'real/list.json'), JSON.stringify(minimal()));
  await symlink(path.join(f.instanceDir, 'real'), path.join(f.instanceDir, 'linked'));
  await setConfig(f, { content: 'linked/list.json' });
  await assert.rejects(assemble(f), /Symlinks/);
  const linkedRoot = path.join(f.root, 'linked-instance');
  await symlink(f.instanceDir, linkedRoot);
  await assert.rejects(assemble({ ...f, instanceDir: linkedRoot }), /must not be a symlink/);
  await absent(f.outDir);
});

test('rejects output inside instance or engine, including a symlinked output parent', async () => {
  const f = await fixture();
  for (const parent of [f.instanceDir, f.engineDir]) {
    await assert.rejects(assemble({ ...f, outDir: path.join(parent, 'output') }), /outside/);
  }
  const linked = path.join(f.root, 'engine-link');
  await symlink(f.engineDir, linked);
  await assert.rejects(assemble({ ...f, outDir: path.join(linked, 'output') }), /outside/);
  await absent(f.outDir);
});

test('validates referenced compatibility and does not copy unrelated mappings', async () => {
  const f = await fixture();
  await setConfig(f, { content: 'list.json', compatibility: 'legacy.json' });
  const mapping = { 'old-quiz/old-question': { key: 'qz0v2_0', choices: ['yes', 'no'] } };
  await writeFile(path.join(f.instanceDir, 'legacy.json'), JSON.stringify(mapping));
  await assemble(f);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outDir, 'legacy.json'), 'utf8')), mapping);
  const bad = await fixture();
  await setConfig(bad, { content: 'list.json', compatibility: 'legacy.json' });
  await writeFile(path.join(bad.instanceDir, 'legacy.json'), JSON.stringify({ 'bad-key': {} }));
  await assert.rejects(assemble(bad), /compatibility/);
  await absent(bad.outDir);
});

test('reader-version must be a full matching checkout commit before any output', async () => {
  const f = await fixture();
  await writeFile(path.join(f.instanceDir, 'reader-version'), 'main\n');
  await assert.rejects(assemble(f), /40-character/);
  await writeFile(path.join(f.instanceDir, 'reader-version'), `${'a'.repeat(40)}\n`);
  await assert.rejects(assemble(f), /does not match/);
  await absent(f.outDir);
});

test('final output contains no staging index', async () => {
  const f = await fixture();
  await assemble(f);
  const files = await readdir(f.outDir);
  assert.ok(files.includes('index.html'));
  assert.ok(!files.includes('.index-pending'));
});


test('normalizes leading ./ for packaging and collision checks while preserving config', async () => {
  const f = await fixture();
  await setConfig(f, { content: './list.json' });
  await assemble(f);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outDir, 'config.json'), 'utf8')), { content: './list.json' });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outDir, 'list.json'), 'utf8')), minimal());
  const bad = await fixture();
  await setConfig(bad, { content: './reader.js' });
  await assert.rejects(assemble(bad), /collides/);
  await absent(bad.outDir);
});

test('pinned assembly accepts a clean checkout and rejects tracked or untracked changes', async () => {
  const f = await fixture();
  const git = (...args) => execFileSync('git', ['-C', f.engineDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Reader test', '-c', 'user.email=reader-test@example.org', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic test fixture');
  const sha = git('rev-parse', 'HEAD');
  await writeFile(path.join(f.instanceDir, 'reader-version'), `${sha}\n`);
  await assemble(f);
  assert.equal(JSON.parse(await readFile(path.join(f.outDir, 'release.json'), 'utf8')).readerRevision, sha);
  await writeFile(path.join(f.engineDir, 'reader.js'), '/* changed fixture */');
  const dirtyOutput = path.join(f.root, 'dirty-output');
  await assert.rejects(assemble({ ...f, outDir: dirtyOutput }), /clean reader working tree/);
  await absent(dirtyOutput);
  git('restore', 'reader.js');
  await writeFile(path.join(f.engineDir, 'untracked.txt'), 'fixture');
  await assert.rejects(assemble({ ...f, outDir: dirtyOutput }), /clean reader working tree/);
  await absent(dirtyOutput);
});


test('unpinned metadata identifies only clean checkouts rooted at the reader folder', async () => {
  const f = await fixture();
  const git = (...args) => execFileSync('git', ['-C', f.engineDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Reader test', '-c', 'user.email=reader-test@example.org', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic clean fixture');
  const sha = git('rev-parse', 'HEAD');
  const clean = await assemble(f);
  assert.equal(clean.readerRevision, sha);
  await writeFile(path.join(f.engineDir, 'reader.js'), '/* changed fixture */');
  const dirty = await assemble({ ...f, outDir: path.join(f.root, 'dirty-preview') });
  assert.equal(dirty.readerRevision, null);
  assert.equal(JSON.parse(await readFile(path.join(dirty.output, 'release.json'), 'utf8')).readerRevision, null);
  git('restore', 'reader.js');
  await writeFile(path.join(f.engineDir, 'new-file.txt'), 'synthetic untracked file');
  const untracked = await assemble({ ...f, outDir: path.join(f.root, 'untracked-preview') });
  assert.equal(untracked.readerRevision, null);
});

test('a reader directory inside a different Git repository never inherits its commit', async () => {
  const f = await fixture();
  const git = (...args) => execFileSync('git', ['-C', f.root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Reader test', '-c', 'user.email=reader-test@example.org', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Unrelated enclosing repository');
  const result = await assemble(f);
  assert.equal(result.readerRevision, null);
  const metadata = JSON.parse(await readFile(path.join(f.outDir, 'release.json'), 'utf8'));
  assert.equal(metadata.readerRevision, null);
  await writeFile(path.join(f.instanceDir, 'reader-version'), `${git('rev-parse', 'HEAD')}\n`);
  const pinnedOutput = path.join(f.root, 'incorrect-pin');
  await assert.rejects(assemble({ ...f, outDir: pinnedOutput }), /does not match/);
  await absent(pinnedOutput);
});
