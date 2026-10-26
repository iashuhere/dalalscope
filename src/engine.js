/* A page can hand in fresher data before this script runs (window.__SEED); otherwise the built-in snapshot below is used. */
var SEED = (typeof window !== 'undefined' && window.__SEED) || {};
var STOCK_DATA = SEED.stocks || "__STOCKS__";
var STOCK_DATE = SEED.date || '23 Oct 2026';
var STOCK_ISO = SEED.iso || '2026-10-23';
var STOCK_PARTIAL = !!SEED.partial;

/* ================= ENGINE (pure) ================= */
var SEGS = ['del','intra','fut','opt','cfut','copt','mfut','mopt'];
var SEG_LABEL = { del:'Equity delivery', intra:'Equity intraday', fut:'Equity futures', opt:'Equity options', cfut:'Currency futures', copt:'Currency options', mfut:'Commodity futures', mopt:'Commodity options' };
var SEG_SHORT = { del:'Delivery', intra:'Intraday', fut:'Futures', opt:'Options', cfut:'Curr. futures', copt:'Curr. options', mfut:'Comm. futures', mopt:'Comm. options' };
var SEG_TILE = {
  del:{ grp:'Equity', nm:'Delivery' }, intra:{ grp:'Equity', nm:'Intraday' }, fut:{ grp:'Equity F&O', nm:'Futures' }, opt:{ grp:'Equity F&O', nm:'Options' },
  cfut:{ grp:'Currency', nm:'Futures' }, copt:{ grp:'Currency', nm:'Options' }, mfut:{ grp:'Commodity', nm:'Futures' }, mopt:{ grp:'Commodity', nm:'Options' }
};
var STAT = {
  del:  { sttB:0.001, sttS:0.001,   txn:0.0000307, stampB:0.00015 },
  intra:{ sttB:0,     sttS:0.00025, txn:0.0000307, stampB:0.00003 },
  fut:  { sttB:0,     sttS:0.0005,  txn:0.0000183, stampB:0.00002 },
  opt:  { sttB:0,     sttS:0.0015,  txn:0.0003553, stampB:0.00003 },
  cfut: { sttB:0,     sttS:0,       txn:0.0000035, stampB:0.000001 },
  copt: { sttB:0,     sttS:0,       txn:0.000311,  stampB:0.000001 },
  mfut: { sttB:0,     sttS:0.0001,  txn:0.000021,  stampB:0.00002 },
  mopt: { sttB:0,     sttS:0.0005,  txn:0.000418,  stampB:0.00003 }
};
var SEBI = 0.000001;
var REF = { del:100000, intra:100000, fut:1000000, opt:10000, cfut:85000, copt:1000, mfut:600000, mopt:10000 };
var SIZE_LABEL = { del:'Delivery value', intra:'Intraday value', fut:'Futures contract value', opt:'Options premium', cfut:'Currency futures value', copt:'Currency options premium', mfut:'Commodity futures value', mopt:'Commodity options premium' };
var FNO = { fut:1, opt:1, cfut:1, copt:1, mfut:1, mopt:1 };

var Z = { t:'z' };
function F(a){ return { t:'f', a:a }; }
function L(a, p, mn){ return { t:'l', a:a, p:p, mn:!!mn }; }
function P(p){ return { t:'p', p:p }; }
function LOT(a){ return { t:'lot', a:a }; }

