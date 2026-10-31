#!/usr/bin/env node
/*
 * Builds the DalalScope site into _site/ from src/ templates and data/*.json.
 *
 *   SITE_URL=https://example.github.io/dalalscope/ node scripts/build_site.js
 *   node scripts/build_site.js --preview out.html   (single self-contained file, full stock list inline)
 *
 * Runs on every deploy, so the static pages (broker pages, rate table, FAQ answers,
 * sitemap) always match the latest rates and prices.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, '_site');
const args = process.argv.slice(2);
const PREVIEW = args[0] === '--preview' ? path.resolve(args[1] || 'preview.html') : null;
let SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8765/';
if (!SITE_URL.endsWith('/')) SITE_URL += '/';
// Pages reports http:// for a custom domain until HTTPS is enforced; links should always be https.
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SITE_URL)) SITE_URL = SITE_URL.replace(/^http:\/\//, 'https://');
const BRAND = 'DalalScope';

const read = (p) => fs.readFileSync(p, 'utf8');
const readJSON = (p, d) => { try { return JSON.parse(read(p)); } catch (e) { return d; } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

/* ---------- engine (the same code the browser runs) ---------- */
const engineSrc = read(path.join(SRC, 'engine.js'));
const uiSrc = read(path.join(SRC, 'ui.js'));
const fullStocks = readJSON(path.join(DATA, 'prices.json'), null);
const engineForNode = engineSrc.replace('"__STOCKS__"', JSON.stringify(fullStocks ? fullStocks.data : ''));
const tmpEngine = path.join(require('os').tmpdir(), 'dalalscope-engine-' + process.pid + '.js');
fs.writeFileSync(tmpEngine, engineForNode);
const E = require(tmpEngine);
fs.unlinkSync(tmpEngine);

const brokersDoc = readJSON(path.join(DATA, 'brokers.json'), {});
const live = E.cleanBrokers(brokersDoc.list);
if (live) { E.BROKERS.length = 0; Array.prototype.push.apply(E.BROKERS, live); }
const BROKERS = E.BROKERS;
const newsDoc = readJSON(path.join(DATA, 'news.json'), { items: [] });
const status = readJSON(path.join(DATA, 'status.json'), {});
const meta = readJSON(path.join(DATA, 'prices-meta.json'), {});

