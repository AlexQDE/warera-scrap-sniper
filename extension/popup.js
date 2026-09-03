// Settings page (the toolbar-button popup and the options tab share it).
const $ = (id) => document.getElementById(id);
const DEFAULTS = { apiKey: '', minMarginPct: 0, intervalSec: 30, collapsed: false };
const clamp = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def; };

const storage = {
  get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
  set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
};

function status(text, kind = '') {
  const el = $('status');
  el.className = `status ${kind}`.trim();
  el.textContent = text;
}

const ago = (iso) => {
  if (!iso) return null;
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
};

function renderBook(book) {
  const el = $('book');
  if (!book?.at) { el.textContent = 'No scrap price read yet.'; return; }
  el.textContent = `Last scrap price read ${ago(book.at)}: lowest ask ${book.ask}, best bid ${book.bid}`
    + (book.remaining != null ? ` · ${book.remaining} of ${book.limit} requests left that minute` : '') + '.';
}

async function load() {
  const { settings = {}, book } = await storage.get(['settings', 'book']);
  const s = { ...DEFAULTS, ...settings };
  $('key').value = s.apiKey;
  $('margin').value = s.minMarginPct;
  $('interval').value = s.intervalSec;
  renderBook(book);
  if (s.apiKey) status('Key saved. Press Test to check it.');
}

async function save() {
  const { settings = {} } = await storage.get(['settings']);
  const next = {
    ...DEFAULTS,
    ...settings,
    apiKey: $('key').value.trim(),
    minMarginPct: clamp($('margin').value, -50, 500, 0),
    intervalSec: clamp($('interval').value, 10, 600, 30),
  };
  $('margin').value = next.minMarginPct;
  $('interval').value = next.intervalSec;
  await storage.set({ settings: next });
  $('saved').textContent = 'Saved.';
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
  if (next.apiKey) await test();
  else status('No key saved: the toolbar will ask for one.', 'warn');
}

async function test() {
  const key = $('key').value.trim();
  if (!key) { status('Paste your key first.', 'warn'); return; }
  status('Checking the key against the API…');
  const r = await chrome.runtime.sendMessage({ type: 'testKey', key });
  if (r?.ok) {
    status(`Key accepted. Scrap price now ${r.ask} (bid ${r.bid}) · ${r.remaining} of ${r.limit} requests left this minute.`, 'ok');
  } else if (r?.error === 'key-rejected') {
    status('Not accepted: the API answered as if no key were sent. Check the key for typos, or create a new one in the game.', 'bad');
  } else if (r?.error === 'rate-limited') {
    status('The API is rate limiting right now. Try again in a minute.', 'warn');
  } else {
    status(`Could not check the key: ${r?.message ?? 'no answer'}`, 'bad');
  }
}

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
$('show').addEventListener('change', () => { $('key').type = $('show').checked ? 'text' : 'password'; });
load();
