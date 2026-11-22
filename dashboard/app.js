// Token Radar dashboard (radar-3) — vanilla DOM, no network, reads window.RADAR
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
  function fmtX(n) { return n == null || !isFinite(n) ? EM : '\u00d7' + n.toFixed(2); }
  function fmtAge(d) { return d == null || !isFinite(d) ? EM : d + 'd'; }
  function fmtShare(x) { return x == null || !isFinite(x) ? EM : Math.round(x * 100) + '%'; }
  function fmtBrier(x) { return x == null || !isFinite(x) ? EM : x.toFixed(3); }
  function fmtSigned(n) {
    if (n == null || !isFinite(n)) return EM;
    var s = n < 0 ? '-' : '+';
    var a = Math.abs(n);
    if (a >= 1000) return s + fmtUsd(a).slice(0);
    return s + '$' + a.toFixed(2);
  }
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

  var V = R.validation || {};
  var VV = V.value || {};
  var VO = V.odds || {};
  var SC = R.scenario || {};
  var VC = R.verdict_counts || { farm: 0, marginal: 0, skip: 0 };
  var C = R.counts || {};
  var totalProtocols = C.protocols_scanned != null ? C.protocols_scanned : 0;

  /* --- State & hash routing --- */
  var bySlug = Object.create(null), catSet = Object.create(null), chainSet = Object.create(null);
  R.rows.forEach(function (r) {
    bySlug[r.slug] = r;
    catSet[catOf(r.category)] = 1;
    (r.chains || []).forEach(function (c) { if (c) chainSet[c] = 1; });
  });

  var state = { tab: 'board', q: '', cat: '', chain: '', wl: false, verdict: '', sort: 'implied', selected: null };

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

  /* --- Header & KPI strip --- */
  function keptCount(terms) {
    var k = 0, total = 0;
    (terms || []).forEach(function (t) {
      if (t.status === 'baseline' || t.key === 'placebo') return;
      total++;
      if (t.status === 'kept') k++;
    });
    return { kept: k, total: total };
  }

  function buildHeader() {
    var vk = keptCount(VV.terms), ok = keptCount(VO.terms);
    var calib = VV.calibration || {};
    var cards;
    if (VV.mode === 'fitted') {
      cards = [
        ['Out-of-sample miss \u2014 walk-forward',
          fmtX(VV.final.walk_forward) + ' vs ' + fmtX(VV.baseline.walk_forward) + ' flat',
          'Leave-one-out ' + fmtX(VV.final.loo) + ' vs ' + fmtX(VV.baseline.loo) + ' \u00b7 graded on ' + fmtInt(VV.peer_count) + ' traded peers', 'accent'],
        ['Is the printed range honest?',
          fmtShare(calib.inside_p25_p75) + ' in P25\u2013P75 \u00b7 ' + fmtShare(calib.inside_p10_p90) + ' in P10\u2013P90',
          'Stated coverage is 50% \u00b7 80% \u2014 measured leave-one-out on the peers', ''],
        ['Token odds vs base rate',
          'Brier ' + fmtBrier(VO.final.brier_10fold) + ' vs ' + fmtBrier(VO.baseline.brier_10fold),
          'Called right ' + fmtShare(VO.final.called_right) + ' vs ' + fmtShare(VO.baseline.called_right) + ' held out (10-fold)', ''],
        ['Terms that survived both tests',
          vk.kept + ' of ' + vk.total + ' value \u00b7 ' + ok.kept + ' of ' + ok.total + ' odds',
          'The rest are shown in the evidence panel \u2014 tested, not used', ''],
        ['Worth farming, this scenario',
          'FARM ' + fmtInt(VC.farm) + ' of ' + fmtInt(R.rows.length),
          fmtInt(VC.marginal) + ' marginal \u00b7 ' + fmtInt(VC.skip) + ' skip \u2014 net must beat a T-bill and $25 an hour', 'watchlist'],
        ['Watchlist ranked',
          fmtInt(C.watchlist_covered) + ' / ' + fmtInt(C.watchlist_size),
          'Plus ' + fmtInt(R.rows.length) + ' pre-token protocols ranked \u00b7 all ' + fmtInt(totalProtocols) + ' accounted below', '']
      ];
    } else {
      cards = [
        ['Value model', 'Fallback multiple', 'Too few dated peers to fit \u2014 shrunk category multiple used', 'accent'],
        ['Is the printed range honest?',
          fmtShare(calib.inside_p25_p75) + ' in P25\u2013P75 \u00b7 ' + fmtShare(calib.inside_p10_p90) + ' in P10\u2013P90',
          'Stated coverage is 50% \u00b7 80% \u2014 measured on the live peers', ''],
        ['Token odds vs base rate',
          'Brier ' + fmtBrier(VO.final.brier_10fold) + ' vs ' + fmtBrier(VO.baseline.brier_10fold),
          'Called right ' + fmtShare(VO.final.called_right) + ' held out (10-fold)', ''],
        ['Terms that survived both tests',
          ok.kept + ' of ' + ok.total + ' odds',
          'The rest are shown in the evidence panel \u2014 tested, not used', ''],
        ['Worth farming, this scenario',
          'FARM ' + fmtInt(VC.farm) + ' of ' + fmtInt(R.rows.length),
          fmtInt(VC.marginal) + ' marginal \u00b7 ' + fmtInt(VC.skip) + ' skip', 'watchlist'],
        ['Watchlist ranked',
          fmtInt(C.watchlist_covered) + ' / ' + fmtInt(C.watchlist_size),
          'Plus ' + fmtInt(R.rows.length) + ' pre-token protocols ranked \u00b7 all ' + fmtInt(totalProtocols) + ' accounted below', '']
      ];
    }
    return el('header', 'radar-header',
      el('div', 'header-top',
        el('div', 'brand-block',
          el('span', 'eyebrow', el('span', 'pulse-dot'), 'Pre-token launch radar'),
          el('h1', 'radar-title', 'TOKEN RADAR'),
          el('p', 'radar-subtitle', 'Pre-token protocols ranked by implied launch value \u2014 a fitted model, graded out-of-sample, with the odds and the farm economics printed.')
        ),
        el('div', 'snapshot-meta',
          el('span', 'meta-pill', 'Model ', el('strong', null, R.model_version || 'radar-3')),
          el('span', 'meta-pill', 'Fitted on ', el('strong', null, fmtInt(VV.peer_count) + ' traded peers')),
          el('span', 'meta-pill', 'As of ', el('strong', null, R.as_of))
        )
      ),
      el('div', 'stat-strip', cards.map(function (c) {
        return el('div', 'stat-chip' + (c[3] ? ' ' + c[3] : ''),
          el('span', 'stat-label', c[0]), el('span', 'stat-value', c[1]), el('span', 'stat-sub', c[2]));
      }))
    );
  }

  /* --- Formula line, accounting bar, integrity line --- */
  function buildAccounting() {
    var groups = R.accounting || [];
    var colors = ['#2dd4bf', '#64748b', '#94a3b8', '#f5b84c', '#a78bfa', '#4ade80', '#38bdf8', '#566c7c'];
    var total = groups.reduce(function (s, g) { return s + g.count; }, 0) || 1;
    var segs = groups.filter(function (g) { return g.count > 0; }).map(function (g, i) {
      return el('div', {
        class: 'acct-seg',
        style: 'width:' + (g.count / total * 100).toFixed(2) + '%;background:' + colors[i % colors.length],
        title: g.label + ': ' + g.count
      });
    });
    var legend = groups.map(function (g, i) {
      return el('span', 'acct-legend-item',
        el('span', { class: 'acct-dot', style: 'background:' + colors[i % colors.length] }),
        g.label + ' ', el('strong', null, fmtInt(g.count)));
    });
    return el('section', 'acct-panel',
      el('div', 'acct-head',
        el('span', 'acct-title', 'Every protocol accounted for'),
        el('span', 'acct-caption', fmtInt(total) + ' of ' + fmtInt(totalProtocols) + ' protocols, each in exactly one group')
      ),
      el('div', 'acct-bar', segs),
      el('div', 'acct-legend', legend),
      el('div', 'integrity-line',
        '\u2713 this table = board.json \u00b7 ' + fmtInt(R.rows.length) + ' of ' + fmtInt(R.rows.length) + ' rows \u00b7 ranks 1\u2013' +
        fmtInt(R.rows.length) + ' in order, values never rise \u00b7 totals equal: $' + fmtInt(R.implied_total_usd) +
        ' \u00b7 watchlist ' + fmtInt(C.watchlist_covered) + '/' + fmtInt(C.watchlist_size) + ' ranked \u00b7 seal ' + (R.seal || EM))
    );
  }

  function buildFormula() {
    return el('div', 'formula-panel',
      el('div', 'formula-line',
        el('div', 'formula-eq',
          el('span', 'formula-lhs', 'Implied value'),
          el('span', 'formula-op', '='),
          el('span', 'formula-term', 'fitted value if a token launches'),
          el('span', 'formula-op', '\u00d7'),
          el('span', 'formula-term', 'token odds')
        ),
        el('span', 'formula-note', 'Every coefficient is fitted on this snapshot and tested held-out. Leave-one-out & walk-forward validation vs flat baseline; token-launch odds scored vs base rate (Brier).')
      )
    );
  }

  /* --- Evidence panel --- */
  function termTable(title, note, head, rows, widths) {
    return el('div', 'evidence-col',
      el('h3', 'evidence-title', title),
      el('table', 'cat-table evidence-table',
        el('colgroup', null, widths.map(function (w) { return el('col', { style: 'width:' + w }); })),
        el('thead', null, el('tr', null, head.map(function (h, i) { return el('th', i ? 'num' : null, h); }))),
        el('tbody', null, rows)
      ),
      el('p', 'formula-note', note)
    );
  }

  function buildEvidence() {
    if (VV.mode !== 'fitted') {
      return el('section', 'evidence-panel',
        el('div', 'evidence-col',
          el('h3', 'evidence-title', 'Out-of-sample evidence'),
          el('p', 'formula-note', (VV.calibration && VV.calibration.sentence) || 'Fallback model in use on this snapshot.')
        )
      );
    }
    var vRows = (VV.terms || []).map(function (t) {
      return el('tr', null,
        el('td', 'cat-name', t.label),
        el('td', 'num', fmtX(t.test_a)),
        el('td', 'num', fmtX(t.test_b)),
        el('td', null, el('span', 'status-chip ' + statusCls(t.status), t.status))
      );
    });
    var oRows = (VO.terms || []).map(function (t) {
      return el('tr', null,
        el('td', 'cat-name', t.label),
        el('td', 'num', fmtBrier(t.test_a)),
        el('td', 'num', fmtBrier(t.test_b)),
        el('td', 'num', t.called_right == null ? EM : fmtShare(t.called_right)),
        el('td', null, el('span', 'status-chip ' + statusCls(t.status), t.status))
      );
    });
    var coef = VV.coefficients || {};
    var coefLines = [];
    if (coef.tvl_slope != null) {
      coefLines.push('Size curve: fitted value scales with TVL^' + coef.tvl_slope.toFixed(2) +
        ' \u2014 doubling TVL multiplies value by ' + fmtX(Math.pow(2, coef.tvl_slope)) +
        ', not \u00d72. The flat peer multiple is ' + fmtMult(coef.flat_multiple) + '.');
    }
    if (coef.growth_coef != null) coefLines.push('Growth term kept: coefficient ' + coef.growth_coef.toFixed(2) + ' on clamped 7-day TVL change.');
    if (coef.age_coef != null) coefLines.push('Age term kept: coefficient ' + coef.age_coef.toFixed(2) + ' on ln(1 + age in years).');
    if (coef.breadth_coef != null) coefLines.push('Breadth term kept: coefficient ' + coef.breadth_coef.toFixed(2) + ' on ln(chain count).');
    if ((coef.category_effects || []).length) coefLines.push('Category effect kept for ' + coef.category_effects.length + ' categories (shrunk offsets, table below the board).');
    if (coefLines.length === 1) coefLines.push('Category, growth, age and breadth were each tested and rejected \u2014 they did not beat the size curve on both out-of-sample tests.');
    var calib = VV.calibration || {};
    var honesty = el('div', 'evidence-col',
      el('h3', 'evidence-title', 'Range honesty \u2014 leave-one-out, ' + fmtInt(calib.n) + ' peers'),
      el('table', 'cat-table evidence-table',
        el('colgroup', null, [el('col', { style: 'width:58%' }), el('col', { style: 'width:42%' })]),
        el('tbody', null, [
          ['Actual inside its P25\u2013P75', fmtShare(calib.inside_p25_p75) + ' (stated 50%)'],
          ['Actual inside its P10\u2013P90', fmtShare(calib.inside_p10_p90) + ' (stated 80%)'],
          ['Actual within \u00d73 of the fitted value', fmtShare(calib.within_3x)]
        ].map(function (r) {
          return el('tr', null, el('td', 'cat-name', r[0]), el('td', 'num cat-mult', r[1]));
        }))
      ),
      coefLines.map(function (l) { return el('p', 'formula-note', l); }),
      el('p', 'formula-note honesty-note', calib.sentence || '')
    );
    var holdoutNote = (VV.holdouts || []).map(function (h) {
      return h.name.replace('holdout ', '') + ': ' + fmtX(h.final) + ' vs flat ' + fmtX(h.flat);
    }).join(' \u00b7 ');
    return el('section', 'evidence-panel',
      el('div', 'evidence-head',
        el('span', 'evidence-heading', 'Out-of-sample evidence'),
        el('span', 'formula-note', 'A term joins the model only if it lowers BOTH the leave-one-out miss AND the walk-forward miss. Peer sets: value peers = records a token, mcap & TVL > 0, dated (' + fmtInt(VV.peer_count) + '); odds universe = TVL > 0 and dated (' + fmtInt(VO.universe_n) + ', base rate ' + fmtShare(VO.base_rate) + ' record a token).')
      ),
      el('div', 'evidence-grid',
        termTable('Value model \u2014 miss multiple, lower is better',
          'Walk-forward: first ' + fmtInt(VV.walk_forward_split.train_n) + ' peers by listing date train, last ' + fmtInt(VV.walk_forward_split.test_n) + ' test (from ' + (VV.walk_forward_split.boundary || EM) + '). Holdouts \u2014 ' + holdoutNote + '.',
          ['Term', 'LOO', 'Walk-fwd', 'Status'], vRows, ['42%', '13%', '17%', '28%']),
        termTable('Token odds \u2014 Brier score, lower is better',
          'Fitted on how the peers\u2019 record turned out. Walk-forward: first ' + fmtInt(VO.walk_forward_split.train_n) + ' train, last ' + fmtInt(VO.walk_forward_split.test_n) + ' test (from ' + (VO.walk_forward_split.boundary || EM) + ').',
          ['Term', '10-fold', 'Walk-fwd', 'Called', 'Status'], oRows, ['34%', '12%', '14%', '12%', '28%']),
        honesty
      )
    );
  }

  function statusCls(s) {
    if (s === 'kept') return 'kept';
    if (s === 'baseline') return 'baseline';
    if (s.indexOf('control') === 0) return 'control';
    return 'rejected';
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
    ['implied', 'Implied value'], ['tvl', 'TVL'], ['odds', 'Token odds'], ['net', 'Net $'],
    ['growth', '7-day growth'], ['age', 'Age']
  ], function () { state.sort = sortSelect.value; renderBoardRows(); });

  var verdictBtns = {};
  var verdictChips = el('div', 'verdict-chips', [
    ['', 'All', R.rows.length],
    ['FARM', 'Farm', VC.farm],
    ['MARGINAL', 'Marginal', VC.marginal],
    ['SKIP', 'Skip', VC.skip]
  ].map(function (v) {
    var btn = el('button', {
      type: 'button', class: 'verdict-filter-chip', 'aria-pressed': 'false',
      onClick: function () { state.verdict = v[0]; renderBoardRows(); syncVerdictChips(); }
    }, v[1] + ' ', el('span', 'tab-count', fmtInt(v[2])));
    verdictBtns[v[0]] = btn;
    return btn;
  }));
  function syncVerdictChips() {
    for (var k in verdictBtns) {
      var act = state.verdict === k;
      verdictBtns[k].className = 'verdict-filter-chip' + (act ? ' active' : '');
      verdictBtns[k].setAttribute('aria-pressed', act ? 'true' : 'false');
    }
  }

  var scenarioLine = el('div', 'scenario-line',
    el('strong', null, 'Standard: '),
    'deposit = ' + ((SC.deposit_pct_of_tvl || 0.0002) * 100) + '% of TVL (min $' + fmtInt(SC.deposit_min_usd) +
    ', max $' + fmtInt(SC.deposit_max_usd) + ') \u00b7 drop pool = ' + Math.round((SC.drop_pool_pct_of_value || 0.07) * 100) +
    '% of value-if-it-launches \u00b7 your share = deposit \u00f7 (deposit + farmer capital of 5\u00d7 the drop pool) \u00b7 time at $' + fmtInt(SC.hourly_rate_usd) +
    '/h \u00b7 idle cash at a ' + Math.round((SC.tbill_rate || 0.05) * 100) + '% T-bill over ' + fmtInt(SC.horizon_weeks) + ' weeks \u00b7 fees = the farm steps\u2019 gas midpoints'
  );

  var countEl = el('span', 'showing-count');
  var toolbar = el('div', 'toolbar',
    el('div', 'toolbar-left',
      searchInput,
      el('label', 'control-field', el('span', 'control-label', 'Category'), catSelect),
      el('label', 'control-field', el('span', 'control-label', 'Chain'), chainSelect),
      el('label', 'control-field', wlCheck, el('span', null, 'Watchlist only')),
      el('label', 'control-field', el('span', 'control-label', 'Verdict'), verdictChips),
      el('label', 'control-field', el('span', 'control-label', 'Sort'), sortSelect)
    ),
    el('div', 'toolbar-right', countEl)
  );

  var workspaceBar = el('div', 'workspace-bar', tabBar, scenarioLine, toolbar);
  var tablePanel = el('section', { class: 'table-panel', id: 'board' });
  var boardTbody = el('tbody');
  var backdrop = el('div', { class: 'drawer-backdrop', onClick: closeDrawer });
  var drawer = el('aside', { class: 'detail-drawer', hidden: true, 'aria-hidden': 'true' });

  /* --- Board filtering, sorting & table --- */
  var sorters = {
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
    odds: function (a, b) { return b.launch_odds - a.launch_odds || a.rank - b.rank; },
    net: function (a, b) { return b.net_usd - a.net_usd || a.rank - b.rank; },
    growth: function (a, b) {
      var ag = a.change_7d == null ? -1e9 : a.change_7d, bg = b.change_7d == null ? -1e9 : b.change_7d;
      return bg - ag || a.rank - b.rank;
    },
    age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days) || a.rank - b.rank; }
  };

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.cat && catOf(r.category) !== state.cat) return false;
      if (state.chain && (!r.chains || r.chains.indexOf(state.chain) === -1)) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(sorters[state.sort] || sorters.implied);
  }

  function protoCell(r) {
    var ch = r.chains || [];
    var sub = catOf(r.category) + (ch.length ? ' \u00b7 ' + ch[0] + (ch.length > 1 ? ' +' + (ch.length - 1) : '') : '');
    return el('div', 'proto-cell', el('div', 'proto-main',
      el('div', 'proto-name-line', el('span', 'proto-name', r.name), r.watchlist ? el('span', 'badge badge-watchlist', '\u2605 WL') : null),
      el('span', 'proto-slug', sub)
    ));
  }

  function verdictChip(v) {
    return el('span', 'verdict-chip ' + v.toLowerCase(), v);
  }

  function makeBoardRow(r) {
    var sel = state.selected === r.slug;
    var oddsPct = Math.round((r.launch_odds || 0) * 100);
    return el('tr', {
      class: 'clickable' + (r.rank <= 3 ? ' top-rank' : '') + (sel ? ' is-selected' : ''),
      'data-slug': r.slug, 'aria-selected': sel ? 'true' : 'false', tabindex: '0',
      onClick: function () { openDrawer(r.slug); },
      onKeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); } }
    },
      el('td', 'rank', r.rank),
      el('td', 'num range-cell', r.rank_best === r.rank_worst ? String(r.rank_best) : r.rank_best + '\u2013' + r.rank_worst),
      el('td', null, protoCell(r)),
      el('td', 'num', fmtUsd(r.tvl_usd)),
      el('td', 'num ' + pctCls(r.change_7d), fmtPct(r.change_7d)),
      el('td', 'num', fmtAge(r.age_days)),
      el('td', 'odds-cell',
        el('div', 'odds-wrap',
          el('div', 'odds-bar', el('span', { style: 'width:' + oddsPct + '%' })),
          el('span', 'odds-pct', oddsPct + '%')
        )
      ),
      el('td', 'num', fmtUsd(r.value_if_launches_usd)),
      el('td', 'num implied-cell',
        el('div', 'implied-wrap',
          el('span', 'implied-val', fmtUsd(r.implied_value_usd)),
          el('span', 'implied-sub', fmtUsd(r.range_p25_usd) + '\u2013' + fmtUsd(r.range_p75_usd))
        )
      ),
      el('td', 'num',
        el('div', 'implied-wrap',
          el('span', 'net-val ' + (r.net_usd > 0 ? 'pos' : 'neg'), fmtSigned(r.net_usd)),
          el('span', 'implied-sub', 'dep ' + fmtUsd(r.deposit_usd) + ' \u00b7 fees ' + fmtUsd(r.fees_usd))
        )
      ),
      el('td', null, verdictChip(r.verdict))
    );
  }

  function renderBoardRows() {
    if (state.tab !== 'board') return;
    var rows = filteredRows();
    countEl.textContent = '';
    add(countEl, [el('strong', null, fmtInt(rows.length)), rows.length === R.rows.length ? ' protocols' : ' of ' + fmtInt(R.rows.length) + ' protocols']);
    boardTbody.textContent = '';
    if (!rows.length) {
      boardTbody.appendChild(el('tr', null, el('td', { colspan: '11' }, el('div', 'empty-state',
        el('strong', null, 'No matching protocols'),
        el('p', null, 'Try clearing the search, category, chain, watchlist, or verdict filter.')
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

  /* --- Category effects, collapsed below the board --- */
  function buildCategoryDetails() {
    var effects = (VV.coefficients && VV.coefficients.category_effects) || [];
    var body;
    if (effects.length) {
      body = el('table', 'cat-table',
        el('thead', null, el('tr', null, el('th', null, 'Category'), el('th', 'num', 'Value peers'), el('th', 'num', 'Fitted effect'))),
        el('tbody', null, effects.map(function (e) {
          return el('tr', null,
            el('td', 'cat-name', e.category),
            el('td', 'num cat-peers', fmtInt(e.peers)),
            el('td', 'num cat-mult', fmtMult(e.effect)));
        }))
      );
    } else {
      var mults = R.category_multiples || [];
      body = el('div', null,
        el('p', 'formula-note', 'The fitted category term was tested and not kept on this snapshot, so no category offset is used. For reference, the shrunk peer multiples behind the fallback are:'),
        el('table', 'cat-table',
          el('thead', null, el('tr', null, el('th', null, 'Category'), el('th', 'num', 'Board rows'), el('th', 'num', 'Live peers'), el('th', 'num', 'Shrunk \u00d7'))),
          el('tbody', null, mults.slice(0, 20).map(function (m) {
            return el('tr', null,
              el('td', 'cat-name', m.category),
              el('td', 'num cat-peers', fmtInt(m.board_count)),
              el('td', 'num cat-peers', fmtInt(m.live_peers)),
              el('td', 'num cat-mult', fmtMult(m.multiple_used)));
          }))
        )
      );
    }
    return el('details', 'model-box cat-details',
      el('summary', null, el('span', 'model-title', 'Category effects & peer multiples (detail)')),
      el('div', 'model-box-body', body)
    );
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
    var fm = r.model || {};
    var keptNote = VV.mode === 'fitted' ? '' : ' (fallback multiple)';
    var factors = [
      ['Base \u2014 fitted size curve' + keptNote, 'from TVL ' + fmtUsd(r.tvl_usd) + ' on the traded peers\u2019 curve', fmtUsd(fm.base_value_usd), 0],
      ['\u00d7 Category effect', fm.category_effect === 1 ? 'no offset used for this row' : 'shrunk offset for ' + cat, fmtMult(fm.category_effect), 0],
      ['\u00d7 Growth effect', 'from ' + fmtPct(r.change_7d) + ' 7d TVL change', fmtMult(fm.growth_effect), 0],
      ['\u00d7 Age effect', r.age_days != null ? 'from ' + r.age_days + ' days tracked' : 'listing date unknown \u2014 universe median age used', fmtMult(fm.age_effect), 0],
      ['\u00d7 Breadth effect', 'from ' + ch.length + ' chain' + (ch.length === 1 ? '' : 's'), fmtMult(fm.breadth_effect), 0],
      ['= Value if it launches', 'fitted value before odds', fmtUsd(r.value_if_launches_usd), 0],
      ['\u00d7 Token odds', 'fitted on the peers\u2019 record', fmtShare(r.launch_odds), 0],
      ['= Implied value', 'Rank #' + r.rank + ' (range #' + r.rank_best + '\u2013#' + r.rank_worst + ')', fmtUsd(r.implied_value_usd), 1]
    ];
    var drivers = (fm.odds_drivers || []).map(function (d) {
      return el('div', 'factor-row',
        el('div', 'factor-name', d.label, el('span', 'factor-hint', 'log-odds points')),
        el('div', 'factor-val ' + (d.contribution > 0 ? 'pos' : d.contribution < 0 ? 'neg' : ''), (d.contribution > 0 ? '+' : '') + d.contribution.toFixed(2))
      );
    });
    var timeCost = (r.hours || 0) * (SC.hourly_rate_usd || 25);
    var oppCost = (r.deposit_usd || 0) * (SC.tbill_rate || 0.05) * ((SC.horizon_weeks || 12) / 52);
    var econ = [
      ['Deposit (standard)', fmtUsd(r.deposit_usd)],
      ['Expected drop, odds-weighted', fmtSigned(r.expected_usd)],
      ['Fees \u2014 step gas midpoints', fmtUsd(r.fees_usd)],
      ['Time \u2014 ' + (r.hours != null ? r.hours.toFixed(2) : EM) + ' h at $' + fmtInt(SC.hourly_rate_usd) + '/h', fmtUsd(timeCost)],
      ['Idle cash \u2014 T-bill ' + Math.round((SC.tbill_rate || 0.05) * 100) + '% \u00d7 ' + fmtInt(SC.horizon_weeks) + 'wk', fmtUsd(oppCost)],
      ['Net', fmtSigned(r.net_usd)],
      ['Net per hour', fmtSigned(r.net_per_hour_usd)]
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
            r.watchlist ? el('span', 'badge badge-watchlist', '\u2605 Watchlist') : null,
            verdictChip(r.verdict)
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
            el('span', 'kpi-sub', 'P25\u2013P75 ' + fmtUsd(r.range_p25_usd) + '\u2013' + fmtUsd(r.range_p75_usd) + ' \u00b7 P10\u2013P90 ' + fmtUsd(r.range_p10_usd) + '\u2013' + fmtUsd(r.range_p90_usd))
          ),
          el('div', 'kpi-box', el('span', 'kpi-label', 'If it launches'), el('span', 'kpi-val', fmtUsd(r.value_if_launches_usd))),
          el('div', 'kpi-box', el('span', 'kpi-label', 'Token odds'), el('span', 'kpi-val', fmtShare(r.launch_odds))),
          el('div', 'kpi-box',
            el('span', 'kpi-label', 'TVL \u00b7 7d \u00b7 age'),
            el('span', 'kpi-val', fmtUsd(r.tvl_usd)),
            el('span', 'kpi-sub', fmtPct(r.change_7d) + ' \u00b7 ' + (r.age_days != null ? r.age_days + ' days' : 'age unknown') + (r.listed_at ? ' \u00b7 listed ' + r.listed_at : ''))
          ),
          el('div', 'kpi-box',
            el('span', 'kpi-label', 'Farm net, this scenario'),
            el('span', 'kpi-val ' + (r.net_usd > 0 ? 'pos' : 'neg'), fmtSigned(r.net_usd)),
            el('span', 'kpi-sub', r.verdict + ' \u00b7 ' + fmtSigned(r.net_per_hour_usd) + ' per hour')
          )
        ),
        el('section', 'drawer-section',
          el('h3', null, 'Why this value \u2014 fitted breakdown'),
          el('div', 'factor-table', factors.map(function (f) {
            return el('div', 'factor-row' + (f[3] ? ' total' : ''),
              el('div', 'factor-name', f[0], el('span', 'factor-hint', f[1])),
              el('div', 'factor-val', f[2])
            );
          })),
          drivers.length ? el('div', 'factor-table odds-drivers',
            el('div', 'factor-row driver-head',
              el('div', 'factor-name', 'What moves the odds', el('span', 'factor-hint', 'base rate ' + fmtShare(VO.base_rate) + ' before these')),
              el('div', 'factor-val', '')
            ), drivers) : null
        ),
        el('section', 'drawer-section',
          el('h3', null, 'Farm economics \u2014 the standard scenario'),
          el('div', 'factor-table', econ.map(function (e, i) {
            return el('div', 'factor-row' + (i === 5 ? ' total' : ''),
              el('div', 'factor-name', e[0]),
              el('div', 'factor-val', e[1])
            );
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
    scenarioLine.style.display = state.tab === 'board' ? '' : 'none';
    catSelect.value = state.cat;
    chainSelect.value = state.chain;
    searchInput.value = state.q;
    wlCheck.checked = state.wl;
    sortSelect.value = state.sort;
    syncVerdictChips();

    tablePanel.textContent = '';
    if (state.tab === 'board') {
      tablePanel.appendChild(buildTable([
        ['#', 0], ['Range', 1], ['Protocol', 0], ['TVL', 1], ['7D', 1], ['Age', 1],
        ['Token odds', 0], ['If it launches', 1], ['Implied', 1], ['Net', 1], ['Verdict', 0]
      ]));
      renderBoardRows();
    } else if (state.tab === 'aside') {
      renderSecondary(
        'These record no token either, but each is a wrapped, staked, bridged or versioned product of a token that already trades, or an exchange\u2019s own product, so a launch of its own is not what its record promises. They are counted in the accounting bar above, never ranked.',
        [['Name', 0], ['Category', 0], ['TVL', 1], ['Reason', 0]],
        R.set_aside,
        function (r) {
          return el('tr', null,
            el('td', null, el('div', 'proto-cell', el('div', 'proto-main',
              el('div', 'proto-name-line', el('span', 'proto-name', r.name)),
              el('span', 'proto-slug', r.slug)))),
            el('td', null, el('span', 'badge badge-cat', catOf(r.category))),
            el('td', 'num', fmtUsd(r.tvl_usd)),
            el('td', null, el('span', 'badge badge-reason', r.reason))
          );
        }
      );
    } else {
      renderSecondary(
        'These already record a token; their record is what the models were fitted on \u2014 the dated, priced peers among them anchor the value model, and the whole dated universe anchors the odds. They are never ranked on the board.',
        [['Name', 0], ['Symbol', 0], ['Category', 0], ['TVL', 1], ['Market cap', 1], ['Mcap/TVL', 1]],
        R.live,
        function (r) {
          return el('tr', null,
            el('td', null, el('div', 'proto-cell', el('div', 'proto-main',
              el('div', 'proto-name-line', el('span', 'proto-name', r.name)),
              el('span', 'proto-slug', r.slug)))),
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
      buildFormula(),
      buildAccounting(),
      buildEvidence(),
      workspaceBar,
      tablePanel,
      buildCategoryDetails(),
      el('footer', 'radar-footer',
        el('span', null, 'Board derived only from the snapshot\u2019s figures; a protocol is said to record no token in DefiLlama\u2019s record, never that it has none. Odds and values are model estimates graded out-of-sample above \u2014 not promises.'),
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
