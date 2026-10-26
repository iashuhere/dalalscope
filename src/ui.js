/* ================= UI ================= */
if (typeof document !== 'undefined') (function(){
  var $ = function(id){ return document.getElementById(id); };
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches:false };
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function inr(n, dec){ dec = dec == null ? 2 : dec; return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits:dec, maximumFractionDigits:dec }); }
  function pct(p){ return (+(p * 100).toFixed(4)).toString() + '%'; }
  function ruleText(r){
    if (!r) return 'Not offered';
    switch (r.t) {
      case 'z': return '₹0';
      case 'f': return '₹' + r.a + ' per order';
      case 'l': return (r.p >= 0.025 ? '₹' + r.a + ' per order' : '₹' + r.a + ' or ' + pct(r.p)) + (r.mn ? ', min ₹5' : '');
      case 'p': return pct(r.p) + ' of value';
      case 'lot': return '₹' + r.a + ' per lot';
    }
    return '—';
  }
  function shortRule(r){ return ruleText(r).replace(' per order', '').replace(' of value', ''); }
  function fullName(b){ return b.name + (b.plan && b.plan !== 'Standard' ? ' ' + b.plan : ''); }
  function joinNames(a){ return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  var LAZY = {}, lazyN = 0;
  function lazy(cls, html){ var k = 'z' + (++lazyN); LAZY[k] = html; return '<div class="' + cls + '" data-lazy="' + k + '"></div>'; }
  document.addEventListener('toggle', function(e){
    var d = e.target; if (!d.open || !d.querySelector) return;
    var slot = d.querySelector(':scope > [data-lazy]');
    if (slot && !slot.childElementCount && LAZY[slot.dataset.lazy]) { slot.innerHTML = LAZY[slot.dataset.lazy]; delete LAZY[slot.dataset.lazy]; }
  }, true);
  function rankLabel(i){ return '[' + (i < 9 ? '0' : '') + (i + 1) + ']'; }
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(d){ var p = d.split('-'); return +p[2] + ' ' + MON[+p[1] - 1]; }
  function fmtDateY(d){ var p = d.split('-'); return +p[2] + ' ' + MON[+p[1] - 1] + ' ' + p[0]; }
  function store(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function safeHref(u){ return okUrl(u) ? esc(u) : '#'; }

  /* ---------- theme: night by default, day on request ---------- */
  var root = document.documentElement;
  function paintTheme(){ var t = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; $('thLight').setAttribute('aria-pressed', String(t === 'light')); $('thDark').setAttribute('aria-pressed', String(t === 'dark')); var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === 'light' ? '#E8F0F5' : '#061020'; }
  function setTheme(t){ root.setAttribute('data-theme', t); try { localStorage.setItem('brc-theme', t); } catch (e) {} paintTheme(); }
  $('thLight').addEventListener('click', function(){ setTheme('light'); });
  $('thDark').addEventListener('click', function(){ setTheme('dark'); });
  paintTheme();

  /* ---------- fold 1: stock calculator ---------- */
  var STOCKS = [], BY = {}, POPULAR = [];
  function indexStocks(list){
    STOCKS = list; BY = {};
    STOCKS.forEach(function(x){ BY[x.s] = x; });
    POPULAR = ['RELIANCE','HDFCBANK','TCS','INFY','SBIN','ITC','TMPV','ETERNAL','IRFC','NIFTYBEES'].filter(function(s){ return BY[s]; });
  }
  indexStocks(parseStocks(STOCK_DATA));
  var saved = load('brc-stock') || {};
  var S = { stock: BY[saved.s] || BY.HDFCBANK || STOCKS[0], qty: saved.q > 0 ? saved.q : 250, type: saved.t === 'intra' ? 'intra' : 'del', side: ['buy','sell','both'].indexOf(saved.side) >= 0 ? saved.side : 'both', rank:'total' };
  function persist(){ store('brc-stock', { s:S.stock.s, q:S.qty, t:S.type, side:S.side }); }
  var pendingSym = saved.s && !BY[saved.s] ? saved.s : null; /* a saved stock outside the starter list, restored once the full list loads */

  var inp = $('stockInput'), lb = $('stockList'), active = -1, results = [];
  function tagText(t){ return t === 'T2T' ? 'Trade-to-trade' : t === 'Z' ? 'Z group' : t === 'SME' ? 'SME' : ''; }
  function openList(items, emptyMsg){
    results = items; active = items.length ? 0 : -1;
    if (!items.length) {
      lb.innerHTML = emptyMsg ? '<li class="none" role="option" aria-disabled="true">' + esc(emptyMsg) + '</li>' : '';
      lb.hidden = !emptyMsg; inp.setAttribute('aria-expanded', String(!!emptyMsg)); inp.removeAttribute('aria-activedescendant'); return;
    }
    lb.innerHTML = items.map(function(x, i){ return '<li role="option" id="opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === active) + '"><span class="ls">' + esc(x.s) + '</span><span class="ln">' + esc(x.n) + '</span>' + (x.t ? '<span class="lt">' + tagText(x.t) + '</span>' : '') + '</li>'; }).join('');
    lb.hidden = false; inp.setAttribute('aria-expanded', 'true'); inp.setAttribute('aria-activedescendant', 'opt-0');
  }
  function closeList(){ lb.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); active = -1; }
  function moveActive(d){
    if (!results.length) return;
    active = (active + d + results.length) % results.length;
    lb.querySelectorAll('li[role="option"]').forEach(function(li, i){ li.setAttribute('aria-selected', String(i === active)); });
    inp.setAttribute('aria-activedescendant', 'opt-' + active);
    var el = $('opt-' + active); if (el) el.scrollIntoView({ block:'nearest' });
  }
  function choose(x){ pendingSym = null; S.stock = x; inp.value = ''; inp.placeholder = x.s + ' · ' + x.n; closeList(); persist(); renderStock(true); }
  inp.addEventListener('input', function(){
    var q = inp.value;
    if (!q.trim()) { openList(POPULAR.map(function(s){ return BY[s]; })); return; }
    openList(searchStocks(STOCKS, q, 8), 'No listed stock matches “' + q.trim() + '”. Try the company name or NSE symbol.');
  });
  inp.addEventListener('focus', function(){ if (!inp.value.trim()) openList(POPULAR.map(function(s){ return BY[s]; })); });
  inp.addEventListener('keydown', function(e){
    if (e.key === 'ArrowDown') { e.preventDefault(); if (lb.hidden) inp.dispatchEvent(new Event('input')); else moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && results[active]) choose(results[active]); }
    else if (e.key === 'Escape') { inp.value = ''; closeList(); }
  });
  inp.addEventListener('blur', function(){ setTimeout(closeList, 120); });
  lb.addEventListener('mousedown', function(e){ e.preventDefault(); });
  lb.addEventListener('click', function(e){ var li = e.target.closest('li[data-i]'); if (li) choose(results[+li.dataset.i]); });
  $('stockForm').addEventListener('submit', function(e){ e.preventDefault(); });

  function renderPopular(){ $('popular').innerHTML = POPULAR.map(function(s){ return '<button type="button" data-s="' + esc(s) + '" aria-pressed="false">' + esc(s) + '</button>'; }).join(''); }
  renderPopular();
  $('popular').addEventListener('click', function(e){ var b = e.target.closest('button'); if (b) choose(BY[b.dataset.s]); });

  var qtyEl = $('qtyInput'), qtyTimer = 0;
  qtyEl.addEventListener('input', function(){ var v = Math.floor(+qtyEl.value); if (v > 0) { S.qty = v; persist(); renderStock(false); clearTimeout(qtyTimer); qtyTimer = setTimeout(function(){ snapLock(); }, 350); } });
  qtyEl.addEventListener('blur', function(){ qtyEl.value = S.qty; });
  function stepQty(d){ var step = S.qty >= 1000 ? 100 : S.qty >= 100 ? 10 : 1; S.qty = Math.max(1, S.qty + d * step); qtyEl.value = S.qty; persist(); renderStock(true); }
  $('qtyMinus').addEventListener('click', function(){ stepQty(-1); });
  $('qtyPlus').addEventListener('click', function(){ stepQty(1); });
  function setType(t){ S.type = t; persist(); renderStock(true); }
  $('tDel').addEventListener('click', function(){ setType('del'); });
  $('tIntra').addEventListener('click', function(){ setType('intra'); });
  function setSide(s){ S.side = s; persist(); renderStock(true); }
  $('sBuy').addEventListener('click', function(){ setSide('buy'); });
  $('sSell').addEventListener('click', function(){ setSide('sell'); });
  $('sBoth').addEventListener('click', function(){ setSide('both'); });
  $('rkTotal').addEventListener('click', function(){ S.rank = 'total'; renderStock(true); });
  $('rkCom').addEventListener('click', function(){ S.rank = 'com'; renderStock(true); });

  /* the lock brackets close in on the cheapest row whenever the target changes */
  function snapLock(){
    if (RM.matches) return;
    var el = document.querySelector('#sRows .brow.lock');
    if (!el) return;
    el.classList.remove('snap'); void el.offsetWidth; el.classList.add('snap');
  }
  function setArc(el, len, offset){ el.setAttribute('stroke-dasharray', len.toFixed(2) + ' ' + (100 - len).toFixed(2)); el.setAttribute('stroke-dashoffset', (-offset).toFixed(2)); }

  function renderStock(animate){
    var x = S.stock, v = x.p * S.qty;
    var t2t = (x.t === 'T2T' || x.t === 'Z');
    var seg = t2t ? 'del' : S.type;
    inp.placeholder = x.s + ' · ' + x.n;
    $('picked').innerHTML = '<span><b>' + esc(x.s) + '</b><span class="pn">' + esc(x.n) + '</span></span>' + (x.t ? '<span class="pt">' + tagText(x.t) + '</span>' : '');
    $('popular').querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.s === x.s)); });
    if (document.activeElement !== qtyEl) qtyEl.value = S.qty;
    $('tDel').setAttribute('aria-pressed', String(seg === 'del')); $('tIntra').setAttribute('aria-pressed', String(seg === 'intra'));
    $('sBuy').setAttribute('aria-pressed', String(S.side === 'buy')); $('sSell').setAttribute('aria-pressed', String(S.side === 'sell')); $('sBoth').setAttribute('aria-pressed', String(S.side === 'both'));
    $('rkTotal').setAttribute('aria-pressed', String(S.rank === 'total')); $('rkCom').setAttribute('aria-pressed', String(S.rank === 'com'));
    var note = $('t2tNote');
    if (t2t && S.type === 'intra') { note.hidden = false; note.textContent = x.s + ' trades in the trade-to-trade segment, so intraday is not allowed. Showing delivery charges.'; }
    else note.hidden = true;
    var sideTxt = S.side === 'buy' ? 'buy' : S.side === 'sell' ? 'sell' : 'buy and sell';
    $('tradeValue').textContent = inr(v, 0) + (S.side === 'both' ? ' each way' : '');
    $('priceNote').textContent = S.qty.toLocaleString('en-IN') + ' shares at ' + inr(x.p) + ', NSE close on ' + STOCK_DATE;

    var buy = S.side !== 'sell' ? v : 0, sell = S.side !== 'buy' ? v : 0;
    var rows = BROKERS.map(function(b){ return { b:b, c:compute(b, seg, buy, sell, 1, 1) }; });
    var keyF = S.rank === 'com' ? function(r){ return r.c.brok + r.c.total / 1e9; } : function(r){ return r.c.total; };
    rows.sort(function(a, z){ return keyF(a) - keyF(z); });
    var minTot = Math.min.apply(null, rows.map(function(r){ return r.c.total; }));
    var maxTot = Math.max.apply(null, rows.map(function(r){ return r.c.total; }));
    var minCom = Math.min.apply(null, rows.map(function(r){ return r.c.brok; }));
    var cheapest = rows.filter(function(r){ return r.c.total - minTot < 0.005; });
    var priciest = rows.filter(function(r){ return maxTot - r.c.total < 0.005; })[0];
    var best = cheapest[0].c;

    /* lock-on readout */
    var gShare = best.total > 0 ? best.statutory / best.total : 0, bShare = 1 - gShare;
    setArc($('arcBrk'), bShare * 100, 0);
    setArc($('arcGov'), gShare * 100, bShare * 100);
    $('gPct').textContent = Math.round(gShare * 100) + '%';
    $('rLabel').textContent = 'Cheapest for ' + S.qty.toLocaleString('en-IN') + ' ' + x.s + ', ' + (seg === 'del' ? 'delivery' : 'intraday') + ' ' + sideTxt;
    $('rBest').textContent = joinNames(cheapest.map(function(r){ return fullName(r.b); }));
    $('rTotal').textContent = inr(best.total) + ' all in';
    $('rBrk').textContent = inr(best.brokerSide);
    $('rGov').textContent = inr(best.statutory);
    $('rWorst').innerHTML = 'Costliest is ' + esc(fullName(priciest.b)) + ' at <b>' + inr(maxTot) + '</b>, ' + inr(maxTot - minTot) + ' more for the same trade.';
    var agg = cheapest.filter(function(r){ return r.b.src === 'agg'; });
    $('rCaveat').hidden = !agg.length;
    if (agg.length) $('rCaveat').textContent = joinNames(agg.map(function(r){ return r.b.name; })) + ' rates come from comparison sites. Confirm before you open an account.';

    Object.keys(LAZY).forEach(function(k){ if (k.charAt(0) === 'z' && !document.querySelector('[data-lazy="' + k + '"]')) delete LAZY[k]; });
    $('sRows').innerHTML = rows.map(function(r, i){
      var c = r.c, b = r.b, top = c.total - minTot < 0.005, worst = maxTot - c.total < 0.005, lowC = c.brok - minCom < 0.005;
      var w1 = (c.brokerSide / maxTot * 100).toFixed(2), w2 = (c.statutory / maxTot * 100).toFixed(2);
      var kv = '<table class="kv"><tbody>' +
        '<tr class="grp"><td colspan="2">Paid to ' + esc(b.name) + '</td></tr>' +
        '<tr><td>Commission (' + esc(ruleText(b.r[seg])) + ')</td><td>' + inr(c.brok) + '</td></tr>' +
        '<tr><td>GST on commission (18%)</td><td>' + inr(c.gstBrok) + '</td></tr>' +
        (seg === 'del' && sell > 0 ? '<tr><td>DP charge on sell</td><td>' + (c.dpMissing ? 'not published' : inr(c.dp)) + '</td></tr>' : '') +
        '<tr class="grp"><td colspan="2">Government and exchange</td></tr>' +
        '<tr><td>STT</td><td>' + inr(c.stt) + '</td></tr>' +
        '<tr><td>Exchange + SEBI fees</td><td>' + inr(c.txn) + '</td></tr>' +
        '<tr><td>GST on exchange fees</td><td>' + inr(c.gstOther) + '</td></tr>' +
        '<tr><td>Stamp duty</td><td>' + inr(c.stamp) + '</td></tr>' +
        '<tr><td>Total you pay</td><td>' + inr(c.total) + '</td></tr></tbody></table>';
      return '<li><details class="brow' + (top ? ' lock' : '') + (worst ? ' worst' : '') + '"><summary>' +
        '<span class="rk">' + rankLabel(i) + '</span>' +
        '<span class="who"><b>' + esc(b.name) + '</b><small>' + esc(b.plan === 'Standard' ? shortRule(b.r[seg]) : b.plan + ', ' + shortRule(b.r[seg])) + '</small>' + (b.src === 'agg' ? '<span class="agg">Rates from comparison sites</span>' : '') + '</span>' +
        '<span class="com' + (lowC ? ' low' : '') + '"><b>' + inr(c.brok) + '</b><small>commission</small></span>' +
        '<span class="tot"><span class="tv"><small>' + (top ? 'cheapest' : '+' + inr(c.total - minTot)) + '</small><b>' + inr(c.total) + '</b></span><span class="meter" role="img" aria-label="' + esc(b.name) + ': broker ' + inr(c.brokerSide) + ', government ' + inr(c.statutory) + '"><span class="m1" style="width:' + w1 + '%"></span><span class="m2" style="width:' + w2 + '%"></span></span></span>' +
        '<span class="chev" aria-hidden="true">▶</span></summary>' +
        lazy('bdetail', '<div><h3>Breakdown</h3>' + kv + '</div><div><h3>Watch out for</h3><ul>' + b.notes.map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('') + '</ul><p class="src">Rate source: ' + b.links.map(function(l){ return '<a href="' + safeHref(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + '</a>'; }).join(', ') + '</p></div>') + '</details></li>';
    }).join('');
    if (animate) snapLock();
  }

  /* ---------- fold 2: news player ---------- */
  var DUR = 8000, curW = 'All', list = NEWS.slice(), idx = 0, playing = !RM.matches, held = false, offscreen = false;
  var BOOT = new Date().toISOString();
  function isFresh(n){ return !!n.at && n.at > BOOT; }
  function newsKey(n){ return n.d + '|' + n.title; }
  function filtered(){ return curW === 'All' ? NEWS.slice() : NEWS.filter(function(n){ return n.who === curW; }); }
  function renderFilter(){
    var whoList = ['All'];
    NEWS.forEach(function(n){ if (whoList.indexOf(n.who) < 0) whoList.push(n.who); });
    if (whoList.indexOf(curW) < 0) curW = 'All';
    $('nFilter').innerHTML = whoList.map(function(w){ return '<button type="button" data-w="' + esc(w) + '" aria-pressed="' + (w === curW) + '">' + esc(w) + '</button>'; }).join('');
  }
  $('nFilter').addEventListener('click', function(e){ var b = e.target.closest('button'); if (b) setFilter(b.dataset.w); });
  function setFilter(w){
    curW = w; list = filtered();
    $('nFilter').querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.w === w)); });
    idx = 0; renderList(); show();
  }
  function renderList(){
    $('hlList').innerHTML = list.map(function(n, i){ return '<li><button type="button" data-i="' + i + '"><time datetime="' + esc(n.d) + '">' + fmtDate(n.d) + '</time><span class="t"><b>' + (isFresh(n) ? '<span class="fresh">New</span>' : '') + esc(n.who) + '</b>' + esc(n.title) + '</span></button></li>'; }).join('');
    markCur();
  }
  function markCur(){
    $('nCount').textContent = list.length ? (idx + 1) + ' of ' + list.length : '0';
    $('hlList').querySelectorAll('button').forEach(function(b){ b.classList.toggle('cur', +b.dataset.i === idx); });
  }
  $('hlList').addEventListener('click', function(e){ var b = e.target.closest('button'); if (b) { idx = +b.dataset.i; show(); } });
  function show(){
    var n = list[idx], el = $('nItem');
    if (!n) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="pl-meta">' + (isFresh(n) ? '<span class="fresh">New</span>' : '') + '<span class="pl-who">' + esc(n.who) + '</span><time datetime="' + esc(n.d) + '">' + fmtDateY(n.d) + '</time><span class="pl-tag">' + esc(n.tag) + '</span></div><h3>' + esc(n.title) + '</h3><p>' + esc(n.body) + '</p>' +
      (n.src[1] ? '<a href="' + safeHref(n.src[1]) + '" target="_blank" rel="noopener">Read on ' + esc(n.src[0]) + '</a>' : '');
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    markCur();
    restartBar();
  }
  function applyNews(items){
    var cur = list[idx] && newsKey(list[idx]);
    NEWS = items; renderFilter(); list = filtered();
    var at = -1;
    for (var i = 0; i < list.length; i++) if (newsKey(list[i]) === cur) { at = i; break; }
    idx = at >= 0 ? at : 0;
    renderList();
    if (at < 0) show();
  }
  renderFilter();
  function restartBar(){
    var bar = $('nBar');
    bar.classList.remove('run'); void bar.offsetWidth;
    bar.style.setProperty('--dur', DUR + 'ms');
    if (playing && list.length > 1) { bar.classList.add('run'); bar.classList.toggle('hold', held || offscreen); }
  }
  $('nBar').addEventListener('animationend', function(){ if (playing) next(); });
  function next(){ idx = (idx + 1) % list.length; show(); }
  function prev(){ idx = (idx - 1 + list.length) % list.length; show(); }
  function renderPlay(){
    $('nPlay').innerHTML = playing ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3.5v12H3zM9.5 2H13v12H9.5z"></path></svg>Pause' : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z"></path></svg>Play';
    $('nPlay').setAttribute('aria-label', playing ? 'Pause news' : 'Play news');
    $('player').classList.toggle('playing', playing);
    $('nItem').setAttribute('aria-live', playing ? 'off' : 'polite');
  }
  $('nPlay').addEventListener('click', function(){ playing = !playing; renderPlay(); restartBar(); });
  $('nNext').addEventListener('click', next);
  $('nPrev').addEventListener('click', prev);
  var pl = $('player');
  function holdState(){ $('nBar').classList.toggle('hold', held || offscreen); }
  pl.addEventListener('mouseenter', function(){ held = true; holdState(); });
  pl.addEventListener('mouseleave', function(){ held = false; holdState(); });
  pl.addEventListener('focusin', function(){ held = true; holdState(); });
  pl.addEventListener('focusout', function(e){ if (!pl.contains(e.relatedTarget)) { held = false; holdState(); } });
  if ('IntersectionObserver' in window) new IntersectionObserver(function(es){ offscreen = !es[0].isIntersecting; holdState(); }).observe(pl);

  /* ---------- fold 3: segment comparison ---------- */
  var segState = load('brc-segs') || {};
  var SEL = Array.isArray(segState.sel) ? segState.sel.filter(function(s){ return SEGS.indexOf(s) >= 0; }) : ['fut','opt'];
  var SIZES = {}; SEGS.forEach(function(s){ SIZES[s] = segState.sizes && segState.sizes[s] > 0 ? segState.sizes[s] : REF[s]; });
  function persistSeg(){ store('brc-segs', { sel:SEL, sizes:SIZES }); }
  var tiles = $('tiles');
  SEGS.forEach(function(s){
    var t = SEG_TILE[s], lab = document.createElement('label');
    lab.className = 'tile';
    lab.innerHTML = '<input type="checkbox" id="seg-' + s + '" value="' + s + '"' + (SEL.indexOf(s) >= 0 ? ' checked' : '') + '><span class="box"><span class="grp">' + t.grp + '</span><span class="nm">' + t.nm + '</span></span>';
    tiles.appendChild(lab);
  });
  tiles.addEventListener('change', function(){ SEL = SEGS.filter(function(s){ return $('seg-' + s).checked; }); persistSeg(); renderSizes(); renderSeg(); });
  function renderSizes(){
    var g = $('sizeGrid');
    if (!SEL.length) { g.innerHTML = '<p class="fine">Pick a segment first.</p>'; return; }
    g.innerHTML = SEL.map(function(s){ return '<div><label for="sz-' + s + '">' + SIZE_LABEL[s] + ' (₹)' + (FNO[s] ? ', 1 lot' : '') + '</label><input id="sz-' + s + '" type="number" min="1" step="100" inputmode="decimal" value="' + SIZES[s] + '"></div>'; }).join('');
    SEL.forEach(function(s){ $('sz-' + s).addEventListener('input', function(e){ var v = parseFloat(e.target.value); if (v > 0) { SIZES[s] = v; persistSeg(); renderSeg(); } }); });
  }
  function renderSeg(){
    if (!SEL.length) { $('verdict').innerHTML = '<div class="empty">Tick at least one segment to rank brokers.</div>'; $('rows').innerHTML = ''; $('partial').innerHTML = ''; $('partialLabel').hidden = true; return; }
    var R = rankFor(SEL, SIZES);
    R.full.sort(function(a, z){ return a.total - z.total; });
    R.part.sort(function(a, z){ return a.missing.length - z.missing.length || a.total - z.total; });
    var segMin = {};
    SEL.forEach(function(s){ var m = Infinity; R.full.concat(R.part).forEach(function(x){ if (x.cells[s] && x.cells[s].total < m) m = x.cells[s].total; }); segMin[s] = m; });
    if (!R.full.length) $('verdict').innerHTML = '<div class="empty">No single broker here offers every segment you picked. Partial matches are listed below.</div>';
    else {
      var lead = R.full[0].total, ties = R.full.filter(function(x){ return x.total - lead < 0.005; }), others = R.full.filter(function(x){ return x.total - lead >= 0.005; });
      $('verdict').innerHTML = '<div class="verdict2"><span class="k2">Cheapest for ' + esc(SEL.map(function(s){ return SEG_SHORT[s]; }).join(' + ')) + '</span><span class="w2">' + esc(joinNames(ties.map(function(x){ return fullName(x.b); }))) + ', ' + inr(lead) + '</span>' +
        (others.length ? '<span class="x2">Next is ' + esc(fullName(others[0].b)) + ' at <b>' + inr(others[0].total) + '</b>. Costliest is ' + esc(fullName(others[others.length - 1].b)) + ' at <b>' + inr(others[others.length - 1].total) + '</b>.</span>' : '') + '</div>';
    }
    $('rows').innerHTML = R.full.map(function(x, i){ return segRow(x, rankLabel(i), x.total - R.full[0].total < 0.005, segMin); }).join('');
    $('partialLabel').hidden = !R.part.length;
    $('partial').innerHTML = R.part.map(function(x){ return segRow(x, '–', false, segMin); }).join('');
  }
  function segRow(x, rank, top, segMin){
    var b = x.b;
    var cells = SEL.map(function(s){
      var c = x.cells[s];
      if (!c) return '<span class="cell na"><span class="cl">' + SEG_SHORT[s] + '</span><span class="cr">Not offered</span><span class="cc">—</span></span>';
      return '<span class="cell' + (c.total - segMin[s] < 0.005 ? ' best' : '') + '"><span class="cl">' + SEG_SHORT[s] + '</span><span class="cr">' + esc(shortRule(b.r[s])) + '</span><span class="cc">' + inr(c.total) + '</span></span>';
    }).join('');
    var brk = SEL.filter(function(s){ return x.cells[s]; }).map(function(s){ var c = x.cells[s]; return '<tr><td>' + SEG_SHORT[s] + '</td><td>' + inr(c.brok) + '</td><td>' + inr(c.gst) + '</td><td>' + inr(c.stt) + '</td><td>' + inr(c.other) + '</td><td>' + (s === 'del' ? (c.dpMissing ? 'n/a' : inr(c.dp)) : '—') + '</td><td><b>' + inr(c.total) + '</b></td></tr>'; }).join('');
    return '<li><details class="srow' + (top ? ' lock' : '') + '"><summary><span class="rk">' + rank + '</span><span class="who"><b>' + esc(b.name) + '</b><small>' + esc(b.plan === 'Standard' ? 'AMC ' + b.amc : b.plan) + '</small></span><span class="cells">' + cells + '</span><span class="stot"><b>' + (x.missing.length ? '—' : inr(x.total)) + '</b><small>' + (x.missing.length ? 'partial' : 'all in') + '</small></span><span class="chev" aria-hidden="true">▶</span></summary>' +
      lazy('sdetail', '<div class="brk-wrap"><table class="segtbl"><thead><tr><th>Segment</th><th>Brokerage</th><th>GST</th><th>STT</th><th>Exch+SEBI+stamp</th><th>DP</th><th>Total</th></tr></thead><tbody>' + (brk || '<tr><td colspan="7">Not offered</td></tr>') + '</tbody></table></div><p class="src">Rate source: ' + b.links.map(function(l){ return '<a href="' + safeHref(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + '</a>'; }).join(', ') + '</p>') + '</details></li>';
  }

  /* ---------- boot ---------- */
  renderStock(false);
  renderList(); renderPlay(); show();
  renderSizes(); renderSeg();
  setTimeout(function(){ snapLock(); $('app').classList.remove('boot'); }, 650);

  /* ---------- live data ----------
     On the website, data/*.json in this folder is refreshed by a daily price job and an
     hourly news-and-rates job; the page re-checks data/status.json every few minutes.
     Inside Claude, the same updates arrive through the page's database. Without either,
     the snapshot built into this file stays on screen. */
  function fmtWhen(iso){
    var t = new Date(iso); if (isNaN(t)) return '';
    var o = { timeZone:'Asia/Kolkata' };
    var day = function(d){ return d.toLocaleDateString('en-CA', o); };
    var hm = t.toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata', hour:'numeric', minute:'2-digit', hour12:true }).replace(/\s?([ap])\.?m\.?/i, function(_, x){ return ' ' + x.toLowerCase() + 'm'; });
    var p = day(t).split('-'), today = day(new Date()) === day(t);
    return (today ? 'today ' : +p[2] + ' ' + MON[+p[1] - 1] + ', ') + hm + ' IST';
  }
  function showLive(){ $('liveTag').hidden = false; }
  function applyPrices(doc){
    if (!doc || typeof doc.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) return;
    if (doc.date < STOCK_ISO || (doc.date === STOCK_ISO && !STOCK_PARTIAL)) return;
    var fresh = parseStocks(doc.data).filter(function(x){ return x.s && x.n && x.p > 0; });
    if (fresh.length < 500) return;
    indexStocks(fresh); STOCK_PARTIAL = false;
    STOCK_ISO = doc.date; STOCK_DATE = fmtDateY(doc.date);
    S.stock = (pendingSym && BY[pendingSym]) || BY[S.stock.s] || BY.HDFCBANK || STOCKS[0]; pendingSym = null;
    $('footDate').textContent = STOCK_DATE; $('footCount').textContent = STOCKS.length.toLocaleString('en-IN'); $('stPrices').textContent = STOCK_DATE;
    renderPopular(); renderStock(false);
  }
  function applyBrokers(doc){
    var list2 = doc && cleanBrokers(doc.list);
    if (!list2) return;
    BROKERS.length = 0; Array.prototype.push.apply(BROKERS, list2);
    $('planCount').textContent = BROKERS.length;
    renderStock(false); renderSeg();
  }
  function applyStatus(doc){
    if (!doc) return;
    if (doc.ratesCheckedAt) $('stRates').textContent = fmtWhen(doc.ratesCheckedAt);
    if (doc.newsCheckedAt) $('newsWhen').textContent = 'Checked ' + fmtWhen(doc.newsCheckedAt) + '. Refreshes every hour.';
  }

  /* website mode: poll the JSON files next to this page */
  var seen = { rates: SEED.ratesKey, news: SEED.newsKey }, inClaude = !!(window.claude && typeof window.claude.use === 'function');
  var DATA_BASE = (document.body && document.body.getAttribute('data-root')) || '';
  function getJSON(name){
    return fetch(DATA_BASE + 'data/' + name + '?t=' + Date.now(), { cache:'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  }
  function poll(){
    /* prices-meta.json is written by the daily price job; status.json by the hourly news-and-rates job */
    getJSON('prices-meta.json').then(function(pm){
      if (!pm || !pm.date) return;
      showLive();
      /* the page ships with a starter list of popular stocks; the full list of every NSE stock loads here */
      if ((pm.date > STOCK_ISO || STOCK_PARTIAL) && seen.prices !== pm.date) { seen.prices = pm.date; getJSON('prices.json').then(applyPrices); }
    });
    getJSON('status.json').then(function(st){
      if (!st) return;
      showLive(); applyStatus(st);
      var rk = st.ratesUpdatedAt || st.ratesCheckedAt;
      if (rk && seen.rates !== rk) { seen.rates = rk; getJSON('brokers.json').then(applyBrokers); }
      var nk = st.newsUpdatedAt || st.newsCheckedAt;
      if (nk && seen.news !== nk) { seen.news = nk; getJSON('news.json').then(function(d){ var items = d && cleanNews(d.items); if (items && items.length) applyNews(items); }); }
    });
  }
  if (!inClaude && location.protocol !== 'file:') {
    poll();
    setInterval(function(){ if (document.visibilityState === 'visible') poll(); }, 180000);
    document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') poll(); });
  }

  /* Claude mode: the page's own database */
  function watchDoc(db, path, fn){
    db.doc(path).onSnapshot(function(snap){
      if (!snap.exists) return;
      showLive();
      try { fn(snap.data()); } catch (e) { console.warn('live ' + path, e); }
    }, function(err){ console.warn('live ' + path + ' stopped:', err && err.code); });
  }
  if (inClaude) {
    window.claude.use('db').then(function(db){
      if (!db) return;
      watchDoc(db, 'live/prices', applyPrices);
      watchDoc(db, 'live/brokers', applyBrokers);
      watchDoc(db, 'live/status', applyStatus);
      db.collection('news').orderBy('d', 'desc').limit(40).onSnapshot(function(q){
        var items = cleanNews(q.docs.map(function(d){ var o = d.data() || {}; return { id:d.id, d:o.d, who:o.who, tag:o.tag, title:o.title, body:o.body, srcName:o.srcName, srcUrl:o.srcUrl, addedAt:o.addedAt }; }));
        if (!items.length) return;
        showLive(); applyNews(items);
      }, function(err){ console.warn('live news stopped:', err && err.code); });
    }).catch(function(){});
  }
})();