var BROKERS = [
  { id:'zerodha', name:'Zerodha', plan:'Standard', src:'off', amc:'₹300/yr (₹0 BSDA under ₹4L)', dp:15.34, news:'Zerodha',
    r:{ del:Z, intra:L(20,0.0003), fut:L(20,0.0003), opt:F(20), cfut:L(20,0.0003), copt:F(20), mfut:L(20,0.0003), mopt:F(20) },
    notes:['Accounts that break the 50% cash-margin rule pay ₹40, not ₹20, per intraday F&O order from 1 Apr 2026. A debit balance adds ₹20 per order.','Free delivery is for individuals only; HUFs, firms and companies pay 0.1% or ₹20.','Call & trade and auto square-off: ₹50 per order.'],
    links:[['zerodha.com/charges','https://zerodha.com/charges']] },
  { id:'groww', name:'Groww', plan:'Standard', src:'off', amc:'₹0', dp:23.6, news:'Groww',
    r:{ del:L(20,0.001,1), intra:L(20,0.001,1), fut:F(20), opt:F(20), cfut:null, copt:null, mfut:F(20), mopt:F(20) },
    notes:['Equity orders paid from UPI Mandate balance cost 1% of order value with no cap. Fund the account first.','Minimum brokerage ₹5 (or 2.5% if lower) on stock orders.','Auto square-off ₹50 per open intraday position. No currency derivatives.'],
    links:[['groww.in/pricing','https://groww.in/pricing']] },
  { id:'angel', name:'Angel One', plan:'Standard', src:'off', amc:'₹240/yr', dp:23.6, news:'Angel One',
    r:{ del:L(20,0.001,1), intra:L(20,0.001,1), fut:F(20), opt:F(20), cfut:F(20), copt:F(20), mfut:F(20), mopt:F(20) },
    notes:['Delivery is not free: ₹20 or 0.1%, with a ₹5 minimum.','₹0 brokerage up to ₹500 in the first 30 days after onboarding.','Call & trade ₹20 per order; auto square-off at normal brokerage.'],
    links:[['angelone.in pricing','https://www.angelone.in/exchange-transaction-charges']] },
  { id:'upstox', name:'Upstox', plan:'Standard', src:'off', amc:'₹300/yr', dp:23.6, news:'Upstox',
    r:{ del:F(20), intra:L(20,0.001), fut:L(20,0.0005), opt:F(20), cfut:L(20,0.0005), copt:F(20), mfut:L(20,0.0005), mopt:F(20) },
    notes:['Delivery costs a flat ₹20 per order, even on a small buy.','Stock F&O that ends in physical settlement: 0.25% brokerage on the settled value (0.1% if netted off).','Auto square-off and call & trade: ₹75 + GST per order.'],
    links:[['upstox.com/brokerage-charges','https://upstox.com/brokerage-charges/']] },
  { id:'dhan', name:'Dhan', plan:'Standard', src:'off', amc:'₹0', dp:14.75, news:'Dhan',
    r:{ del:Z, intra:L(20,0.0003), fut:F(20), opt:F(20), cfut:L(20,0.0003), copt:F(20), mfut:F(20), mopt:F(20) },
    notes:['F&O that goes to physical delivery costs 0.10% of contract value.','Free delivery, ETFs and IPOs; zero AMC for individuals.','Auto square-off ₹20 + GST; call & trade ₹50 + GST.'],
    links:[['dhan.co/pricing','https://dhan.co/pricing/']] },
  { id:'fyers', name:'FYERS', plan:'Standard', src:'off', amc:'₹0', dp:14.75, news:'FYERS',
    r:{ del:L(20,0.003), intra:L(20,0.0003), fut:L(20,0.0003), opt:F(20), cfut:L(20,0.0003), copt:F(20), mfut:L(20,0.0003), mopt:F(20) },
    notes:['Delivery moved from free to ₹20 or 0.3% on 1 Oct 2024. Some comparison sites still list it as free.','Adds clearing charges of 0.0005% on futures and 0.009% on options (not included here).','Call & trade and admin square-off: ₹50 + GST per order.'],
    links:[['fyers.in/charges-list','https://fyers.in/charges-list.md']] },
  { id:'5paisa', name:'5paisa', plan:'Standard', src:'off', amc:'Slab-based', dp:23.6, news:'5paisa',
    r:{ del:F(20), intra:L(20,0.025), fut:L(20,0.025), opt:F(20), cfut:L(20,0.025), copt:F(20), mfut:L(20,0.025), mopt:F(20) },
    notes:['Flat ₹20 on every segment, including delivery.','Demat AMC free in year one, then depends on holding value and months traded.','Auto square-off and call & trade: ₹20 extra per order.'],
    links:[['5paisa FAQ','https://forum.5paisa.com/portal/en/kb/articles/what-are-the-brokerage-charges-for-resident-individual-demat-accounts-at-5paisa']] },
  { id:'kotak', name:'Kotak Neo', plan:'Trade Free (30+)', src:'off', amc:'not on plan page', dp:null, news:'Kotak Neo',
    r:{ del:P(0.002), intra:L(10,0.0005), fut:F(10), opt:F(10), cfut:F(10), copt:F(10), mfut:F(10), mopt:F(10) },
    notes:['₹10 on intraday and F&O, but delivery is 0.20% with no cap: ₹200 on a ₹1 lakh buy.','Existing clients pay ₹499 + GST to switch to this plan. Under 30? Trade Free Youth has ₹0 delivery.','DP charges are on a separate demat schedule, so they are not included here.'],
    links:[['kotakneo.com Trade Free','https://www.kotakneo.com/pricing/trade-free-plan/']] },
  { id:'hdfcsky', name:'HDFC Sky', plan:'Standard', src:'off', amc:'free year one', dp:23.6, news:'HDFC Sky',
    r:{ del:L(20,0.025), intra:L(20,0.025), fut:L(20,0.025), opt:F(20), cfut:L(20,0.025), copt:F(20), mfut:L(20,0.025), mopt:F(20) },
    notes:['₹20 per order on everything, delivery and ETFs included.','RMS square-off adds a further ₹20 per order.','Pledge ₹20 per scrip.'],
    links:[['hdfcsky.com/pricing','https://hdfcsky.com/pricing']] },
  { id:'icici-ms', name:'ICICI Direct', plan:'MoneySaver (default)', src:'off', amc:'₹700/yr', dp:23.6, news:'ICICI Direct',
    r:{ del:P(0.0029), intra:P(0.00029), fut:P(0.00029), opt:LOT(49), cfut:F(20), copt:F(20), mfut:F(20), mopt:F(20) },
    notes:['If you buy no plan you pay 0.29% on delivery, 0.029% on intraday and futures, and ₹49 per options lot.','One-time Prime plans bring delivery down to 0.25%–0.07%.','Call & trade ₹50 per order.'],
    links:[['icicidirect.com/brokerage','https://icicidirect.com/brokerage']] },
  { id:'icici-iv', name:'ICICI Direct', plan:'iValue add-on', src:'off', amc:'₹300/yr', dp:23.6, news:'ICICI Direct',
    r:{ del:P(0.0029), intra:F(20), fut:F(20), opt:F(20), cfut:F(20), copt:F(20), mfut:F(20), mopt:F(20) },
    notes:['iValue does not change delivery: it stays at 0.29% unless you also buy a Prime plan.','One-time add-on: flat ₹20 on intraday, futures, options and commodity.','Demat AMC drops from ₹700 to ₹300.'],
    links:[['icicidirect.com/brokerage','https://icicidirect.com/brokerage']] },
  { id:'motilal', name:'Motilal Oswal', plan:'Default', src:'off', amc:'₹199/yr', dp:35.4, news:'Motilal Oswal',
    r:{ del:P(0.002), intra:P(0.0002), fut:P(0.0002), opt:LOT(20), cfut:LOT(20), copt:LOT(20), mfut:P(0.0002), mopt:LOT(200) },
    notes:['Options are ₹20 per lot, not per order: five lots in one order cost ₹100.','0.20% delivery, 0.02% intraday and futures.','DP is 0.025% or ₹30 per debit; ₹30 + GST is used here.'],
    links:[['Motilal on charges','https://motilaloswal.com/learning-centre/2023/6/what-are-the-charges-levied-on-stock-trading-at-motilal-oswal']] },
  { id:'mstock', name:'m.Stock', plan:'Standard', src:'off', amc:'₹0', dp:21.24, news:'m.Stock',
    r:{ del:F(10), intra:F(10), fut:F(10), opt:F(10), cfut:F(10), copt:F(10), mfut:null, mopt:null },
    notes:['The pricing page now lists ₹10 per order on delivery too. The old ₹0 delivery offer is gone.','Zero AMC, platform and call & trade charges.','RMS square-off ₹100 + GST per order. Commodity rates not published.'],
    links:[['mstock.com/pricing','https://www.mstock.com/pricing']] },
  { id:'shoonya', name:'Shoonya', plan:'by Finvasia', src:'agg', amc:'₹499/yr', dp:10.62, news:'Shoonya',
    r:{ del:Z, intra:L(5,0.0003), fut:L(5,0.0003), opt:F(5), cfut:L(5,0.0003), copt:F(5), mfut:L(5,0.0003), mopt:F(5) },
    notes:['Zero brokerage ended in December 2024. Intraday, F&O and commodity now cost ₹5 per order; delivery is still free.','AMC ₹499 + GST a year on active accounts. API trading ₹1,999 + GST a month.','Rates are from comparison sites, not Shoonya’s own page. Confirm before opening an account.'],
    links:[['TradingQnA notice','https://tradingqna.com/t/shoonya-no-more-free/175985']] },
  { id:'paytm', name:'Paytm Money', plan:'Standard', src:'agg', amc:'₹0', dp:23.6, news:'Paytm Money',
    r:{ del:L(20,0.025), intra:L(20,0.0005), fut:L(20,0.0002), opt:F(20), cfut:null, copt:null, mfut:null, mopt:null },
    notes:['Delivery is charged: ₹20 or 2.5%, whichever is lower.','Accounts opened before Aug 2023 may still be on older ₹10–₹15 pricing.','No currency or commodity trading. Rates are from comparison sites.'],
    links:[['CompareShareBrokers','https://comparesharebrokers.com/review/paytm-money']] }
];

