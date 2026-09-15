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
export function renderItem(item, list, language = 'en') {
  const t = translator(language);
  const article = element('article', 'item'); article.dataset.id = item.id;
  const head = element('div', 'head'), title = element('h3', '', item.title);
  if (item.byline) title.append(element('span', 'src', item.byline));
  head.append(button('box', '✓', t('markDone', {title: item.title})), title);
  const body = element('div', 'body');
  if (item.description) body.append(element('p', 'what prose', item.description));
  if (item.links?.length) body.append(renderLinks(item.links));
  if (item.why) {
    const why = element('div', 'why'); why.append(element('span', 'lab', t('why')), element('div', 'prose', item.why)); body.append(why);
  }
  if (item.effort?.length) {
    const effort = element('div', 'effort');
    for (const text of item.effort) effort.append(element('span', '', text));
    body.append(effort);
  }
  if (item.parts?.length) {
    const ul = element('ul', 'subs');
    for (const part of item.parts) {
      const li = element('li'); li.dataset.id = part.id;
      const text = element('div', 'txt'); text.append(element('span', '', part.title));
      if (part.description) text.append(element('p', 'prose', part.description));
      if (part.links?.length) text.append(renderLinks(part.links));
      li.append(button('box', '✓', t('markDone', {title: part.title})), text); ul.append(li);
    }
    body.append(ul);
  }
  body.append(button('drop', t('drop')));
  const drawer = element('details', 'closeout'), summary = element('summary');
  summary.append(element('span', '', t('recallAndNote')), element('span', 'sumtxt'));
  const tools = element('div', 'tools'); tools.append(button('copy1', t('handoff')));
  drawer.append(summary,
    field(item, 'recall', t('recall'), list.recallPrompt || t('recallPrompt')),
    field(item, 'notetext', t('note'), list.notePrompt || t('notePrompt')),
    element('div', 'qslot'), tools);
  article.append(head, body, drawer);
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