const CONFIG = readJSON(path.join(ROOT, 'site.config.json'), {});
const changeLog = readJSON(path.join(DATA, 'changes.json'), { items: [] });
const REPO_URL = CONFIG.repo ? 'https://github.com/' + CONFIG.repo : '';
const REPORT_URL = REPO_URL ? REPO_URL + '/issues/new?title=' + encodeURIComponent('Wrong rate: ') : '';
function siteLinks(root) {
  return [`<li><a href="${root}about/">About DalalScope</a></li>`, `<li><a href="${root}how-we-calculate/">How we calculate</a></li>`]
    .concat(REPORT_URL ? [`<li><a href="${REPORT_URL}" target="_blank" rel="noopener">Report a wrong rate</a></li>`] : [])
    .concat(CONFIG.contactEmail ? [`<li><a href="mailto:${esc(CONFIG.contactEmail)}">Contact</a></li>`] : []).join('');
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtISODate = (d) => { const p = d.split('-'); return +p[2] + ' ' + MON[+p[1] - 1] + ' ' + p[0]; };
const istDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const pricesISO = meta.date || (fullStocks && fullStocks.date) || '2026-10-23';
const PRICES_DATE = fmtISODate(pricesISO);
const RATES_DATE = status.ratesCheckedAt ? fmtISODate(istDate(status.ratesCheckedAt)) : PRICES_DATE;
const YEAR = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 4);
const inr = (n, dec) => { dec = dec == null ? 2 : dec; return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
const pct = (p) => (+(p * 100).toFixed(4)).toString() + '%';
function ruleText(r) {
  if (!r) return 'Not offered';
  switch (r.t) {
    case 'z': return '₹0';
    case 'f': return '₹' + r.a + ' per order';
    case 'l': return (r.p >= 0.025 ? '₹' + r.a + ' per order' : '₹' + r.a + ' or ' + pct(r.p) + ' (whichever is lower)') + (r.mn ? ' (min ₹5)' : '');
    case 'p': return pct(r.p) + ' of trade value';
    case 'lot': return '₹' + r.a + ' per lot';
  }
  return '—';
}
const shortRule = (r) => ruleText(r).replace(' per order', '').replace(' of trade value', '').replace(' (whichever is lower)', '');
const joinNames = (a) => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fullName = (b) => b.name + (b.plan && b.plan !== 'Standard' ? ' ' + b.plan : '');

/* one page per broker; plans of the same broker share a page */
const groups = [];
BROKERS.forEach((b) => {
  let g = groups.find((x) => x.name === b.name);
  if (!g) { g = { name: b.name, slug: slugify(b.name), plans: [] }; groups.push(g); }
  g.plans.push(b);
});
const groupOf = (b) => groups.find((g) => g.name === b.name);

/* rank of each plan per segment on one buy + one sell at the reference size */
function segRanks(seg) {
  const v = E.REF[seg];
  const rows = BROKERS.map((b) => ({ b, c: E.compute(b, seg, v, v, 1, 1) })).filter((r) => r.c);
  rows.sort((a, z) => a.c.total - z.c.total);
  return rows;
}
const RANKS = {};
E.SEGS.forEach((s) => { RANKS[s] = segRanks(s); });
const rankOf = (b, seg) => { const rows = RANKS[seg]; const best = rows.length ? rows[0].c.total : 0; const i = rows.findIndex((r) => r.b === b); if (i < 0) return null; return { pos: rows.filter((r) => r.c.total < rows[i].c.total - 0.005).length + 1, of: rows.length, best: rows[0], c: rows[i].c, gap: rows[i].c.total - best }; };
const EX_LABEL = { del: '₹1 lakh delivery, buy + sell', intra: '₹1 lakh intraday, buy + sell', fut: '₹10 lakh futures contract, buy + sell', opt: '₹10,000 options premium, buy + sell', cfut: '₹85,000 currency futures, buy + sell', copt: '₹1,000 currency options premium, buy + sell', mfut: '₹6 lakh commodity futures, buy + sell', mopt: '₹10,000 commodity options premium, buy + sell' };
const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

/* ---------- shared bits ---------- */
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Saira:wght@400..700&display=swap';
const css = read(path.join(SRC, 'site.css'));
const appJs = engineSrc.replace('"__STOCKS__"', '""') + '\n' + uiSrc;
const CSS_V = hash(css), JS_V = hash(appJs);
const THEME_INIT = "<script>try{var _t=localStorage.getItem('brc-theme');if(_t==='light'||_t==='dark')document.documentElement.setAttribute('data-theme',_t)}catch(e){}</script>";
const THEME_TOGGLE = `<div class="theme" role="group" aria-label="Colour theme">
      <button type="button" id="thLight" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"></circle><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3"></path></g></svg>Light</button>
      <button type="button" id="thDark" aria-pressed="true"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"></path></svg>Dark</button>
    </div>`;
const THEME_JS = "<script>(function(){var r=document.documentElement;function p(){var t=r.getAttribute('data-theme')==='light'?'light':'dark';document.getElementById('thLight').setAttribute('aria-pressed',t==='light');document.getElementById('thDark').setAttribute('aria-pressed',t==='dark')}function s(t){r.setAttribute('data-theme',t);try{localStorage.setItem('brc-theme',t)}catch(e){}p()}document.getElementById('thLight').onclick=function(){s('light')};document.getElementById('thDark').onclick=function(){s('dark')};p()})();</script>";
const MARK_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10" fill="none" stroke="var(--trace)" stroke-width="1.6"/><path d="M16 2v7M16 23v7M2 16h7M23 16h7" stroke="var(--trace)" stroke-width="1.6"/><circle cx="16" cy="16" r="3" fill="var(--lock)"/></svg>';

function head({ title, desc, canonical, root, jsonld, preview }) {
  const ogImage = SITE_URL + 'assets/og.png';
  const styles = preview ? `<style>${css}</style>` : `<link rel="stylesheet" href="${root}assets/site.css?v=${CSS_V}">`;
  const icons = preview ? `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(read(path.join(ROOT, 'assets/favicon.svg')))}">`
    : `<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">\n<link rel="icon" href="${root}assets/icon-32.png" sizes="32x32" type="image/png">\n<link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png">\n<link rel="manifest" href="${root}manifest.webmanifest">`;
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="DalalScope brokerage calculator">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="theme-color" content="#061020">
${CONFIG.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(CONFIG.googleSiteVerification)}">\n` : ''}${CONFIG.bingSiteVerification ? `<meta name="msvalidate.01" content="${esc(CONFIG.bingSiteVerification)}">\n` : ''}<link rel="alternate" type="application/rss+xml" title="DalalScope broker news" href="${SITE_URL}feed.xml">
${icons}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_HREF}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONT_HREF}"></noscript>
${styles}
${THEME_INIT}
${jsonld.map((j) => '<script type="application/ld+json">' + JSON.stringify(j).replace(/</g, '\\u003c') + '</script>').join('\n')}
</head>
`;
}

function topBar(root, homeLink) {
  return `<header class="bar-top">
    <${homeLink ? `a class="mark" href="${root}"` : 'div class="mark"'}>${MARK_SVG}DalalScope <small>Brokerage calculator</small></${homeLink ? 'a' : 'div'}>
    ${THEME_TOGGLE}
  </header>`;
}

/* ---------- home: static sections that search engines can read ---------- */
function rateTable(root) {
  const rows = BROKERS.map((b) => {
    const g = groupOf(b);
    return `<tr><th scope="row"><a href="${root}brokers/${g.slug}/">${esc(b.name)}</a>${b.plan !== 'Standard' ? `<small>${esc(b.plan)}</small>` : ''}</th><td>${esc(shortRule(b.r.del))}</td><td>${esc(shortRule(b.r.intra))}</td><td>${esc(shortRule(b.r.fut))}</td><td>${esc(shortRule(b.r.opt))}</td><td>${b.dp == null ? 'not published' : inr(b.dp)}</td><td>${esc(b.amc)}</td></tr>`;
  }).join('\n          ');
  return `  <section class="ratecards" id="rate-cards" aria-labelledby="rc-h">
    <div class="sec-head"><h2 id="rc-h">Rate cards at a glance</h2><p>Brokerage per order for an individual account, before GST. Open a broker for its full charges and what a typical trade costs.</p></div>
    <div class="panel"><div class="table-scroll"><table class="rc-t">
      <thead><tr><th scope="col">Broker</th><th scope="col">Delivery</th><th scope="col">Intraday</th><th scope="col">Futures</th><th scope="col">Options</th><th scope="col">DP per sell</th><th scope="col">Demat AMC</th></tr></thead>
      <tbody>
          ${rows}
      </tbody>
    </table></div><p class="fine">Rates checked ${RATES_DATE} against each broker’s published charges page.</p></div>
  </section>`;
}

function faqItems() {
  const zeroDel = BROKERS.filter((b) => b.r.del && b.r.del.t === 'z').map(fullName);
  const fo = E.rankFor(['fut', 'opt'], E.REF).full.sort((a, z) => a.total - z.total);
  const dps = BROKERS.filter((b) => b.dp != null).map((b) => b.dp);
  const hd = E.parseStocks(fullStocks ? fullStocks.data : '').find((x) => x.s === 'HDFCBANK');
  let taxShare = '';
  if (hd) {
    const v = hd.p * 250; const rows = BROKERS.map((b) => E.compute(b, 'del', v, v, 1, 1)).sort((a, z) => a.total - z.total);
    taxShare = Math.round(rows[0].statutory / rows[0].total * 100) + '%';
  }
  return [
    ['Which broker charges zero brokerage on delivery?', `${joinNames(zeroDel)} charge ₹0 brokerage on equity delivery. You still pay STT, exchange fees, stamp duty and a DP charge when you sell, so a delivery trade is never completely free.`],
    ['Which broker is cheapest for F&O?', fo.length > 1 ? `For one futures trade (₹10 lakh contract) and one options trade (₹10,000 premium), each bought and sold, ${fullName(fo[0].b)} is cheapest at ${inr(fo[0].total)} including taxes, followed by ${fullName(fo[1].b)} at ${inr(fo[1].total)}. Use the segment comparison to try your own trade sizes.` : 'Use the segment comparison to rank brokers on your own trade sizes.'],
    ['What do I pay besides brokerage?', 'Securities transaction tax (0.1% on both sides for delivery, 0.025% on the sell side for intraday), exchange transaction charges, SEBI’s fee of ₹10 per crore, stamp duty on the buy side, 18% GST on brokerage and exchange charges, and a DP charge each time you sell delivery shares.'],
    ['What is a DP charge?', dps.length ? `A depository charge for moving shares out of your demat account when you sell delivery holdings. It is a flat fee per stock per day, from ${inr(Math.min.apply(null, dps))} to ${inr(Math.max.apply(null, dps))} including GST among the brokers compared here.` : 'A depository charge for moving shares out of your demat account when you sell delivery holdings.'],
    ['Why are delivery totals so close across brokers?', `Government taxes and exchange fees make up most of the cost of a delivery trade, and they are the same at every broker.${taxShare ? ` For 250 HDFCBANK shares bought and sold, ${taxShare} of the cheapest total is tax and fees.` : ''}`],
    ['Does the share price change the brokerage?', 'Only for plans that charge a percentage of the trade value. Flat-fee and zero-brokerage plans charge the same whatever the price. Taxes scale with trade value, so a 2% move in the price changes the total by about 2%.'],
    ['How current is this data?', `Stock prices are NSE closing prices, refreshed after each trading day (latest: ${PRICES_DATE}). Broker rate cards are re-checked daily against each broker’s official charges page, and broker news is checked every hour.`],
  ];
}
function faqSection(items) {
  return `  <section class="faq" id="faq" aria-labelledby="faq-h">
    <div class="sec-head"><h2 id="faq-h">Questions traders ask</h2></div>
    <div class="faq-list">
