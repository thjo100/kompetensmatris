'use strict';

/*
 * Kompetensmatris – all logik i webbläsaren.
 * Ingen byggsteg och inga ramverk: data hämtas från /api/data och hela trädet ritas om vid varje ändring.
 */

// ---------- Lagring i webbläsaren (bara bekvämligheter, t.ex. vilka grenar som är utfällda) ----------

const local = {
  get(key, fallback) {
    try { const v = localStorage.getItem('km.' + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('km.' + key, JSON.stringify(value)); } catch { /* t.ex. privat läge */ }
  },
};

function loadPassword() {
  try { return sessionStorage.getItem('km.pw'); } catch { return null; }
}
function setPassword(value) {
  state.password = value || null;
  try { value ? sessionStorage.setItem('km.pw', value) : sessionStorage.removeItem('km.pw'); } catch { /* ignorera */ }
}

// ---------- Tillstånd ----------

const state = {
  nodes: [],
  courses: [],
  byId: new Map(),
  kids: new Map(),
  treeId: null,
  toggled: new Set(local.get('toggled', [])), // noder vars utfällning skiljer sig från standard
  forced: new Set(), // noder som hålls utfällda av sökningen
  matches: [],
  matchIndex: -1,
  search: '',
  zoom: local.get('zoom', 1),
  password: loadPassword(),
  addingTo: null, // id för noden som just nu får ett nytt underområde
  busy: false,
};

const isAdmin = () => !!state.password;

/** Funktioner som kan stängas av där de inte fungerar (t.ex. i en inbäddad demo). */
const features = { calendar: true };
const $ = (id) => document.getElementById(id);
const el = {
  tree: $('tree'),
  canvas: $('canvas'),
  modal: $('modal'),
  toast: $('toast'),
  courseBar: $('courseBar'),
  treeSelect: $('treeSelect'),
  search: $('search'),
  searchInfo: $('searchInfo'),
  loginBtn: $('loginBtn'),
  adminTools: $('adminTools'),
  adminHint: $('adminHint'),
  zoomReset: $('zoomReset'),
  importFile: $('importFile'),
};

// ---------- Små hjälpfunktioner ----------

/** Skapar ett element: h('button', { class: 'x', onclick: fn }, 'Text', annatElement) */
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  let value;
  if (tag === 'button') node.type = 'button';
  for (const [key, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (key === 'value') value = v;
    else if (key === 'class') node.className = v;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), v);
    else if (key in node && typeof v !== 'string') node[key] = v;
    else node.setAttribute(key, v === true ? '' : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  if (value !== undefined) node.value = value;
  return node;
}

let fieldCounter = 0;
function field(label, input, hint) {
  input.id ||= 'f' + ++fieldCounter;
  return h('div', { class: 'field' },
    h('label', { for: input.id }, label),
    input,
    hint ? h('div', { class: 'hint' }, hint) : null);
}

const section = (title) => h('h3', { class: 'section-title' }, title);
const safeUrl = (url) => (/^(https?:|mailto:)/i.test(url || '') ? url : '#');
const prioBadge = (p) => (p ? h('span', { class: `prio prio-${p}`, title: `Prioritet ${p}` }, p) : null);

let toastTimer;
function toast(message, error = false) {
  el.toast.textContent = message;
  el.toast.className = 'toast' + (error ? ' error' : '');
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), error ? 6000 : 2500);
}

