
// =====================================================================
// Demoversion: samma gränssnitt, men datan ligger i artefaktens delade
// databas (claude.ai) i stället för i ASP.NET-serverns JSON-fil.
// Funktionerna nedan ersätter api(), reload(), exportData() och init().
// =====================================================================

const DEMO_PASSWORD = 'demo';
const demo = { db: null, downloads: null, loaded: { nodes: false, courses: false }, got: { nodes: false, courses: false }, raw: { nodes: [], courses: [] } };


function fail(message) {
  throw new Error(message);
}

function cleanText(value, field, max, required = false) {
  const v = (value ?? '').toString().trim();
  if (!v) {
    if (required) fail(`${field} måste fyllas i.`);
    return null;
  }
  if (v.length > max) fail(`${field} får vara högst ${max} tecken.`);
  return v;
}

function cleanUrl(value, field) {
  const v = cleanText(value, field, 2000);
  if (v && !/^(https?:|mailto:)/i.test(v)) fail(`${field} måste börja med http:// eller https://`);
  return v;
}

function nodeFields(body) {
  const title = cleanText(body.title, 'Titel', 200, true);
  const priority = body.priority ?? null;
  if (priority !== null && ![1, 2, 3].includes(priority)) fail('Prioritet måste vara 1, 2, 3 eller tom.');
  const links = (body.links || [])
    .filter((l) => (l.url || '').trim())
    .map((l) => ({ title: cleanText(l.title, 'Länktitel', 200) || l.url.trim(), url: cleanUrl(l.url, 'Länk') }));
  return { title, priority, description: cleanText(body.description, 'Beskrivning', 10000), links };
}

function courseFields(body) {
  if (!state.byId.has(body.nodeId)) fail('Kursen måste höra till ett område.');
  const start = body.start ? new Date(body.start) : null;
  if (!start || isNaN(start)) fail('Kursen måste ha en starttid.');
  const end = body.end ? new Date(body.end) : null;
  if (end && end < start) fail('Sluttiden kan inte vara före starttiden.');
  return {
    nodeId: body.nodeId,
    title: cleanText(body.title, 'Kursnamn', 200, true),
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    url: cleanUrl(body.url, 'Möteslänk'),
    teacher: cleanText(body.teacher, 'Kursledare', 200),
    description: cleanText(body.description, 'Beskrivning', 10000),
  };
}


const nextOrder = (parentId) => Math.max(-1, ...kidsOf(parentId).map((n) => n.order ?? 0)) + 1;
const nodeDoc = (id) => demo.db.collection('nodes').doc(id);
const courseDoc = (id) => demo.db.collection('courses').doc(id);

function friendly(err) {
  if (err instanceof Error) return err;
  if (err?.code === 'invalid_argument') return new Error('Du har inte behörighet att ändra här. Be ägaren dela sidan med dig som Contributor eller Editor.');
  if (err?.code === 'quota_exceeded') return new Error('Databasen är full: ' + err.message);
  return new Error(err?.message || 'Något gick fel. Försök igen.');
}

