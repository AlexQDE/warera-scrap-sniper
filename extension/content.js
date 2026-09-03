// Scrap Sniper content script. Runs on every app.warera.io page, does its work
// only while the equipment market is open: a toolbar with the live scrap floor
// per rarity, and a verdict block on each offer that says what the gear is
// worth dismantled, how much of the price the scraps pay back, and whether the
// offer is under its floor.
//
// The maths is the editor's rule: floor = scraps x the scrap price (the highest
// buy order, what the scraps fetch sold right away), compared with the gear
// price exactly as the market shows it. No tax is added or removed anywhere.
//
// Read-only by construction. The scrap book is read by the background worker
// with the player's OWN API key (never without one; see lib/api.mjs) and
// shared between tabs. This script only reads the page it is on and draws.
// Nothing here clicks BUY, and nothing reads or sends the session.
(async () => {
  if (window.__scrapSniper) return;
  window.__scrapSniper = true;

  const { scrapTable } = await import(chrome.runtime.getURL('lib/scraplib.mjs'));
  const dom = await import(chrome.runtime.getURL('lib/dom.mjs'));

  const DEFAULTS = { minMarginPct: 0, intervalSec: 30, collapsed: false };
  const TICK_MS = 5000;

  const state = {
    settings: { ...DEFAULTS }, book: null, notice: null, error: null, summary: null, busy: false,
    noKey: false, keyRejected: false,
  };

  // ---------- settings (the API key stays in storage and in the background worker, never here) ----------
  const storage = {
    async get(keys) { return new Promise((r) => chrome.storage.local.get(keys, r)); },
    async set(obj) { return new Promise((r) => chrome.storage.local.set(obj, r)); },
  };
  const withoutKey = (s) => { const { apiKey, ...rest } = s ?? {}; return rest; };
  const loaded = await storage.get(['settings', 'book']);
  state.settings = { ...DEFAULTS, ...withoutKey(loaded.settings) };
  if (loaded.book?.at) state.book = loaded.book;
  const saveSettings = async () => {
    const { settings = {} } = await storage.get(['settings']);   // merge, so the key is kept
    await storage.set({ settings: { ...settings, ...state.settings } });
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const before = state.settings;
    state.settings = { ...DEFAULTS, ...withoutKey(changes.settings.newValue) };
    const input = document.querySelector('#scrap-sniper-bar .ss-margin-in');
    if (input && Number(input.value) !== state.settings.minMarginPct) input.value = state.settings.minMarginPct;
    const keyChanged = String(changes.settings.oldValue?.apiKey ?? '') !== String(changes.settings.newValue?.apiKey ?? '');
    if (keyChanged || before.intervalSec !== state.settings.intervalSec) refreshBook(true).then(scan);
    else scan();
  });

  // ---------- the scrap book (asked from the background worker) ----------
  const isFresh = (b) => b?.at && Date.now() - Date.parse(b.at) < state.settings.intervalSec * 1000;
  async function refreshBook(force = false) {
    if (!force && isFresh(state.book) && !state.noKey && !state.keyRejected) return;
    state.busy = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'book', force });
      if (!r) throw new Error('no answer from the extension');
      state.noKey = r.error === 'no-key';
      state.keyRejected = r.error === 'key-rejected';
      if (state.keyRejected) state.book = null;
      else if (r.book) state.book = r.book;
      state.error = r.error && !state.noKey && !state.keyRejected ? (r.message ?? r.error) : null;
    } catch (e) {
      state.error = e.message;
    } finally {
      state.busy = false;
    }
  }

  // ---------- per-rarity floors: scraps x the scrap price (highest buy order), nothing else ----------
  function floors() {
    if (state.book?.bid == null) return null;
    const rows = scrapTable({ bid: state.book.bid, ask: state.book.ask });
    return Object.fromEntries(rows.map((r) => [r.rarity, { floor: r.valueAtBid, scraps: r.yield }]));
  }

  function anchorNotice() {
    // The notice sweep reads every div; keep the element until the game replaces it.
    if (!state.notice?.isConnected) state.notice = dom.taxNotice();
    return state.notice;
  }

  // ---------- formatting ----------
  const onMarket = () => /\/market\/equipments/.test(location.pathname);
  // Gold amounts carry 3 decimals, the market's own precision (392.991, 1.495), so a floor reads 1:1 against a price.
  const fmt = (v, d = 3) => (v == null ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const signed = (v, d = 3) => (v < 0 ? '−' : '+') + fmt(Math.abs(v), d);
  const ago = (iso) => {
    if (!iso) return 'never';
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
  };
  const rgb = (r) => `rgb(${dom.RARITY_BORDERS[r].join(',')})`;
  const clampMargin = (v) => Math.max(-50, Math.min(500, Math.round(Number(v) || 0)));

  // ---------- toolbar ----------
  function ensureBar(notice) {
    let bar = document.getElementById('scrap-sniper-bar');
    if (bar) return bar;
    const anchor = notice ?? [...document.querySelectorAll('div')].find((e) => (e.textContent || '').trim().startsWith('Weapons') && (e.textContent || '').length < 700);
    if (!anchor) return null;
    bar = document.createElement('div');
    bar.id = 'scrap-sniper-bar';
    bar.innerHTML = `
      <div class="ss-head">
        <div class="ss-brand"><span class="ss-logo">⚒</span><span>Scrap Sniper</span></div>
        <div class="ss-live"><span class="ss-pulse"></span><span class="ss-live-text">reading the scrap book…</span></div>
        <div class="ss-grow"></div>
        <div class="ss-margin" title="Highlight an offer only when scrapping it clears at least this margin">
          <span class="ss-label">min margin</span>
          <button type="button" class="ss-step" data-d="-5" aria-label="lower the minimum margin">−</button>
          <input class="ss-margin-in" type="number" min="-50" max="500" step="1" aria-label="minimum margin in percent">
          <span class="ss-label">%</span>
          <button type="button" class="ss-step" data-d="5" aria-label="raise the minimum margin">+</button>
        </div>
        <button type="button" class="ss-icon ss-refresh" title="Read the scrap book again">↻</button>
        <button type="button" class="ss-icon ss-collapse" title="Collapse or expand">▾</button>
      </div>
      <div class="ss-body">
        <div class="ss-setup"></div>
        <div class="ss-stats"></div>
        <div class="ss-caption"></div>
        <div class="ss-floors"></div>
        <div class="ss-summary"></div>
      </div>`;
    anchor.insertAdjacentElement(notice ? 'afterend' : 'beforebegin', bar);
    bar.querySelector('.ss-setup').addEventListener('click', (e) => {
      if (e.target.closest('.ss-open-settings')) chrome.runtime.sendMessage({ type: 'openSettings' });
    });

    const input = bar.querySelector('.ss-margin-in');
    input.value = state.settings.minMarginPct;
    const setMargin = async (v) => {
      state.settings.minMarginPct = clampMargin(v);
      input.value = state.settings.minMarginPct;
      await saveSettings();
      scan();
    };
    input.addEventListener('change', () => setMargin(input.value));
    for (const b of bar.querySelectorAll('.ss-step')) b.addEventListener('click', () => setMargin(state.settings.minMarginPct + Number(b.dataset.d)));
    bar.querySelector('.ss-refresh').addEventListener('click', async (e) => {
      e.currentTarget.classList.add('ss-busy');
      await refreshBook(true);
      bar.querySelector('.ss-refresh')?.classList.remove('ss-busy');
      scan();
    });
    bar.querySelector('.ss-collapse').addEventListener('click', async () => {
      state.settings.collapsed = !state.settings.collapsed;
      await saveSettings();
      bar.dataset.collapsed = state.settings.collapsed ? '1' : '0';
    });
    return bar;
  }

  const SETUP_HTML = {
    noKey: `<div><b>Add your WarEra API key to start.</b><div class="ss-muted">Scrap Sniper reads the scrap price only with your own key, never without one. Create the key in the game under your account settings, then paste it into the extension settings.</div></div><button type="button" class="ss-open-settings">Open settings</button>`,
    rejected: `<div><b>The API did not accept this key.</b><div class="ss-muted">It answered as if no key were sent. Check the key for typos in the extension settings, or create a new one in the game.</div></div><button type="button" class="ss-open-settings">Open settings</button>`,
  };

  function renderBar(bar, fl) {
    const b = state.book ?? {};
    bar.dataset.collapsed = state.settings.collapsed ? '1' : '0';
    const setup = state.noKey || state.keyRejected;
    bar.dataset.setup = setup ? '1' : '0';
    const setupEl = bar.querySelector('.ss-setup');
    const setupHtml = !setup ? '' : state.noKey ? SETUP_HTML.noKey : SETUP_HTML.rejected;
    if (setupEl.innerHTML !== setupHtml) setupEl.innerHTML = setupHtml;

    const live = bar.querySelector('.ss-live');
    const stale = setup || !b.at || Date.now() - Date.parse(b.at) > state.settings.intervalSec * 3000 || !!state.error;
    live.dataset.stale = stale ? '1' : '0';
    live.querySelector('.ss-live-text').textContent = state.noKey ? 'no API key'
      : state.keyRejected ? 'key not accepted'
        : state.error ? `read failed · showing ${ago(b.at)}` : `book ${ago(b.at)}`;
    live.title = setup ? 'Open the extension settings and add your WarEra API key.'
      : state.error
        ? `The last scrap-book read failed: ${state.error}. The values shown come from the previous read.`
        : `The scrap order book is read every ${state.settings.intervalSec}s with your API key and shared between your tabs.`
          + (b.remaining != null ? ` ${b.remaining} of ${b.limit} requests were left that minute.` : '');
    if (setup) return;

    const cap = (c) => (c ? '+' : '');
    bar.querySelector('.ss-stats').innerHTML = `
      <div class="ss-stat"><span class="ss-label">scrap price</span><b>${fmt(b.bid, 3)}</b><span class="ss-sub">${b.bid == null ? 'no buy orders' : `highest buy order · ${dom.fmtQty(b.bidQty)}${cap(b.bidCapped)} wanted`}</span></div>
      <div class="ss-stat"><span class="ss-label">lowest ask</span><b>${fmt(b.ask, 3)}</b><span class="ss-sub">${b.ask == null ? 'no sell orders' : `${dom.fmtQty(b.askQty)}${cap(b.askCapped)} for sale · reference`}</span></div>`;

    bar.querySelector('.ss-caption').innerHTML = fl
      ? `<span class="ss-label">buy under these · scraps × ${fmt(b.bid, 3)} per rarity, compared with the price as shown</span>`
      : '';
    bar.querySelector('.ss-floors').innerHTML = fl
      ? dom.RARITIES.map((r) => `
        <div class="ss-tile" data-ss-rarity="${r}" title="A ${r} piece dismantles into ${fl[r].scraps} scraps × ${fmt(b.bid, 3)} (highest buy order) = ${fmt(fl[r].floor)}">
          <span class="ss-tile-name">${r}</span>
          <span class="ss-tile-price">${fmt(fl[r].floor)}</span>
          <span class="ss-tile-sub">${fl[r].scraps} scraps</span>
        </div>`).join('')
      : '<span class="ss-chip ss-warn">no scrap price yet, floors unavailable</span>';

    const s = state.summary;
    let summary = '';
    if (s) {
      summary += `<span><span class="ss-hits${s.hits ? '' : ' ss-none'}">${s.hits ? `${s.hits} under floor` : 'none under floor'}</span> <span>of ${s.rows} offer${s.rows === 1 ? '' : 's'} on this page</span></span>`;
      if (s.closest) summary += `<span>closest to floor: <span class="ss-dot" style="background:${rgb(s.closest.rarity)}"></span>${s.closest.rarity} at <b>${fmt(s.closest.price)}</b>, <b>${fmt(s.closest.ratio, 2)}×</b> its scrap value</span>`;
      if (s.unknown) summary += `<span class="ss-warn">${s.unknown} offer${s.unknown === 1 ? '' : 's'} unreadable</span>`;
      if (state.settings.minMarginPct) summary += `<span class="ss-label">highlighting from ${signed(state.settings.minMarginPct, 0)}% margin</span>`;
    }
    bar.querySelector('.ss-summary').innerHTML = summary;
  }

  // ---------- offers ----------
  function setVerdict(row, kind, html) {
    let el = row.querySelector(':scope > .ss-verdict');
    if (!el) { el = document.createElement('div'); el.className = 'ss-verdict'; row.appendChild(el); }
    if (el.dataset.kind !== kind) el.dataset.kind = kind;
    if (el.innerHTML !== html) el.innerHTML = html;
    if (row.dataset.scrapSniper !== kind) row.dataset.scrapSniper = kind;
  }

  function verdictHtml(v, floor, best) {
    const bestTag = best ? '<span class="ss-v-best" title="Of the offers on this page, this one sits nearest its scrap floor">closest on page</span>' : '';
    if (v.hit) {
      return `${bestTag}<div class="ss-v-top"><span class="ss-v-tag">SNIPE</span><b class="ss-v-main">${signed(v.margin)}</b><span class="ss-v-pct">${signed(v.marginPct * 100, 1)}%</span></div>
        <div class="ss-meter"><i style="width:100%"></i></div>
        <div class="ss-v-bottom"><span>scrap value ${fmt(floor)}</span><span>pays back ${Math.round(v.coverPct)}%</span></div>`;
    }
    return `${bestTag}<div class="ss-v-top"><span class="ss-v-label">scrap value</span><b class="ss-v-main">${fmt(floor)}</b><span class="ss-v-pct">${signed(v.margin)}</span></div>
      <div class="ss-meter"><i style="width:${Math.min(100, Math.max(2, v.coverPct)).toFixed(0)}%"></i></div>
      <div class="ss-v-bottom"><span>${fmt(v.ratio, 2)}× floor</span><span>pays back ${Math.round(v.coverPct)}%</span></div>`;
  }

  function scan() {
    if (!onMarket()) { clear(); return; }
    const notice = anchorNotice();
    const bar = ensureBar(notice);
    if (state.noKey || state.keyRejected) {
      clearVerdicts();
      state.summary = null;
      if (bar) renderBar(bar, null);
      return;
    }
    const fl = floors();
    const code = dom.filteredItemCode(location.search);
    const fromCode = code ? dom.rarityFromItemCode(code) : null;

    const rows = dom.offerRows().map((r) => {
      const rarity = fromCode ?? r.rarity;
      const floor = fl && rarity ? fl[rarity].floor : null;
      return { ...r, rarity, floor, v: dom.verdict({ price: r.price, floor, minMarginPct: state.settings.minMarginPct }) };
    });
    const best = dom.closestIndex(rows.map((r) => r.v));
    const summary = { rows: rows.length, hits: 0, unknown: 0, closest: best >= 0 ? { rarity: rows[best].rarity, price: rows[best].price, ratio: rows[best].v.ratio } : null };
    rows.forEach((r, i) => {
      if (r.v.hit == null) {
        summary.unknown++;
        setVerdict(r.row, 'unknown', `<div class="ss-v-top"><span class="ss-v-label">${r.rarity ? 'no scrap price yet' : r.price == null ? 'price unreadable' : 'rarity unreadable'}</span></div>`);
        return;
      }
      if (r.v.hit) summary.hits++;
      setVerdict(r.row, r.v.hit ? 'hit' : 'miss', verdictHtml(r.v, r.floor, i === best));
    });
    state.summary = summary;
    if (bar) renderBar(bar, fl);
  }

  function clearVerdicts() {
    for (const el of document.querySelectorAll('[data-scrap-sniper]')) {
      el.querySelector(':scope > .ss-verdict')?.remove();
      delete el.dataset.scrapSniper;
    }
  }

  function clear() {
    document.getElementById('scrap-sniper-bar')?.remove();
    clearVerdicts();
  }

  // ---------- loop ----------
  let timer = null;
  const ours = (n) => !!(n?.closest?.('#scrap-sniper-bar, .ss-verdict') || n?.parentElement?.closest?.('#scrap-sniper-bar, .ss-verdict'));
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 250); };
  new MutationObserver((muts) => {
    if (muts.every((m) => ours(m.target))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  async function tick() {
    if (onMarket()) await refreshBook();
    scan();
  }
  await tick();
  setInterval(tick, TICK_MS);
})();