function download(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- API ----------

async function api(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.password) headers['X-Admin-Password'] = state.password;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && url !== '/api/login') {
    setPassword(null);
    render();
    throw new Error('Du är inte inloggad längre. Logga in igen.');
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try { message = (await res.json()).error || message; } catch { /* inget JSON-svar */ }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

async function reload() {
  const data = await api('GET', '/api/data');
  state.nodes = data.nodes || [];
  state.courses = data.courses || [];
  buildIndex();
  render();
}

function buildIndex() {
  state.byId = new Map(state.nodes.map((n) => [n.id, n]));
  state.kids = new Map();
  for (const n of state.nodes) {
    const key = n.parentId ?? '';
    if (!state.kids.has(key)) state.kids.set(key, []);
    state.kids.get(key).push(n);
  }
  const roots = kidsOf(null);
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (roots.some((r) => r.id === fromHash)) state.treeId = fromHash;
  else if (!roots.some((r) => r.id === state.treeId)) state.treeId = roots[0]?.id ?? null;
}

// ---------- Trädnavigering ----------

const kidsOf = (id) => state.kids.get(id ?? '') || [];

function ancestors(id) {
  const list = [];
  let n = state.byId.get(id);
  while (n?.parentId) {
    n = state.byId.get(n.parentId);
    if (n) list.unshift(n);
  }
  return list;
}

function subtree(id) {
  const out = [];
  const walk = (parentId) => kidsOf(parentId).forEach((c) => { out.push(c); walk(c.id); });
  walk(id);
  return out;
}

const rootOf = (id) => ancestors(id)[0] || state.byId.get(id);
const pathText = (id) => [...ancestors(id).slice(1), state.byId.get(id)].map((n) => n.title).join(' › ');

/** Standard: kategorierna (nivå 1) är utfällda, allt under dem är ihopfällt. */
function isOpen(n, depth) {
  if (depth === 0 || state.forced.has(n.id)) return true;
  const byDefault = depth <= 1;
  return state.toggled.has(n.id) ? !byDefault : byDefault;
}

function setOpen(n, depth, open) {
  const byDefault = depth <= 1;
  if (open === byDefault) state.toggled.delete(n.id);
  else state.toggled.add(n.id);
  if (!open) state.forced.delete(n.id);
  local.set('toggled', [...state.toggled]);
}

// ---------- Kurser ----------

function courseEnd(c) {
  if (c.end) return new Date(c.end);
  const d = new Date(c.start);
  d.setHours(23, 59, 59, 999);
  return d;
}

function courseStatus(c, now = new Date()) {
  if (now < new Date(c.start)) return 'upcoming';
  return now <= courseEnd(c) ? 'live' : 'past';
}

const byStart = (a, b) => new Date(a.start) - new Date(b.start);

/** Pågående och kommande kurser för de angivna noderna, i tidsordning. */
function activeCourses(nodeIds) {
  const ids = new Set(nodeIds);
  return state.courses.filter((c) => ids.has(c.nodeId) && courseStatus(c) !== 'past').sort(byStart);
}

const fmtDay = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDate = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' });
const fmtTime = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();

function formatWhen(c) {
  const s = new Date(c.start);
  const e = c.end ? new Date(c.end) : null;
  let text = `${fmtDay.format(s)} ${fmtTime.format(s)}`;
  if (e) text += sameDay(s, e) ? `–${fmtTime.format(e)}` : ` – ${fmtDay.format(e)} ${fmtTime.format(e)}`;
  if (s.getFullYear() !== new Date().getFullYear()) text += ` ${s.getFullYear()}`;
  return text;
}

function shortWhen(c) {
  if (courseStatus(c) === 'live') return 'Pågår nu';
  const s = new Date(c.start);
  if (sameDay(s, new Date())) return `Idag ${fmtTime.format(s)}`;
  return `${fmtDate.format(s)} ${fmtTime.format(s)}`;
}

function downloadIcs(c) {
  const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const end = c.end || new Date(new Date(c.start).getTime() + 3600e3).toISOString();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kompetensmatris//SV', 'BEGIN:VEVENT',
    `UID:${c.id}@kompetensmatris`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(c.start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(c.title)}`,
    `DESCRIPTION:${esc([c.description, c.teacher && 'Kursledare: ' + c.teacher, c.url].filter(Boolean).join('\n\n'))}`,
    c.url ? `LOCATION:${esc(c.url)}` : null,
    c.url ? `URL:${c.url}` : null,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  download(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), 'kurs.ics');
}

// ---------- Rita trädet ----------

function render() {
  document.body.classList.toggle('admin', isAdmin());
  renderTopbar();
  computeSearch();
  renderCourseBar();

  el.tree.style.zoom = state.zoom;
  el.zoomReset.textContent = Math.round(state.zoom * 100) + '%';

  const root = state.byId.get(state.treeId);
  if (!root) {
    el.tree.replaceChildren(h('div', { class: 'empty' },
      h('p', {}, 'Det finns inget träd ännu.'),
      isAdmin()
        ? h('button', { class: 'primary', onclick: newTree }, '+ Skapa ett träd')
        : h('p', {}, 'Logga in som admin för att skapa ett.')));
    return;
  }

  const cats = kidsOf(root.id);
  const adding = state.addingTo === root.id;
  const rootRow = h('div', { class: 'root-row' + (cats.length || adding ? ' has-kids' : '') }, nodeBox(root, 0));
  const ul = h('ul', { class: 'cats' },
    h('li', { class: 'bar', 'aria-hidden': 'true' }),
    cats.map((c) => h('li', { class: 'cat' }, nodeBox(c, 1), stem(c, 1), childList(c, 1))),
    adding ? h('li', { class: 'cat adding' }, h('div', { class: 'add-row' }, addInput(root.id))) : null);

  el.tree.replaceChildren(rootRow, ul);
  drawBar(rootRow, ul);
}

/** Den vågräta linjen mellan kategorierna. Mäts i procent så att den fungerar med zoom. */
function drawBar(rootRow, ul) {
  const bar = ul.querySelector('.bar');
  const heads = [...ul.querySelectorAll(':scope > .cat > .box'), rootRow.querySelector('.box')];
  const u = ul.getBoundingClientRect();
  if (heads.length < 2 || !u.width) { bar.hidden = true; return; }
  const xs = heads.map((e) => {
    const r = e.getBoundingClientRect();
    return ((r.left + r.width / 2 - u.left) / u.width) * 100;
  });
  const left = Math.min(...xs);
  bar.style.left = left + '%';
  bar.style.width = Math.max(...xs) - left + '%';
}

function nodeBox(n, depth) {
  const own = activeCourses([n.id]);
  const hidden = isOpen(n, depth) ? [] : activeCourses(subtree(n.id).map((x) => x.id));
  const live = own.some((c) => courseStatus(c) === 'live');
  const hasInfo = n.description || n.links?.length;
  const classes = [
    'box',
    depth === 0 ? 'root' : depth === 1 ? 'cat-box' : '',
    state.matches.includes(n.id) ? 'match' : '',
    own.length ? (live ? 'has-live' : 'has-course') : '',
  ];
  return h('div', { class: classes.filter(Boolean).join(' '), 'data-id': n.id },
    prioBadge(n.priority),
    h('button', { class: 'title' + (hasInfo ? ' has-info' : ''), title: 'Visa detaljer', onclick: () => showNode(n.id) }, n.title),
    own.length ? courseBadge(own, false) : null,
    hidden.length ? courseBadge(hidden, true) : null,
    isAdmin() ? adminActions(n, depth) : null);
}

function courseBadge(list, inSubAreas) {
  const live = list.some((c) => courseStatus(c) === 'live');
  let label;
  let title;
  if (inSubAreas) {
    // Visas på ihopfällda rutor när en kurs finns längre ned i grenen.
    label = (live ? 'Pågår nu' : list.length === 1 ? shortWhen(list[0]) : `${list.length} kurser`) + ' ↓';
    title = `${list.length} ${list.length === 1 ? 'kurs' : 'kurser'} i underområden – klicka för att se`;
  } else {
    label = shortWhen(list[0]) + (list.length > 1 ? ` +${list.length - 1}` : '');
    title = list.map((c) => `${c.title} (${formatWhen(c)})`).join('\n') + '\nKlicka för att se kursen';
  }
  return h('button', {
    class: 'course-badge' + (live ? ' live' : '') + (inSubAreas ? ' sub' : ''),
    title,
    onclick: () => showCourses(list),
  }, live ? h('span', { class: 'dot' }) : '🎓', label);
}

/** Knappen under en ruta: visar antal underområden (ihopfälld) eller − (utfälld). */
function stem(n, depth) {
  const count = kidsOf(n.id).length;
  const adding = state.addingTo === n.id;
  if (!count && !adding) return null;
  const open = isOpen(n, depth) || adding;
  return h('div', { class: 'stem' + (open ? ' open' : '') },
    count
      ? h('button', {
        class: 'toggle',
        title: open ? 'Fäll ihop' : `Visa ${count} underområden`,
        'aria-expanded': String(open),
        onclick: () => { setOpen(n, depth, !open); render(); },
      }, open ? '−' : count)
      : h('span', { class: 'toggle' }, '−'));
}

function childList(n, depth) {
  const adding = state.addingTo === n.id;
  if (!isOpen(n, depth) && !adding) return null;
  const kids = kidsOf(n.id);
  if (!kids.length && !adding) return null;
  return h('ul', { class: 'children' },
    kids.map((c) => h('li', {}, nodeBox(c, depth + 1), stem(c, depth + 1), childList(c, depth + 1))),
    adding ? h('li', { class: 'add-row' }, addInput(n.id)) : null);
}

function adminActions(n, depth) {
  const siblings = kidsOf(n.parentId);
  const i = siblings.indexOf(n);
  const vertical = depth >= 2; // kategorierna ligger bredvid varandra, resten under varandra
  return h('span', { class: 'actions' },
    h('button', { title: 'Lägg till underområde', onclick: () => startAdding(n, depth) }, '+'),
    h('button', { title: 'Redigera', onclick: () => editNode(n.id) }, '✎'),
    depth > 0 && i > 0
      ? h('button', { title: vertical ? 'Flytta upp' : 'Flytta vänster', onclick: () => moveNode(n, i - 1) }, vertical ? '↑' : '←')
      : null,
    depth > 0 && i < siblings.length - 1
      ? h('button', { title: vertical ? 'Flytta ned' : 'Flytta höger', onclick: () => moveNode(n, i + 1) }, vertical ? '↓' : '→')
      : null,
    h('button', { title: depth === 0 ? 'Ta bort hela trädet' : 'Ta bort', onclick: () => removeNode(n) }, '🗑'));
}

// ---------- Sök ----------

function computeSearch() {
  state.forced = new Set();
  state.matches = [];
  const q = state.search.trim().toLowerCase();
  if (q && state.treeId) {
    for (const n of subtree(state.treeId)) {
      if (n.title.toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q)) {
        state.matches.push(n.id);
        ancestors(n.id).forEach((a) => state.forced.add(a.id));
      }
    }
  }
  el.searchInfo.textContent = q ? (state.matches.length ? `${state.matches.length} träffar` : 'Inga träffar') : '';
}

function scrollToBox(id, flash = true) {
  const box = el.tree.querySelector(`.box[data-id="${CSS.escape(id)}"]`);
  if (!box) return;
  box.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  if (flash) {
    box.classList.add('flash');
    setTimeout(() => box.classList.remove('flash'), 3400);
  }
}

/** Visa en nod i trädet: byt träd vid behov, fäll ut föräldrarna och blinka rutan. */
function reveal(id) {
  const root = rootOf(id);
  if (root && root.id !== state.treeId) {
    state.treeId = root.id;
    history.replaceState(null, '', '#' + root.id);
  }
  ancestors(id).forEach((a, depth) => setOpen(a, depth, true));
  closeDialog();
  render();
  scrollToBox(id);
}

// ---------- Toppfält och kursremsa ----------

function renderTopbar() {
  const roots = kidsOf(null);
  el.treeSelect.hidden = roots.length < 2;
  el.treeSelect.replaceChildren(...roots.map((r) => h('option', { value: r.id }, r.title)));
  el.treeSelect.value = state.treeId || '';
  el.loginBtn.textContent = isAdmin() ? 'Logga ut' : 'Logga in';
  el.loginBtn.classList.toggle('primary', !isAdmin());
  el.adminTools.hidden = !isAdmin();
  el.adminHint.hidden = !isAdmin();
  const root = state.byId.get(state.treeId);
  document.title = root ? `${root.title} – Kompetensmatris` : 'Kompetensmatris';
}

function renderCourseBar() {
  const list = state.treeId ? activeCourses([state.treeId, ...subtree(state.treeId).map((n) => n.id)]) : [];
  el.courseBar.hidden = !list.length;
  if (!list.length) return el.courseBar.replaceChildren();
  const max = 5;
  const chips = list.slice(0, max).map((c) => {
    const live = courseStatus(c) === 'live';
    return h('button', { class: 'course-chip' + (live ? ' live' : ''), onclick: () => showCourses([c]) },
      h('span', { class: 'when' }, shortWhen(c)),
      c.title,
      h('span', { class: 'muted' }, '· ' + (state.byId.get(c.nodeId)?.title ?? '')));
  });
  if (list.length > max) {
    chips.push(h('button', { onclick: () => showCourses(list, 'Alla kommande kurser') }, `Visa alla (${list.length})`));
  }
  el.courseBar.replaceChildren(h('span', { class: 'label' }, '🎓 Kurser'), ...chips);
}

// ---------- Dialoger ----------

function openDialog({ title, body, buttons }) {
  delete el.modal.dataset.node; // sätts av showNode så att rutan kan ritas om när datan ändras
  el.modal.replaceChildren(
    h('div', { class: 'dlg-head' },
      h('h2', {}, title),
      h('button', { class: 'icon', 'aria-label': 'Stäng', title: 'Stäng', onclick: closeDialog }, '✕')),
    h('div', { class: 'dlg-body' }, body),
    h('div', { class: 'dlg-foot' }, buttons));
  if (!el.modal.open) el.modal.showModal();
  const first = el.modal.querySelector('.dlg-body input, .dlg-body textarea, .dlg-body select');
  (first || el.modal.querySelector('.dlg-foot .primary'))?.focus();
}

function closeDialog() {
  if (el.modal.open) el.modal.close();
}

/** Bekräftelse i sidans egen dialog. Svarar true om användaren väljer OK. */
function ask(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value) => {
      if (answered) return;
      answered = true;
      el.modal.removeEventListener('close', onClose);
      closeDialog();
      resolve(value);
    };
    const onClose = () => answer(false);
    openDialog({
      title: 'Bekräfta',
      body: h('p', { class: 'description' }, message),
      buttons: [
        h('button', { onclick: () => answer(false) }, 'Avbryt'),
        h('button', { class: 'primary' + (danger ? ' danger-fill' : ''), onclick: () => answer(true) }, okLabel),
      ],
    });
    el.modal.addEventListener('close', onClose);
  });
}

function courseCard(c, showArea = true) {
  const status = courseStatus(c);
  const area = state.byId.get(c.nodeId);
  const isTeams = /teams\.(microsoft|live)\.com/i.test(c.url || '');
  return h('article', { class: `course-card ${status}` },
    h('span', { class: `status ${status}` }, { live: 'Pågår nu', upcoming: 'Kommande', past: 'Genomförd' }[status]),
    h('h3', {}, c.title),
    h('div', { class: 'meta' },
      h('span', {}, '📅 ', formatWhen(c)),
      c.teacher ? h('span', {}, '👤 ', c.teacher) : null,
      showArea && area
        ? h('span', {}, '📍 ', h('a', { href: '#', title: 'Visa i trädet', onclick: (e) => { e.preventDefault(); reveal(area.id); } }, pathText(area.id)))
        : null),
    c.description ? h('p', { class: 'description' }, c.description) : null,
    h('div', { class: 'actions-row' },
      c.url
        ? h('a', { class: 'button' + (status === 'past' ? '' : ' primary'), href: safeUrl(c.url), target: '_blank', rel: 'noopener' },
          status === 'past' ? 'Öppna länk' : isTeams ? 'Anslut i Teams' : 'Öppna möteslänk')
        : null,
      features.calendar && status !== 'past' ? h('button', { onclick: () => downloadIcs(c) }, 'Lägg till i kalender') : null,
      isAdmin() ? h('button', { onclick: () => editCourse(c.id) }, 'Redigera kurs') : null));
}

function showCourses(list, title) {
  openDialog({
    title: title || (list.length === 1 ? 'Kurs' : 'Kurser'),
    body: list.map((c) => courseCard(c)),
    buttons: [h('button', { class: 'primary', onclick: closeDialog }, 'Stäng')],
  });
}

function showNode(id) {
  const n = state.byId.get(id);
  if (!n) return;
  const path = ancestors(id);
  const kids = kidsOf(id);
  const own = state.courses.filter((c) => c.nodeId === id).sort(byStart);
  const ownActive = own.filter((c) => courseStatus(c) !== 'past');
  const ownPast = own.filter((c) => courseStatus(c) === 'past').reverse();
  const inSub = activeCourses(subtree(id).map((x) => x.id));
  const empty = !n.description && !n.links?.length && !own.length && !inSub.length && !kids.length;

  openDialog({
    title: [prioBadge(n.priority), ' ', n.title],
    body: [
      path.length ? h('div', { class: 'breadcrumb' }, path.map((p) => p.title).join(' › ')) : null,
      n.description ? h('p', { class: 'description' }, n.description) : null,
      n.links?.length
        ? [section('Länkar'), h('ul', { class: 'link-list' },
          n.links.map((l) => h('li', {}, h('a', { href: safeUrl(l.url), target: '_blank', rel: 'noopener' }, l.title || l.url))))]
        : null,
      ownActive.length ? [section('Kurser'), ownActive.map((c) => courseCard(c, false))] : null,
      inSub.length ? [section('Kurser i underområden'), inSub.map((c) => courseCard(c))] : null,
      ownPast.length
        ? h('details', {}, h('summary', {}, `Tidigare kurser (${ownPast.length})`), ownPast.map((c) => courseCard(c, false)))
        : null,
      kids.length
        ? [section('Underområden'), h('div', { class: 'chips' },
          kids.map((k) => h('button', { onclick: () => showNode(k.id) }, prioBadge(k.priority), ' ', k.title)))]
        : null,
      empty ? h('p', { class: 'muted' }, 'Ingen beskrivning ännu.') : null,
    ],
    buttons: [
      isAdmin() ? h('button', { class: 'left', onclick: () => editNode(id) }, '✎ Redigera område') : null,
      isAdmin() ? h('button', { onclick: () => editCourse(null, id) }, '+ Lägg till kurs') : null,
      h('button', { onclick: () => reveal(id) }, 'Visa i trädet'),
      h('button', { class: 'primary', onclick: closeDialog }, 'Stäng'),
    ],
  });
  el.modal.dataset.node = id;
}

function showLogin() {
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const form = h('form', {
    id: 'loginForm',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/login', { password: password.value });
        setPassword(password.value);
        closeDialog();
        render();
        toast('Du är inloggad som admin.');
      } catch {
        toast('Fel lösenord.', true);
        password.select();
      }
    },
  }, field('Lösenord', password, 'Samma lösenord för alla administratörer. Det sätts med ADMIN_PASSWORD när applikationen startas.'));
  openDialog({
    title: 'Logga in som admin',
    body: form,
    buttons: [
      h('button', { onclick: closeDialog }, 'Avbryt'),
      h('button', { class: 'primary', type: 'submit', form: 'loginForm' }, 'Logga in'),
    ],
  });
}

// ---------- Admin: områden ----------

function startAdding(n, depth) {
  state.addingTo = n.id;
  if (depth > 0) setOpen(n, depth, true);
  render();
  focusAddInput();
}

function focusAddInput() {
  const input = el.tree.querySelector('.add-row input');
  if (!input) return;
  input.focus();
  input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function stopAdding() {
  state.addingTo = null;
  render();
}

function addInput(parentId) {
  const input = h('input', {
    type: 'text',
    maxlength: 200,
    placeholder: 'Namn + Enter (Esc avbryter)',
    title: 'Skriv ett namn och tryck Enter. Klistra in en lista med flera rader (indrag = underområden) för att skapa många på en gång.',
    'aria-label': 'Namn på nytt område',
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') return stopAdding();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    state.busy = true;
    try {
      await api('POST', '/api/nodes', { parentId, title: input.value });
      input.value = '';
      await reload();
      focusAddInput();
    } catch (err) {
      toast(err.message, true);
    } finally {
      state.busy = false;
    }
  });

  input.addEventListener('paste', async (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    const count = text.split(/\r?\n/).filter((l) => l.trim()).length;
    state.busy = true;
    try {
      const ok = await ask(`Skapa ${count} områden från den inklistrade listan? Indragna rader blir underområden och [1], [2] eller [3] först på raden blir prioritet.`, `Skapa ${count} områden`);
      if (!ok) return;
      await api('POST', '/api/nodes/outline', { parentId, text });
      await reload();
      focusAddInput();
      toast(`${count} områden skapades.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      state.busy = false;
    }
  });

  // Klickar man någon annanstans med ett tomt fält avslutas läget.
  input.addEventListener('blur', () => setTimeout(() => {
    if (state.busy || state.addingTo !== parentId) return;
    if (document.activeElement?.closest?.('.add-row') || input.value.trim()) return;
    stopAdding();
  }, 200));

  return input;
}