/** Ersätter fetch-anropen mot ASP.NET-servern med anrop till den delade databasen. */
async function api(method, url, body) {
  try {
    if (method === 'GET' && url === '/api/data') return { nodes: state.nodes, courses: state.courses };
    if (method === 'POST' && url === '/api/login') {
      if (body?.password !== DEMO_PASSWORD) throw new Error('Fel lösenord.');
      return null;
    }
    if (!isAdmin()) throw new Error('Du är inte inloggad längre. Logga in igen.');
    if (!demo.db) throw new Error('Databasen är inte tillgänglig i den här vyn.');

    let m;
    if (method === 'POST' && url === '/api/nodes') {
      if (body.parentId && !state.byId.has(body.parentId)) fail('Noden finns inte.');
      const node = { id: newId(), parentId: body.parentId ?? null, ...nodeFields(body), order: nextOrder(body.parentId) };
      const { id, ...data } = node;
      await nodeDoc(id).set(data);
      return node;
    }
    if (method === 'POST' && url === '/api/nodes/outline') {
      if (body.parentId && !state.byId.has(body.parentId)) fail('Noden finns inte.');
      const items = parseOutline(body.text || '');
      if (!items.length) fail('Texten innehåller inga rader.');
      const created = [];
      const add = async (parentId, list, firstOrder) => {
        let order = firstOrder;
        for (const item of list) {
          const id = newId();
          await nodeDoc(id).set({ parentId, title: item.title, priority: item.priority, description: null, links: [], order: order++ });
          created.push(id);
          await add(id, item.children, 0);
        }
      };
      await add(body.parentId ?? null, items, nextOrder(body.parentId));
      return created;
    }
    if ((m = url.match(/^\/api\/nodes\/([^/]+)$/)) && method === 'PUT') {
      if (!state.byId.has(m[1])) fail('Noden finns inte.');
      await nodeDoc(m[1]).update(nodeFields(body));
      return null;
    }
    if ((m = url.match(/^\/api\/nodes\/([^/]+)\/move$/)) && method === 'POST') {
      const node = state.byId.get(m[1]) || fail('Noden finns inte.');
      const parentId = body.parentId ?? null;
      if (parentId) {
        if (!state.byId.has(parentId)) fail('Noden finns inte.');
        if (parentId === node.id || subtree(node.id).some((x) => x.id === parentId)) fail('En nod kan inte flyttas in under sig själv.');
      }
      const siblings = kidsOf(parentId).filter((x) => x.id !== node.id);
      siblings.splice(Math.max(0, Math.min(body.index, siblings.length)), 0, node);
      for (const [i, s] of siblings.entries()) {
        const patch = {};
        if (s.order !== i) patch.order = i;
        if (s.id === node.id && node.parentId !== parentId) patch.parentId = parentId;
        if (Object.keys(patch).length) await nodeDoc(s.id).update(patch);
      }
      return null;
    }
    if ((m = url.match(/^\/api\/nodes\/([^/]+)$/)) && method === 'DELETE') {
      const node = state.byId.get(m[1]) || fail('Noden finns inte.');
      const ids = new Set([node.id, ...subtree(node.id).map((x) => x.id)]);
      for (const c of state.courses.filter((x) => ids.has(x.nodeId))) await courseDoc(c.id).delete();
      for (const id of ids) await nodeDoc(id).delete();
      return null;
    }
    if ((m = url.match(/^\/api\/trees\/([^/]+)$/)) && method === 'PUT') {
      // Kod-vyn: ersätt trädets struktur. Befintliga id:n behåller beskrivning, länkar och kurser.
      const root = state.byId.get(m[1]) || fail('Trädet finns inte.');
      const items = body.nodes || [];
      if (!items.length || items[0].id !== root.id) fail('Första raden måste vara trädets rot.');
      const treeIds = new Set([root.id, ...subtree(root.id).map((n) => n.id)]);
      const seen = new Set();
      for (const [i, item] of items.entries()) {
        if (seen.has(item.id)) fail('Samma id förekommer flera gånger.');
        if (state.byId.has(item.id) && !treeIds.has(item.id)) fail('Ett id tillhör ett annat träd.');
        if (i > 0 && !seen.has(item.parentId)) fail(`"${item.title}" måste ligga under en rad ovanför sig.`);
        cleanText(item.title, 'Titel', 200, true);
        if (item.priority != null && ![1, 2, 3].includes(item.priority)) fail('Prioritet måste vara 1, 2, 3 eller tom.');
        seen.add(item.id);
      }
      const orders = new Map();
      for (const [i, item] of items.entries()) {
        const old = state.byId.get(item.id);
        let order = old?.order ?? 0;
        if (i > 0) {
          order = orders.get(item.parentId) ?? 0;
          orders.set(item.parentId, order + 1);
        }
        const fields = { parentId: item.parentId ?? null, title: item.title.trim(), priority: item.priority ?? null, order };
        if (!old) {
          await nodeDoc(item.id).set({ ...fields, description: null, links: [] });
          continue;
        }
        const patch = {};
        for (const [k, v] of Object.entries(fields)) if ((old[k] ?? null) !== v) patch[k] = v;
        if (Object.keys(patch).length) await nodeDoc(item.id).update(patch);
      }
      for (const id of treeIds) {
        if (seen.has(id)) continue;
        for (const c of state.courses.filter((x) => x.nodeId === id)) await courseDoc(c.id).delete();
        await nodeDoc(id).delete();
      }
      return null;
    }
    if (method === 'POST' && url === '/api/courses') {
      const id = newId();
      const data = courseFields(body);
      await courseDoc(id).set(data);
      return { id, ...data };
    }
    if ((m = url.match(/^\/api\/courses\/([^/]+)$/))) {
      if (!state.courses.some((c) => c.id === m[1])) fail('Kursen finns inte.');
      if (method === 'PUT') await courseDoc(m[1]).set(courseFields(body));
      if (method === 'DELETE') await courseDoc(m[1]).delete();
      return null;
    }
    fail('Finns inte i demoversionen.');
  } catch (err) {
    throw friendly(err);
  }
}

