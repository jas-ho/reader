#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {validateList} from './content.js';

const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: node validate.mjs <reading-list.json>'); process.exitCode = 1;
} else {
  try {
    const source = await readFile(path, 'utf8');
    let list;
    try { list = JSON.parse(source); }
    catch (error) {
      const offset = /position (\d+)/.exec(error.message)?.[1];
      const before = source.slice(0, offset === undefined ? source.length : Number(offset));
      const lines = before.split('\n');
      throw Error(`JSON syntax error at line ${lines.length}, column ${lines.at(-1).length + 1}: ${error.message}`);
    }
    const errors = validateList(list);
    if (errors.length) throw Error(errors.join('\n'));
    console.log(`Valid reading list: ${list.title} (${list.id})`);
  } catch (error) { console.error(`${path}: ${error.message}`); process.exitCode = 1; }
}
