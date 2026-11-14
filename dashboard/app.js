// Token Radar dashboard (vanilla DOM, no network, reads window.RADAR)
(function () {
  'use strict';

  var R = window.RADAR;
  var root = document.getElementById('app');

  /* --- DOM & formatting helpers --- */
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (typeof attrs === 'string') { if (attrs) n.className = attrs; }
    else if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }

  function add(p, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) add(p, c[i]); }
    else p.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  var EM = '\u2014';
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return EM;
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtInt(n) { return n == null || !isFinite(n) ? EM : Math.round(n).toLocaleString('en-US'); }
  function fmtPct(n) { return n == null || !isFinite(n) ? EM : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtMult(n) { return n == null || !isFinite(n) ? EM : n.toFixed(2) + '\u00d7'; }
  function fmtAge(d) { return d == null || !isFinite(d) ? EM : d + 'd'; }
  function pctCls(n) { return n == null || !isFinite(n) ? 'zero' : n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }
  function catOf(c) { return c || 'Uncategorized'; }
  function parseStep(s) {
    var m = /^(.*?)\s+Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.?$/.exec(s);
    return m ? { a: m[1], c: m[2], t: m[3] } : { a: s, c: '', t: '' };
  }

  if (!R || !Array.isArray(R.rows)) {
    root.appendChild(el('main', 'radar-shell', el('div', 'panel', el('div', 'empty-state',
      el('strong', null, 'No radar data'),
      el('p', null, 'window.RADAR is missing. Run main.ts to generate data.js.')
    ))));
    return;
  }

  /* --- State & hash routing --- */
  var M = R.model || {}, C = R.counts || {};
  var bySlug = Object.create(null), catSet = Object.create(null), chainSet = Object.create(null);
  R.rows.forEach(function (r) {
    bySlug[r.slug] = r;
    catSet[catOf(r.category)] = 1;
    (r.chains || []).forEach(function (c) { if (c) chainSet[c] = 1; });
  });

  var state = { tab: 'board', q: '', cat: '', chain: '', wl: false, sort: 'implied', selected: null };

  function setHash(h) {
    if (h) { if (location.hash !== h) location.hash = h; }
    else { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } }
  }

  function applyHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    if (raw.indexOf('p=') === 0) {
      var s = decodeURIComponent(raw.slice(2));
      state.tab = 'board';
      state.selected = bySlug[s] ? s : null;
    } else if (raw.indexOf('cat=') === 0) {
      var c = decodeURIComponent(raw.slice(4));
      state.tab = 'board';
      state.cat = catSet[c] ? c : '';
      state.selected = null;
    } else if (raw === 'tab=aside' || raw === 'tab=live') {
      state.tab = raw.slice(4);
      state.selected = null;
    } else if (!raw) {
      state.selected = null;
    }
  }

  /* --- Header & model box --- */
  function buildHeader() {
    var chips = [
      ['Data as of', R.as_of, 'Floor ' + fmtUsd(R.floor_usd), ''],
      ['Protocols scanned', fmtInt(C.protocols_scanned), fmtInt(C.pre_token_found) + ' pre-token', ''],
      ['Ranked on board', fmtInt(C.board_rows != null ? C.board_rows : R.rows.length), 'Eligible pre-token', 'accent'],
      ['Watchlist covered', fmtInt(C.watchlist_covered) + ' / ' + fmtInt(C.watchlist_size), 'Tracked targets', 'watchlist'],
      ['Set aside', fmtInt(C.set_aside != null ? C.set_aside : R.set_aside.length), 'Wrapped / CEX / ver.', ''],
      ['Trading now', fmtInt(C.live_peers != null ? C.live_peers : R.live.length), 'Top ' + R.live.length + ' shown', '']
    ];
    return el('header', 'radar-header',
      el('div', 'header-top',
        el('div', 'brand-block',
          el('span', 'eyebrow', el('span', 'pulse-dot'), 'Pre-token launch radar'),
          el('h1', 'radar-title', 'TOKEN RADAR'),
          el('p', 'radar-subtitle', 'Every protocol that records no token yet, ranked by what its launch would be worth \u2014 and how to farm it.')
        ),
        el('div', 'snapshot-meta',
          el('span', 'meta-pill', 'Model ', el('strong', null, M.version || R.model_version)),
          el('span', 'meta-pill', 'Global \u00d7 ', el('strong', null, fmtMult(M.global_multiple))),
          el('span', 'meta-pill', 'As of ', el('strong', null, R.as_of))
        )
      ),
      el('div', 'stat-strip', chips.map(function (c) {
        return el('div', 'stat-chip' + (c[3] ? ' ' + c[3] : ''),
          el('span', 'stat-label', c[0]), el('span', 'stat-value', c[1]), el('span', 'stat-sub', c[2]));
      }))
    );
  }

  function buildModelBox() {
    var catRows = R.category_multiples || [], cols = 3, perCol = Math.ceil(catRows.length / cols) || 1;
    var ths = [], trs = [];
    for (var g = 0; g < cols; g++) {
      ths.push(el('th', g ? 'sep' : '', 'Category'), el('th', 'num', 'Peers'), el('th', 'num', 'Raw med'), el('th', 'num', 'Used'));
    }
    for (var r = 0; r < perCol; r++) {
      var tds = [];
      for (var c = 0; c < cols; c++) {
        var it = catRows[c * perCol + r], sep = c ? ' sep' : '';
        if (it) tds.push(
          el('td', 'cat-name' + sep, it.category),
          el('td', 'num cat-peers', fmtInt(it.live_peers)),
          el('td', 'num cat-peers', it.raw_median == null ? EM : fmtMult(it.raw_median)),
          el('td', 'num cat-mult', fmtMult(it.multiple_used))
        );
        else tds.push(el('td', sep), el('td'), el('td'), el('td'));
      }
      trs.push(el('tr', null, tds));
    }
    var maxMat = (M.maturity_floor + M.maturity_range).toFixed(2);
    var terms = ['TVL', 'category multiple', 'growth', 'maturity', 'breadth'];
    var eq = [el('span', 'formula-lhs', 'implied'), el('span', 'formula-op', '=')];
    terms.forEach(function (t, idx) {
      if (idx) eq.push(el('span', 'formula-op', '\u00d7'));
      eq.push(el('span', 'formula-term', t));
    });

    return el('details', { class: 'model-box', open: true },
      el('summary', null,
        el('span', 'model-title', 'The value model (' + (M.version || 'radar-2') + ')'),
        el('div', 'model-params', [
          ['Prior wt ', M.prior_weight], ['Multiple ', '[' + M.multiple_floor + ', ' + M.multiple_cap + ']'],
          ['Growth wt ', M.growth_weight], ['Maturity ', M.maturity_days + 'd']
        ].map(function (p) { return el('span', 'param-chip', p[0], el('strong', null, p[1])); }))
      ),
      el('div', 'model-box-body',
        el('div', 'formula-line',
          el('div', 'formula-eq', eq),
          el('span', 'formula-note', 'One function scores every row; no protocol name is special-cased, and every figure comes from the snapshot itself.')
        ),
        el('p', 'formula-note',
          'Category multiple = median mcap/TVL of the category\u2019s already-trading protocols, pulled toward the market-wide median (' +
          fmtMult(M.global_multiple) + ') with weight ' + M.prior_weight + ', clamped to [' + M.multiple_floor + ', ' + M.multiple_cap + ']; ' +
          'growth from 7-day TVL change clamped to [' + M.growth_floor + '%, +' + M.growth_cap + '%] at weight ' + M.growth_weight + '; ' +
          'maturity from days tracked, ' + M.maturity_floor.toFixed(2) + ' rising to ' + maxMat + ' at ' + M.maturity_days + ' days (unknown age: ' + M.unknown_age_days + 'd); ' +
          'breadth +' + Math.round((M.breadth_step || 0.04) * 100) + '% per extra chain up to ' + M.breadth_max_extra_chains + '.'
        ),
        el('div', 'cat-multiples-wrap',
          el('div', 'cat-section-head',
            el('span', null, 'Category multiples (' + catRows.length + ' board categories)'),
            el('span', null, 'Market-wide median ' + fmtMult(M.global_multiple))
          ),
          el('div', { style: 'overflow-x:auto' },
            el('table', 'cat-table', el('thead', null, el('tr', null, ths)), el('tbody', null, trs))
          )
        )
      )
    );
  }

  /* --- Controls & workspace --- */
  function makeSelect(label, opts, onChange) {
    return el('select', { class: 'select', 'aria-label': label, onChange: onChange },
      opts.map(function (o) { return el('option', { value: o[0] }, o[1]); }));
  }

  var tabBtns = {};
  var tabBar = el('div', 'tab-bar',
    el('div', { class: 'tab-list', role: 'tablist' }, [
      ['board', 'Board', R.rows.length],
      ['aside', 'Set aside', R.set_aside.length],
      ['live', 'Trading now', R.live.length]
    ].map(function (t) {
      var btn = el('button', {
        type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false',
        onClick: function () {
          state.tab = t[0];
          if (t[0] === 'board') setHash(state.selected ? '#p=' + encodeURIComponent(state.selected) : (state.cat ? '#cat=' + encodeURIComponent(state.cat) : ''));
          else { state.selected = null; setHash('#tab=' + t[0]); }
          renderBody();
        }
      }, t[1], el('span', 'tab-count', fmtInt(t[2])));
      tabBtns[t[0]] = btn;
      return btn;
    }))
  );

  var searchInput = el('input', {
    type: 'search', class: 'search-input', placeholder: 'Search name or slug\u2026', 'aria-label': 'Search name or slug',
    onInput: function () { state.q = searchInput.value; renderBoardRows(); }
  });
  var catSelect = makeSelect('Filter by category', [['', 'All categories']].concat(
    Object.keys(catSet).sort().map(function (c) { return [c, c]; })
  ), function () {
    state.cat = catSelect.value;
    if (!state.selected) setHash(state.cat ? '#cat=' + encodeURIComponent(state.cat) : '');
    renderBoardRows();
  });
  var chainSelect = makeSelect('Filter by chain', [['', 'All chains']].concat(
    Object.keys(chainSet).sort().map(function (c) { return [c, c]; })
  ), function () { state.chain = chainSelect.value; renderBoardRows(); });
  var wlCheck = el('input', { type: 'checkbox', onChange: function () { state.wl = wlCheck.checked; renderBoardRows(); } });
  var sortSelect = makeSelect('Sort board', [
    ['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['cat_mult', 'Category multiple']
  ], function () { state.sort = sortSelect.value; renderBoardRows(); });

  var countEl = el('span', 'showing-count');
  var toolbar = el('div', 'toolbar',
    el('div', 'toolbar-left',
      searchInput,
      el('label', 'control-field', el('span', 'control-label', 'Category'), catSelect),
      el('label', 'control-field', el('span', 'control-label', 'Chain'), chainSelect),
      el('label', 'control-field', wlCheck, el('span', null, 'Watchlist only')),
      el('label', 'control-field', el('span', 'control-label', 'Sort'), sortSelect)
    ),
    el('div', 'toolbar-right', countEl)
  );

  var workspaceBar = el('div', 'workspace-bar', tabBar, toolbar);
  var tablePanel = el('section', { class: 'table-panel', id: 'board' });
  var boardTbody = el('tbody');
  var backdrop = el('div', { class: 'drawer-backdrop', onClick: closeDrawer });
  var drawer = el('aside', { class: 'detail-drawer', hidden: true, 'aria-hidden': 'true' });

  /* --- Board filtering, sorting & table --- */
  var sorters = {
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
    growth: function (a, b) {
      var ag = a.change_7d == null ? -1e9 : a.change_7d, bg = b.change_7d == null ? -1e9 : b.change_7d;
      return bg - ag || a.rank - b.rank;
    },
    age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days) || a.rank - b.rank; },
    cat_mult: function (a, b) { return b.category_multiple - a.category_multiple || a.rank - b.rank; }
  };

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && catOf(r.category) !== state.cat) return false;
      if (state.chain && (!r.chains || r.chains.indexOf(state.chain) === -1)) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(sorters[state.sort] || sorters.implied);
  }

  function protoCell(name, slug, badge) {
    return el('div', 'proto-cell', el('div', 'proto-main',
      el('div', 'proto-name-line', el('span', 'proto-name', name), badge || null),
      el('span', 'proto-slug', slug)
    ));
  }

  function makeBoardRow(r) {
    var ch = r.chains || [], sel = state.selected === r.slug;
    return el('tr', {
      class: 'clickable' + (r.rank <= 3 ? ' top-rank' : '') + (sel ? ' is-selected' : ''),
      'data-slug': r.slug, 'aria-selected': sel ? 'true' : 'false', tabindex: '0',
      onClick: function () { openDrawer(r.slug); },
      onKeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); } }
    },
      el('td', 'rank', r.rank),
      el('td', null, protoCell(r.name, r.slug, r.watchlist ? el('span', 'badge badge-watchlist', '\u2605 WL') : null)),
      el('td', null, el('span', 'badge badge-cat', catOf(r.category))),
      el('td', null, ch.length ? el('div', 'chains-cell', el('span', 'chain-chip', ch[0]), ch.length > 1 ? el('span', 'chain-more', '+' + (ch.length - 1)) : null) : EM),
      el('td', 'num', fmtUsd(r.tvl_usd)),
      el('td', 'num ' + pctCls(r.change_7d), fmtPct(r.change_7d)),
      el('td', 'num', fmtAge(r.age_days)),
      el('td', 'num', fmtMult(r.category_multiple)),
      el('td', 'num implied-cell', fmtUsd(r.implied_value_usd))
    );
  }

  function renderBoardRows() {
    if (state.tab !== 'board') return;
    var rows = filteredRows();
    countEl.textContent = '';
    add(countEl, [el('strong', null, fmtInt(rows.length)), rows.length === R.rows.length ? ' protocols' : ' of ' + fmtInt(R.rows.length) + ' protocols']);
    boardTbody.textContent = '';
    if (!rows.length) {
      boardTbody.appendChild(el('tr', null, el('td', { colspan: '9' }, el('div', 'empty-state',
        el('strong', null, 'No matching protocols'),
        el('p', null, 'Try clearing the search, category, chain, or watchlist filter.')
      ))));
      return;
    }
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(makeBoardRow(r)); });
    boardTbody.appendChild(frag);
  }

  function buildTable(cols, rows, rowFn) {
    return el('div', 'table-wrap', el('table', 'radar-table',
      el('thead', null, el('tr', null, cols.map(function (c) { return el('th', c[1] ? 'num' : null, c[0]); }))),
      rowFn ? el('tbody', null, rows.map(rowFn)) : boardTbody
    ));
  }

  /* --- Secondary tabs: Set aside & Trading now --- */
  function renderSecondary(note, cols, rows, rowFn) {
    tablePanel.appendChild(el('div', 'toolbar', el('span', 'formula-note', note)));
    tablePanel.appendChild(buildTable(cols, rows, rowFn));
  }

  /* --- Detail drawer --- */
  function openDrawer(slug) {
    if (!bySlug[slug]) return;
    state.selected = slug;
    setHash('#p=' + encodeURIComponent(slug));
    renderDrawer();
    renderBoardRows();
  }

  function closeDrawer() {
    state.selected = null;
    setHash(state.cat ? '#cat=' + encodeURIComponent(state.cat) : '');
    renderDrawer();
    renderBoardRows();
  }

  function renderDrawer() {
    var r = state.selected ? bySlug[state.selected] : null;
    if (!r) {
      drawer.textContent = '';
      drawer.setAttribute('hidden', '');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.className = 'drawer-backdrop';
      document.body.classList.remove('drawer-open');
      return;
    }

    var cat = catOf(r.category), ch = r.chains || [];
    var catHint = r.peer_count > 0
      ? 'median of ' + r.peer_count + ' trading peer' + (r.peer_count === 1 ? '' : 's') + ', raw ' + fmtMult(r.raw_category_median) + ' pulled toward ' + fmtMult(M.global_multiple) + ' market median'
      : 'no live peers; using ' + fmtMult(M.global_multiple) + ' market median';
    var matHint = r.age_days != null ? 'from ' + r.age_days + ' days tracked' : 'unknown listing date (' + M.unknown_age_days + 'd default)';
    var factors = [
      ['TVL', 'Snapshot total value locked', fmtUsd(r.tvl_usd), 0],
      ['\u00d7 Category multiple', catHint, fmtMult(r.category_multiple), 0],
      ['\u00d7 Growth', 'from ' + fmtPct(r.change_7d) + ' 7d TVL change', fmtMult(r.growth_multiplier), 0],
      ['\u00d7 Maturity', matHint, fmtMult(r.maturity_multiplier), 0],
      ['\u00d7 Breadth', 'from ' + ch.length + ' chain' + (ch.length === 1 ? '' : 's'), fmtMult(r.breadth_multiplier), 0],
      ['= Implied value', 'Model output for ' + (M.version || 'radar-2'), fmtUsd(r.implied_value_usd), 1]
    ];
    var peers = R.live.filter(function (p) { return catOf(p.category) === cat; }).slice(0, 3);

    drawer.textContent = '';
    drawer.removeAttribute('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.className = 'drawer-backdrop is-open';
    document.body.classList.add('drawer-open');

    add(drawer, [
      el('div', 'drawer-header',
        el('div', 'drawer-title-group',
          el('div', 'drawer-eyebrow',
            el('span', 'drawer-rank', '#' + r.rank),
            el('span', 'badge badge-cat', cat),
            r.watchlist ? el('span', 'badge badge-watchlist', '\u2605 Watchlist') : null
          ),
          el('h2', null, r.name),
          el('span', 'drawer-sub', r.slug)
        ),
        el('button', { type: 'button', class: 'drawer-close', 'aria-label': 'Close detail drawer', onClick: closeDrawer }, '\u00d7')
      ),
      el('div', 'drawer-body',
        el('div', 'valuation-hero',
          el('div', 'kpi-box primary',
            el('span', 'kpi-label', 'Implied launch value'),
            el('span', 'kpi-val', fmtUsd(r.implied_value_usd)),
            el('span', 'kpi-sub', 'Rank #' + r.rank + ' of ' + fmtInt(R.rows.length) + ' ranked protocols')
          ),
          el('div', 'kpi-box', el('span', 'kpi-label', 'TVL'), el('span', 'kpi-val', fmtUsd(r.tvl_usd))),
          el('div', 'kpi-box', el('span', 'kpi-label', '7d change'), el('span', 'kpi-val ' + pctCls(r.change_7d), fmtPct(r.change_7d))),
          el('div', 'kpi-box',
            el('span', 'kpi-label', 'Age / listed'),
            el('span', 'kpi-val', r.age_days != null ? r.age_days + ' days' : 'Unknown'),
            el('span', 'kpi-sub', r.listed_at ? 'Listed ' + r.listed_at : 'No listing date')
          ),
          el('div', 'kpi-box',
            el('span', 'kpi-label', 'Rank & chains'),
            el('span', 'kpi-val', '#' + r.rank + ' \u00b7 ' + ch.length + ' chain' + (ch.length === 1 ? '' : 's')),
            el('span', 'kpi-sub', ch.length ? ch.join(', ') : EM)
          )
        ),
        el('section', 'drawer-section',
          el('h3', null, 'Why this value'),
          el('div', 'factor-table', factors.map(function (f) {
            return el('div', 'factor-row' + (f[3] ? ' total' : ''),
              el('div', 'factor-name', f[0], el('span', 'factor-hint', f[1])),
              el('div', 'factor-val', f[2])
            );
          }))
        ),
        el('section', 'drawer-section',
          el('h3', null, 'How to farm it'),
          el('div', 'farm-meta-strip', [
            ['Suggested cap', '$' + fmtInt(r.capital_usd)],
            ['Hold window', r.hold_days + 'd'],
            ['Primary chain', ch.length ? ch[0] : EM]
          ].map(function (m) {
            return el('div', 'farm-meta-card', el('span', 'k', m[0]), el('span', 'v', m[1]));
          })),
          el('ol', 'farm-steps', (r.farm_steps || []).map(function (raw) {
            var p = parseStep(raw);
            return el('li', 'farm-step',
              el('div', 'step-action', p.a),
              (p.c || p.t) ? el('div', 'step-chips',
                p.c ? el('span', 'chip-cost', 'Cost: ' + p.c) : null,
                p.t ? el('span', 'chip-time', 'Time: ' + p.t) : null
              ) : null
            );
          }))
        ),
        el('section', 'drawer-section',
          el('h3', null, 'Trading peers in this category'),
          peers.length ? el('table', 'cat-table',
            el('thead', null, el('tr', null, el('th', null, 'Name'), el('th', null, 'Symbol'), el('th', 'num', 'Mcap'), el('th', 'num', 'Mcap/TVL'))),
            el('tbody', null, peers.map(function (p) {
              return el('tr', null,
                el('td', 'cat-name', p.name),
                el('td', null, el('span', 'badge badge-symbol', p.symbol || EM)),
                el('td', 'num', fmtUsd(p.mcap_usd)),
                el('td', 'num cat-mult', fmtMult(p.mcap_tvl_multiple))
              );
            }))
          ) : el('p', 'formula-note', 'No top-24 live peers in ' + cat + ' (' + fmtInt(r.peer_count) + ' total in snapshot).')
        )
      )
    ]);
  }

  /* --- Render & mount --- */
  function renderBody() {
    for (var k in tabBtns) {
      var act = k === state.tab;
      tabBtns[k].className = 'tab' + (act ? ' active' : '');
      tabBtns[k].setAttribute('aria-selected', act ? 'true' : 'false');
    }
    toolbar.style.display = state.tab === 'board' ? '' : 'none';
    catSelect.value = state.cat;
    chainSelect.value = state.chain;
    searchInput.value = state.q;
    wlCheck.checked = state.wl;
    sortSelect.value = state.sort;

    tablePanel.textContent = '';
    if (state.tab === 'board') {
      tablePanel.appendChild(buildTable([
        ['Rank', 0], ['Protocol', 0], ['Category', 0], ['Chains', 0],
        ['TVL', 1], ['7d %', 1], ['Age', 1], ['Cat \u00d7', 1], ['Implied', 1]
      ]));
      renderBoardRows();
    } else if (state.tab === 'aside') {
      renderSecondary(
        'These record no token either, but each is a wrapped, staked, bridged or versioned product of a token that already trades, or an exchange\u2019s own product, so a launch of its own is not what its record promises.',
        [['Name', 0], ['Category', 0], ['TVL', 1], ['Reason', 0]],
        R.set_aside,
        function (r) {
          return el('tr', null,
            el('td', null, protoCell(r.name, r.slug)),
            el('td', null, el('span', 'badge badge-cat', catOf(r.category))),
            el('td', 'num', fmtUsd(r.tvl_usd)),
            el('td', null, el('span', 'badge badge-reason', r.reason))
          );
        }
      );
    } else {
      renderSecondary(
        'These already have a token; the market\u2019s own mcap/TVL is the anchor the model borrows \u2014 they are never ranked on the board.',
        [['Name', 0], ['Symbol', 0], ['Category', 0], ['TVL', 1], ['Market cap', 1], ['Mcap/TVL', 1]],
        R.live,
        function (r) {
          return el('tr', null,
            el('td', null, protoCell(r.name, r.slug)),
            el('td', null, el('span', 'badge badge-symbol', r.symbol || EM)),
            el('td', null, el('span', 'badge badge-cat', catOf(r.category))),
            el('td', 'num', fmtUsd(r.tvl_usd)),
            el('td', 'num', fmtUsd(r.mcap_usd)),
            el('td', 'num implied-cell', fmtMult(r.mcap_tvl_multiple))
          );
        }
      );
    }
    renderDrawer();
  }

  applyHash();
  add(root, [
    el('div', 'radar-shell',
      buildHeader(),
      buildModelBox(),
      workspaceBar,
      tablePanel,
      el('footer', 'radar-footer',
        el('span', null, 'Board derived only from the snapshot\u2019s figures; a protocol is said to record no token in DefiLlama\u2019s record, never that it has none.'),
        el('span', 'mono', R.source || '')
      )
    ),
    backdrop,
    drawer
  ]);
  renderBody();

  window.addEventListener('hashchange', function () { applyHash(); renderBody(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selected) closeDrawer(); });
})();
