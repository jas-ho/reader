import {translator, translateShell} from './locale.js';
import {allItems, validateList, validateConfig, validateCompatibility} from './content.js';
import {createCodec, readState, quizKey, quizScore, itemScore} from './state.js';
import {renderList, element, button} from './render.js';
import {buildExport} from './export.js';

// Resolve everything beside this module, not the current URL: a production root
// index can point at an immutable release and all its data stays on that release.
const baseURL = new URL('./', import.meta.url);
let language = document.documentElement.lang === 'de' ? 'de' : 'en';
let t = translator(language);
const $ = selector => document.querySelector(selector);
async function readJSON(path) {
  const response = await fetch(new URL(path, baseURL));
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  try { return JSON.parse(await response.text()); } catch (error) { throw Error(`${path}: ${error.message}`); }
}
function requireValid(errors, file) { if (errors.length) throw Error(`${file}\n${errors.join('\n')}`); }

async function boot() {
  const config = await readJSON('config.json'); requireValid(validateConfig(config), 'config.json');
  language = config.language || 'en'; t = translator(language); translateShell(document, language);
  const list = await readJSON(config.content); requireValid(validateList(list), config.content);
  const mapping = config.compatibility ? await readJSON(config.compatibility) : {};
  requireValid(validateCompatibility(mapping, list), config.compatibility || 'compatibility');
  let storage;
  try { storage = window.localStorage; } catch { /* readState reports unavailable storage */ }
  const storageKey = config.storageKey || `reader:${list.id}`;
  const loaded = readState(storage, storageKey, language);
  const codec = createCodec(mapping);
  if (config.theme) {
    const theme = element('link'); theme.rel = 'stylesheet'; theme.href = new URL(config.theme, baseURL).href;
    theme.onerror = () => { $('#theme-status').textContent = t('themeFailed'); };
    document.head.append(theme);
  }
  renderList(list, language);
  $('#app').hidden = false; $('#bar').hidden = false; $('#startup-error').hidden = true;
  if (loaded.warning) $('#storage-status').textContent = loaded.warning;
  const page = startReader(list, codec.decode(loaded.state), codec, storage, storageKey);
  if (config.sync) {
    $('#sync-status').textContent = t('syncHelp');
    try {
      const {attachSync} = await import('./sync.js');
      await attachSync(config.sync, page, $('#syncMount'), baseURL, language);
    } catch (error) { $('#sync-status').textContent = error.message; }
  }
}