var NEWS = [
  { d:'2026-10-25', who:'SEBI', tag:'Rule change', title:'SEBI weighs terminal safeguards and size-based rules for brokers', body:'Proposals include tying trading terminals to MAC and static IP addresses to stop misuse, and compliance duties that scale with a broker’s size and reliance on technology. These are not final rules and no dates have been set.', src:['Kotak Neo News','https://www.kotakneo.com/news/regulations/sebi-trading-terminal-safeguards-broker-compliance-ai-rules/'] },
  { d:'2026-10-23', who:'Groww', tag:'New product', title:'Groww opens US stock trading to all users', body:'After a three-week pilot, every Groww user can buy over 10,000 US stocks and ETFs, including fractional shares. Brokerage is 0.1% of trade value; currency-conversion and bank fees are extra.', src:['Whalesbook','https://www.whalesbook.com/news/English/brokerage-reports/Groww-Opens-US-Stock-Trading-To-All-Users/6adb88ed79a16deaeafc2598'] },
  { d:'2026-10-19', who:'Zerodha', tag:'New product', title:'Zerodha opens US stock investing on Kite', body:'Eligible resident individuals can buy about 2,000 US companies and 1,000 ETFs from $1. Brokerage is 0.1% capped at $10 an order plus GST, with a 0.5% currency markup. Runs through India INX Global Access at GIFT City.', src:['Indian Startup News','https://indianstartupnews.com/news/nithin-kamath-led-zerodha-launches-us-stock-investing-on-kite-offers-access-to-2000-companies-12689088'] },
  { d:'2026-10-19', who:'Angel One', tag:'New product', title:'Angel One adds US shares and ETFs, brokerage-free until December', body:'US investing through GIFT City is rolling out in the app to selected users first, with full availability expected by mid-November. Brokerage is waived until December 2026; regulatory charges still apply.', src:['UNI India','https://www.uniindia.com/business-economy/business-india-angel-one-us-stock-investing-rptng-in-dc-file/219558'] },
  { d:'2026-10-19', who:'SEBI', tag:'Rule change', title:'Expiry settlement moves off the closing auction from 7 December', body:'Expiring stock derivatives will settle at each stock’s volume-weighted average price over the last 30 minutes of trading. Index contracts settle on index values built the same way. The closing auction still sets the cash close.', src:['Outlook Business','https://www.outlookbusiness.com/markets/sebi-reworks-closing-auction-weeks-after-launch-ends-its-say-in-derivatives-settlement'] },
  { d:'2026-10-19', who:'Upstox', tag:'Pricing', title:'Upstox sets 0.25% brokerage on physically settled stock F&O', body:'Stock F&O positions left open into physical settlement are charged 0.25% of the settled value. Netted-off positions pay 0.1%, plus exchange charges.', src:['Upstox announcements','https://upstox.com/announcements/'] },
  { d:'2026-10-14', who:'Industry', tag:'Market share', title:'Angel One closes in on Zerodha for the No. 2 spot', body:'September NSE active clients: Groww 1.34 crore (29.16% share), Zerodha 67.92 lakh (down 5,313), Angel One 67.56 lakh (up 36,956). Upstox fell 10,343 to 18.54 lakh.', src:['Inc42','https://inc42.com/buzz/brokers-in-september-groww-strengthens-lead-angel-one-closes-in-on-zerodha/'] },
  { d:'2026-10-10', who:'Dhan', tag:'Growth', title:'Dhan crosses 11.2 lakh active clients', body:'Dhan added 13,624 active clients in September, the third-highest net addition among the top 10 brokers, and held 8th place on NSE. It was the twelfth straight month of growth.', src:['PNI News','https://www.pninews.com/dhan-crosses-11-2-lakh-active-clients-records-third-highest-additions-among-top-10-brokers-in-september/'] },
  { d:'2026-10-09', who:'Kotak Neo', tag:'Rebrand', title:'Kotak Securities renames its retail business Kotak Neo', body:'Kotak Securities Ltd stays the legal entity and existing accounts are unchanged. The brand now spans trading, investing and wealth, including a Private Client Group and Connect Plus for distributors.', src:['Business Minutes','https://www.businessminutes.in/2026/10/kotak-securities-rebrands-as-kotak-neo-unveils-unified-investment-ecosystem.html'] },
  { d:'2026-10-02', who:'Industry', tag:'Pricing', title:'0.02% UPI fee on payments to brokers starts 15 October', body:'UPI payments to brokers and mutual funds carry a 0.02% merchant fee capped at ₹300 (plus GST), paid by the broker. Reuters reports Zerodha and others are weighing new client charges or mandate-based payments to offset it.', src:['Reuters via TradingView','https://www.tradingview.com/news/moodys:c12946d5a1409:0-brokerages-weigh-new-charges-mandates-as-upi-mdr-set-to-take-effect/'] },
  { d:'2026-10-01', who:'SEBI', tag:'Rule change', title:'Brokers must show SEBI investor-awareness messages from 1 November', body:'The messages and risk disclosures go on every broker’s website landing page from 1 November 2026, and on app landing pages on alternate days.', src:['TaxGuru','https://taxguru.in/sebi/sebi-mandates-investor-awareness-messages-broker-websites-apps-november-1.html'] },
  { d:'2026-04-01', who:'Zerodha', tag:'Pricing', title:'₹40 per intraday F&O order for some Zerodha accounts', body:'Accounts that do not meet the 50% cash-margin requirement pay ₹40 instead of ₹20 per intraday F&O order. Equity delivery stays free.', src:['Inc42','https://inc42.com/buzz/zerodha-raises-fo-charges-to-%E2%82%B940-per-order-for-certain-intraday-trades/'] },
  { d:'2026-04-01', who:'SEBI', tag:'Tax change', title:'F&O STT hike takes effect', body:'STT on futures rose from 0.02% to 0.05% of sell value, and on options from 0.10% to 0.15% of premium. STT on exercised options went from 0.125% to 0.15%.', src:['5paisa','https://www.5paisa.com/news/stt-hike-on-fo-to-take-effect-from-april-1-amid-rising-options-activity'] }
];

