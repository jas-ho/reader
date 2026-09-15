// The authored content contract. Keep validation browser-independent so the CLI
// and page report the same errors. New fields start here; see docs/extending.md.
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const allItems = list => list.sections.flatMap(section => section.items);
export const quizKey = (quiz, question) => `${quiz.id}/${question.id}`;
// Reading-source links. Audio is exported separately with its coverage notes.
export function allLinks(item) {
  const links = [...(item.links || []), ...(item.parts || []).flatMap(part => part.links || [])];
  return links.filter((link, index) => links.findIndex(other => other.url === link.url) === index);
}

export function validateList(list) {
  const errors = [], progressIDs = new Set(), quizIDs = new Set(), sectionIDs = new Set();
  const error = (path, message) => errors.push(`${path}: ${message}`);
  function object(value, path, fields) {
    if (!isRecord(value)) { error(path, 'expected an object'); return false; }
    for (const key of Object.keys(value)) if (!fields.includes(key)) error(`${path}.${key}`, 'unknown field');
    return true;
  }
  function text(value, path, required = false) {
    if (value === undefined && !required) return;
    if (typeof value !== 'string' || (required && !value.trim())) error(path, 'expected a nonempty string');
  }
  function id(value, path, seen) {
    if (typeof value !== 'string' || !SLUG.test(value) || RESERVED.has(value)) error(path, 'expected a safe lowercase ID (letters, digits, hyphens; max 64)');
    else if (seen.has(value)) error(path, `duplicate ID ${value}`);
    else seen.add(value);
  }
  function array(value, path, min = 0, optional = true) {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) { error(path, 'expected an array'); return []; }
    if (value.length < min) error(path, `expected at least ${min} entries`);
    return value;
  }
  function url(value, path, protocols = ['http:', 'https:']) {
    try {
      const parsed = new URL(value);
      if (typeof value !== 'string' || !protocols.includes(parsed.protocol) || parsed.username || parsed.password) throw Error();
    } catch { error(path, `expected an absolute ${protocols.map(protocol => protocol.slice(0, -1).toUpperCase()).join('/')} URL without credentials`); }
  }
  function links(value, path) {
    array(value, path).forEach((link, index) => {
      const p = `${path}[${index}]`;
      if (!object(link, p, ['label', 'url'])) return;
      text(link.label, `${p}.label`, true);
      url(link.url, `${p}.url`);
    });
  }
  function audio(value, path) {
    array(value, path).forEach((recording, index) => {
      const p = `${path}[${index}]`;
      if (!object(recording, p, ['label', 'url', 'description', 'src'])) return;
      text(recording.label, `${p}.label`, true);
      text(recording.description, `${p}.description`, true);
      url(recording.url, `${p}.url`);
      if (recording.src !== undefined) url(recording.src, `${p}.src`, ['https:']);
    });
  }
  if (!object(list, 'list', ['schemaVersion', 'id', 'title', 'description', 'recallPrompt', 'notePrompt', 'footer', 'sections'])) return errors;
  if (list.schemaVersion !== 1) error('list.schemaVersion', 'supported version is 1');
  id(list.id, 'list.id', new Set()); text(list.title, 'list.title', true);
  for (const field of ['description', 'recallPrompt', 'notePrompt', 'footer']) text(list[field], `list.${field}`);
  array(list.sections, 'list.sections', 1, false).forEach((section, si) => {
    const sp = `list.sections[${si}]`;
    if (!object(section, sp, ['id', 'title', 'description', 'items'])) return;
    id(section.id, `${sp}.id`, sectionIDs); text(section.title, `${sp}.title`, true); text(section.description, `${sp}.description`);
    array(section.items, `${sp}.items`, 1, false).forEach((item, ii) => {
      const ip = `${sp}.items[${ii}]`;
      if (!object(item, ip, ['id', 'title', 'byline', 'description', 'why', 'effort', 'links', 'audio', 'parts', 'quizzes'])) return;
      id(item.id, `${ip}.id`, progressIDs); text(item.title, `${ip}.title`, true);
      for (const field of ['byline', 'description', 'why']) text(item[field], `${ip}.${field}`);
      array(item.effort, `${ip}.effort`).forEach((v, i) => text(v, `${ip}.effort[${i}]`, true));
      links(item.links, `${ip}.links`);
      audio(item.audio, `${ip}.audio`);
      array(item.parts, `${ip}.parts`).forEach((part, pi) => {
        const pp = `${ip}.parts[${pi}]`;
        if (!object(part, pp, ['id', 'title', 'description', 'links', 'audio'])) return;
        id(part.id, `${pp}.id`, progressIDs); text(part.title, `${pp}.title`, true); text(part.description, `${pp}.description`); links(part.links, `${pp}.links`);
        audio(part.audio, `${pp}.audio`);
      });
      array(item.quizzes, `${ip}.quizzes`).forEach((quiz, qi) => {
        const qp = `${ip}.quizzes[${qi}]`;
        if (!object(quiz, qp, ['id', 'title', 'questions'])) return;
        id(quiz.id, `${qp}.id`, quizIDs); text(quiz.title, `${qp}.title`, true);
        const questionIDs = new Set();
        array(quiz.questions, `${qp}.questions`, 1, false).forEach((question, index) => {
          const p = `${qp}.questions[${index}]`;
          if (!object(question, p, ['id', 'prompt', 'choices', 'answer', 'explanation'])) return;
          id(question.id, `${p}.id`, questionIDs); text(question.prompt, `${p}.prompt`, true); text(question.explanation, `${p}.explanation`);
          const choiceIDs = new Set(), choices = array(question.choices, `${p}.choices`, 2, false);
          if (choices.length > 26) error(`${p}.choices`, 'at most 26 choices supported');
          choices.forEach((choice, ci) => {
            if (!object(choice, `${p}.choices[${ci}]`, ['id', 'text'])) return;
            id(choice.id, `${p}.choices[${ci}].id`, choiceIDs); text(choice.text, `${p}.choices[${ci}].text`, true);
          });
          if (!choiceIDs.has(question.answer)) error(`${p}.answer`, 'must name a choice ID');
        });
      });
    });
  });
  return errors;
}