${items.map(([q, a]) => `      <details class="panel"><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join('\n')}
    </div>
  </section>`;
}

const ORG_LD = { '@context': 'https://schema.org', '@type': 'Organization', '@id': SITE_URL + '#org', name: BRAND, url: SITE_URL, logo: SITE_URL + 'assets/icon-512.png', description: 'Independent brokerage cost comparison for Indian stock traders.', sameAs: REPO_URL ? [REPO_URL] : [] };

function buildHome(preview) {
  const root = '';
  const items = faqItems();
  const title = `Brokerage Calculator India: Compare ${BROKERS.length} Broker Plans | DalalScope`;
  const desc = `Pick any NSE stock and quantity to see what Zerodha, Groww, Angel One, Upstox, Dhan and ${BROKERS.length - 5} more plans charge, with STT, GST, stamp duty and DP charges included.`;
  const jsonld = [
    ORG_LD,
    { '@context': 'https://schema.org', '@type': 'WebSite', name: BRAND, url: SITE_URL, inLanguage: 'en-IN', publisher: { '@id': SITE_URL + '#org' } },
    { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'DalalScope brokerage calculator', url: SITE_URL, applicationCategory: 'FinanceApplication', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' }, description: desc },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
  /* starter list: popular stocks inline so the calculator works at once; the full list loads in the background */
  const all = fullStocks ? fullStocks.data.split('\n') : [];
  const want = new Set(Object.keys(E.BIG).concat(['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'SBIN', 'ITC', 'TMPV', 'ETERNAL', 'IRFC', 'NIFTYBEES']));
  const starter = all.filter((l) => want.has(l.split('|')[0])).join('\n');
  const seed = {
    stocks: preview ? (fullStocks ? fullStocks.data : '') : starter, partial: !preview, iso: pricesISO, date: PRICES_DATE,
    brokers: BROKERS, news: (newsDoc.items || []).slice(0, 40), ratesKey: status.ratesUpdatedAt || status.ratesCheckedAt, newsKey: status.newsUpdatedAt || status.newsCheckedAt,
  };
  const newsWhen = status.newsCheckedAt ? 'Checked ' + fmtISODate(istDate(status.newsCheckedAt)) + '. Refreshes every hour.' : 'Refreshes every hour.';
  const brokerLinks = groups.map((g) => `<li><a href="${root}brokers/${g.slug}/">${esc(g.name)} brokerage charges</a></li>`).join('');
  let body = read(path.join(SRC, '_body.html'))
    .replace('{{ROOT}}', root)
    .split('{{PRICES_DATE}}').join(PRICES_DATE)
    .replace('{{RATES_WHEN}}', RATES_DATE)
    .replace('{{PLAN_COUNT}}', String(BROKERS.length))
    .replace('{{NEWS_WHEN}}', esc(newsWhen))
    .replace('{{STOCK_COUNT}}', (meta.count || (fullStocks && fullStocks.count) || 0).toLocaleString('en-IN'))
    .replace('{{RATES_SECTION}}', rateTable(root))
    .replace('{{FAQ_SECTION}}', faqSection(items))
    .replace('{{BROKER_LINKS}}', brokerLinks)
    .replace('{{SITE_LINKS}}', siteLinks(root));
  const seedTag = `<script>window.__SEED=${JSON.stringify(seed).replace(/</g, '\\u003c')};</script>`;
  const appTag = preview ? `<script>${appJs}</script>` : `<script src="assets/app.js?v=${JS_V}" defer></script>`;
  return head({ title, desc, canonical: SITE_URL, root, jsonld, preview }) + body + seedTag + '\n' + appTag + '\n</body>\n</html>\n';
}

/* ---------- broker pages ---------- */
function brokerPage(g) {
  const root = '../../';
  const canonical = SITE_URL + 'brokers/' + g.slug + '/';
  const p0 = g.plans[0];
  const title = `${g.name} Brokerage Charges ${YEAR}: Delivery, Intraday, F&O | ${BRAND}`;
  const desc = `${g.name} charges ${shortRule(p0.r.del)} on delivery, ${shortRule(p0.r.intra)} on intraday and ${shortRule(p0.r.opt)} on options${g.plans.length > 1 ? ' on its default plan' : ''}. See DP, AMC and what a typical trade really costs with STT and GST.`;
  const others = groups.filter((x) => x !== g);
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: BRAND, item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'Rate cards', item: SITE_URL + '#rate-cards' },
    { '@type': 'ListItem', position: 3, name: g.name + ' brokerage charges', item: canonical },
  ] }];
  const planBlocks = g.plans.map((b) => {
    const segRows = E.SEGS.map((s) => {
      const r = b.r[s];
      if (!r) return `<tr class="na"><th scope="row">${E.SEG_LABEL[s]}</th><td>${b.unl && b.unl.includes(s) ? 'Rate not published' : 'Not offered'}</td><td>—</td><td>—</td><td>—</td></tr>`;
      const k = rankOf(b, s);
      return `<tr><th scope="row">${E.SEG_LABEL[s]}<small>${EX_LABEL[s]}</small></th><td>${esc(ruleText(r))}</td><td>${inr(k.c.brok)}</td><td><b>${inr(k.c.total)}</b></td><td>${k.pos === 1 ? '<span class="best">Cheapest</span>' : ord(k.pos) + ' of ' + k.of + `<small>+${inr(k.gap)} vs <a href="${root}brokers/${groupOf(k.best.b).slug}/">${esc(k.best.b.name)}</a></small>`}</td></tr>`;
    }).join('\n            ');
    return `<section class="panel plan" aria-labelledby="plan-${esc(b.id)}">
        <h2 id="plan-${esc(b.id)}">${esc(g.plans.length > 1 ? b.plan + ' plan' : b.name + ' charges by segment')}</h2>
        <div class="table-scroll"><table class="ex-t">
          <thead><tr><th scope="col">Segment and example trade</th><th scope="col">Brokerage</th><th scope="col">Brokerage on the example</th><th scope="col">Total with taxes</th><th scope="col">Rank of ${BROKERS.length}</th></tr></thead>
          <tbody>
            ${segRows}
          </tbody>
        </table></div>
        <dl class="facts">
          <div><dt>DP charge per sell</dt><dd>${b.dp == null ? 'Not published on the plan page' : inr(b.dp) + ' including GST'}</dd></div>
          <div><dt>Demat AMC</dt><dd>${esc(b.amc)}</dd></div>
          <div><dt>Rate source</dt><dd>${b.links.map((l) => `<a href="${esc(l[1])}" target="_blank" rel="noopener">${esc(l[0])}</a>`).join(', ')}${b.src === 'agg' ? ' (comparison site; confirm before you open an account)' : ''}</dd></div>
        </dl>
        <h3>Watch out for</h3>
        <ul class="notes">${b.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </section>`;
  }).join('\n      ');
  const delRank = rankOf(p0, 'del'), foRank = p0.r.opt ? rankOf(p0, 'opt') : null;
  const lead = `${g.name} charges ${esc(ruleText(p0.r.del))} on equity delivery and ${esc(ruleText(p0.r.intra))} on intraday${p0.r.opt ? `, and ${esc(ruleText(p0.r.opt))} on options` : ''}${g.plans.length > 1 ? ' on its default plan' : ''}. On a ₹1 lakh delivery buy and sell it ranks ${ord(delRank.pos)} cheapest of ${delRank.of} plans compared here${foRank ? `, and ${ord(foRank.pos)} on options` : ''}.`;
  return head({ title, desc, canonical, root, jsonld }) + `<body data-root="${root}">
<div class="wrap page">
  ${topBar(root, true)}
  <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${root}">DalalScope</a></li><li><a href="${root}#rate-cards">Rate cards</a></li><li aria-current="page">${esc(g.name)}</li></ol></nav>
  <article class="bp">
    <header class="bp-head">
      <h1>${esc(g.name)} brokerage charges</h1>
      <p class="lead">${lead}</p>
      <p class="checked">Checked ${RATES_DATE}. Totals include 18% GST, STT, exchange and SEBI fees, stamp duty and the DP charge on delivery sells.</p>
      <a class="cta" href="${root}#calculator">Check any NSE stock in the calculator</a>
    </header>
      ${planBlocks}
    <section class="panel" aria-labelledby="cmp-h">
      <h2 id="cmp-h">Compare ${esc(g.name)} with</h2>
      <ul class="cmp-links">${others.map((o) => `<li><a href="${root}brokers/${o.slug}/">${esc(o.name)}</a></li>`).join('')}</ul>
    </section>
  </article>
  <footer><p>Rates come from each broker’s published charges page and change often; your contract note is the final word. DalalScope compares published prices; it is not investment advice.</p><ul class="foot-site">${siteLinks(root)}<li><a href="${root}">Brokerage calculator</a></li></ul></footer>
</div>
${THEME_JS}
</body>
</html>
`;
}

function notFound() {
  const root = SITE_URL.replace(/^https?:\/\/[^/]+/, '') || '/';
  return head({ title: 'Page not found | ' + BRAND, desc: 'This page does not exist. Go back to the DalalScope brokerage calculator.', canonical: SITE_URL, root, jsonld: [] }).replace('index, follow', 'noindex') + `<body>
<div class="wrap page">
  ${topBar(root, true)}
  <section class="lost panel"><h1>Nothing at this address</h1><p>The page may have moved. The calculator and every broker’s rate card start from the home page.</p><a class="cta" href="${root}">Go to the brokerage calculator</a></section>
</div>
${THEME_JS}
</body>
</html>
`;
}

/* ---------- trust pages ---------- */
function shell({ title, desc, canonical, root, jsonld, crumbs, body }) {
  return head({ title, desc, canonical, root, jsonld }) + `<body data-root="${root}">
<div class="wrap page">
  ${topBar(root, true)}
  <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${root}">DalalScope</a></li><li aria-current="page">${esc(crumbs)}</li></ol></nav>
  <article class="bp doc">
${body}
  </article>
  <footer><p>DalalScope compares published prices; it is not investment advice. Your broker’s contract note is the final word on what you paid.</p><ul class="foot-site">${siteLinks(root)}<li><a href="${root}">Brokerage calculator</a></li></ul></footer>
</div>
${THEME_JS}
</body>
</html>
`;
}
const crumbLD = (name, url) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: BRAND, item: SITE_URL }, { '@type': 'ListItem', position: 2, name, item: url }] });