function legCharge(rule, seg, v){
  if (v <= 0) return 0;
  var cap = (seg === 'del' || seg === 'intra') ? 0.025 * v : Infinity, b;
  switch (rule.t) {
    case 'z': return 0;
    case 'f': return Math.min(rule.a, cap);
    case 'l': b = Math.min(rule.a, rule.p * v); if (rule.mn && b < 5) b = Math.min(5, 0.025 * v); return Math.min(b, cap);
    case 'p': return Math.min(rule.p * v, cap);
  }
  return 0;
}
function sideBrokerage(rule, seg, v, orders, lots){
  if (!(v > 0)) return 0;
  if (rule.t === 'lot') return rule.a * lots;
  return orders * legCharge(rule, seg, v / orders);
}
function compute(broker, seg, buy, sell, orders, lots){
  var rule = broker.r[seg];
  if (!rule) return null;
  orders = Math.max(1, Math.round(orders || 1)); lots = Math.max(1, Math.round(lots || 1));
  buy = Math.max(0, buy || 0); sell = Math.max(0, sell || 0);
  var s = STAT[seg], turnover = buy + sell;
  var brok = sideBrokerage(rule, seg, buy, orders, lots) + sideBrokerage(rule, seg, sell, orders, lots);
  var stt = s.sttB * buy + s.sttS * sell, txn = s.txn * turnover, sebi = SEBI * turnover, stamp = s.stampB * buy;
  var gstBrok = 0.18 * brok, gstOther = 0.18 * (txn + sebi);
  var needsDp = seg === 'del' && sell > 0;
  var dp = needsDp && broker.dp != null ? broker.dp : 0;
  var brokerSide = brok + gstBrok + dp, statutory = stt + txn + sebi + stamp + gstOther;
  return { brok:brok, gstBrok:gstBrok, gstOther:gstOther, gst:gstBrok + gstOther, stt:stt, txn:txn + sebi, stamp:stamp, other:txn + sebi + stamp, dp:dp, dpMissing: needsDp && broker.dp == null, brokerSide:brokerSide, statutory:statutory, total:brokerSide + statutory };
}
function rankFor(sel, sizes){
  var full = [], part = [];
  BROKERS.forEach(function(b){
    var cells = {}, total = 0, missing = [];
    sel.forEach(function(s){ var c = compute(b, s, sizes[s], sizes[s], 1, 1); cells[s] = c; if (c) total += c.total; else missing.push(s); });
    (missing.length ? part : full).push({ b:b, cells:cells, total:total, missing:missing });
  });
  return { full:full, part:part };
}
function parseStocks(txt){
  return txt.split('\n').map(function(l){ var p = l.split('|'); return { s:p[0], n:p[1], p:+p[2], t:p[3] || '', ls:p[0].toLowerCase(), ln:p[1].toLowerCase() }; });
}
var BIG = {};
'RELIANCE HDFCBANK ICICIBANK INFY TCS BHARTIARTL ITC LT SBIN AXISBANK KOTAKBANK HINDUNILVR BAJFINANCE M&M MARUTI SUNPHARMA HCLTECH NTPC TITAN ULTRACEMCO POWERGRID TATASTEEL ONGC ASIANPAINT BAJAJFINSV ADANIPORTS ADANIENT COALINDIA TECHM JSWSTEEL NESTLEIND WIPRO GRASIM HINDALCO EICHERMOT SBILIFE HDFCLIFE BEL TRENT ETERNAL SHRIRAMFIN CIPLA DRREDDY APOLLOHOSP TATACONSUM BAJAJ-AUTO INDIGO JIOFIN TMPV IRFC NIFTYBEES TATAPOWER YESBANK SUZLON'.split(' ').forEach(function(s){ BIG[s] = 1; });
var ALIAS = { zomato:'eternal', 'l&t':'larsen', airtel:'bharti airtel' };
function searchStocks(list, q, limit){
  q = q.trim().toLowerCase(); if (!q) return [];
  if (ALIAS[q]) q = ALIAS[q];
  var hits = [];
  for (var i = 0; i < list.length; i++) {
    var x = list[i], sc = -1;
    if (x.ls === q) sc = 0;
    else if (x.ls.indexOf(q) === 0) sc = 1;
    else if (x.ln.indexOf(q) === 0) sc = 2;
    else if ((' ' + x.ln).indexOf(' ' + q) >= 0) sc = 3;
    else if (x.ls.indexOf(q) >= 0 || x.ln.indexOf(q) >= 0) sc = 4;
    if (sc >= 0) hits.push({ x:x, sc:sc + (x.t ? 0.5 : 0) - (BIG[x.s] ? 0.6 : 0) });
  }
  hits.sort(function(a, z){ return a.sc - z.sc || a.x.s.length - z.x.s.length || (a.x.s < z.x.s ? -1 : 1); });
  return hits.slice(0, limit || 8).map(function(h){ return h.x; });
}