export function safeRelativePath(path) {
  if (typeof path === 'string' && path.startsWith('./')) path = path.slice(2);
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') &&
    !/[?#:%\x00-\x20]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}
export function validateConfig(config) {
  if (!isRecord(config)) return ['config: expected an object'];
  const errors = [];
  for (const field of Object.keys(config)) if (!['content', 'language', 'theme', 'compatibility', 'storageKey', 'sync'].includes(field)) errors.push(`config.${field}: unknown field`);
  for (const field of ['content', 'theme', 'compatibility']) {
    if (field !== 'content' && config[field] === undefined) continue;
    if (!safeRelativePath(config[field])) errors.push(`config.${field}: expected a relative file path without traversal`);
  }
  if (config.language !== undefined && !['en', 'de'].includes(config.language)) errors.push('config.language: expected en or de');
  if (config.storageKey !== undefined && (typeof config.storageKey !== 'string' || !config.storageKey.trim())) errors.push('config.storageKey: expected a nonempty string');
  if (config.sync != null) {
    if (!isRecord(config.sync)) errors.push('config.sync: expected an object or null');
    else {
      for (const field of Object.keys(config.sync)) if (!['script', 'site', 'importFrom'].includes(field)) errors.push(`config.sync.${field}: unknown field`);
      for (const field of ['site', 'importFrom']) {
        if (field === 'importFrom' && config.sync[field] === undefined) continue;
        if (typeof config.sync[field] !== 'string' || !SLUG.test(config.sync[field]) || RESERVED.has(config.sync[field])) errors.push(`config.sync.${field}: expected a safe ID`);
      }
      if (config.sync.site === config.sync.importFrom) errors.push('config.sync.importFrom: must differ from site');
      try {
        const url = new URL(config.sync.script, 'https://reader.invalid/');
        if (typeof config.sync.script !== 'string' || !config.sync.script.trim() || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
      } catch { errors.push('config.sync.script: expected an HTTP/HTTPS script URL or path'); }
    }
  }
  return errors;
}

export function validateCompatibility(mapping, list) {
  if (!isRecord(mapping)) return ['compatibility: expected an object'];
  const errors = [], wireKeys = new Set(), questions = new Map();
  for (const item of allItems(list)) for (const quiz of item.quizzes || []) for (const question of quiz.questions) questions.set(quizKey(quiz, question), question);
  for (const [key, entry] of Object.entries(mapping)) {
    const p = `compatibility.${key}`;
    if (key.split('/').length !== 2 || !key.split('/').every(id => SLUG.test(id) && !RESERVED.has(id))) errors.push(`${p}: expected quiz/question IDs`);
    if (!isRecord(entry)) { errors.push(`${p}: expected an object`); continue; }
    if (Object.keys(entry).some(field => !['key', 'choices'].includes(field))) errors.push(`${p}: unknown field`);
    if (typeof entry.key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(entry.key) || RESERVED.has(entry.key) || wireKeys.has(entry.key)) errors.push(`${p}.key: invalid or duplicate legacy key`);
    wireKeys.add(entry.key);
    if (!Array.isArray(entry.choices) || entry.choices.length < 2 || entry.choices.some(id => typeof id !== 'string' || !SLUG.test(id) || RESERVED.has(id)) || new Set(entry.choices).size !== entry.choices.length) errors.push(`${p}.choices: expected unique choice IDs in immutable legacy order`);
    else if (questions.has(key) && questions.get(key).choices.some(choice => !entry.choices.includes(choice.id))) errors.push(`${p}.choices: missing an active choice ID`);
  }
  return errors;
}