async function moveNode(n, index) {
  try {
    await api('POST', `/api/nodes/${n.id}/move`, { parentId: n.parentId, index });
    await reload();
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeNode(n) {
  const below = subtree(n.id).length;
  const courses = state.courses.filter((c) => [n.id, ...subtree(n.id).map((x) => x.id)].includes(c.nodeId)).length;
  const extra = [below && `${below} underområden`, courses && `${courses} kurser`].filter(Boolean).join(' och ');
  const what = n.parentId ? `"${n.title}"` : `hela trädet "${n.title}"`;
  const ok = await ask(`Ta bort ${what}${extra ? ` med ${extra}` : ''}? Det går inte att ångra (men du kan exportera en säkerhetskopia först).`, 'Ta bort', true);
  if (!ok) return;
  try {
    await api('DELETE', `/api/nodes/${n.id}`);
    closeDialog();
    if (n.id === state.treeId) {
      state.treeId = null;
      history.replaceState(null, '', location.pathname);
    }
    await reload();
    toast('Borttaget.');
  } catch (err) {
    toast(err.message, true);
  }
}

function parseLinks(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [a, b] = line.includes('|') ? line.split('|').map((s) => s.trim()) : ['', line];
    const url = /^[a-z]+:/i.test(b) ? b : 'https://' + b;
    return { title: a, url };
  });
}