/* ----- live data checks: anything from the database is validated before use ----- */
var RULE_T = { z:1, f:1, l:1, p:1, lot:1 };
function okUrl(u){ return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u); }
function validRule(r){
  if (r === null) return true;
  if (!r || typeof r !== 'object' || !RULE_T[r.t]) return false;
  if ((r.t === 'f' || r.t === 'lot') && !(r.a >= 0 && r.a <= 500)) return false;
  if (r.t === 'p' && !(r.p >= 0 && r.p <= 0.025)) return false;
  if (r.t === 'l' && !(r.a >= 0 && r.a <= 500 && r.p >= 0 && r.p <= 0.025)) return false;
  return true;
}
function cleanBrokers(list){
  if (!Array.isArray(list) || list.length < 5 || list.length > 40) return null;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (!b || typeof b.id !== 'string' || typeof b.name !== 'string' || !b.r || typeof b.r !== 'object') return null;
    var r = {};
    for (var j = 0; j < SEGS.length; j++) { var s = SEGS[j], v = b.r[s] === undefined ? null : b.r[s]; if (!validRule(v)) return null; r[s] = v; }
    out.push({ id:b.id, name:b.name, plan: typeof b.plan === 'string' ? b.plan : 'Standard', src: b.src === 'agg' ? 'agg' : 'off',
      amc: b.amc == null ? '—' : String(b.amc), dp: typeof b.dp === 'number' && b.dp >= 0 ? b.dp : null, news: typeof b.news === 'string' ? b.news : b.name, r:r,
      notes: Array.isArray(b.notes) ? b.notes.filter(function(n){ return typeof n === 'string'; }).slice(0, 6) : [],
      links: Array.isArray(b.links) ? b.links.filter(function(l){ return Array.isArray(l) && typeof l[0] === 'string' && okUrl(l[1]); }).slice(0, 4) : [] });
  }
  return out;
}
function cleanNews(arr){
  var out = [];
  (arr || []).forEach(function(n){
    if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(n.d) || typeof n.title !== 'string' || !n.title) return;
    out.push({ id:String(n.id || ''), d:n.d, who:String(n.who || 'Industry'), tag:String(n.tag || 'News'), title:n.title, body:String(n.body || ''),
      src:[String(n.srcName || 'source'), okUrl(n.srcUrl) ? n.srcUrl : ''], at: typeof n.addedAt === 'string' ? n.addedAt : '' });
  });
  out.sort(function(a, z){ return a.d < z.d ? 1 : a.d > z.d ? -1 : (a.at < z.at ? 1 : a.at > z.at ? -1 : 0); });
  return out;
}

if (SEED.brokers) { var _sb = cleanBrokers(SEED.brokers); if (_sb) { BROKERS.length = 0; Array.prototype.push.apply(BROKERS, _sb); } }
if (SEED.news) { var _sn = cleanNews(SEED.news); if (_sn.length) NEWS = _sn; }

if (typeof module !== 'undefined') module.exports = { BROKERS:BROKERS, compute:compute, rankFor:rankFor, parseStocks:parseStocks, searchStocks:searchStocks, STOCK_DATA:STOCK_DATA, cleanBrokers:cleanBrokers, cleanNews:cleanNews, NEWS:NEWS, STAT:STAT, SEGS:SEGS, SEG_LABEL:SEG_LABEL, SEG_SHORT:SEG_SHORT, REF:REF, BIG:BIG };