function startReader(list, initialState, codec, storage, storageKey) {
  let state = initialState, timer = null;
  const items = allItems(list), cards = new Map(), quizPainters = new Map(), skipped = new Set();
  const finePointer = matchMedia('(hover:hover) and (pointer:fine)').matches;
  function persist() {
    try { storage.setItem(storageKey, JSON.stringify(codec.encode(state))); }
    catch { $('#storage-status').textContent = t('saveFailed'); }
  }
  function saveNow() {
    clearTimeout(timer); timer = null; persist();
    if (page.onChange) page.onChange();
  }
  function save() { clearTimeout(timer); timer = setTimeout(saveNow, 350); }
  function updateTextarea(input, value) {
    if (input.value === value) return;
    const start = input.selectionStart, end = input.selectionEnd;
    input.value = value;
    if (document.activeElement === input) input.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
  }
  function paintProgress(node) {
    const value = state.items[node.dataset.id];
    if (['done', 'dropped'].includes(value)) node.dataset.state = value; else delete node.dataset.state;
    node.querySelector('.box').setAttribute('aria-pressed', String(value === 'done'));
    const item = items.find(item => item.id === node.dataset.id);
    if (item) {
      if (['done', 'dropped'].includes(value)) for (const player of node.querySelectorAll('audio')) player.pause();
      node.querySelector('.box').setAttribute('aria-label', t('markDone', {title: item.title}) + (value === 'dropped' ? t('droppedLabel') : ''));
    }
  }
  function paintDrawer(item) {
    const card = cards.get(item.id), tokens = [], score = itemScore(item, state);
    if (state.recall[item.id]?.trim()) tokens.push(t('recallToken'));
    if (state.notes[item.id]?.trim()) tokens.push(t('noteToken'));
    if (score.answered) tokens.push(t('quizToken', score));
    card.querySelector('.sumtxt').textContent = tokens.length ? `· ${tokens.join(' · ')}` : '';
    card.querySelector('.closeout').dataset.filled = tokens.length ? '1' : '0';
    for (const paint of quizPainters.get(item.id) || []) paint();
  }
  function toggle(node, dropped = false) {
    const id = node.dataset.id, current = state.items[id];
    const next = dropped ? (current === 'dropped' ? null : 'dropped') : (current === 'done' || current === 'dropped' ? null : 'done');
    if (next) state.items[id] = next; else delete state.items[id];
    paintProgress(node); return next;
  }
  for (const item of items) {
    const card = $(`.item[data-id="${item.id}"]`); cards.set(item.id, card);
    card.querySelector('.head .box').addEventListener('click', () => {
      const next = toggle(card); paintDrawer(item); renderProgress(); save();
      if (next === 'done') { card.querySelector('.closeout').open = true; if (finePointer) card.querySelector('.recall').focus({preventScroll: true}); }
    });
    card.querySelector('.drop').addEventListener('click', () => { toggle(card, true); paintDrawer(item); renderProgress(); save(); card.querySelector('.head .box').focus({preventScroll: true}); });
    for (const part of card.querySelectorAll('.subs > li')) {
      part.querySelector('.box').addEventListener('click', () => {
        toggle(part);
        const allDone = (item.parts || []).every(part => state.items[part.id] === 'done');
        if (allDone) state.items[item.id] = 'done'; else if (state.items[item.id] === 'done') delete state.items[item.id];
        paintProgress(card); paintDrawer(item); renderProgress(); save();
        if (allDone) card.querySelector('.head .box').focus({preventScroll: true});
      });
    }
    for (const [selector, field] of [['.recall', 'recall'], ['.notetext', 'notes']]) {
      const input = card.querySelector(selector); input.value = state[field][item.id] || '';
      input.addEventListener('input', () => { state[field][item.id] = input.value; paintDrawer(item); save(); });
      input.addEventListener('blur', saveNow);
    }
    card.querySelector('.copy1').addEventListener('click', event => openHandoff(event.currentTarget, item.id));
    for (const quiz of item.quizzes || []) buildQuiz(item, quiz, card);
  }

  function buildQuiz(item, quiz, card) {
    const details = element('details', 'quiz'), summary = element('summary'), scoreLabel = element('span', 'qscore');
    scoreLabel.setAttribute('aria-live', 'polite');
    summary.append(element('span', '', quiz.title), scoreLabel); details.append(summary);
    const gate = element('div', 'gate'), skip = button('qreset', t('skipRecall'));
    gate.append(element('span', '', t('recallGate')), skip);
    skip.addEventListener('click', () => { skipped.add(item.id); paintDrawer(item); summary.focus(); });
    const body = element('div', 'qbody'), painters = [];
    quiz.questions.forEach((question, index) => {
      const key = quizKey(quiz, question), row = element('div', 'q'); row.dataset.question = key;
      row.append(element('p', 'qtext', `${index + 1}. ${question.prompt}`));
      const buttons = question.choices.map((choice, optionIndex) => {
        const option = button('opt', `${String.fromCharCode(65 + optionIndex)}. ${choice.text}`); option.dataset.choice = choice.id;
        option.addEventListener('click', () => {
          if (question.choices.some(choice => choice.id === state.quiz[key])) return;
          state.quiz[key] = choice.id; save(); paintDrawer(item);
        });
        row.append(option); return option;
      });
      const result = element('p', 'rat'); result.setAttribute('role', 'status'); row.append(result); body.append(row);
      painters.push(() => {
        const chosen = state.quiz[key], answered = question.choices.some(choice => choice.id === chosen);
        row.classList.toggle('answered', answered);
        buttons.forEach((option, index) => {
          const id = question.choices[index].id;
          option.setAttribute('aria-disabled', String(answered));
          option.classList.toggle('correct', answered && id === question.answer);
          option.classList.toggle('wrong', answered && id === chosen && id !== question.answer);
        });
        const answer = question.choices.find(choice => choice.id === question.answer);
        const resultText = answered ? `${chosen === question.answer ? t('correct') : t('incorrect', {answer: answer.text})}${question.explanation ? ' ' + question.explanation : ''}` : '';
        if (result.textContent !== resultText) result.textContent = resultText;
      });
    });
    const reset = button('qreset', t('resetQuiz'));
    reset.addEventListener('click', () => { for (const question of quiz.questions) codec.clearAnswer(state, quizKey(quiz, question)); save(); paintDrawer(item); summary.focus(); });
    body.append(reset); details.append(gate, body); card.querySelector('.qslot').append(details);
    function paint() {
      const score = quizScore(quiz, state), gated = !state.recall[item.id]?.trim() && !score.answered && !skipped.has(item.id);
      gate.hidden = !gated; body.hidden = gated;
      const scoreText = score.answered ? t('score', score) : t('questions', {count: score.total});
      if (scoreLabel.textContent !== scoreText) scoreLabel.textContent = scoreText;
      for (const painter of painters) painter();
    }
    quizPainters.set(item.id, [...(quizPainters.get(item.id) || []), paint]);
  }

  const scratch = $('#freeform'); scratch.value = state.freeform;
  scratch.addEventListener('input', () => { state.freeform = scratch.value; save(); });
  scratch.addEventListener('blur', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);
  const jump = button('jump', ''); $('#hint').append(jump);
  let nextItem = null;
  jump.addEventListener('click', () => {
    if (!nextItem) return;
    const card = cards.get(nextItem.id);
    card.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'start'});
    card.querySelector('.box').focus({preventScroll: true});
  });
  function renderProgress() {
    const open = items.filter(item => !['done', 'dropped'].includes(state.items[item.id]));
    const countText = open.length ? t('left', {count: open.length}) : t('allDone');
    if ($('#count').textContent !== countText) $('#count').textContent = countText;
    nextItem = open[0];
    jump.hidden = !nextItem;
    jump.replaceChildren();
    if (nextItem) jump.append(t('next'), element('span', 't', nextItem.title));
  }
  function paintAll() {
    for (const item of items) {
      const card = cards.get(item.id); paintProgress(card);
      for (const part of card.querySelectorAll('.subs > li')) paintProgress(part);
      updateTextarea(card.querySelector('.recall'), state.recall[item.id] || '');
      updateTextarea(card.querySelector('.notetext'), state.notes[item.id] || '');
      paintDrawer(item);
    }
    updateTextarea(scratch, state.freeform); renderProgress();
  }
  const page = {
    get: () => codec.encode(state),
    set: value => { state = codec.decode(value); persist(); paintAll(); },
    onChange: null
  };
  window.readerPage = page;
  paintAll();
  function setBarHeight() { document.documentElement.style.setProperty('--bar-h', `${$('#bar').offsetHeight}px`); }
  setBarHeight(); new ResizeObserver(setBarHeight).observe($('#bar'));

  const handoff = $('#handoff'), text = $('#handoffText'); let snapshot = null;
  function openHandoff(trigger, id = null) {
    saveNow(); snapshot = {trigger, id, text: buildExport(list, state, id, language)}; text.value = snapshot.text;
    $('#handoffTitle').textContent = id ? t('handoff') : t('exportAll');
    $('#copyMsg').textContent = finePointer ? t('copyDesktop') : t('copyTouch');
    handoff.showModal(); text.focus(); text.select(); text.scrollTop = 0;
  }
  $('#exportBtn').addEventListener('click', event => openHandoff(event.currentTarget));
  $('#handoffClose').addEventListener('click', () => handoff.close());
  handoff.addEventListener('close', () => { snapshot?.trigger.focus({preventScroll: true}); snapshot = null; });
  $('#notesDownload').addEventListener('click', () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([snapshot.text], {type: 'text/markdown;charset=utf-8'}));
    const a = element('a'); a.href = url; a.download = `${list.id}-${snapshot.id || 'all-notes'}.md`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  return page;
}

boot().catch(error => {
  $('#startup-error').setAttribute('role', 'alert');
  $('#startup-error').hidden = false;
  $('#startup-error').textContent = t('openFailed', {detail: error.message});
  console.error(error);
});
