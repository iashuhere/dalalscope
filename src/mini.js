/* Small trade calculator for broker and comparison pages.
   Needs engine.js loaded first in the browser (compute). The build also requires this file
   to render the same table on the server, so the page shows real numbers before any script runs. */
var MC = (function(){
  var LOTSEG = { fut:1, opt:1, cfut:1, copt:1, mfut:1, mopt:1 }, PREM = { opt:1, copt:1, mopt:1 };
  function inr(n){ return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function label(p, plans){
    var sameName = plans.filter(function(q){ return q.name === p.name; }).length > 1;
    return p.name + (p.plan && p.plan !== 'Standard' && (sameName || plans.length === 1) ? ' ' + p.plan : '');
  }
  function render(compute, plans, seg, buy, sell, lots){
    var cs = plans.map(function(p){ return compute(p, seg, buy, sell, 1, LOTSEG[seg] ? lots : 1); });
    var head = '<tr><th scope="col">On this trade</th>' + plans.map(function(p){
      return '<th scope="col">' + esc(p.name) + (p.plan && p.plan !== 'Standard' ? '<small>' + esc(p.plan) + '</small>' : '') + '</th>';
    }).join('') + '</tr>';
    function row(lab, f, cls){
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + lab + '</th>' + cs.map(function(c){ return '<td>' + (c ? f(c) : 'Not offered') + '</td>'; }).join('') + '</tr>';
    }
    var rows = [
      row('Brokerage', function(c){ return inr(c.brok); }),
      row('GST on brokerage', function(c){ return inr(c.gstBrok); }),
      row(seg === 'mfut' || seg === 'mopt' ? 'CTT' : 'STT', function(c){ return inr(c.stt); }),
      row('Exchange and SEBI fees, with GST', function(c){ return inr(c.txn + c.gstOther); }),
      row('Stamp duty', function(c){ return inr(c.stamp); })
    ];
    if (seg === 'del' && sell > 0) rows.push(row('DP charge on the sell', function(c){ return c.dpMissing ? 'Not published' : inr(c.dp); }));
    rows.push(row('Total', function(c){ return '<b>' + inr(c.total) + '</b>'; }, 'tot-row'));
    var note = '';
    var missing = plans.filter(function(p, i){ return !cs[i]; }).map(function(p){ return esc(label(p, plans)); });
    if (missing.length) note = missing.join(' and ') + (missing.length > 1 ? ' do' : ' does') + ' not offer this segment.';
    else if (plans.length === 2) {
      var d = cs[0].total - cs[1].total;
      note = Math.abs(d) < 0.005 ? 'Both cost the same on this trade.' : esc(label(d < 0 ? plans[0] : plans[1], plans)) + ' is <b>' + inr(Math.abs(d)) + '</b> cheaper on this trade.';
    }
    return '<div class="table-scroll' + (plans.length === 1 ? ' one' : '') + '"><table class="ex-t mc-t"><thead>' + head + '</thead><tbody>' + rows.join('') + '</tbody></table></div>' + (note ? '<p class="mc-note">' + note + '</p>' : '');
  }
  function init(){
    var el = document.getElementById('mc-data'), f = document.getElementById('mc');
    if (!el || !f || typeof compute !== 'function') return;
    var D = JSON.parse(el.textContent), out = document.getElementById('mc-out'), vl = document.getElementById('mc-vl'), lw = document.getElementById('mc-lw');
    var touched = false;
    function num(x){ var n = parseFloat(String(x).replace(/[,\s₹]/g, '')); return isFinite(n) && n > 0 ? n : 0; }
    function run(){
      var s = f.elements.seg.value, v = num(f.elements.v.value), l = Math.max(1, Math.round(num(f.elements.lots.value) || 1)), side = f.elements.side.value;
      lw.hidden = !LOTSEG[s];
      vl.textContent = PREM[s] ? 'Total premium (₹)' : 'Trade value (₹)';
      out.innerHTML = render(compute, D.plans, s, side === 'sell' ? 0 : v, side === 'buy' ? 0 : v, l);
    }
    f.addEventListener('submit', function(e){ e.preventDefault(); });
    f.elements.seg.addEventListener('change', function(){ if (!touched) f.elements.v.value = D.ref[f.elements.seg.value]; run(); });
    f.elements.v.addEventListener('input', function(){ touched = true; run(); });
    f.elements.lots.addEventListener('input', run);
    f.elements.side.addEventListener('change', run);
    run();
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
  return { render: render, LOTSEG: LOTSEG, PREM: PREM };
})();
if (typeof module !== 'undefined') module.exports = MC;
