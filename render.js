import {translator, formatMinutes} from './locale.js';
import {allItems, itemMinutes, totalMinutes} from './content.js';

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
function renderLinks(links = [], className = 'source-links') {
  const ul = element('ul', className);
  for (const link of links) {
    const li = element('li'), a = element('a', '', link.label);
    a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    li.append(a);
    if (link.jumps?.length) li.append(renderLinks(link.jumps, 'jumps')); // places inside this source
    ul.append(li);
  }
  return ul;
}
function field(item, className, label, prompt) {
  const wrap = element('div', 'field'), lab = element('label', '', label), input = element('textarea', className);
  input.id = `${className}/${item.id}`; input.rows = 2; input.placeholder = prompt; // IDs are slugs: the slash keeps namespaces apart
  lab.htmlFor = input.id; wrap.append(lab, input); return wrap;
}
function renderAudio(recordings, t, ownerId) {
  const group = element('div', 'audio-options');
  recordings.forEach((recording, index) => {
    const entry = element('div', 'audio-option'), toolbar = element('div', 'audio-toolbar');
    const source = element('div', 'audio-source'); source.hidden = true;
    source.id = `audio/${ownerId}/${index}`;
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
  title.tabIndex = -1; // where navigation lands: reading context, not the progress toggle
  heading.append(title);
  // One line: priority · byline · time · free-text effort.
  const minutes = itemMinutes(item), metadata = element('div', 'metadata');
  if (item.priority) metadata.append(element('span', `priority priority-${item.priority}`, t(item.priority)));
  if (item.byline) metadata.append(element('span', 'src', item.byline));
  if (minutes !== null) metadata.append(element('span', 'minutes', formatMinutes(minutes, language)));
  for (const text of item.effort || []) metadata.append(element('span', 'effort', text));
  if (metadata.childElementCount) heading.append(metadata);
  head.append(button('box', '✓', t('markDone', {title: item.title})), heading);
  const body = element('div', 'body'); body.id = `body/${item.id}`;
  // The instruction first; the curator's reason after it, quieter.
  if (item.description) body.append(element('p', 'what prose', item.description));
  if (item.why) body.append(element('p', 'why prose', item.why));
  if (item.links?.length) body.append(renderLinks(item.links));
  if (item.audio?.length) body.append(renderAudio(item.audio, t, item.id));
  if (item.parts?.length) {
    const ul = element('ul', 'subs');
    for (const part of item.parts) {
      const li = element('li'); li.dataset.id = part.id;
      const text = element('div', 'txt'); text.append(element('span', '', part.title));
      if (part.minutes !== undefined) text.append(element('span', 'minutes', ` · ${formatMinutes(part.minutes, language)}`));
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
  summary.append(chevron, element('span', 'summary-text')); // "Recall ✓ · Note · Quiz 3/4", painted by the reader
  // The drawer ends where the reader ends up: take it to a chatbot, close it, or finish and move on.
  const exits = element('div', 'exits'), copy = button('copy1', '', t('handoff'));
  copy.title = t('handoff'); copy.append(clipboard());
  exits.append(copy, button('close1', t('close'), t('closeLabel', {title: item.title})), button('next1'));
  drawer.append(summary,
    field(item, 'recall', t('recall'), list.recallPrompt || t('recallPrompt')),
    field(item, 'notetext', t('note'), list.notePrompt || t('notePrompt')),
    element('div', 'qslot'), exits);
  // Skip and Show share one slot: Skip while the reading is open, Show once it is done or skipped.
  const show = button('show'); show.setAttribute('aria-controls', body.id); show.setAttribute('aria-expanded', 'false');
  footer.append(drawer, button('drop', t('drop')), show);
  article.append(head, body, footer);
  return article;
}
function clipboard() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  for (const d of ['M9 3h6v4H9z', 'M15 5h3v16H6V5h3']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
// "34 readings · ~6 h · essential ~4 h": counts and times are computed, never authored.
export function summarise(items, language = 'en', withEssential = false) {
  const t = translator(language), minutes = totalMinutes(items), parts = [t('readings', {count: items.length})];
  if (minutes !== null) parts.push(formatMinutes(minutes, language));
  const essential = items.filter(item => item.priority === 'essential'), essentialMinutes = totalMinutes(essential);
  if (withEssential && essentialMinutes !== null && essential.length && essential.length < items.length) parts.push(t('essentialTime', {time: formatMinutes(essentialMinutes, language)}));
  return parts.join(' · ');
}
export function renderList(list, language = 'en') {
  document.title = list.title;
  document.querySelector('meta[name="description"]').content = list.description || list.title;
  const h1 = document.querySelector('h1'); h1.textContent = list.title; h1.tabIndex = -1;
  document.getElementById('description').textContent = list.description || '';
  document.getElementById('counts').textContent = summarise(allItems(list), language, true);
  const main = document.getElementById('readings'); main.replaceChildren();
  for (const section of list.sections) {
    const bucket = element('section', 'bucket'), h2 = element('h2', '', section.title); bucket.id = `section-${section.id}`;
    h2.tabIndex = -1; bucket.append(h2, element('p', 'counts', summarise(section.items, language)));
    if (section.description) bucket.append(element('p', 'why-bucket prose', section.description));
    for (const item of section.items) bucket.append(renderItem(item, list, language));
    main.append(bucket);
  }
  document.getElementById('curator-footer').textContent = list.footer || '';
}
