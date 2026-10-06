import {translator, translateShell, formatMinutes} from './locale.js';
import {allItems, itemMinutes, validateList, validateConfig, validateCompatibility} from './content.js';
import {createCodec, readState, quizKey, quizScore, itemScore} from './state.js';
import {renderList, summarise, element, button} from './render.js';
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
  if (config.homeLink) {
    const home = element('a', '', config.homeLink.label); home.href = config.homeLink.url;
    $('#home-link').append(home); $('#home-link').hidden = false;
  }
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
  const items = allItems(list), cards = new Map(), quizPainters = new Map();
  // View state: where the reader is and what they chose to see. It stays on this device, never
  // syncs and never changes progress. Only the reader's own actions open or close things.
  const viewKey = `${storageKey}:view`, view = readView(), skipped = new Set(view.skipped), shown = new Set(), painted = new Map();
  function readView() {
    try { const v = JSON.parse(storage.getItem(viewKey)); return {at: typeof v?.at === 'string' ? v.at : null, skipped: Array.isArray(v?.skipped) ? v.skipped.filter(id => typeof id === 'string') : []}; }
    catch { return {at: null, skipped: []}; }
  }
  function saveView() {
    try { storage.setItem(viewKey, JSON.stringify({at: currentCard()?.dataset.id ?? null, skipped: [...skipped]})); } catch { /* view state is a convenience */ }
  }
  const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
  // Where the reader is: the reading they last interacted with or jumped to, until they scroll
  // themselves; then the last card whose top has reached the top of the screen (below its 1rem
  // scroll margin); above the list, none. A second tap during a smooth scroll still moves on.
  let anchor = null, scrolledByReader = false;
  const scrollKeys = ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '];
  // Scrolling inside a dialog (contents, handoff) does not move the reader through the list.
  function readerScrolls(event) { if (!event.target.closest?.('dialog')) { anchor = null; scrolledByReader = true; } }
  addEventListener('wheel', readerScrolls, {passive: true});
  addEventListener('touchmove', readerScrolls, {passive: true});
  addEventListener('keydown', event => {
    if (scrollKeys.includes(event.key) && !event.target.closest?.('textarea, input, button, summary, audio')) readerScrolls(event);
  });
  addEventListener('focusin', event => { const card = event.target.closest?.('.item'); if (card) anchor = card; });
  function currentCard() {
    if (anchor?.matches('.item')) return anchor;
    let current = null;
    for (const card of cards.values()) { if (card.getBoundingClientRect().top <= 24) current = card; else break; }
    return current;
  }
  const unfinished = item => !['done', 'dropped'].includes(state.items[item.id]);
  // The first unfinished reading from position `start` in display order, wrapping round.
  const indexOf = card => items.findIndex(item => item.id === card.dataset.id);
  const unfinishedFrom = start => [...items.slice(start), ...items.slice(0, start)].find(unfinished) || null;
  const nextAfter = card => unfinishedFrom(card ? indexOf(card) + 1 : 0);
  // Next from where the reader is: after a jump to a section or the top, its first unfinished reading.
  function nextFromHere() {
    if (anchor && !anchor.matches('.item')) { const first = anchor.querySelector('.item'); return unfinishedFrom(first ? indexOf(first) : 0); }
    return nextAfter(currentCard());
  }
  // After a jump, the finger that tapped is over different content; a quick second tap must not
  // drop, open or follow whatever moved under it.
  let tapGuardUntil = 0;
  $('#readings').addEventListener('click', event => {
    if (performance.now() < tapGuardUntil) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  // Go to a reading card, a section or the top (the .wrap): bring it to the top of the screen,
  // focus its heading and make it where the reader is, even where the page cannot scroll that far.
  function goTo(target, smooth = true) {
    tapGuardUntil = performance.now() + 400;
    target.scrollIntoView({behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start'});
    target.querySelector(target.matches('.item') ? '.head h3' : 'h1, h2').focus({preventScroll: true});
    anchor = target;
  }
  // Put focus on an element and bring it just into view (scroll-padding keeps it clear of the bar).
  function land(el) { el.focus({preventScroll: true}); el.scrollIntoView({block: 'nearest'}); }
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
    const id = node.dataset.id, value = state.items[id], closed = ['done', 'dropped'].includes(value);
    if (closed) node.dataset.state = value; else delete node.dataset.state;
    const box = node.querySelector(':scope > .head .box, :scope > .box');
    box.setAttribute('aria-pressed', String(value === 'done'));
    const item = items.find(item => item.id === id);
    if (!item) return;
    // Act on real changes only, so a sync repaint never stops audio or folds what the reader opened.
    if (painted.has(id) && painted.get(id) !== value) {
      shown.delete(id);
      if (closed) for (const player of node.querySelectorAll('audio')) player.pause();
    }
    painted.set(id, value);
    box.setAttribute('aria-label', t('markDone', {title: item.title}) + (value === 'dropped' ? t('droppedLabel') : ''));
    const show = node.querySelector('.item-footer > .show'), open = shown.has(id);
    node.toggleAttribute('data-show', open);
    show.textContent = t(open ? 'hide' : 'show');
    show.setAttribute('aria-label', t(open ? 'hideLabel' : 'showLabel', {title: item.title}));
    show.setAttribute('aria-expanded', String(open));
  }
  // The drawer's summary names what is inside and shows what is filled: "Recall ✓ · Note · Quiz 3/4".
  function paintDrawer(item) {
    const card = cards.get(item.id), score = itemScore(item, state), mark = filled => filled ? ' ✓' : '';
    const parts = [t('recall') + mark(state.recall[item.id]?.trim()), t('note') + mark(state.notes[item.id]?.trim())];
    if (item.quizzes?.length) parts.push(score.answered ? t('quizToken', score) : t('quiz'));
    const summaryText = parts.join(' · '), target = card.querySelector('.summary-text');
    if (target.textContent !== summaryText) target.textContent = summaryText;
    const next = card.querySelector('.next1'), done = state.items[item.id] === 'done';
    next.textContent = t(done ? 'nextReading' : 'doneNext');
    next.setAttribute('aria-label', t(done ? 'nextReadingLabel' : 'doneNextLabel', {title: item.title}));
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
    const drawer = card.querySelector('.closeout'), headBox = card.querySelector('.head .box');
    // Finishing or skipping a reading compacts it; nothing opens by itself.
    function settle(next) { if (next) drawer.open = false; paintDrawer(item); renderProgress(); save(); }
    headBox.addEventListener('click', () => settle(toggle(card)));
    card.querySelector('.drop').addEventListener('click', () => { settle(toggle(card, true)); land(headBox); });
    card.querySelector('.item-footer > .show').addEventListener('click', () => {
      if (shown.has(item.id)) shown.delete(item.id); else shown.add(item.id);
      paintProgress(card);
    });
    card.querySelector('.close1').addEventListener('click', () => { drawer.open = false; land(drawer.querySelector('summary')); });
    card.querySelector('.next1').addEventListener('click', () => {
      if (state.items[item.id] !== 'done') { state.items[item.id] = 'done'; paintProgress(card); }
      settle(true);
      const target = nextAfter(card);
      // The card has just collapsed under the reader; jump rather than glide from a shifted position.
      if (target) goTo(cards.get(target.id), false); else land(card.querySelector('.head h3'));
    });
    for (const part of card.querySelectorAll('.subs > li')) {
      part.querySelector('.box').addEventListener('click', () => {
        toggle(part);
        const allDone = (item.parts || []).every(part => state.items[part.id] === 'done');
        if (allDone) state.items[item.id] = 'done'; else if (state.items[item.id] === 'done') delete state.items[item.id];
        if (allDone) drawer.open = false;
        paintProgress(card); paintDrawer(item); renderProgress(); save();
        if (allDone) land(card.querySelector('.head .box')); // the part's row is now hidden
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
    gate.append(element('span', '', t('recallGate')), ' ', skip);
    skip.addEventListener('click', () => { skipped.add(item.id); paintDrawer(item); body.querySelector('.opt')?.focus({preventScroll: true}); });
    const body = element('div', 'qbody'), painters = [];
    for (const question of quiz.questions) {
      const key = quizKey(quiz, question), row = element('div', 'q'), prompt = element('p', 'qtext', question.prompt);
      // Choices are announced with their question. IDs are slugs, so the slash keeps quiz/question pairs apart.
      prompt.id = `q/${quiz.id}/${question.id}`; row.setAttribute('role', 'group'); row.setAttribute('aria-labelledby', prompt.id);
      row.dataset.question = key; row.append(prompt);
      const buttons = question.choices.map(choice => {
        const option = button('opt', choice.text); option.dataset.choice = choice.id;
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
    }
    const reset = button('qreset', t('resetQuiz'));
    reset.addEventListener('click', () => {
      for (const question of quiz.questions) codec.clearAnswer(state, quizKey(quiz, question));
      save(); paintDrawer(item);
      (body.hidden ? skip : reset).focus({preventScroll: true}); // stay put; the gate may be back
    });
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) { saveNow(); saveView(); } });
  window.addEventListener('pagehide', () => { saveNow(); saveView(); });
  const jump = button('jump', t('nextShort'), t('nextLabel')); $('#hint').append(jump);
  jump.addEventListener('click', () => { const target = nextFromHere(); if (target) goTo(cards.get(target.id)); });

  // Contents: every section and reading with its state; opens from the count, jumps anywhere.
  const contents = $('#contents'), count = $('#count'), rows = new Map();
  let navigating = false; // closing to jump somewhere: the jump places focus, not the dialog
  function entry(text, time, target) {
    const go = button('toc'), mark = element('span', 'mark'), state = element('span', 'sr');
    mark.setAttribute('aria-hidden', 'true');
    go.append(mark, element('span', 'name', text), state);
    if (time) go.append(element('span', 'time', time));
    go.addEventListener('click', () => { navigating = true; contents.close(); goTo(target, false); });
    return go;
  }
  const top = element('ul'), topRow = element('li'); topRow.append(entry(t('top'), '', $('.wrap'))); top.append(topRow);
  $('#contentsList').append(top);
  for (const section of list.sections) {
    const heading = element('h3'), ul = element('ul');
    heading.append(entry(section.title, summarise(section.items, language), $(`#section-${section.id}`)));
    for (const item of section.items) {
      const li = element('li'), minutes = itemMinutes(item);
      li.append(entry(item.title, minutes === null ? '' : formatMinutes(minutes, language), cards.get(item.id)));
      rows.set(item.id, li); ul.append(li);
    }
    $('#contentsList').append(heading, ul);
  }
  function paintContents() {
    for (const [id, li] of rows) {
      const value = state.items[id], closed = ['done', 'dropped'].includes(value);
      if (closed) li.dataset.state = value; else delete li.dataset.state;
      li.querySelector('.mark').textContent = value === 'done' ? '✓' : value === 'dropped' ? '–' : '';
      li.querySelector('.sr').textContent = `, ${t(closed ? value : 'open')}`;
    }
  }
  count.addEventListener('click', () => {
    const at = currentCard(); // where the reader is, before the dialog takes focus
    for (const [id, li] of rows) { if (id === at?.dataset.id) li.firstChild.setAttribute('aria-current', 'true'); else li.firstChild.removeAttribute('aria-current'); }
    contents.showModal();
    const here = at && rows.get(at.dataset.id).firstChild;
    if (here) { here.focus(); here.scrollIntoView({block: 'center'}); }
  });
  $('#contentsClose').addEventListener('click', () => contents.close());
  contents.addEventListener('close', () => { if (!navigating) count.focus({preventScroll: true}); navigating = false; });

  function renderProgress() {
    const open = items.filter(unfinished);
    const countText = open.length ? t('left', {count: open.length}) : t('allDone');
    if (count.textContent !== countText) { count.textContent = $('#contentsCount').textContent = countText; count.setAttribute('aria-label', t('contentsLabel', {count: countText})); }
    jump.hidden = !open.length;
    paintContents();
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
    set: value => {
      state = codec.decode(value); persist(); paintAll();
      // A remote change can hide what the reader had focused (e.g. a reading marked done elsewhere).
      const active = document.activeElement;
      if (active && active !== document.body && !(active.checkVisibility ? active.checkVisibility() : active.offsetParent)) {
        active.closest('.item')?.querySelector('.head h3').focus({preventScroll: true});
      }
    },
    onChange: null
  };
  window.readerPage = page;
  paintAll();
  // Return to the reading the reader was at (this device only). The browser's own restoration
  // would race the asynchronous render, so the reader owns it; fonts and theme can shift layout
  // once more, so restore again then unless the reader has scrolled meanwhile.
  history.scrollRestoration = 'manual';
  const resume = !location.hash && view.at && cards.get(view.at);
  if (resume) {
    resume.scrollIntoView({block: 'start'});
    // A custom theme and web fonts can still change heights after the first paint.
    const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(done => addEventListener('load', done, {once: true}));
    Promise.all([loaded, document.fonts?.ready]).then(() => { if (!scrolledByReader) resume.scrollIntoView({block: 'start'}); });
  }
  function setBarHeight() { document.documentElement.style.setProperty('--bar-h', `${$('#bar').offsetHeight}px`); }
  setBarHeight(); new ResizeObserver(setBarHeight).observe($('#bar'));

  const handoff = $('#handoff'), text = $('#handoffText'); let snapshot = null;
  function openHandoff(trigger, id = null) {
    saveNow(); snapshot = {trigger, id, text: buildExport(list, state, id, language)}; text.value = snapshot.text;
    $('#handoffTitle').textContent = id ? t('handoff') : t('exportAll');
    $('#copyMsg').textContent = '';
    handoff.showModal(); $('#copyBtn').focus(); text.scrollTop = 0;
  }
  $('#copyBtn').addEventListener('click', async () => {
    const session = snapshot; let copied = true;
    try { await navigator.clipboard.writeText(session.text); } catch { copied = false; }
    if (snapshot !== session) return; // the dialog closed or moved on meanwhile
    if (!copied) { text.focus(); text.select(); }
    $('#copyMsg').textContent = t(copied ? 'copied' : 'copyFailed');
  });
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