function aboutPage() {
  const root = '../';
  const url = SITE_URL + 'about/';
  const who = CONFIG.owner ? `DalalScope is built and maintained by ${esc(CONFIG.owner)}${CONFIG.ownerNote ? ', ' + esc(CONFIG.ownerNote) : ''}.` : 'DalalScope is an independent project run from Bengaluru.';
  const contact = [REPORT_URL ? `<a href="${REPORT_URL}" target="_blank" rel="noopener">report it on GitHub</a>` : '', CONFIG.contactEmail ? `email <a href="mailto:${esc(CONFIG.contactEmail)}">${esc(CONFIG.contactEmail)}</a>` : ''].filter(Boolean).join(' or ');
  const body = `    <header class="bp-head">
      <h1>About DalalScope</h1>
      <p class="lead">DalalScope answers one question for Indian traders: what will this exact trade cost me at each broker? Pick any NSE stock and a quantity, and it works out every plan’s commission, taxes and fees, cheapest first.</p>
    </header>
    <section class="panel prose" aria-labelledby="ab-ind"><h2 id="ab-ind">Independent and free</h2>
      <p>DalalScope is not owned by, paid by or affiliated with any broker, exchange or regulator. There are no referral links, paid placements or ads, and brokers are ranked by cost alone.</p>
      <p>${who} The code and every data file are public${REPO_URL ? ` on <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>` : ''}, so anyone can check how a number was worked out.</p></section>
    <section class="panel prose" aria-labelledby="ab-data"><h2 id="ab-data">Where the numbers come from</h2>
      <ul>
        <li><b>Stock prices:</b> NSE’s official end-of-day bhavcopy, refreshed after every trading day. Latest: ${PRICES_DATE}.</li>
        <li><b>Broker rates:</b> each broker’s published charges page, re-checked every day. ${BROKERS.length} plans from ${groups.length} brokers, last checked ${RATES_DATE}.</li>
        <li><b>Taxes and exchange fees:</b> current STT, stamp duty, exchange transaction charges, SEBI fees and GST. <a href="${root}how-we-calculate/">See every rate and formula</a>.</li>
        <li><b>Broker news:</b> checked every hour; each headline is summarised in plain language and links to the original report.</li>
      </ul></section>
    <section class="panel prose" aria-labelledby="ab-fix"><h2 id="ab-fix">Corrections</h2>
      <p>Brokers change their rate cards often. If a rate here doesn’t match a broker’s official page${contact ? `, ${contact}` : ''}. Corrections go live as soon as they are checked against the broker’s own page, and every rate change is listed on <a href="${root}how-we-calculate/#changes">How we calculate</a>.</p></section>
    <section class="panel prose" aria-labelledby="ab-nfa"><h2 id="ab-nfa">Not investment advice</h2>
      <p>DalalScope compares published prices to help you understand costs. It does not recommend brokers, stocks or trades. Some plans are only for new accounts or need a paid subscription; check the broker’s terms before you open an account.</p></section>`;
  return shell({ title: 'About DalalScope: Independent Brokerage Comparison for India', desc: 'Who runs DalalScope, where its stock prices and broker rates come from, how often they are checked, and how to report a wrong rate.', canonical: url, root, crumbs: 'About', jsonld: [ORG_LD, { '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About DalalScope', url, about: { '@id': SITE_URL + '#org' } }, crumbLD('About', url)], body });
}