function editNode(id) {
  const n = state.byId.get(id);
  if (!n) return;
  const title = h('input', { value: n.title, required: true, maxlength: 200 });
  const priority = h('select', { value: n.priority ? String(n.priority) : '' },
    h('option', { value: '' }, 'Ingen'),
    h('option', { value: '1' }, '1 (röd)'),
    h('option', { value: '2' }, '2 (blå)'),
    h('option', { value: '3' }, '3 (grön)'));
  const description = h('textarea', { rows: 4, value: n.description || '' });
  const links = h('textarea', {
    rows: 3,
    placeholder: 'Microsoft Learn | https://learn.microsoft.com/…',
    value: (n.links || []).map((l) => (l.title && l.title !== l.url ? `${l.title} | ${l.url}` : l.url)).join('\n'),
  });

  // Flytta till en annan förälder (inte till sig själv eller sina egna underområden).
  let parent = null;
  if (n.parentId) {
    const banned = new Set([id, ...subtree(id).map((x) => x.id)]);
    const options = [];
    const walk = (node, depth) => {
      if (banned.has(node.id)) return;
      options.push(h('option', { value: node.id }, '\u00a0\u00a0\u00a0'.repeat(depth) + node.title));
      kidsOf(node.id).forEach((k) => walk(k, depth + 1));
    };
    walk(rootOf(id), 0);
    parent = h('select', { value: n.parentId }, options);
  }

  const save = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', `/api/nodes/${id}`, {
        title: title.value,
        priority: priority.value ? Number(priority.value) : null,
        description: description.value,
        links: parseLinks(links.value),
      });
      if (parent && parent.value !== n.parentId) {
        await api('POST', `/api/nodes/${id}/move`, { parentId: parent.value, index: 1_000_000 });
      }
      closeDialog();
      await reload();
      toast('Sparat.');
    } catch (err) {
      toast(err.message, true);
    }
  };

  openDialog({
    title: n.parentId ? 'Redigera område' : 'Redigera träd',
    body: h('form', { id: 'nodeForm', onsubmit: save },
      field('Namn', title),
      h('div', { class: 'row2' },
        field('Prioritet', priority, 'Visas som en färgad siffra före namnet.'),
        parent ? field('Ligger under', parent, 'Välj en annan förälder för att flytta området.') : h('div')),
      field('Beskrivning', description, 'Vad området innehåller, vad man bör kunna, vem man kan fråga …'),
      field('Länkar', links, 'En länk per rad. Skriv "Titel | https://adress" eller bara adressen.')),
    buttons: [
      h('button', { class: 'left danger', onclick: () => removeNode(n) }, 'Ta bort'),
      h('button', { onclick: () => showNode(id) }, 'Avbryt'),
      h('button', { class: 'primary', type: 'submit', form: 'nodeForm' }, 'Spara'),
    ],
  });
}