/** Datan kommer live från databasen, så "ladda om" ritar bara om från det senaste läget. */
async function reload() {
  applySnapshot();
}

function applySnapshot() {
  if (!demo.got.nodes) return; // vänta på första svaret så att sidan inte blinkar "tomt"
  state.nodes = [...demo.raw.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  state.courses = demo.raw.courses;
  buildIndex();

  // Behåll det som skrivs i snabbinmatningen om någon annan ändrar samtidigt.
  const typing = document.activeElement?.closest?.('.add-row') ? document.activeElement.value : null;
  render();
  // En öppen områdesruta visar det senaste läget (t.ex. en kurs som just sparades).
  const open = el.modal.open && el.modal.dataset.node;
  if (open && state.byId.has(open)) showNode(open);
  if (typing !== null) {
    const input = el.tree.querySelector('.add-row input');
    if (input) {
      input.value = typing;
      input.focus();
    }
  }
}

async function exportData() {
  if (!demo.downloads) return toast('Export är inte tillgängligt i den här vyn.', true);
  const data = { nodes: state.nodes, courses: state.courses };
  try {
    await demo.downloads.save({
      filename: `kompetensmatris-${new Date().toISOString().slice(0, 10)}.json`,
      data: JSON.stringify(data, null, 2),
    });
  } catch (err) {
    if (err?.code !== 'declined') toast('Exporten misslyckades.', true);
  }
}

function showStatus(text) {
  el.tree.replaceChildren(h('div', { class: 'empty' }, h('p', {}, text)));
}

async function init() {
  features.calendar = false; // .ics-filer kan inte sparas från en inbäddad sida
  $('importBtn').hidden = true;
  wireEvents();
  showStatus('Laddar kompetensträdet …');

  if (state.password && state.password !== DEMO_PASSWORD) setPassword(null);
  renderTopbar();

  const [db, downloads] = await Promise.all([
    window.claude?.use?.('db') ?? null,
    window.claude?.use?.('downloads') ?? null,
  ]);
  demo.downloads = downloads;
  if (!db) {
    showStatus('Den här vyn kan inte läsa datan. Öppna sidan i claude.ai och logga in.');
    return;
  }
  demo.db = db;

  const timer = setTimeout(() => {
    if (!demo.loaded.nodes) showStatus('Kan inte nå datan just nu. Sidan försöker igen av sig själv.');
  }, 10000);

  const listen = (name) => db.collection(name).onSnapshot(
    (snap) => {
      demo.raw[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      demo.got[name] = true;
      if (!snap.metadata.fromCache) demo.loaded[name] = true;
      if (demo.loaded.nodes) clearTimeout(timer);
      applySnapshot();
    },
    (err) => {
      clearTimeout(timer);
      showStatus(err.code === 'revoked' ? 'Åtkomsten till datan har ändrats.' : 'Kunde inte läsa datan: ' + err.message);
    });
  listen('nodes');
  listen('courses');
}

init();