function methodPage() {
  const root = '../';
  const url = SITE_URL + 'how-we-calculate/';
  const pc = (p) => p ? (+(p * 100).toFixed(5)).toString() + '%' : '—';
  const statRows = E.SEGS.map((s) => { const t = E.STAT[s]; return `<tr><th scope="row">${E.SEG_LABEL[s]}</th><td>${t.sttB ? pc(t.sttB) + ' buy, ' : ''}${t.sttS ? pc(t.sttS) + ' sell' : 'None'}</td><td>${pc(t.txn)}</td><td>${pc(t.stampB)}</td></tr>`; }).join('\n          ');
  const hd = E.parseStocks(fullStocks ? fullStocks.data : '').find((x) => x.s === 'HDFCBANK');
  let example = '';
  if (hd) {
    const qty = 250, v = hd.p * qty;
    const rows = BROKERS.map((b) => ({ b, c: E.compute(b, 'del', v, v, 1, 1) })).sort((a, z) => a.c.total - z.c.total);
    const pick = [rows[0], rows.find((r) => r.b.id === 'zerodha'), rows[rows.length - 1]].filter((r, i, a) => r && a.indexOf(r) === i);
    const line = (label, f) => `<tr><th scope="row">${label}</th>${pick.map((r) => `<td>${inr(f(r.c))}</td>`).join('')}</tr>`;
    example = `<section class="panel prose" aria-labelledby="m-ex"><h2 id="m-ex">Worked example</h2>
      <p>Buying and then selling ${qty} HDFCBANK shares for delivery at the ${PRICES_DATE} close of ${inr(hd.p)}: ${inr(v, 0)} each way.</p>
      <div class="table-scroll"><table class="ex-t"><thead><tr><th scope="col">Line item</th>${pick.map((r) => `<th scope="col">${esc(fullName(r.b))}</th>`).join('')}</tr></thead><tbody>
          ${line('Commission (both orders)', (c) => c.brok)}
          ${line('GST on commission (18%)', (c) => c.gstBrok)}
          ${line('DP charge on the sell', (c) => c.dp)}
          ${line('STT (0.1% each side)', (c) => c.stt)}
          ${line('Exchange and SEBI fees', (c) => c.txn)}
          ${line('GST on exchange and SEBI fees', (c) => c.gstOther)}
          ${line('Stamp duty (buy side)', (c) => c.stamp)}
          <tr class="tot-row"><th scope="row">Total you pay</th>${pick.map((r) => `<td><b>${inr(r.c.total)}</b></td>`).join('')}</tr>
      </tbody></table></div></section>`;
  }
  const log = (changeLog.items || []).slice(0, 30).map((it) => `<li><time datetime="${esc(it.at)}">${fmtISODate(istDate(it.at))}</time><ul>${it.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></li>`).join('\n        ');
  const body = `    <header class="bp-head">
      <h1>How DalalScope calculates your costs</h1>
      <p class="lead">Every total on DalalScope is the broker’s commission plus the government and exchange charges that apply to that trade. Here is exactly what goes in, at today’s rates.</p>
      <p class="checked">Broker rates last checked ${RATES_DATE}. Stock prices are NSE closing prices for ${PRICES_DATE}.</p>
    </header>
    <section class="panel prose" aria-labelledby="m-f"><h2 id="m-f">The formula</h2>
      <p class="formula">Total = commission + 18% GST on commission + STT + exchange transaction charges + SEBI fee + 18% GST on exchange and SEBI fees + stamp duty + DP charge on delivery sells</p>
      <ul>
        <li>One buy order and one sell order are assumed unless you pick only one side.</li>
        <li>Trade value is quantity × the latest NSE closing price. F&amp;O comparisons use one lot at the size you set; option charges apply to the premium.</li>
        <li>Brokerage on cash-market trades is capped at 2.5% of the trade value, the SEBI maximum.</li>
      </ul></section>
    <section class="panel prose" aria-labelledby="m-b"><h2 id="m-b">How brokerage is charged</h2>
      <ul>
        <li><b>Flat per order:</b> the same fee whatever the trade size, for example ₹20 per order.</li>
        <li><b>Lower of a flat fee or a percentage:</b> for example ₹20 or 0.03%, whichever is lower, so small trades cost less than ₹20.</li>
        <li><b>Percentage of trade value:</b> for example 0.25% on delivery, common at full-service brokers.</li>
        <li><b>Per lot:</b> some brokers charge options by the lot, so five lots in one order cost five times as much.</li>
        <li><b>Zero:</b> some plans charge nothing on delivery, or on every segment.</li>
      </ul></section>
    <section class="panel prose" aria-labelledby="m-s"><h2 id="m-s">Government and exchange charges</h2>
      <p>These are the same at every broker. SEBI’s fee is ₹10 per crore of turnover, and GST is 18% of brokerage, exchange charges and the SEBI fee.</p>
      <div class="table-scroll"><table class="ex-t"><thead><tr><th scope="col">Segment</th><th scope="col">STT / CTT</th><th scope="col">Exchange transaction charge</th><th scope="col">Stamp duty (buy)</th></tr></thead><tbody>
          ${statRows}
      </tbody></table></div></section>
    ${example}
    <section class="panel prose" aria-labelledby="m-out"><h2 id="m-out">What is left out</h2>
      <ul>
        <li>Separate clearing fees some brokers add on F&amp;O, and STT on exercised options.</li>
        <li>Fees for call &amp; trade, auto square-off, pledging, margin funding interest and physical settlement. They are listed under each broker’s “Watch out for”.</li>
        <li>Account opening fees and demat AMC, which are shown beside each broker but not added to a single trade.</li>
        <li>Higher BSE transaction charges on some BSE-only stocks; every stock is priced at NSE rates.</li>
      </ul></section>
    <section class="panel prose" aria-labelledby="m-up"><h2 id="m-up">How the data stays current</h2>
      <ul>
        <li>Closing prices for every NSE-listed stock are loaded from NSE’s bhavcopy after each trading day.</li>
        <li>Every broker plan is re-checked daily against the broker’s official charges page, and a rate only changes when that page states a different number.</li>
        <li>Plans marked “rates from comparison sites” are the exception: their own pages don’t publish full rates.</li>
      </ul></section>
    <section class="panel prose" id="changes" aria-labelledby="m-log"><h2 id="m-log">Rate changes</h2>
      <ol class="changes">
        ${log}
      </ol></section>`;
  return shell({ title: 'How We Calculate Brokerage, STT, GST and DP Charges | DalalScope', desc: 'The exact formula and rates DalalScope uses: brokerage rules, STT, stamp duty, exchange and SEBI fees, GST and DP charges, with a worked example and a log of rate changes.', canonical: url, root, crumbs: 'How we calculate', jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'How DalalScope calculates your costs', url, dateModified: status.ratesUpdatedAt || status.ratesCheckedAt, publisher: { '@id': SITE_URL + '#org' } }, crumbLD('How we calculate', url)], body });
}

