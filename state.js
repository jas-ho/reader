import {isRecord, quizKey} from './content.js';
export {quizKey};
export const emptyState = () => ({items: {}, notes: {}, recall: {}, freeform: '', quiz: {}});

// Never reinterpret an invalid or retired answer as a valid choice. Preserve it
// so merely viewing/editing another reading does not erase historical state.
export function createCodec(mapping = {}) {
  return {
    decode(raw) {
      const quiz = raw.quiz || {};
      const state = {...raw, quiz: {...quiz}};
      for (const [stable, legacy] of Object.entries(mapping)) {
        const value = quiz[legacy.key];
        // An explicit stable answer takes precedence if a migration supplied
        // both representations; encode will make the numeric alias agree.
        if (!Object.hasOwn(quiz, stable) && Number.isInteger(value) && value >= 0 && value < legacy.choices.length) {
          state.quiz[stable] = legacy.choices[value]; delete state.quiz[legacy.key];
        }
      }
      return state;
    },
    encode(state) {
      const raw = {...state, quiz: {...state.quiz}};
      for (const [stable, legacy] of Object.entries(mapping)) {
        const index = legacy.choices.indexOf(state.quiz?.[stable]);
        if (index >= 0) { raw.quiz[legacy.key] = index; delete raw.quiz[stable]; }
      }
      return raw;
    },
    clearAnswer(state, key) {
      delete state.quiz[key];
      if (mapping[key]) delete state.quiz[mapping[key].key];
    }
  };
}

export function readState(storage, key) {
  let raw;
  try { raw = storage.getItem(key); } catch { return {state: emptyState(), warning: 'Browser storage is unavailable. Download your notes before closing this page.'}; }
  if (raw === null) return {state: emptyState(), warning: ''};
  let state;
  try { state = JSON.parse(raw); } catch { throw Error(`Saved state in ${key} is not valid JSON and has been left untouched. Recover this entry in this browser's developer tools under Local Storage before resetting it.`); }
  if (!isRecord(state) || ['items', 'notes', 'recall', 'quiz'].some(field => state[field] !== undefined && !isRecord(state[field])) || (state.freeform !== undefined && typeof state.freeform !== 'string')) throw Error(`Saved state in ${key} has an unsupported shape and has been left untouched. Recover this entry in this browser's developer tools under Local Storage before resetting it.`);
  for (const field of ['notes', 'recall']) if (Object.values(state[field] || {}).some(value => typeof value !== 'string')) throw Error(`Saved state in ${key}.${field} contains non-text notes. It has been left untouched.`);
  return {state: {...emptyState(), ...state}, warning: ''};
}

export function flatten(state) {
  const flat = {};
  for (const [field, prefix] of [['items', 'item'], ['notes', 'note'], ['recall', 'recall'], ['quiz', 'quiz']]) {
    for (const [id, value] of Object.entries(state[field])) if (field === 'quiz' || value) flat[`${prefix}:${id}`] = value;
  }
  if (state.freeform) flat.freeform = state.freeform;
  return flat;
}
export function unflatten(flat) {
  const state = emptyState();
  const assign = (field, id, value) => Object.defineProperty(state[field], id, {value, enumerable: true, writable: true, configurable: true});
  for (const [key, value] of Object.entries(flat)) {
    if (value == null) continue;
    const split = key.indexOf(':'), prefix = key.slice(0, split), id = key.slice(split + 1);
    if (key === 'freeform' && typeof value === 'string') state.freeform = value;
    else if (prefix === 'item' && ['done', 'dropped'].includes(value)) assign('items', id, value);
    else if (prefix === 'note' && typeof value === 'string') assign('notes', id, value);
    else if (prefix === 'recall' && typeof value === 'string') assign('recall', id, value);
    else if (prefix === 'quiz') assign('quiz', id, value);
  }
  return state;
}

export function quizScore(quiz, state) {
  let answered = 0, correct = 0;
  for (const question of quiz.questions) {
    const chosen = state.quiz[quizKey(quiz, question)];
    if (question.choices.some(choice => choice.id === chosen)) { answered++; if (chosen === question.answer) correct++; }
  }
  return {answered, correct, total: quiz.questions.length};
}
export function itemScore(item, state) {
  return (item.quizzes || []).reduce((sum, quiz) => {
    const score = quizScore(quiz, state);
    for (const key of Object.keys(sum)) sum[key] += score[key];
    return sum;
  }, {answered: 0, correct: 0, total: 0});
}
