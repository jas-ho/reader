import {itemMinutes} from './content.js';
import {itemScore, isClosed} from './state.js';
import {translator, formatMinutes} from './locale.js';

const quote = (text, t) => text?.trim() ? '> ' + text.trim().replace(/\r?\n/g, '\n> ') : t('nothingRecorded');
const audioDescription = recording => [recording.duration, recording.description, recording.warning, recording.details].filter(Boolean).join('\n');
const status = value => isClosed(value) ? value : 'open';
// A source and the places inside it (jumps), indented under its owner.
const linkLines = (links = [], indent = '') => links.flatMap(link => [`${indent}- ${link.label}: ${link.url}`, ...(link.jumps || []).map(jump => `${indent}  - ${jump.label}: ${jump.url}`)]);

// This function and renderItem consume the same authored item. Add new context
// fields here deliberately, so a chatbot receives the full reading assignment.
export function itemBlock(item, state, number, language = 'en', section = null) {
  const t = translator(language), quoted = text => quote(text, t);
  const lines = [`## ${number}. [${t(status(state.items[item.id]))}] ${item.title}`];
  if (section) lines.push(`${t('section')}: ${section.title}`, ...(section.description ? [quoted(section.description)] : []));
  if (item.byline) lines.push(item.byline);
  if (item.priority) lines.push(`${t('priority')}: ${t(item.priority)}`);
  if (item.description) lines.push('', '### ' + t('readingInstructions'), quoted(item.description));
  if (item.scope) lines.push('', `${t('scopeExport')}: ${item.scope}`);
  const minutes = itemMinutes(item);
  if (minutes !== null) lines.push('', `${t('time')}: ${formatMinutes(minutes, language)}`);
  if (item.effort?.length) lines.push('', `${t('effort')}: ${item.effort.join(' · ')}`);
  if (item.why) lines.push('', '### ' + t('whyRead'), quoted(item.why));
  lines.push('', '### ' + t('sources'));
  const parts = item.parts || [];
  if (!item.links?.length && !item.audio?.length && !parts.some(part => part.links?.length || part.audio?.length)) lines.push(t('noSource'));
  lines.push(...linkLines(item.links)); // part sources are listed with their part below
  if (item.audio?.length) {
    lines.push('', '### ' + t('audio'));
    for (const recording of item.audio) lines.push(`- ${recording.label}: ${recording.url}`, quoted(audioDescription(recording)));
  }
  if (item.parts?.length) {
    lines.push('', '### ' + t('parts'));
    for (const part of item.parts) {
      const value = state.items[part.id];
      const time = part.minutes === undefined ? '' : ` (${formatMinutes(part.minutes, language)})`;
      lines.push(`- [${value === 'done' ? 'x' : value === 'dropped' ? '-' : ' '}] ${part.title}${time}`);
      if (part.description) lines.push(quoted(part.description));
      if (part.scope) lines.push(`  ${t('scopeExport')}: ${part.scope}`);
      lines.push(...linkLines(part.links, '  '));
      for (const recording of part.audio || []) lines.push(`  - ${t('audio')}: ${recording.label}: ${recording.url}`, quoted(audioDescription(recording)));
    }
  }
  lines.push('', '### ' + t('readerRecall'), quoted(state.recall[item.id]), '', '### ' + t('readerNote'), quoted(state.notes[item.id]));
  const score = itemScore(item, state);
  if (score.answered) lines.push('', t('exportScore', score));
  return lines.join('\n');
}

export function buildExport(list, state, onlyId = null, language = 'en') {
  const t = translator(language);
  const lines = [`# ${list.title}: ${t(onlyId ? 'oneReading' : 'myNotes')}`, '', t('chatbotPrompt'), t('chatbotBoundaries'), ''];
  if (list.description) lines.push('## ' + t('aboutList'), quote(list.description, t), '');
  let number = 0;
  for (const section of list.sections) {
    if (!onlyId) lines.push(`## ${t('section')}: ${section.title}`, ...(section.description ? [quote(section.description, t)] : []), '');
    for (const item of section.items) {
      number += 1;
      if (!onlyId || item.id === onlyId) lines.push(itemBlock(item, state, number, language, onlyId ? section : null), '');
    }
  }
  if (!onlyId && state.freeform.trim()) lines.push('## ' + t('readerScratch'), quote(state.freeform, t), '');
  return lines.join('\n');
}
