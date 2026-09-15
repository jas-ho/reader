import {translator} from './locale.js';

// Plain DOM construction: authored strings are text, never executable HTML.
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(className, text, label) {
  const node = element('button', className, text); node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}
function renderLinks(links = []) {
  const ul = element('ul', 'source-links');
  for (const link of links) {
    const li = element('li'), a = element('a', '', link.label);
    a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    li.append(a); ul.append(li);
  }
  return ul;
}
function field(item, className, label, prompt) {
  const wrap = element('div', 'field'), lab = element('label', '', label), input = element('textarea', className);
  input.id = `${className}-${item.id}`; input.rows = 3; input.placeholder = prompt;
  lab.htmlFor = input.id; wrap.append(lab, input); return wrap;
}
function renderAudio(recordings, t, ownerId) {
  const group = element('div', 'audio-options');
  recordings.forEach((recording, index) => {
    const entry = element('div', 'audio-option'), toolbar = element('div', 'audio-toolbar');
    const source = element('div', 'audio-source'); source.hidden = true;
    source.id = `audio-source-${ownerId}-${index}`;
    const link = element('a', '', recording.label);
    link.href = recording.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    source.append(link);
    if (recording.details) source.append(element('p', 'prose', recording.details));
    const disclosure = button('audio-details', '', t('audioDetailsLabel', {title: recording.label}));
    const arrow = element('span', 'chevron', '›'); arrow.setAttribute('aria-hidden', 'true');
    disclosure.append(element('span', '', t('audioDetails')), arrow);
    disclosure.setAttribute('aria-controls', source.id);
    function showDetails(open) { source.hidden = !open; disclosure.setAttribute('aria-expanded', String(open)); }
    showDetails(false);
    disclosure.addEventListener('click', () => showDetails(source.hidden));
    const caption = t('playAudio') + (recording.duration ? ` · ${recording.duration}` : '');
    const description = element('p', 'audio-description prose', recording.description);
    entry.append(toolbar, description);
    if (recording.warning) entry.append(element('p', 'audio-warning prose', recording.warning));
    if (recording.src) {
      const start = button('audio-start', '', `${caption}: ${recording.label}`);
      const glyph = element('span', '', '▶'); glyph.setAttribute('aria-hidden', 'true');
      start.append(glyph, element('span', '', caption));
      const player = element('audio'), status = element('p', 'audio-status');
      player.controls = true; player.preload = 'none'; player.hidden = true; player.tabIndex = 0;
      player.setAttribute('aria-label', recording.label);
      status.setAttribute('role', 'status');
      const failed = () => {
        status.textContent = t('audioFailed'); showDetails(true);
        start.textContent = t('retryAudio'); start.hidden = false;
        start.setAttribute('aria-label', `${t('retryAudio')}: ${recording.label}`);
        if (document.activeElement === player) start.focus();
        player.hidden = true;
      };
      player.addEventListener('error', failed);
      player.addEventListener('playing', () => { status.textContent = ''; });
      player.addEventListener('play', () => {
        for (const other of document.querySelectorAll('.audio-option audio')) if (other !== player) other.pause();
      });
      start.addEventListener('click', () => {
        // No media URL reaches the browser's loader until the reader asks to play.
        status.textContent = '';
        player.src = recording.src; player.hidden = false; start.hidden = true;
        player.play().catch(error => { if (error.name !== 'AbortError') failed(); });
        player.focus();
      });
      toolbar.append(start, player, disclosure);
      entry.append(status);
    } else {
      const listen = element('a', 'audio-link', caption + ' ↗');
      listen.href = recording.url; listen.target = '_blank'; listen.rel = 'noopener noreferrer';
      listen.setAttribute('aria-label', `${caption}: ${recording.label}`);
      toolbar.append(listen, disclosure);
    }
    entry.append(source); group.append(entry);
  });
  return group;
}
export function renderItem(item, list, language = 'en') {
  const t = translator(language);
  const article = element('article', 'item'); article.dataset.id = item.id;
  const head = element('div', 'head'), heading = element('div', 'heading'), title = element('h3', '', item.title);
  heading.append(title);
  if (item.byline || item.effort?.length) {
    const metadata = element('div', 'metadata');
    if (item.byline) metadata.append(element('span', 'src', item.byline));
    for (const text of item.effort || []) metadata.append(element('span', 'effort', text));
    heading.append(metadata);
  }
  head.append(button('box', '✓', t('markDone', {title: item.title})), heading);
  const body = element('div', 'body');
  if (item.why) body.append(element('p', 'why prose', item.why));
  if (item.description) body.append(element('p', 'what prose', item.description));
  if (item.links?.length) body.append(renderLinks(item.links));
  if (item.audio?.length) body.append(renderAudio(item.audio, t, item.id));
  if (item.parts?.length) {
    const ul = element('ul', 'subs');
    for (const part of item.parts) {
      const li = element('li'); li.dataset.id = part.id;
      const text = element('div', 'txt'); text.append(element('span', '', part.title));
      if (part.description) text.append(element('p', 'prose', part.description));
      if (part.links?.length) text.append(renderLinks(part.links));
      if (part.audio?.length) text.append(renderAudio(part.audio, t, part.id));
      li.append(button('box', '✓', t('markDone', {title: part.title})), text); ul.append(li);
    }
    body.append(ul);
  }
  const footer = element('div', 'item-footer');
  const drawer = element('details', 'closeout'), summary = element('summary');
  const chevron = element('span', 'chevron', '›'); chevron.setAttribute('aria-hidden', 'true');
  const summaryText = element('span', 'summary-text');
  summaryText.append(element('span', '', t(item.quizzes?.length ? 'recallNoteQuiz' : 'recallAndNote')), element('span', 'sumtxt'));
  summary.append(chevron, summaryText);
  const tools = element('div', 'tools'); tools.append(button('copy1', t('handoff')));
  drawer.append(summary,
    field(item, 'recall', t('recall'), list.recallPrompt || t('recallPrompt')),
    field(item, 'notetext', t('note'), list.notePrompt || t('notePrompt')),
    element('div', 'qslot'), tools);
  footer.append(drawer, button('drop', t('drop')));
  article.append(head, body, footer);
  return article;
}
export function renderList(list, language = 'en') {
  document.title = list.title;
  document.querySelector('meta[name="description"]').content = list.description || list.title;
  document.querySelector('h1').textContent = list.title;
  document.getElementById('description').textContent = list.description || '';
  const main = document.getElementById('readings'); main.replaceChildren();
  for (const section of list.sections) {
    const bucket = element('section', 'bucket'); bucket.id = `section-${section.id}`;
    bucket.append(element('h2', '', section.title));
    if (section.description) bucket.append(element('p', 'why-bucket prose', section.description));
    for (const item of section.items) bucket.append(renderItem(item, list, language));
    main.append(bucket);
  }
  document.getElementById('curator-footer').textContent = list.footer || '';
}
