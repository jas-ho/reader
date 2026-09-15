import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {messages, translator, translateShellHTML} from '../locale.js';
import {validateConfig} from '../content.js';
import {buildExport} from '../export.js';
import {emptyState, readState} from '../state.js';
import {assemble} from '../assemble.mjs';

test('language is optional, explicit and limited to supported translations', () => {
  for (const language of [undefined, 'en', 'de']) assert.deepEqual(validateConfig({content: 'list.json', ...(language && {language})}), []);
  for (const language of ['fr', '', null, 42, '__proto__']) assert.match(validateConfig({content: 'list.json', language}).join(), /config.language/);
  assert.equal(translator()('left', {count: 2}), '2 left');
  assert.equal(translator('de')('left', {count: 2}), '2 offen');
  assert.equal(translator('de')('markDone', {title: '$& <Notizen> {title}'}), '$& <Notizen> {title} als gelesen markieren');
});

test('every language supplies the same messages and interpolation variables', () => {
  const variables = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.de).sort());
  for (const key of Object.keys(messages.en)) assert.deepEqual(variables(messages.en[key]), variables(messages.de[key]), key);
});

test('German export retains source links and authored text without modifying saved identities', () => {
  const list = {id: 'test', title: 'Leseliste', sections: [{items: [{id: 'first', title: 'Ein Text', description: 'Absatz 2 lesen', parts: [{id: 'part', title: 'Teil', links: [{label: 'Quelle', url: 'https://example.org/part'}]}]}]}]};
  const state = emptyState(); state.items.first = 'done'; state.notes.first = 'Eigene Notiz'; state.freeform = 'Ein Gedanke';
  const before = JSON.stringify(state), output = buildExport(list, state, null, 'de');
  for (const text of ['meine Lesenotizen', '[gelesen]', 'Leseauftrag', 'Absatz 2 lesen', 'Eigene Notiz', 'https://example.org/part', 'Warte auf meine Frage', 'niemals in Web-Suchanfragen', 'Freie Notizen']) assert.ok(output.includes(text), text);
  assert.equal(JSON.stringify(state), before);
  assert.match(buildExport(list, state), /my reading notes/);
});

test('German corrupt-storage error leaves the original bytes untouched', () => {
  const storage = {getItem: () => '{', setItem: () => assert.fail('must not overwrite')};
  assert.throws(() => readState(storage, 'reader:test', 'de'), /reader:test.*kein gültiges JSON/);
});

test('assembly emits German shell language, labels and fallback messages without JavaScript', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reader-language-'));
  const instance = path.join(root, 'instance'), output = path.join(root, 'output'); await mkdir(instance);
  await writeFile(path.join(instance, 'config.json'), JSON.stringify({content: 'list.json', language: 'de'}));
  await writeFile(path.join(instance, 'list.json'), JSON.stringify({schemaVersion: 1, id: 'test', title: 'Test', sections: [{id: 'one', title: 'Teil', items: [{id: 'book', title: 'Buch'}]}]}));
  await assemble({instanceDir: instance, outDir: output});
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  for (const text of ['lang="de"', 'Die Leseliste wird geladen.', 'Dieser Reader braucht JavaScript', 'aria-label="Export aller Notizen"', 'Erinnerungen und Notizen.', 'Schließen']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Loading reading list'));
  assert.ok(!html.includes('Scratch notes'));
  assert.equal(translateShellHTML(html, 'de'), html);
});

test("raw English shell agrees with its string table", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(translateShellHTML(html), html);
});