function rssFeed() {
  const items = (newsDoc.items || []).slice(0, 40).map((n) => `  <item>
    <title>${esc(n.who + ': ' + n.title)}</title>
    <link>${esc(n.srcUrl)}</link>
    <guid isPermaLink="false">dalalscope-${esc(n.id)}</guid>
    <pubDate>${new Date(n.d + 'T12:00:00+05:30').toUTCString()}</pubDate>
    <category>${esc(n.tag)}</category>
    <description>${esc(n.body + ' (Source: ' + n.srcName + ')')}</description>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>DalalScope broker news</title>
  <link>${esc(SITE_URL)}</link>
  <atom:link href="${esc(SITE_URL)}feed.xml" rel="self" type="application/rss+xml"/>
  <description>Pricing changes, new products and SEBI rules that change what Indian traders pay their brokers.</description>
  <language>en-IN</language>
  <lastBuildDate>${new Date(status.newsUpdatedAt || Date.now()).toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

/* ---------- write ---------- */
if (PREVIEW) {
  fs.writeFileSync(PREVIEW, buildHome(true));
  console.log('preview', PREVIEW);
  process.exit(0);
}
fs.rmSync(OUT, { recursive: true, force: true });
const w = (rel, s) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
w('index.html', buildHome(false));
w('assets/site.css', css);
w('assets/app.js', appJs);
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(OUT, 'assets', f));
for (const f of fs.readdirSync(DATA)) if (f.endsWith('.json')) w('data/' + f, read(path.join(DATA, f)));
groups.forEach((g) => w('brokers/' + g.slug + '/index.html', brokerPage(g)));
w('404.html', notFound());
w('about/index.html', aboutPage());
w('how-we-calculate/index.html', methodPage());
w('feed.xml', rssFeed());
if (CONFIG.indexNowKey) w(CONFIG.indexNowKey + '.txt', CONFIG.indexNowKey);
w('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
const lastRates = istDate(status.ratesUpdatedAt || status.ratesCheckedAt || new Date().toISOString());
const urls = [[SITE_URL, pricesISO > lastRates ? pricesISO : lastRates, 'daily', '1.0'], [SITE_URL + 'how-we-calculate/', lastRates, 'weekly', '0.6'], [SITE_URL + 'about/', lastRates, 'monthly', '0.4']].concat(groups.map((g) => [SITE_URL + 'brokers/' + g.slug + '/', lastRates, 'weekly', '0.8']));
w('urls.txt', urls.map((u) => u[0]).join('\n') + '\n');
w('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d, f, p]) => `  <url><loc>${esc(u)}</loc><lastmod>${d}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')}\n</urlset>\n`);
w('manifest.webmanifest', JSON.stringify({ name: 'DalalScope brokerage calculator', short_name: BRAND, start_url: './', scope: './', display: 'standalone', background_color: '#061020', theme_color: '#061020', icons: [{ src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'assets/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, null, 1));
w('.nojekyll', '');
console.log('built', OUT, 'pages:', 1 + groups.length, 'brokers:', groups.map((g) => g.slug).join(', '));