function newTree() {
  const title = h('input', { required: true, maxlength: 200, placeholder: 'T.ex. LST Testare' });
  const save = async (e) => {
    e.preventDefault();
    try {
      const node = await api('POST', '/api/nodes', { parentId: null, title: title.value });
      history.replaceState(null, '', '#' + node.id);
      state.treeId = node.id;
      closeDialog();
      await reload();
      startAdding(node, 0);
    } catch (err) {
      toast(err.message, true);
    }
  };
  openDialog({
    title: 'Nytt träd',
    body: h('form', { id: 'treeForm', onsubmit: save },
      field('Namn', title, 'Trädets rot, t.ex. en roll. Därefter lägger du till områden med + på rutan.')),
    buttons: [
      h('button', { onclick: closeDialog }, 'Avbryt'),
      h('button', { class: 'primary', type: 'submit', form: 'treeForm' }, 'Skapa'),
    ],
  });
}

// ---------- Admin: kurser ----------

/** ISO-tid -> värde för <input type="datetime-local"> i webbläsarens tidszon. */
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function editCourse(courseId, nodeId) {
  const c = courseId ? state.courses.find((x) => x.id === courseId) : null;
  nodeId = c ? c.nodeId : nodeId;
  const area = state.byId.get(nodeId);
  if (!area) return;

  const title = h('input', { value: c?.title || '', required: true, maxlength: 200, placeholder: 'T.ex. Introduktion till GeoJSON' });
  const start = h('input', { type: 'datetime-local', required: true, value: toLocalInput(c?.start) });
  const end = h('input', { type: 'datetime-local', value: toLocalInput(c?.end) });
  const url = h('input', { type: 'url', value: c?.url || '', placeholder: 'https://teams.microsoft.com/l/meetup-join/…' });
  const teacher = h('input', { value: c?.teacher || '', maxlength: 200 });
  const description = h('textarea', { rows: 3, value: c?.description || '' });

  start.addEventListener('change', () => {
    if (end.value || !start.value) return;
    const d = new Date(start.value);
    d.setHours(d.getHours() + 1);
    end.value = toLocalInput(d);
  });

  const save = async (e) => {
    e.preventDefault();
    const body = {
      nodeId,
      title: title.value,
      start: new Date(start.value).toISOString(),
      end: end.value ? new Date(end.value).toISOString() : null,
      url: url.value,
      teacher: teacher.value,
      description: description.value,
    };
    try {
      await api(c ? 'PUT' : 'POST', c ? `/api/courses/${c.id}` : '/api/courses', body);
      await reload();
      showNode(nodeId);
      toast('Kursen sparades.');
    } catch (err) {
      toast(err.message, true);
    }
  };

  const remove = async () => {
    if (!(await ask(`Ta bort kursen "${c.title}"?`, 'Ta bort kurs', true))) return;
    try {
      await api('DELETE', `/api/courses/${c.id}`);
      await reload();
      showNode(nodeId);
      toast('Kursen togs bort.');
    } catch (err) {
      toast(err.message, true);
    }
  };

  openDialog({
    title: c ? 'Redigera kurs' : 'Ny kurs',
    body: h('form', { id: 'courseForm', onsubmit: save },
      h('div', { class: 'breadcrumb' }, 'Område: ', pathText(nodeId)),
      field('Kursnamn', title),
      h('div', { class: 'row2' }, field('Start', start), field('Slut', end)),
      field('Länk till Teams-mötet', url, 'Kopiera länken från mötesinbjudan i Teams/Outlook ("Anslut till mötet").'),
      field('Kursledare', teacher),
      field('Beskrivning', description)),
    buttons: [
      c ? h('button', { class: 'left danger', onclick: remove }, 'Ta bort kurs') : null,
      h('button', { onclick: () => showNode(nodeId) }, 'Avbryt'),
      h('button', { class: 'primary', type: 'submit', form: 'courseForm' }, 'Spara kurs'),
    ],
  });
}

