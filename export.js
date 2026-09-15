import {allItems, allLinks} from './content.js';
import {itemScore} from './state.js';
import {translator} from './locale.js';

const quote = (text, t) => text?.trim() ? '> ' + text.trim().replace(/\r?\n/g, '\n> ') : t('nothingRecorded');
const status = value => ['done', 'dropped'].includes(value) ? value : 'open';

// This function and renderItem consume the same authored item. Add new context
// fields here deliberately, so a chatbot receives the full reading assignment.
export function itemBlock(item, state, number, language = 'en') {
  const t = translator(language), quoted = text => quote(text, t);
  const lines = [`## ${number}. [${t(status(state.items[item.id]))}] ${item.title}`];
  if (item.byline) lines.push(item.byline);
  if (item.description) lines.push('', '### ' + t('readingInstructions'), quoted(item.description));
  if (item.effort?.length) lines.push('', `${t('effort')}: ${item.effort.join(' · ')}`);
  if (item.why) lines.push('', '### ' + t('whyRead'), quoted(item.why));
  lines.push('', '### ' + t('sources'));
  const links = allLinks(item);
  if (!links.length && !item.audio?.length && !(item.parts || []).some(part => part.audio?.length)) lines.push(t('noSource'));
  for (const link of links) lines.push(`- ${link.label}: ${link.url}`);
  if (item.audio?.length) {
    lines.push('', '### ' + t('audio'));
    for (const recording of item.audio) lines.push(`- ${recording.label}: ${recording.url}`, quoted(recording.description));
  }
  if (item.parts?.length) {
    lines.push('', '### ' + t('parts'));
    for (const part of item.parts) {
      const value = state.items[part.id];
      lines.push(`- [${value === 'done' ? 'x' : value === 'dropped' ? '-' : ' '}] ${part.title}`);
      if (part.description) lines.push(quoted(part.description));
      for (const link of part.links || []) lines.push(`  - ${link.label}: ${link.url}`);
      for (const recording of part.audio || []) lines.push(`  - ${t('audio')}: ${recording.label}: ${recording.url}`, quoted(recording.description));
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
  allItems(list).forEach((item, index) => { if (!onlyId || item.id === onlyId) lines.push(itemBlock(item, state, index + 1, language), ''); });
  if (!onlyId && state.freeform.trim()) lines.push('## ' + t('readerScratch'), quote(state.freeform, t), '');
  return lines.join('\n');
}