// ---------- Admin: export/import ----------

async function exportData() {
  try {
    const data = await api('GET', '/api/data');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    download(blob, `kompetensmatris-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const summary = `${data.nodes?.length ?? 0} områden och ${data.courses?.length ?? 0} kurser`;
    if (!(await ask(`Ersätta ALL data med innehållet i ${file.name} (${summary})?`, 'Ersätt all data', true))) return;
    await api('PUT', '/api/data', data);
    state.treeId = null;
    await reload();
    toast('Importen är klar.');
  } catch (err) {
    toast('Importen misslyckades: ' + err.message, true);
  }
}

// ---------- Start ----------

function setZoom(value) {
  state.zoom = Math.round(Math.min(2, Math.max(0.4, value)) * 10) / 10;
  local.set('zoom', state.zoom);
  el.tree.style.zoom = state.zoom;
  el.zoomReset.textContent = Math.round(state.zoom * 100) + '%';
}

function setAllOpen(open) {
  if (!state.treeId) return;
  for (const n of subtree(state.treeId)) {
    if (kidsOf(n.id).length) setOpen(n, ancestors(n.id).length, open || ancestors(n.id).length <= 1);
  }
  render();
}

function wireEvents() {
  el.loginBtn.addEventListener('click', () => {
    if (!isAdmin()) return showLogin();
    setPassword(null);
    state.addingTo = null;
    render();
    toast('Du är utloggad.');
  });
  $('zoomIn').addEventListener('click', () => setZoom(state.zoom + 0.1));
  $('zoomOut').addEventListener('click', () => setZoom(state.zoom - 0.1));
  el.zoomReset.addEventListener('click', () => setZoom(1));
  $('expandAll').addEventListener('click', () => setAllOpen(true));
  $('collapseAll').addEventListener('click', () => setAllOpen(false));
  $('newTree').addEventListener('click', newTree);
  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', () => {
    const file = el.importFile.files[0];
    el.importFile.value = '';
    if (file) importData(file);
  });

  el.treeSelect.addEventListener('change', () => { location.hash = el.treeSelect.value; });
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!kidsOf(null).some((r) => r.id === id)) return;
    state.treeId = id;
    state.addingTo = null;
    render();
  });

  el.search.addEventListener('input', () => {
    state.search = el.search.value;
    state.matchIndex = -1;
    render();
  });
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.matches.length) {
      state.matchIndex = (state.matchIndex + 1) % state.matches.length;
      scrollToBox(state.matches[state.matchIndex]);
    }
  });

  // Klick utanför dialogrutan stänger den.
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeDialog(); });

  // Hämta om data varje minut (andras ändringar, och kurser som börjar/slutar).
  setInterval(() => {
    if (document.visibilityState !== 'visible' || el.modal.open || state.addingTo) return;
    reload().catch(() => { /* försök igen nästa gång */ });
  }, 60_000);
}

async function init() {
  wireEvents();
  if (state.password) {
    try { await api('POST', '/api/login', { password: state.password }); } catch { setPassword(null); }
  }
  try {
    await reload();
  } catch (err) {
    el.tree.replaceChildren(h('div', { class: 'empty' }, 'Kunde inte läsa data: ' + err.message));
  }
}

init();
