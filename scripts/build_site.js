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
/* wrong-rate reports go to the contact email when one is set (no account needed), otherwise to a GitHub issue */
const REPORT_BODY = 'Broker and plan:\nWhich charge looks wrong:\nCorrect rate:\nLink to the broker’s page that shows it:\n';
const REPORT_URL = CONFIG.contactEmail ? 'mailto:' + CONFIG.contactEmail + '?subject=' + encodeURIComponent('Wrong rate on DalalScope') + '&body=' + encodeURIComponent(REPORT_BODY)
  : REPO_URL ? REPO_URL + '/issues/new?title=' + encodeURIComponent('Wrong rate: ') : '';
const REPORT_ATTRS = REPORT_URL.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener"';
function siteLinks(root) {
  return [`<li><a href="${root}cheapest-broker/">Cheapest broker by segment</a></li>`, `<li><a href="${root}compare/">Compare brokers</a></li>`, `<li><a href="${root}crypto/">Crypto exchange fees</a></li>`, `<li><a href="${root}about/">About DalalScope</a></li>`, `<li><a href="${root}how-we-calculate/">How we calculate</a></li>`]
    .concat(REPORT_URL ? [`<li><a href="${esc(REPORT_URL)}"${REPORT_ATTRS}>Report a wrong rate</a></li>`] : [])
    .concat(CONFIG.contactEmail ? [`<li><a href="mailto:${esc(CONFIG.contactEmail)}">Contact</a></li>`] : []).join('');
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtISODate = (d) => { const p = d.split('-'); return +p[2] + ' ' + MON[+p[1] - 1] + ' ' + p[0]; };
const istDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const pricesISO = meta.date || (fullStocks && fullStocks.date) || '2026-10-23';
const PRICES_DATE = fmtISODate(pricesISO);
const RATES_DATE = status.ratesCheckedAt ? fmtISODate(istDate(status.ratesCheckedAt)) : PRICES_DATE;
/* "2 Nov, 3:43 am IST"; the page swaps in "today …" once it loads the latest status.json */
const istWhen = (iso) => { if (!iso) return '—'; const t = new Date(iso); const p = istDate(iso).split('-'); return +p[2] + ' ' + MON[+p[1] - 1] + ', ' + t.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, (_, x) => ' ' + x.toLowerCase() + 'm') + ' IST'; };
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

/* analytics: Cloudflare (cookieless) and, when googleTagId is set, Google Analytics 4 (sets first-party cookies) */
function analyticsTags(preview) {
  const a = CONFIG.analytics || {};
  if (preview) return '';
  let t = '';
  if (a.cloudflareToken && /^[A-Za-z0-9]+$/.test(a.cloudflareToken)) t += `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${a.cloudflareToken}"}'></script>\n`;
  if (a.goatcounterCode && /^[a-z0-9-]+$/.test(a.goatcounterCode)) t += `<script data-goatcounter="https://${a.goatcounterCode}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>\n`;
  /* Google Analytics 4 via the Google tag Google issued for the stream (GTM-… container, or a plain G-… measurement ID).
     The library is fetched after the page's load event so it never competes with the page itself. */
  if (a.googleTagId && /^(GTM|GT|G)-[A-Z0-9]+$/.test(a.googleTagId)) {
    const id = a.googleTagId, lib = id.startsWith('GTM-') ? 'gtm.js' : 'gtag/js';
    t += `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());${id.startsWith('G-') ? `gtag('config','${id}');` : ''}addEventListener('load',function(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/${lib}?id=${id}';document.head.appendChild(s)});</script>\n`;
  }
  return t;
}

function head({ title, desc, canonical, root, jsonld, preview, noindex }) {
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
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
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
${analyticsTags(preview)}<link rel="preconnect" href="https://fonts.googleapis.com">
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

const PROFILES = ['https://x.com/iashuhere', 'https://www.quora.com/profile/Ashok-Kumar-1023', 'https://github.com/iashuhere'];
const ORG_PROFILES = ['https://x.com/dalalscope', 'https://www.linkedin.com/company/dalalscope/', 'https://www.facebook.com/profile.php?id=61596207647602'];
const PERSON_LD = CONFIG.owner ? { '@context': 'https://schema.org', '@type': 'Person', '@id': SITE_URL + '#owner', name: CONFIG.owner, description: CONFIG.ownerNote || undefined, url: SITE_URL + 'about/', sameAs: PROFILES } : null;
const ORG_LD = { '@context': 'https://schema.org', '@type': 'Organization', '@id': SITE_URL + '#org', name: BRAND, url: SITE_URL, logo: SITE_URL + 'assets/icon-512.png', description: 'Independent brokerage cost comparison for Indian stock traders.', email: CONFIG.contactEmail || undefined, founder: CONFIG.owner ? { '@type': 'Person', name: CONFIG.owner, url: SITE_URL + 'about/' } : undefined, sameAs: ORG_PROFILES.concat(REPO_URL ? [REPO_URL] : []).concat(PROFILES) };
/* Page dates. Each page's dateModified (and sitemap lastmod) is the latest of: the last rewrite of its
   copy (CONTENT_REVISED), the last logged rate change that touches it, and for broker pages the newest
   news item about that broker. The daily check does not count, and one broker's rate change does not
   re-date another broker's page. Bump CONTENT_REVISED when the page copy itself is rewritten. */
const CONTENT_REVISED = '2026-11-23';
const latestDate = (...ds) => ds.filter(Boolean).map((d) => String(d).slice(0, 10)).sort().pop();
const SEG_IN_CHANGE = [[/commodity futures/i, 'mfut'], [/commodity options/i, 'mopt'], [/currency futures/i, 'cfut'], [/currency options/i, 'copt'], [/delivery|\bDP\b/, 'del'], [/intraday/i, 'intra']];
const changeSegs = (c) => {
  if (/^(Added|Launched|Removed) /.test(c)) return E.SEGS.slice();
  const out = SEG_IN_CHANGE.filter(([re]) => re.test(c)).map(([, s]) => s);
  const rest = c.replace(/(commodity|currency) (futures|options)/gi, '');
  if (/futures|F&O/i.test(rest)) out.push('fut');
  if (/options|F&O/i.test(rest)) out.push('opt');
  return out.length ? out : E.SEGS.slice();
};
const isRateChange = (c) => !/^(Added|Launched) /.test(c);
const brokerChangedOn = (name) => latestDate(...(changeLog.items || []).filter((it) => it.changes.some((c) => isRateChange(c) && c.includes(name))).map((it) => istDate(it.at)));
const brokerNewsOn = (g) => { const ids = new Set(g.plans.map((p) => p.news).filter(Boolean)); return latestDate(...(newsDoc.items || []).filter((n) => ids.has(n.who)).map((n) => n.d)); };
const modBroker = (g) => latestDate(CONTENT_REVISED, brokerChangedOn(g.name), brokerNewsOn(g));
const modPair = (p) => latestDate(CONTENT_REVISED, brokerChangedOn(p.A.name), brokerChangedOn(p.B.name));
const modSegs = (segs) => latestDate(CONTENT_REVISED, ...(changeLog.items || []).filter((it) => it.changes.some((c) => changeSegs(c).some((s) => segs.includes(s)))).map((it) => istDate(it.at)));
const articleLD = (headline, url, datePublished, dateModified) => ({ '@context': 'https://schema.org', '@type': 'Article', headline, mainEntityOfPage: url, datePublished, dateModified: dateModified || latestDate(CONTENT_REVISED, datePublished), inLanguage: 'en-IN', author: CONFIG.owner ? { '@type': 'Person', name: CONFIG.owner, url: SITE_URL + 'about/' } : { '@id': SITE_URL + '#org' }, publisher: { '@id': SITE_URL + '#org' } });

/* visible byline: who compiled the page and where its rates come from (E-E-A-T for a finance site) */
const byline = (root, rest) => `<p class="checked byline">${CONFIG.owner ? `By <a href="${root}about/" rel="author">${esc(CONFIG.owner)}</a> · ` : ''}${rest}.</p>`;
const srcLinks = (b) => b.links.map((l) => `<a href="${esc(l[1])}" target="_blank" rel="noopener">${esc(l[0])}</a>`).join(', ');

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
    .replace('{{RATES_WHEN}}', status.ratesCheckedAt ? istWhen(status.ratesCheckedAt) : RATES_DATE)
    .replace('{{NEWS_CHECKED}}', istWhen(status.newsCheckedAt))
    .replace('{{PLAN_COUNT}}', String(BROKERS.length))
    .replace('{{NEWS_WHEN}}', esc(newsWhen))
    .replace('{{STOCK_COUNT}}', (meta.count || (fullStocks && fullStocks.count) || 0).toLocaleString('en-IN'))
    .replace('{{RATES_SECTION}}', rateTable(root))
    .replace('{{GUIDES_SECTION}}', guidesSection(root))
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
  const mod = modBroker(g);
  const title = `${g.name} Brokerage Calculator & Charges ${YEAR} | ${BRAND}`;
  const subject = g.plans.length > 1 ? `On its ${p0.plan} plan, ${g.name}` : g.name;
  const card = cardSentence(p0, subject);
  const facts = brokerFacts(g, root);
  const leadFact = facts.find((f) => !f.html);
  const rest = facts.filter((f) => f !== leadFact);
  const lead = card + (leadFact ? ' ' + leadFact.text : '');
  const desc = clip(card + (leadFact && card.length < 110 ? ' ' + leadFact.text : ''), 158);
  const others = nearestGroups(g, 6);
  const vsWith = pairList.filter((p) => p.A === g || p.B === g).sort((x, y) => indexedPair(y) - indexedPair(x));
  const jsonld = [Object.assign(articleLD(g.name + ' brokerage charges and calculator', canonical, trackedSince(g), mod), { about: { '@type': 'Organization', name: g.name, url: p0.links[0] ? p0.links[0][1] : undefined, foundingDate: (HIST[g.name] || {}).founded } }),
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
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
        <h2 id="plan-${esc(b.id)}">${esc(g.plans.length > 1 ? b.plan + ' plan, segment by segment' : g.name + ' charges by segment')}</h2>
        <div class="table-scroll"><table class="ex-t">
          <thead><tr><th scope="col">Segment and example trade</th><th scope="col">Brokerage</th><th scope="col">Brokerage on the example</th><th scope="col">Total with taxes</th><th scope="col">Rank of ${BROKERS.length}</th></tr></thead>
          <tbody>
            ${segRows}
          </tbody>
        </table></div>
        <dl class="facts">
          <div><dt>DP charge per sell</dt><dd>${b.dp == null ? 'Not published on the plan page' : inr(b.dp) + ' including GST'}</dd></div>
          <div><dt>Demat AMC</dt><dd>${esc(b.amc)}</dd></div>
          <div><dt>Rate source</dt><dd>${srcLinks(b)}${b.src === 'agg' ? ' (comparison site; confirm before you open an account)' : ''}</dd></div>
        </dl>
        <h3>Watch out for</h3>
        <ul class="notes">${b.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </section>`;
  }).join('\n      ');
  return head({ title, desc, canonical, root, jsonld }) + `<body data-root="${root}">
<div class="wrap page">
  ${topBar(root, true)}
  <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${root}">DalalScope</a></li><li><a href="${root}#rate-cards">Rate cards</a></li><li aria-current="page">${esc(g.name)}</li></ol></nav>
  <article class="bp">
    <header class="bp-head">
      <h1>${esc(g.name)} brokerage charges and calculator</h1>
      <p class="lead">${esc(lead)}</p>
      ${byline(root, `Updated <time datetime="${mod}">${fmtISODate(mod)}</time> · Rates checked ${RATES_DATE} against ${srcLinks(p0)}${p0.src === 'agg' ? ' (comparison site)' : ''}`)}
      <a class="cta" href="${root}#calculator">Check any NSE stock in the calculator</a>
    </header>
    ${miniCalc(g.plans, `${g.name} brokerage calculator`)}
    ${fitSection(g, root, rest)}
      ${planBlocks}
    ${stockExample(g, groups.indexOf(g))}
    ${brokerHistory(g, root)}
    <section class="panel" aria-labelledby="cmp-h">
${vsWith.length ? `      <h2 id="cmp-h">${esc(g.name)} head to head</h2>
      <ul class="cmp-links">${vsWith.map((p) => `<li><a href="${root}compare/${p.slug}/">${esc(p.A.name)} vs ${esc(p.B.name)}</a></li>`).join('')}</ul>
      <h2 class="h-gap">Brokers priced closest to ${esc(g.name)}</h2>` : `      <h2 id="cmp-h">Brokers priced closest to ${esc(g.name)}</h2>`}
      <ul class="cmp-links">${others.map((o) => `<li><a href="${root}brokers/${o.slug}/">${esc(o.name)}</a></li>`).join('')}<li><a href="${root}#rate-cards">All ${BROKERS.length} plans</a></li></ul>
      <h2 class="h-gap">Cheapest broker by segment</h2>
      <ul class="cmp-links">${CHEAP.map((c) => `<li><a href="${root}${cheapUrl(c)}">${esc(cap(c.name))}</a></li>`).join('')}</ul>
    </section>
  </article>
  <footer><p>Rates come from each broker’s published charges page and change often; your contract note is the final word. DalalScope compares published prices; it is not investment advice.</p><ul class="foot-site">${siteLinks(root)}<li><a href="${root}">Brokerage calculator</a></li></ul></footer>
</div>
${THEME_JS}
${calcScripts(root)}
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
  const contact = CONFIG.contactEmail ? `email <a href="${esc(REPORT_URL)}">${esc(CONFIG.contactEmail)}</a> with the broker, the charge and a link to the broker’s page` : REPORT_URL ? `<a href="${REPORT_URL}" target="_blank" rel="noopener">report it on GitHub</a>` : '';
  const body = `    <header class="bp-head">
      <h1>About DalalScope</h1>
      <p class="lead">DalalScope answers one question for Indian traders: what will this exact trade cost me at each broker? Pick any NSE stock and a quantity, and it works out every plan’s commission, taxes and fees, cheapest first.</p>
    </header>
    <section class="panel prose" aria-labelledby="ab-ind"><h2 id="ab-ind">Independent and free</h2>
      <p>DalalScope is not owned by, paid by or affiliated with any broker, exchange or regulator. There are no referral links, paid placements or ads, and brokers are ranked by cost alone.</p>
      <p>${who} The code and every data file are public${REPO_URL ? ` on <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>` : ''}, so anyone can check how a number was worked out.</p></section>
    <section class="panel prose" aria-labelledby="ab-why"><h2 id="ab-why">Why this exists</h2>
      <p>India has added crores of first-time investors in the last few years. Most of us start the same way: download an app, see “zero brokerage” in the ad, and tap buy. Then the contract note arrives, and the “free” trade has STT, exchange charges, stamp duty, GST and a DP charge on it. None of that is hidden exactly, but it is spread across rate cards, circulars and fine print that a new investor has no reason to have read.</p>
      <p>I built DalalScope so that nobody new to the market gets fooled by a headline price. Put in the exact trade you are about to make and see the full cost at every broker plan, before you place it, with every number traceable to the broker’s own published page or the official tax rate. Awareness is the whole point of this site; there is nothing to sign up for and nothing being sold.</p></section>
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
  return shell({ title: 'About DalalScope: Independent Brokerage Comparison for India', desc: 'Who runs DalalScope, where its stock prices and broker rates come from, how often they are checked, and how to report a wrong rate.', canonical: url, root, crumbs: 'About', jsonld: [ORG_LD].concat(PERSON_LD ? [PERSON_LD] : []).concat([{ '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About DalalScope', url, about: { '@id': SITE_URL + '#org' } }, crumbLD('About', url)]), body });
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
  return shell({ title: 'How We Calculate Brokerage, STT, GST and DP Charges | DalalScope', desc: 'The exact formula and rates DalalScope uses: brokerage rules, STT, stamp duty, exchange and SEBI fees, GST and DP charges, with a worked example and a log of rate changes.', canonical: url, root, crumbs: 'How we calculate', jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'How DalalScope calculates your costs', url, dateModified: status.ratesUpdatedAt || status.ratesCheckedAt, publisher: { '@id': SITE_URL + '#org' } },
  { '@context': 'https://schema.org', '@type': 'Dataset', name: 'Indian stock broker rate cards', description: 'Brokerage rules, DP charges and demat AMC for ' + BROKERS.length + ' Indian broker plans, checked daily against each broker\u2019s published charges page, with a public change log.', url, license: REPO_URL ? REPO_URL + '/blob/main/LICENSE' : undefined, isAccessibleForFree: true, creator: { '@id': SITE_URL + '#org' }, dateModified: status.ratesUpdatedAt || status.ratesCheckedAt, distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: SITE_URL + 'data/brokers.json' }, { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: SITE_URL + 'data/changes.json' }] },
  crumbLD('How we calculate', url)], body });
}

/* ---------- guides: cheapest broker by segment, head-to-head comparisons, mini calculator ---------- */
const MC = require(path.join(SRC, 'mini.js'));
const engineAsset = engineSrc.replace('"__STOCKS__"', '""');
const miniSrc = read(path.join(SRC, 'mini.js'));
const ENG_V = hash(engineAsset), MINI_V = hash(miniSrc);
const MONTH_YEAR = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const amt = (v) => v >= 1e7 ? '₹' + +(v / 1e7).toFixed(2) + ' crore' : v >= 1e5 ? '₹' + +(v / 1e5).toFixed(2) + ' lakh' : '₹' + v.toLocaleString('en-IN');
const PREM = MC.PREM;
const SEG_WORD = { del: 'delivery', intra: 'intraday', fut: 'futures', opt: 'options', cfut: 'currency futures', copt: 'currency options', mfut: 'commodity futures', mopt: 'commodity options' };
const TRADE_PHRASE = { del: 'a ₹1 lakh delivery buy and sell', intra: 'a ₹1 lakh intraday buy and sell', fut: 'a ₹10 lakh futures contract bought and sold', opt: 'an options trade with ₹10,000 premium, bought and sold', cfut: 'a ₹85,000 currency futures contract bought and sold', copt: 'currency options with ₹1,000 premium, bought and sold', mfut: 'a ₹6 lakh commodity futures contract bought and sold', mopt: 'commodity options with ₹10,000 premium, bought and sold' };
const SHORT_EX = { del: '₹1 lakh buy + sell', intra: '₹1 lakh buy + sell', fut: '₹10 lakh contract', opt: '₹10,000 premium, buy + sell', cfut: '₹85,000 contract, buy + sell', copt: '₹1,000 premium', mfut: '₹6 lakh contract, buy + sell', mopt: '₹10,000 premium' };
/* trade sizes used to show whether the cheapest plan changes as a trade gets bigger */
const SIZES = {
  del: [{ v: 10000 }, { v: 100000 }, { v: 500000 }, { v: 2500000 }],
  intra: [{ v: 25000 }, { v: 100000 }, { v: 500000 }, { v: 2500000 }],
  fut: [{ v: 500000 }, { v: 1000000 }, { v: 2500000 }, { v: 5000000 }],
  opt: [{ v: 5000, lots: 1 }, { v: 10000, lots: 1 }, { v: 25000, lots: 5 }, { v: 100000, lots: 20 }],
  cfut: [{ v: 85000, lots: 1 }, { v: 850000, lots: 10 }, { v: 4250000, lots: 50 }],
  copt: [{ v: 1000, lots: 2 }, { v: 5000, lots: 10 }, { v: 25000, lots: 50 }],
  mfut: [{ v: 100000 }, { v: 600000 }, { v: 2500000 }],
  mopt: [{ v: 10000, lots: 1 }, { v: 50000, lots: 5 }, { v: 200000, lots: 20 }],
};
const sizeLabel = (s, z) => amt(z.v) + (PREM[s] ? ' premium' : s === 'del' || s === 'intra' ? '' : ' contract') + (z.lots && (PREM[s] || s === 'cfut') ? ', ' + z.lots + ' lot' + (z.lots > 1 ? 's' : '') : '');
const REF_SIZE = (s) => ({ v: E.REF[s], lots: 1 });
const lotsTxt = (s, z) => z.lots && (PREM[s] || s === 'cfut') ? ', ' + z.lots + ' lot' + (z.lots > 1 ? 's' : '') : '';
const sizePhrase = (s, z) => PREM[s] ? amt(z.v) + ' premium' + lotsTxt(s, z) : 'a ' + amt(z.v) + (s === 'del' || s === 'intra' ? ' trade' : ' contract') + lotsTxt(s, z);
const article = (w) => /^[aeiou]/i.test(w) ? 'an' : 'a';
function ranked(s, z) {
  return BROKERS.map((b) => ({ b, c: E.compute(b, s, z.v, z.v, 1, z.lots || 1) })).filter((r) => r.c).sort((a, q) => a.c.total - q.c.total || (a.b.name < q.b.name ? -1 : 1));
}
const tied = (rows) => rows.filter((r) => r.c.total < rows[0].c.total + 0.005);
const lastGroup = (rows) => rows.filter((r) => r.c.total > rows[rows.length - 1].c.total - 0.005);
const nextGroup = (rows) => { const n = rows.find((r) => r.c.total >= rows[0].c.total + 0.005); return n ? rows.filter((r) => Math.abs(r.c.total - n.c.total) < 0.005) : []; };
const namesOf = (rows, max) => { max = max || 4; const n = rows.map((r) => fullName(r.b)); return n.length > max ? n.slice(0, max).join(', ') + ' and ' + (n.length - max) + ' more' : joinNames(n); };
const isAre = (rows) => rows.length > 1 ? 'are' : 'is';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const planCell = (b, root) => `<a href="${root}brokers/${groupOf(b).slug}/">${esc(b.name)}</a>${b.plan !== 'Standard' ? `<small>${esc(b.plan)}</small>` : ''}`;
const posOf = (rows, r) => rows.filter((x) => x.c.total < r.c.total - 0.005).length + 1;
const calcScripts = (root) => `<script src="${root}assets/engine.js?v=${ENG_V}" defer></script>\n<script src="${root}assets/mini.js?v=${MINI_V}" defer></script>`;

function miniCalc(plans, title) {
  const segs = E.SEGS.filter((s) => plans.some((p) => p.r[s]));
  const s0 = segs[0];
  const data = { plans: plans.map((p) => ({ id: p.id, name: p.name, plan: p.plan, r: p.r, dp: p.dp })), ref: E.REF };
  return `<section class="panel mc" aria-labelledby="mc-h">
      <h2 id="mc-h">${esc(title)}</h2>
      <p class="sub">Enter your own trade size. Totals include brokerage, 18% GST, STT, exchange and SEBI fees, stamp duty and, on delivery sells, the DP charge.</p>
      <form class="mc-f" id="mc">
        <label>Segment<select name="seg">${segs.map((s) => `<option value="${s}">${E.SEG_LABEL[s]}</option>`).join('')}</select></label>
        <label><span id="mc-vl">${PREM[s0] ? 'Total premium (₹)' : 'Trade value (₹)'}</span><input name="v" type="number" inputmode="decimal" min="0" step="any" value="${E.REF[s0]}"></label>
        <label id="mc-lw"${MC.LOTSEG[s0] ? '' : ' hidden'}>Lots<input name="lots" type="number" inputmode="numeric" min="1" step="1" value="1"></label>
        <label>Orders<select name="side"><option value="both">Buy and sell</option><option value="buy">Buy only</option><option value="sell">Sell only</option></select></label>
      </form>
      <div id="mc-out" aria-live="polite">${MC.render(E.compute, data.plans, s0, E.REF[s0], E.REF[s0], 1)}</div>
      <script type="application/json" id="mc-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
    </section>`;
}

function guidePage({ title, desc, canonical, root, jsonld, crumbs, body, calc, noindex }) {
  const trail = crumbs.map(([n, href]) => href ? `<li><a href="${href}">${esc(n)}</a></li>` : `<li aria-current="page">${esc(n)}</li>`).join('');
  return head({ title, desc, canonical, root, jsonld, noindex }) + `<body data-root="${root}">
<div class="wrap page">
  ${topBar(root, true)}
  <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${root}">DalalScope</a></li>${trail}</ol></nav>
  <article class="bp guide">
${body}
  </article>
  <footer><p>Rates come from each broker’s published charges page and change often; your contract note is the final word. DalalScope compares published prices; it is not investment advice.</p><ul class="foot-site">${siteLinks(root)}<li><a href="${root}">Brokerage calculator</a></li></ul></footer>
</div>
${THEME_JS}
${calc ? calcScripts(root) : ''}
</body>
</html>
`;
}
const crumbsLD = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [[BRAND, SITE_URL]].concat(items).map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) });
const faqLD = (qa) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const faqBlock = (qa) => `<section class="faq" aria-labelledby="gq-h"><div class="sec-head"><h2 id="gq-h">Common questions</h2></div><div class="faq-list">
${qa.map(([q, a]) => `      <details class="panel"><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join('\n')}
    </div></section>`;

/* --- a year of trading: three typical activity levels, costed at every plan.
   Trading costs only (brokerage, STT, GST, exchange and SEBI fees, stamp duty, DP on delivery sells); AMC is shown separately as published. --- */
/* label: plural, for "cheaper for …"; who: one person, for sentences; short: the table caption */
const ACTIVITY = [
  { id: 'inv', name: 'Investor', label: 'buy-and-hold investors', who: 'an investor who buys and later sells ₹50,000 of shares four times a month', short: '4 delivery round trips of ₹50,000 a month', s: 'del', v: 50000, n: 4 },
  { id: 'swing', name: 'Swing trader', label: 'swing traders', who: 'a swing trader doing 10 delivery round trips of ₹2 lakh a month', short: '10 delivery round trips of ₹2 lakh a month', s: 'del', v: 200000, n: 10 },
  { id: 'dayS', name: 'Small intraday trader', label: 'intraday traders with small orders', who: 'an intraday trader doing 40 round trips of ₹25,000 a month', short: '40 intraday round trips of ₹25,000 a month', s: 'intra', v: 25000, n: 40 },
  { id: 'day', name: 'Intraday trader', label: 'intraday traders with ₹1 lakh orders', who: 'an intraday trader doing 20 round trips of ₹1 lakh a month', short: '20 intraday round trips of ₹1 lakh a month', s: 'intra', v: 100000, n: 20 },
  { id: 'opt', name: 'Options buyer', label: 'single-lot options traders', who: 'an options trader buying and selling ₹10,000 of premium, one lot, 40 times a month', short: '40 options round trips of ₹10,000 premium, 1 lot', s: 'opt', v: 10000, n: 40, lots: 1 },
  { id: 'optM', name: 'Multi-lot options trader', label: 'multi-lot options traders', who: 'an options trader doing 20 round trips a month of ₹1 lakh premium across 10 lots', short: '20 options round trips of ₹1 lakh premium, 10 lots', s: 'opt', v: 100000, n: 20, lots: 10 },
  { id: 'fut', name: 'Futures trader', label: 'futures traders', who: 'a futures trader doing 10 round trips a month on a ₹15 lakh contract', short: '10 futures round trips of ₹15 lakh a month', s: 'fut', v: 1500000, n: 10 },
];
const yearCost = (b, pr) => { const c = E.compute(b, pr.s, pr.v, pr.v, 1, pr.lots || 1); return c ? c.total * pr.n * 12 : null; };
const YEAR_ROWS = {};
ACTIVITY.forEach((pr) => { YEAR_ROWS[pr.id] = BROKERS.map((b) => ({ b, y: yearCost(b, pr) })).filter((r) => r.y != null).sort((a, z) => a.y - z.y); });
const yearRankOf = (b, pr) => {
  const rows = YEAR_ROWS[pr.id], r = rows.find((x) => x.b === b);
  if (!r) return null;
  return { y: r.y, pos: rows.filter((x) => x.y < r.y - 0.5).length + 1, of: rows.length, best: rows.filter((x) => x.y < rows[0].y + 0.5), gap: r.y - rows[0].y };
};
const inr0 = (n) => inr(Math.round(n), 0);
const niceAmt = (v) => amt(v < 1e5 ? Math.round(v / 1000) * 1000 : v < 1e6 ? Math.round(v / 10000) * 10000 : Math.round(v / 1e5) * 1e5);
const YEAR_NOTE = 'Trading costs only: brokerage, STT, GST, exchange and SEBI fees, stamp duty and the DP charge on delivery sells, for twelve months of the activity shown.';

/* ---------- plain-English copy worked out from each rate card ----------
   Every sentence below is chosen by the numbers: which segments a plan groups together, where it ranks,
   which trading patterns it suits. Two plans with different rate cards get different pages. */
const listAnd = (a) => a.length <= 2 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
/* list items that contain "and" themselves read better with a comma before the last one */
const listGroups = (a) => a.length <= 1 ? a.join('') : a.some((x) => / and /.test(x)) ? a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1] : listAnd(a);
/* "currency and commodity futures", "currency futures and commodity options", "currency and commodity derivatives" */
function segGroupLabel(segs) {
  const w = segs.map((s) => SEG_WORD[s]);
  if (segs.length === 4 && segs.every((s) => DERIV.includes(s))) return 'currency and commodity derivatives';
  const tails = Array.from(new Set(w.map((x) => x.split(' ').pop())));
  if (w.length > 1 && tails.length === 1 && w.every((x) => x.includes(' '))) return listAnd(w.map((x) => x.split(' ').slice(0, -1).join(' '))) + ' ' + tails[0];
  return listAnd(w);
}
const clip = (s, n) => s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,;:(]$/, '') + '…';
const ruleProse = (r) => !r ? null : r.t === 'z' ? 'nothing'
  : r.t === 'f' || (r.t === 'l' && r.p >= 0.025) ? `a flat ₹${r.a} an order`
  : r.t === 'l' ? `₹${r.a} or ${pct(r.p)} (whichever is lower${r.mn ? ', minimum ₹5' : ''})`
  : r.t === 'p' ? `${pct(r.p)} of the trade value`
  : `₹${r.a} per lot`;
const EQ = ['del', 'intra', 'fut', 'opt'], DERIV = ['cfut', 'copt', 'mfut', 'mopt'];
const offers = (b, s) => !!b.r[s];
const unpub = (b, s) => !b.r[s] && (b.unl || []).includes(s);
const zeroDel = BROKERS.filter((x) => x.r.del && x.r.del.t === 'z').length;
/* other single-plan brokers with an identical stock and F&O rate card and DP charge */
const twinsOf = (g) => g.plans.length !== 1 ? [] : groups.filter((x) => x !== g && x.plans.length === 1 && x.plans[0].dp === g.plans[0].dp && EQ.every((s) => ruleProse(x.plans[0].r[s]) === ruleProse(g.plans[0].r[s])));
const amcRupees = (s) => { if (/^₹0\b/.test(s || '')) return 0; const m = /₹\s?(\d[\d,]*)/.exec(s || ''); return m ? +m[1].replace(/,/g, '') : null; };

/* the rate card in one sentence, grouping segments that share a rule */
function cardSentence(b, name) {
  if (E.SEGS.every((s) => b.r[s] && b.r[s].t === 'z')) return `${name} charges no brokerage at all, in any segment.`;
  const grp = [];
  EQ.forEach((s) => { const p = ruleProse(b.r[s]); if (!p) return; let x = grp.find((y) => y.p === p); if (!x) grp.push(x = { p, segs: [] }); x.segs.push(s); });
  let t;
  if (grp.length === 1 && grp[0].segs.length === EQ.length) t = grp[0].p === 'nothing' ? `${name} charges no brokerage on delivery, intraday, futures or options` : `${name} charges ${grp[0].p} on every stock and F&O trade, delivery included`;
  else t = `${name} charges ` + listGroups(grp.map((x) => `${x.p} on ${listAnd(x.segs.map((s) => SEG_WORD[s]))}`));
  const missEq = EQ.filter((s) => !offers(b, s));
  if (missEq.length) t += `, and ${missEq.some((s) => unpub(b, s)) ? 'does not publish a rate for' : 'does not offer'} ${listAnd(missEq.map((s) => SEG_WORD[s]))}`;
  t += '.';
  const cur = ['cfut', 'copt'], com = ['mfut', 'mopt'];
  const none = (ss) => ss.every((s) => !offers(b, s) && !unpub(b, s));
  const hidden = (ss) => ss.every((s) => !offers(b, s)) && ss.some((s) => unpub(b, s));
  const extra = [];
  if (none(cur) && none(com)) extra.push('It does not offer currency or commodity trading.');
  else {
    if (none(cur)) extra.push('It does not offer currency derivatives.');
    if (none(com)) extra.push('It does not offer commodity trading.');
    const hid = [hidden(cur) ? 'currency' : null, hidden(com) ? 'commodity' : null].filter(Boolean);
    if (hid.length) extra.push(`It offers ${listAnd(hid)} derivatives but does not publish the brokerage.`);
    const odd = DERIV.filter((s) => offers(b, s) && ruleProse(b.r[s]) !== ruleProse(b.r[s.endsWith('fut') ? 'fut' : 'opt']));
    const og = [];
    odd.forEach((s) => { const p = ruleProse(b.r[s]); let x = og.find((y) => y.p === p); if (!x) og.push(x = { p, segs: [] }); x.segs.push(s); });
    if (og.length) extra.push(cap(listGroups(og.map((x) => `${segGroupLabel(x.segs)} cost ${x.p}`))) + '.');
  }
  return t + (extra.length ? ' ' + extra.join(' ') : '');
}

/* what stands out about one plan, most notable first; each item is {score, text} or {score, html} */
function brokerFacts(g, root) {
  const b = g.plans[0], name = g.name, out = [];
  const add = (score, text) => out.push({ score, text });
  const segs = E.SEGS.filter((s) => b.r[s]).map((s) => ({ s, k: rankOf(b, s), tie: tied(RANKS[s]).length }));
  const top = segs.filter((x) => x.k.pos === 1 && x.tie <= 3);
  const bottom = segs.filter((x) => x.k.of > 5 && lastGroup(RANKS[x.s]).length <= 2 && x.k.c.total > RANKS[x.s][RANKS[x.s].length - 1].c.total - 0.005);
  if (top.length) add(9, `On a typical trade it is the ${top.every((x) => x.tie === 1) ? '' : 'joint '}cheapest plan here for ${listAnd(top.map((x) => SEG_WORD[x.s]))}.`);
  if (bottom.length) add(8, `On a typical trade it is the most expensive plan here for ${listAnd(bottom.map((x) => SEG_WORD[x.s]))}.`);
  const d = b.r.del;
  if (d) {
    if (d.t === 'z') add(zeroDel <= 6 ? 6 : 4, b.dp == null ? `Delivery is free, and ${name} does not publish a DP charge on the plan page, so the delivery totals here leave that fee out.` : `Delivery is free, so the only charge ${name} sets on a delivery trade is the ${inr(b.dp)} DP fee when you sell.`);
    else if (d.t === 'p') { const c = E.compute(b, 'del', 500000, 500000, 1, 1); add(9, `Delivery brokerage is ${pct(d.p)} with no upper limit, so a ₹5 lakh buy and sell pays ${inr0(c.brok)} in brokerage alone, where ${zeroDel} plans here charge nothing.`); }
    else if (d.t === 'f' || d.p >= 0.025) add(7, `Even a ₹5,000 delivery buy pays ₹${d.a} in brokerage, ${+(d.a / 5000 * 100).toFixed(1)}% of the order, so small regular buys cost more here than at the ${zeroDel} plans with free delivery.`);
    else add(5, `Delivery brokerage stops rising at ₹${d.a} once an order passes ${amt(Math.round(d.a / d.p))}${d.mn ? ', and even a tiny order pays at least ₹5' : ''}.`);
  }
  if (b.r.opt && b.r.opt.t === 'lot') { const c = E.compute(b, 'opt', 100000, 100000, 1, 10); add(9, `Options brokerage is ₹${b.r.opt.a} per lot, not per order. A 10-lot order costs ${inr0(c.brok / 2)} each way, where most discount brokers charge ₹20.`); }
  const lowCap = ['intra', 'fut', 'opt'].filter((s) => b.r[s] && (b.r[s].t === 'f' || b.r[s].t === 'l') && b.r[s].a < 20);
  if (lowCap.length >= 2) { const caps = Array.from(new Set(lowCap.map((s) => b.r[s].a))); add(7, `${cap(listAnd(lowCap.map((s) => SEG_WORD[s])))} orders top out at ${caps.length === 1 ? '₹' + caps[0] : '₹' + Math.min(...caps) + ' to ₹' + Math.max(...caps)}, below the ₹20 that most discount brokers charge.`); }
  const dps = BROKERS.filter((x) => x.dp != null).map((x) => x.dp).sort((p, q) => p - q);
  if (b.dp === 0) add(9, `It charges no DP fee when you sell shares from your demat${dps.filter((x) => x === 0).length === 1 ? ', the only plan here that doesn’t' : ''}.`);
  else if (b.dp != null && dps.filter((x) => x < b.dp).length <= 2) add(6, `Its DP charge of ${inr(b.dp)} per sell is one of the three lowest here; across the plans it runs from ${inr(dps[0])} to ${inr(dps[dps.length - 1])}.`);
  else if (b.dp != null && dps.filter((x) => x > b.dp).length <= 1) add(7, `Its DP charge of ${inr(b.dp)} per sell is ${b.dp === dps[dps.length - 1] ? 'the highest' : 'the second highest'} here, and you pay it on every stock you sell from your demat, whatever the amount.`);
  else if (b.dp == null && d && d.t !== 'z') add(5, `${name} does not publish a DP charge on the plan page, so the delivery totals here leave it out.`);
  const amcs = BROKERS.map((x) => amcRupees(x.amc)).filter((x) => x != null), mine = amcRupees(b.amc);
  if (mine && mine === Math.max(...amcs)) add(6, `Its demat AMC, ${b.amc}, is the highest of the plans here.`);
  if (b.src === 'agg') add(5, `${name} does not publish a full rate card, so these rates come from comparison sites. Check with ${name} before you open an account.`);
  /* brokers whose stock and F&O rate card is identical: say so, and point at what does separate them */
  const twins = twinsOf(g);
  twins.forEach((x) => {
    const t = x.plans[0], pr = pairOf(g, x);
    const dOff = DERIV.filter((s) => !!t.r[s] !== !!b.r[s]);
    let h = `${esc(name)}’s stock and F&amp;O rate card is identical to <a href="${root}brokers/${x.slug}/">${esc(x.name)}</a>’s, ${b.dp != null ? `down to the ${inr(b.dp)} DP charge` : 'and neither publishes a DP charge'}, so any delivery, intraday, futures or options trade costs exactly the same at both. `;
    if (dOff.length) h += esc(`They differ on what else is offered: ${listAnd(Array.from(new Set(dOff.map((s) => SEG_WORD[s].split(' ')[0]))))} trading is available at ${!!b.r[dOff[0]] ? name : x.name} only. `);
    h += b.amc !== t.amc ? esc(`Where the yearly bill can differ is the demat AMC: ${b.amc} at ${name}, ${t.amc} at ${x.name}. `) : esc('Even the demat AMC matches, so the choice comes down to the app and the fine print. ');
    if (pr) h += `<a href="${root}compare/${pr.slug}/">${esc(pr.A.name)} vs ${esc(pr.B.name)}</a>.`;
    out.push({ score: 8, html: h });
  });
  /* the broker priced closest, and where the two swap places */
  const near = nearestGroups(g, 1)[0];
  if (near && !twins.includes(near)) {
    const r = near.plans[0];
    const xs = ['del', 'intra', 'fut'].map((s) => crossover(b, r, s)).filter(Boolean);
    const gaps = ACTIVITY.map((pr) => ({ pr, a: yearCost(b, pr), z: yearCost(r, pr) })).filter((x) => x.a != null && x.z != null).map((x) => Object.assign(x, { d: x.a - x.z })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
    const pr = pairOf(g, near);
    let t = `Priced closest to ${esc(name)}: <a href="${root}brokers/${near.slug}/">${esc(fullName(r))}</a>. `;
    if (xs.length) t += esc(xs.map(xoText).join(' ')) + ' ';
    if (gaps.length && Math.abs(gaps[0].d) >= 100) t += esc(`The widest gap is for ${gaps[0].pr.label}, where ${gaps[0].d < 0 ? name : near.name} saves ${inr0(Math.abs(gaps[0].d))} a year.`);
    else if (gaps.length) t += esc('For every trading pattern below, the two land within ₹100 a year of each other.');
    if (pr) t += ` <a href="${root}compare/${pr.slug}/">${esc(pr.A.name)} vs ${esc(pr.B.name)}</a>.`;
    out.push({ score: 3, html: t });
  }
  return out.sort((p, q) => q.score - p.score);
}

/* who the plan is cheap for, over a year of each trading pattern */
function fitSection(g, root, facts) {
  const b = g.plans[0], name = g.name;
  const rows = ACTIVITY.map((pr) => ({ pr, k: yearRankOf(b, pr) })).filter((x) => x.k);
  const good = rows.filter((x) => x.k.pos <= 3 || x.k.gap <= Math.max(300, 0.03 * x.k.y));
  const bad = rows.filter((x) => !good.includes(x) && x.k.pos > x.k.of / 3 && x.k.gap >= Math.max(1000, 0.15 * x.k.y));
  const mid = rows.filter((x) => !good.includes(x) && !bad.includes(x));
  /* what drives the gap against the cheapest plan: its brokerage, or its DP charge */
  const why = (x) => {
    const best = x.k.best[0].b, s = x.pr.s;
    const c = E.compute(b, s, x.pr.v, x.pr.v, 1, x.pr.lots || 1), cb = E.compute(best, s, x.pr.v, x.pr.v, 1, x.pr.lots || 1);
    const brokGap = (c.brok + c.gstBrok) - (cb.brok + cb.gstBrok), dpGap = c.dp - cb.dp;
    return dpGap > brokGap ? `its ${inr(b.dp)} DP charge on every sell` : `its brokerage of ${ruleProse(b.r[s])} on ${SEG_WORD[s]}`;
  };
  const ps = [];
  if (good.length) {
    const g0 = good.slice().sort((p, q) => p.k.pos - q.k.pos || p.k.gap - q.k.gap)[0];
    ps.push(`<p><b>Cheap for</b> ${esc(listAnd(good.map((x) => x.pr.label)))}. ${esc(cap(g0.pr.who))} pays ${inr0(g0.k.y)} a year here, ${g0.k.pos === 1 ? 'less than at any other plan.' : `${inr0(g0.k.gap)} more than at the cheapest, ${esc(namesOf(g0.k.best, 2))}.`}</p>`);
  }
  if (bad.length) {
    const w = bad.slice().sort((p, q) => q.k.gap - p.k.gap)[0];
    ps.push(`<p><b>Costs more for</b> ${esc(listAnd(bad.map((x) => x.pr.label)))}. ${esc(cap(w.pr.who))} pays ${inr0(w.k.y)} a year at ${esc(name)}, ${inr0(w.k.gap)} more than at ${esc(namesOf(w.k.best, 2))}, mostly because of ${esc(why(w))}.</p>`);
  }
  if (mid.length) {
    const lo = Math.min(...mid.map((x) => x.k.pos)), hi = Math.max(...mid.map((x) => x.k.pos));
    ps.push(`<p><b>Middle of the pack</b> for ${esc(listAnd(mid.map((x) => x.pr.label)))}, ranking ${lo === hi ? ord(lo) : ord(lo) + ' to ' + ord(hi)} of ${mid[0].k.of}.</p>`);
  }
  const missing = ACTIVITY.filter((pr) => !rows.some((x) => x.pr === pr));
  if (missing.length) ps.push(`<p>${esc(name)} is left out for ${esc(listAnd(missing.map((pr) => pr.label)))} because it does not offer or publish a rate for that segment.</p>`);
  const tRows = ACTIVITY.map((pr) => {
    const k = yearRankOf(b, pr);
    if (!k) return `<tr class="na"><th scope="row">${pr.name}<small>${esc(pr.short)}</small></th><td colspan="3">Not offered</td></tr>`;
    return `<tr><th scope="row">${pr.name}<small>${esc(pr.short)}</small></th><td class="num"><b>${inr0(k.y)}</b></td><td>${k.pos === 1 ? '<span class="best">Cheapest</span>' : ord(k.pos) + `<small>of ${k.of}</small>`}</td><td>${k.pos === 1 ? '—' : '+' + inr0(k.gap) + ' a year vs ' + planCell(k.best[0].b, root)}</td></tr>`;
  }).join('\n          ');
  return `<section class="panel prose-s" aria-labelledby="yr-h">
      <h2 id="yr-h">Is ${esc(name)} cheap?</h2>
      ${ps.join('\n      ')}
      <div class="table-scroll"><table class="ex-t gt yr-t">
        <thead><tr><th scope="col">A year of trading${g.plans.length > 1 ? ` <small>${esc(b.plan)} plan</small>` : ''}</th><th scope="col" class="num">Cost at ${esc(name)}</th><th scope="col">Rank</th><th scope="col">Cheapest plan</th></tr></thead>
        <tbody>
          ${tRows}
        </tbody>
      </table></div>
      <p class="fine">${YEAR_NOTE} Demat AMC is extra: ${esc(b.amc)}.${b.dp == null ? ` ${esc(name)} does not publish a DP charge on the plan page, so it is left out.` : ''}</p>
      ${facts.length ? `<h3>Worth knowing</h3>
      <ul class="insights">${facts.map((f) => `<li>${f.html || esc(f.text)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

/* where two plans swap places as a trade grows (percentage vs flat fees) */
function crossover(a, b, s) {
  const f = (v) => { const ca = E.compute(a, s, v, v, 1, 1), cb = E.compute(b, s, v, v, 1, 1); return ca && cb ? ca.total - cb.total : null; };
  let pv = null, pd = null;
  for (let v = 2000; v <= 5e6; v = Math.ceil(v * 1.08)) {
    const d = f(v);
    if (d == null) return null;
    if (Math.abs(d) < 0.5) continue;
    if (pd != null && Math.sign(d) !== Math.sign(pd)) {
      let lo = pv, hi = v;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, dm = f(m); if (Math.abs(dm) >= 0.5 && Math.sign(dm) === Math.sign(pd)) lo = m; else hi = m; }
      return { s, v: hi, small: pd < 0 ? a : b, large: pd < 0 ? b : a };
    }
    pd = d; pv = v;
  }
  return null;
}
const xoText = (x) => `On ${SEG_WORD[x.s]}, ${x.small.name} is cheaper on trades below about ${niceAmt(x.v)} and ${x.large.name} on larger ones${x.s === 'del' ? ' (DP charge included)' : ''}.`;

/* ---------- what is specific to one broker, worked out from its own rate card ---------- */
const STOCK_ROWS = E.parseStocks(fullStocks ? fullStocks.data : '');
const LAUNCH_AT = (changeLog.items || []).length ? changeLog.items[changeLog.items.length - 1].at : null;
/* each broker page works through a different large-cap stock, so every page carries its own worked numbers */
const STOCK_ROTA = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'ITC', 'BHARTIARTL', 'LT', 'AXISBANK', 'KOTAKBANK', 'HINDUNILVR', 'MARUTI', 'SUNPHARMA', 'TITAN', 'NTPC', 'TATASTEEL', 'BAJFINANCE', 'HCLTECH', 'ASIANPAINT', 'WIPRO', 'COALINDIA', 'POWERGRID', 'ONGC', 'BEL'];
const rankWord = (k) => (k.pos === 1 ? 'cheapest' : k.pos === k.of ? 'costliest' : ord(k.pos)) + ' of ' + k.of;
const segRankText = (x) => SEG_WORD[x.s] + ' (' + rankWord(x.k) + ')';

/* other brokers whose year-of-trading costs sit closest to this one's, across the three activity profiles */
function nearestGroups(g, n) {
  const vec = (b) => ACTIVITY.map((pr) => yearCost(b, pr));
  const mine = vec(g.plans[0]);
  return groups.filter((x) => x !== g).map((x) => {
    const v = vec(x.plans[0]);
    const d = mine.reduce((s, y, i) => s + (y == null || v[i] == null ? (y == null && v[i] == null ? 0 : 2) : Math.abs(y - v[i]) / Math.max(y, v[i], 1)), 0);
    return { g: x, d };
  }).sort((a, z) => a.d - z.d).slice(0, n).map((x) => x.g);
}
const pairOf = (g1, g2) => pairList.find((p) => (p.A === g1 && p.B === g2) || (p.A === g2 && p.B === g1));

/* a delivery trade in a real stock at the latest close, line by line, against the cheapest other broker */
function stockExample(g, idx) {
  const b = g.plans[0];
  if (!b.r.del) return '';
  const st = STOCK_ROWS.find((x) => x.s === STOCK_ROTA[idx % STOCK_ROTA.length]);
  if (!st || !(st.p > 0)) return '';
  const raw = 150000 / st.p;
  const qty = raw >= 100 ? Math.round(raw / 10) * 10 : raw >= 10 ? Math.round(raw / 5) * 5 : Math.max(1, Math.round(raw));
  const v = qty * st.p;
  const rows = ranked('del', { v });
  const mine = rows.find((r) => r.b === b), others = rows.filter((r) => groupOf(r.b) !== g);
  if (!mine || !others.length) return '';
  const rival = others[0], best = mine.c.total <= rival.c.total + 0.005, gap = Math.abs(mine.c.total - rival.c.total);
  const own = mine.c.brokerSide, theirs = rival.c.brokerSide;
  const ownWhat = mine.c.dpMissing ? 'brokerage with GST (its DP charge is not published)' : mine.c.brok > 0 ? 'brokerage with GST plus the DP charge' : 'just the DP charge, since delivery brokerage is ₹0';
  const said = `Say you buy ${qty} ${st.s} shares at the ${PRICES_DATE} NSE close of ${inr(st.p)}, ${inr(v, 0)} in all, and later sell them at the same price. ${g.name} takes ${inr(mine.c.total)} for the round trip. Of that, ${inr(mine.c.statutory)} is STT, stamp duty and exchange fees, which you would pay at any broker. The part ${g.name} sets is ${ownWhat}: ${inr(own)}. `
    + (best ? `No other plan here charges less on this trade; the next cheapest, ${fullName(rival.b)}, sets ${inr(theirs)}.`
      : `At ${fullName(rival.b)}, the cheapest plan for this trade, that part is ${inr(theirs)}, so ${g.name} costs ${inr(gap)} more.`);
  const line = (label, f) => `<tr><th scope="row">${label}</th><td class="num">${inr(f(mine.c))}</td><td class="num">${inr(f(rival.c))}</td></tr>`;
  return `<section class="panel" aria-labelledby="ex-h">
      <h2 id="ex-h">${qty} ${esc(st.s)} shares, bought and sold at ${esc(g.name)}</h2>
      <p>${esc(said)}</p>
      <div class="table-scroll"><table class="ex-t gt">
        <thead><tr><th scope="col">Line item</th><th scope="col" class="num">${esc(fullName(b))}</th><th scope="col" class="num">${esc(fullName(rival.b))} <small>(${best ? 'next cheapest' : 'cheapest'})</small></th></tr></thead>
        <tbody>
          ${line('Brokerage (both orders)', (c) => c.brok)}
          ${line('GST on brokerage (18%)', (c) => c.gstBrok)}
          ${line('DP charge on the sell', (c) => c.dp)}
          ${line('STT (0.1% each side)', (c) => c.stt)}
          ${line('Exchange and SEBI fees', (c) => c.txn)}
          ${line('GST on exchange and SEBI fees', (c) => c.gstOther)}
          ${line('Stamp duty (buy side)', (c) => c.stamp)}
          <tr class="tot-row"><th scope="row">Total you pay</th><td class="num"><b>${inr(mine.c.total)}</b></td><td class="num"><b>${inr(rival.c.total)}</b></td></tr>
        </tbody>
      </table></div>
      ${mine.c.dpMissing || rival.c.dpMissing ? `<p class="fine">${esc(joinNames([mine, rival].filter((r) => r.c.dpMissing).map((r) => r.b.name)))} does not publish a DP charge, so it is left out; the real cost is higher by that fee.</p>` : ''}
    </section>`;
}

/* ---------- background, pricing history and news (data/history.json, data/news-archive.json) ---------- */
const HIST = (readJSON(path.join(DATA, 'history.json'), { brokers: {} }).brokers) || {};
const ARCHIVE = (readJSON(path.join(DATA, 'news-archive.json'), { items: [] }).items) || [];
const ALL_NEWS = (() => { const seen = new Set(); return (newsDoc.items || []).concat(ARCHIVE).filter((n) => !seen.has(n.id) && seen.add(n.id)).sort((a, b) => b.d.localeCompare(a.d)); })();
const newsFor = (g) => { const ids = new Set(g.plans.map((p) => p.news).filter(Boolean)); return ALL_NEWS.filter((n) => ids.has(n.who)); };
const histDate = (d) => d.length === 7 ? MON[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4) : fmtISODate(d);
/* one leg's brokerage under a rule from history.json: same caps as the engine, plus an explicit rupee minimum */
function histLeg(r, s, v) {
  if (!r || v <= 0) return 0;
  const cap = s === 'del' || s === 'intra' ? 0.025 * v : Infinity;
  if (r.t === 'z') return 0;
  if (r.t === 'f') return Math.min(r.a, cap);
  if (r.t === 'lot') return r.a;
  let b = r.t === 'p' ? r.p * v : Math.min(r.a, r.p * v);
  const mn = r.min != null ? r.min : r.mn ? 5 : 0;
  if (b < mn) b = Math.min(mn, 0.025 * v);
  return Math.min(b, cap);
}
const histTrip = (r, s, v) => 2 * histLeg(r, s, v) * 1.18;
const HIST_SIZES = { del: [100000, 10000, 1000], intra: [100000, 25000, 1000], fut: [1000000, 100000], opt: [10000], cfut: [85000], copt: [1000], mfut: [600000], mopt: [10000] };
/* "On a ₹1 lakh delivery buy and sell, brokerage with GST went from nothing to ₹47.20." at a size where the change shows */
function thenNow(rules) {
  return Object.keys(rules).map((s) => {
    const { from, to } = rules[s];
    const v = HIST_SIZES[s].find((x) => Math.abs(histTrip(from, s, x) - histTrip(to, s, x)) >= 0.01);
    if (!v) return '';
    const a = histTrip(from, s, v), b = histTrip(to, s, v);
    const trade = PREM[s] ? `${amt(v)} of ${SEG_WORD[s]} premium bought and sold` : `a ${amt(v)} ${SEG_WORD[s]} buy and sell`;
    return `On ${trade}, brokerage with GST went from ${a < 0.005 ? 'nothing' : inr(a)} to ${b < 0.005 ? 'nothing' : inr(b)}.`;
  }).filter(Boolean).join(' ');
}
const srcLink = (name, url) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>`;
const histItems = (g, prefix) => ((HIST[g.name] || {}).changes || []).map((c) => ({ d: c.d,
  html: `<time datetime="${esc(c.d)}">${histDate(c.d)}</time>: ${prefix && !c.text.startsWith(g.name) ? `<b>${esc(g.name)}.</b> ` : ''}${esc(c.text)}${c.rules ? ' ' + esc(thenNow(c.rules)) : ''} <span class="src">Source: ${srcLink(c.src[0], c.src[1])}</span>` }));
const factList = (g) => ((HIST[g.name] || {}).facts || []);
const newsLi = (n, withWho) => `<li><time datetime="${esc(n.d)}">${fmtISODate(n.d)}</time>: ${withWho && !n.title.startsWith(n.who) ? `<b>${esc(n.who)}:</b> ` : ''}<b>${esc(n.title)}.</b> ${esc(n.body)} ${srcLink(n.srcName, n.srcUrl)}</li>`;

/* background, the dated story of its charges (researched and logged), and its news */
function brokerHistory(g, root) {
  const items = changeLog.items || [];
  const mentions = items.filter((it) => it.changes.some((c) => c.includes(g.name)));
  const added = mentions.find((it) => it.changes.some((c) => /^Added /.test(c) && c.includes(g.name)));
  const sinceAt = added ? added.at : LAUNCH_AT;
  const since = sinceAt ? fmtISODate(istDate(sinceAt)) : null;
  const logged = mentions.filter((it) => it !== added).map((it) => ({ d: istDate(it.at),
    html: `<time datetime="${esc(it.at)}">${fmtISODate(istDate(it.at))}</time>: ${esc(it.changes.filter((c) => c.includes(g.name)).join('; '))} <span class="src">Logged by DalalScope</span>` }));
  const story = histItems(g, false).concat(logged).sort((a, b) => b.d.localeCompare(a.d));
  const facts = factList(g), news = newsFor(g).slice(0, 6);
  const track = `DalalScope has checked ${g.name}’s charges page every day since ${since || 'it started tracking'}${logged.length ? ` and logged ${logged.length === 1 ? 'one change' : logged.length + ' changes'} in that time` : ', with no change to the published rates so far'}. Every change on any broker is listed on <a href="${root}how-we-calculate/#changes">How we calculate</a>.`;
  return `<section class="panel prose-s" aria-labelledby="hi-h">
      <h2 id="hi-h">${esc(g.name)}${facts.length ? ': background, price changes and news' : ' rate changes and news'}</h2>
      ${facts.length ? `<dl class="facts">${facts.map(([k, v, sn, su]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)} <span class="src">${srcLink(sn, su)}</span></dd></div>`).join('')}</dl>` : ''}
      ${story.length ? `<h3>How ${esc(g.name)}’s charges have changed</h3>
      <ul class="notes">${story.map((x) => `<li>${x.html}</li>`).join('')}</ul>` : ''}
      <p>${track}</p>
      ${news.length ? `<h3>${esc(g.name)} in the news</h3>
      <ul class="notes">${news.map((n) => newsLi(n, false)).join('')}</ul>` : ''}
    </section>`;
}

/* compare pages: both brokers' background and price changes on one timeline, and their latest news */
function pairStory(p, root) {
  const fa = factList(p.A)[0], fb = factList(p.B)[0];
  const story = histItems(p.A, true).concat(histItems(p.B, true)).sort((a, b) => b.d.localeCompare(a.d));
  const news = newsFor(p.A).concat(newsFor(p.B)).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 4);
  if (!fa && !fb && !story.length && !news.length) return '';
  const bg = [[p.A, fa], [p.B, fb]].filter(([, f]) => f).map(([g, f]) => `<li><b>${esc(g.name)}</b> (${esc(f[0].toLowerCase())}): ${esc(f[1])}. <span class="src">${srcLink(f[2], f[3])}</span></li>`).join('');
  return `<section class="panel prose-s" aria-labelledby="vs-hist">
      <h2 id="vs-hist">How ${esc(p.A.name)} and ${esc(p.B.name)} got here</h2>
      ${bg ? `<ul class="notes">${bg}</ul>` : ''}
      ${story.length ? `<h3>Price changes over the years</h3>
      <ul class="notes">${story.map((x) => `<li>${x.html}</li>`).join('')}</ul>` : `<p>${esc(`DalalScope has not found or logged a change to either broker’s brokerage since it started tracking them.`)}</p>`}
      ${news.length ? `<h3>Latest news</h3>
      <ul class="notes">${news.map((n) => newsLi(n, true)).join('')}</ul>` : ''}
    </section>`;
}
const trackedSince = (g) => { const it = (changeLog.items || []).find((x) => x.changes.some((c) => /^Added /.test(c) && c.includes(g.name))); const at = it ? it.at : LAUNCH_AT; return at ? istDate(at) : '2026-10-26'; };

/* --- cheapest broker by segment --- */
const CHEAP = [
  { slug: 'delivery', segs: ['del'], name: 'delivery trading', tile: 'delivery', h1: 'Cheapest broker for delivery trading', title: 'Cheapest Broker for Delivery Trading in India',
    about: 'Delivery trades pay 0.1% STT on both the buy and the sell, plus stamp duty on the buy, so taxes are the largest part of the cost at every broker. What differs is the brokerage, which runs from ₹0 to a percentage of the trade, and the DP charge each time you sell shares out of your demat account.' },
  { slug: 'intraday', segs: ['intra'], name: 'intraday trading', tile: 'intraday', h1: 'Cheapest broker for intraday trading', title: 'Cheapest Broker for Intraday Trading in India',
    about: 'Intraday trades pay STT of only 0.025% on the sell side, so brokerage is a much bigger share of the cost than on delivery. Most discount brokers cap intraday brokerage at ₹20 an order or less, while full-service plans charge a percentage that grows with the trade.' },
  { slug: 'f-and-o', segs: ['opt', 'fut'], name: 'F&O trading', tile: 'F&O', h1: 'Cheapest broker for F&O and options trading', title: 'Cheapest Broker for F&O and Options Trading in India',
    about: 'Most discount brokers charge a flat fee per options order however many lots it holds, but a few plans charge per lot, which adds up fast on multi-lot orders. Since 1 April 2026, STT is 0.05% of the sell value on futures and 0.15% of the premium sold on options.' },
  { slug: 'commodity', segs: ['mfut', 'mopt'], name: 'commodity trading', tile: 'commodity', h1: 'Cheapest broker for commodity trading', title: 'Cheapest Broker for Commodity (MCX) Trading in India',
    about: 'MCX futures on non-agricultural commodities pay commodity transaction tax (CTT) of 0.01% on the sell side, and commodity options 0.05% of the premium sold. Not every broker offers commodity trading; those that don’t are listed below the rankings.' },
  { slug: 'currency', segs: ['cfut', 'copt'], name: 'currency trading', tile: 'currency', h1: 'Cheapest broker for currency trading', title: 'Cheapest Broker for Currency Derivatives Trading in India',
    about: 'Currency futures and options carry no STT, so brokerage and exchange charges make up almost the whole cost. Not every broker offers currency derivatives; those that don’t are listed below the rankings.' },
];
const cheapUrl = (c) => 'cheapest-broker/' + c.slug + '/';

function segFacts(s) {
  const rows = ranked(s, REF_SIZE(s));
  const win = tied(rows), last = rows[rows.length - 1], lastG = lastGroup(rows);
  const notOffered = BROKERS.filter((b) => !b.r[s] && !(b.unl || []).includes(s)).map(fullName);
  const unpublished = BROKERS.filter((b) => !b.r[s] && (b.unl || []).includes(s)).map(fullName);
  const costly = lastG.length === 1 ? `The costliest plan, ${fullName(last.b)}, charges ${inr(last.c.total)} for the same trade.` : `The costliest, ${namesOf(lastG, 3)}, charge ${inr(last.c.total)} each for the same trade.`;
  return { s, rows, win, last, lastG, notOffered, unpublished,
    lead: `On ${TRADE_PHRASE[s]}, ${namesOf(win)} ${isAre(win)} cheapest at ${inr(win[0].c.total)} including taxes and fees. ${costly}` };
}

function rankTable(f, root) {
  const best = f.rows[0].c.total;
  const body = f.rows.map((r) => {
    const w = r.c.total < best + 0.005;
    return `<tr${w ? ' class="win"' : ''}><td class="num rk">${posOf(f.rows, r)}</td><th scope="row">${planCell(r.b, root)}${r.b.src === 'agg' ? '<small>Rates from comparison sites *</small>' : ''}</th><td>${esc(ruleText(r.b.r[f.s]))}</td><td class="num">${inr(r.c.brok)}</td><td class="num"><b>${inr(r.c.total)}</b></td><td class="num">${w ? '<span class="best">Cheapest</span>' : '+' + inr(r.c.total - best)}</td></tr>`;
  }).join('\n          ');
  const aggs = f.rows.filter((r) => r.b.src === 'agg');
  const noDp = f.s === 'del' ? f.rows.filter((r) => r.b.dp == null) : [];
  const missing = [noDp.length ? `<p class="fine">${esc(joinNames(noDp.map((r) => fullName(r.b))))} ${noDp.length > 1 ? 'do' : 'does'} not publish a DP charge, so ${noDp.length > 1 ? 'their totals leave' : 'its total leaves'} it out; the real cost is higher by that fee.</p>` : '', aggs.length ? `<p class="fine">* ${esc(joinNames(aggs.map((r) => r.b.name)))} ${aggs.length > 1 ? 'do' : 'does'} not publish ${aggs.length > 1 ? 'their' : 'its'} full rate card, so ${aggs.length > 1 ? 'their' : 'its'} rates come from comparison sites. Confirm with the broker before opening an account.</p>` : '', f.notOffered.length ? `<p class="fine">Not offered by ${esc(joinNames(f.notOffered))}.</p>` : '', f.unpublished.length ? `<p class="fine">Offered but no rate published by ${esc(joinNames(f.unpublished))}.</p>` : ''].join('');
  return `<section class="panel" aria-labelledby="rk-${f.s}">
      <h2 id="rk-${f.s}">${E.SEG_LABEL[f.s]}: all ${f.rows.length} plans ranked</h2>
      <p class="sub">${esc(cap(TRADE_PHRASE[f.s]))}. Totals include brokerage, 18% GST, STT${f.s.startsWith('m') ? ' or CTT' : ''}, exchange and SEBI fees, stamp duty${f.s === 'del' ? ' and the DP charge on the sell' : ''}.</p>
      <div class="table-scroll"><table class="ex-t gt rk-t">
        <thead><tr><th scope="col" class="num">#</th><th scope="col">Broker and plan</th><th scope="col">Brokerage rule</th><th scope="col" class="num">Brokerage on this trade</th><th scope="col" class="num">Total with taxes</th><th scope="col" class="num">More than cheapest</th></tr></thead>
        <tbody>
          ${body}
        </tbody>
      </table></div>
      ${missing}
    </section>`;
}

function sizeTable(s) {
  const sizes = SIZES[s].map((z) => { const rows = ranked(s, z); return { z, rows, win: tied(rows), next: nextGroup(rows), last: rows[rows.length - 1] }; });
  const cell = (g) => g.length ? `${esc(namesOf(g, 2))}<small>${inr(g[0].c.total)}</small>` : '—';
  const body = sizes.map((x) => `<tr><th scope="row">${esc(sizeLabel(s, x.z))}</th><td>${cell(x.win)}</td><td>${cell(x.next)}</td><td>${cell(lastGroup(x.rows))}</td></tr>`).join('\n          ');
  const keys = sizes.map((x) => x.win.map((r) => r.b.id).sort().join(','));
  const same = keys.every((k) => k === keys[0]);
  const note = same ? `${namesOf(sizes[0].win)} ${isAre(sizes[0].win) === 'are' ? 'stay' : 'stays'} cheapest at every size tested, from ${sizePhrase(s, sizes[0].z)} to ${sizePhrase(s, sizes[sizes.length - 1].z)}.`
    : 'The cheapest plan changes with trade size: ' + sizes.map((x) => `${namesOf(x.win, 2)} on ${sizePhrase(s, x.z)}`).join('; ') + '.';
  return { note, html: `<h3>Does trade size change the answer?</h3>
      <div class="table-scroll"><table class="ex-t gt">
        <thead><tr><th scope="col">${PREM[s] ? 'Premium bought and sold' : 'Trade bought and sold'}</th><th scope="col">Cheapest</th><th scope="col">Next cheapest</th><th scope="col">Costliest</th></tr></thead>
        <tbody>
          ${body}
        </tbody>
      </table></div>` };
}

function segInsights(f) {
  const out = [];
  const best = f.rows[0];
  const bs = f.rows.map((r) => r.c.brokerSide);
  out.push(`Taxes and exchange fees come to ${inr(best.c.statutory)} on this trade at every broker. ${f.s === 'del' ? 'Brokerage, its GST and the DP charge' : 'Brokerage and its GST'} add ${inr(Math.min.apply(null, bs))} to ${inr(Math.max.apply(null, bs))} on top, which is where the plans differ.`);
  const zero = f.rows.filter((r) => r.b.r[f.s].t === 'z');
  if (zero.length) {
    let t = zero.length > 1 ? `${zero.length} plans charge ₹0 brokerage here: ${joinNames(zero.map((r) => fullName(r.b)))}.` : `${fullName(zero[0].b)} is the only plan with ₹0 brokerage here.`;
    if (f.s === 'del' && zero.length > 1) {
      const dps = zero.filter((r) => r.b.dp != null).sort((a, q) => a.b.dp - q.b.dp);
      if (dps.length > 1 && dps[0].b.dp !== dps[dps.length - 1].b.dp) t += ` Their totals differ only by the DP charge on the sell, from ${inr(dps[0].b.dp)} at ${fullName(dps[0].b)} to ${inr(dps[dps.length - 1].b.dp)} at ${fullName(dps[dps.length - 1].b)}.`;
    }
    out.push(t);
  }
  const pctPlans = f.rows.filter((r) => r.b.r[f.s].t === 'p');
  if (pctPlans.length && !PREM[f.s]) {
    const big = SIZES[f.s][SIZES[f.s].length - 1];
    const worst = pctPlans.map((r) => ({ b: r.b, c: E.compute(r.b, f.s, big.v, big.v, 1, 1) })).sort((a, q) => q.c.brok - a.c.brok)[0];
    out.push(`${joinNames(pctPlans.map((r) => fullName(r.b)))} charge${pctPlans.length > 1 ? '' : 's'} a percentage of the trade, so the bill grows with size: on ${sizePhrase(f.s, big)} bought and sold, ${fullName(worst.b)}’s brokerage alone is ${inr(worst.c.brok)}.`);
  }
  const lotPlans = f.rows.filter((r) => r.b.r[f.s].t === 'lot');
  if (lotPlans.length) {
    const big = SIZES[f.s][SIZES[f.s].length - 1];
    const worst = lotPlans.map((r) => ({ b: r.b, c: E.compute(r.b, f.s, big.v, big.v, 1, big.lots || 1) })).sort((a, q) => q.c.brok - a.c.brok)[0];
    out.push(`${joinNames(lotPlans.map((r) => fullName(r.b)))} charge${lotPlans.length > 1 ? '' : 's'} per lot rather than per order. On ${sizePhrase(f.s, big)}, bought and sold, ${fullName(worst.b)}’s brokerage alone is ${inr(worst.c.brok)}.`);
  }
  return out;
}

function cheapFaq(cfg, facts) {
  const qa = [[`Which is the cheapest broker for ${cfg.name} in India?`, facts.map((f) => f.lead).join(' ') + ` Rates checked ${RATES_DATE}.`]];
  const f = facts[0];
  if (cfg.slug === 'delivery') {
    const zero = f.rows.filter((r) => r.b.r.del.t === 'z');
    const dps = zero.filter((r) => r.b.dp != null).map((r) => r.b.dp);
    const dpTxt = dps.length > 1 && Math.min.apply(null, dps) !== Math.max.apply(null, dps) ? ` (${inr(Math.min.apply(null, dps))} to ${inr(Math.max.apply(null, dps))} at the zero-brokerage plans here)` : dps.length ? ` (${inr(dps[0])} at ${fullName(zero[0].b)})` : '';
    if (zero.length) qa.push(['Is zero-brokerage delivery really free?', `No. Even at ₹0 brokerage you pay 0.1% STT on the buy and on the sell, stamp duty, exchange fees, GST on those fees and a DP charge each time you sell${dpTxt}. On a ₹1 lakh buy and sell that comes to ${inr(zero[0].c.total)} at ${fullName(zero[0].b)}.`]);
  } else if (cfg.slug === 'intraday') {
    const bs = f.rows.map((r) => r.c.brokerSide);
    qa.push(['How much tax is there on an intraday trade?', `On a ₹1 lakh intraday buy and sell, STT, exchange and SEBI fees, stamp duty and GST on the fees add up to ${inr(f.rows[0].c.statutory)} at every broker. Brokerage and GST on it come on top: from ${inr(Math.min.apply(null, bs))} to ${inr(Math.max.apply(null, bs))} across the plans compared.`]);
  } else if (cfg.slug === 'f-and-o') {
    const lotPlans = f.rows.filter((r) => r.b.r.opt.t === 'lot');
    const big = SIZES.opt[SIZES.opt.length - 1];
    const rows = ranked('opt', big);
    if (lotPlans.length) {
      const worst = lotPlans.map((r) => rows.find((x) => x.b === r.b)).sort((a, q) => q.c.brok - a.c.brok)[0];
      const flat = rows.find((x) => x.b.id === 'zerodha' && x.b.r.opt.t === 'f') || rows.find((x) => x.b.r.opt.t === 'f' && x.b.r.opt.a === 20) || rows.find((x) => x.b.r.opt.t === 'f');
      qa.push(['Do brokers charge options brokerage per order or per lot?', `Most charge a flat fee per order, whatever the number of lots. ${joinNames(lotPlans.map((r) => fullName(r.b)))} charge per lot instead. On ${sizePhrase('opt', big)}, bought and sold, brokerage is ${inr(flat.c.brok)} at ${fullName(flat.b)}, which charges ${ruleText(flat.b.r.opt)}, and ${inr(worst.c.brok)} at ${fullName(worst.b)}.`]);
    }
  } else {
    const all = facts.reduce((a, x) => a.concat(x.notOffered), []);
    const none = Array.from(new Set(all)).filter((n) => facts.every((x) => x.notOffered.includes(n)));
    const unp = Array.from(new Set(facts.reduce((a, x) => a.concat(x.unpublished), [])));
    if (none.length || unp.length) qa.push([`Which brokers don’t offer ${cfg.name}?`, (none.length ? `${joinNames(none)} ${none.length > 1 ? 'do' : 'does'} not offer ${cfg.name}.` : '') + (unp.length ? ` ${joinNames(unp)} ${unp.length > 1 ? 'offer' : 'offers'} it but ${unp.length > 1 ? 'do' : 'does'} not publish ${unp.length > 1 ? 'their' : 'its'} rates, so ${unp.length > 1 ? 'they are' : 'it is'} left out of the ranking.` : '')]);
  }
  return qa.map(([q, a]) => [q, a.trim()]);
}

function cheapPage(cfg) {
  const root = '../../';
  const url = SITE_URL + cheapUrl(cfg);
  const facts = cfg.segs.map(segFacts);
  const f0 = facts[0];
  const sizes = cfg.segs.map(sizeTable);
  const qa = cheapFaq(cfg, facts);
  const title = `${cfg.title} (${MONTH_YEAR}) | ${BRAND}`;
  const desc = `${namesOf(f0.win, 3)} ${isAre(f0.win)} cheapest for ${cfg.name} on ${SHORT_EX[f0.s]}: ${inr(f0.win[0].c.total)} with all taxes. ${f0.rows.length} plans ranked with STT, GST${cfg.slug === 'delivery' ? ' and DP charges' : ''}, at small and large trade sizes.`;
  const others = CHEAP.filter((c) => c !== cfg);
  const pops = FEATURED.slice(0, 10);
  const sections = facts.map((f, i) => `${rankTable(f, root)}
    <section class="panel" aria-labelledby="ins-${f.s}">
      <h2 id="ins-${f.s}">What changes the ${SEG_WORD[f.s]} ranking</h2>
      <ul class="insights">${segInsights(f).concat([sizes[i].note]).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      ${sizes[i].html}
    </section>`).join('\n    ');
  const body = `    <header class="bp-head">
      <h1>${esc(cfg.h1)}</h1>
      <p class="lead">${esc(facts.map((f) => f.lead).join(' '))}</p>
      ${byline(root, `Updated <time datetime="${modSegs(cfg.segs)}">${fmtISODate(modSegs(cfg.segs))}</time> · Broker rates checked ${RATES_DATE} against each broker’s official charges page`)}
      <a class="cta" href="${root}#calculator">Check any NSE stock in the calculator</a>
    </header>
    <section class="panel prose-s" aria-labelledby="ab-h"><h2 id="ab-h">What ${article(SEG_WORD[f0.s])} ${SEG_WORD[f0.s]} trade costs</h2><p>${esc(cfg.about)}</p></section>
    ${sections}
    ${faqBlock(qa)}
    <section class="panel" aria-labelledby="more-h">
      <h2 id="more-h">Cheapest broker for other segments</h2>
      <ul class="cmp-links">${others.map((c) => `<li><a href="${root}${cheapUrl(c)}">${esc(cap(c.name))}</a></li>`).join('')}<li><a href="${root}cheapest-broker/">All segments</a></li></ul>
      <h2 class="h-gap">Popular head-to-head comparisons</h2>
      <ul class="cmp-links">${pops.map((p) => `<li><a href="${root}compare/${p.slug}/">${esc(p.A.name)} vs ${esc(p.B.name)}</a></li>`).join('')}</ul>
    </section>`;
  const rankLD = { '@context': 'https://schema.org', '@type': 'ItemList', name: cfg.h1 + ', all plans ranked', itemListOrder: 'https://schema.org/ItemListOrderAscending', numberOfItems: f0.rows.length, itemListElement: f0.rows.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: fullName(r.b), url: SITE_URL + 'brokers/' + groupOf(r.b).slug + '/' })) };
  return guidePage({ title, desc, canonical: url, root, body, crumbs: [['Cheapest brokers', root + 'cheapest-broker/'], [cap(cfg.name), null]],
    jsonld: [articleLD(cfg.title, url, '2026-10-31', modSegs(cfg.segs)), rankLD, crumbsLD([['Cheapest brokers', SITE_URL + 'cheapest-broker/'], [cap(cfg.name), url]]), faqLD(qa)] });
}

function cheapHub() {
  const root = '../';
  const url = SITE_URL + 'cheapest-broker/';
  const tiles = CHEAP.map((c) => { const f = segFacts(c.segs[0]); return `<li><a class="g-tile panel" href="${root}${cheapUrl(c)}"><span class="g-k">Cheapest for ${esc(c.tile)}</span><b>${esc(namesOf(f.win, 2))}</b><span class="g-v">${inr(f.win[0].c.total)} on ${esc(SHORT_EX[f.s])}</span></a></li>`; }).join('');
  const rows = E.SEGS.map((s) => { const f = segFacts(s); return `<tr><th scope="row">${E.SEG_LABEL[s]}<small>${esc(cap(TRADE_PHRASE[s]))}</small></th><td>${esc(namesOf(f.win, 3))}</td><td class="num"><b>${inr(f.win[0].c.total)}</b></td><td>${esc(namesOf(f.lastG, 2))}</td><td class="num">${inr(f.last.c.total)}</td></tr>`; }).join('\n          ');
  const zero = BROKERS.filter((b) => b.r.del && b.r.del.t === 'z').map((b) => ({ b, c: E.compute(b, 'del', 100000, 100000, 1, 1) }));
  const zt = zero.map((r) => r.c.total), zdp = zero.filter((r) => r.b.dp != null).map((r) => r.b.dp);
  const intraSmall = tied(ranked('intra', { v: 25000 })), intraBig = tied(ranked('intra', { v: 2500000 }));
  const opt1 = tied(ranked('opt', { v: 10000, lots: 1 })), opt20 = tied(ranked('opt', { v: 100000, lots: 20 }));
  const perLot = BROKERS.filter((b) => b.r.opt && b.r.opt.t === 'lot');
  const same = (x, y) => x.length === y.length && x.every((r) => y.some((q) => q.b === r.b));
  const moves = [
    zero.length ? `${zero.length} of ${BROKERS.length} plans charge ₹0 brokerage on delivery, yet a ₹1 lakh buy and sell still costs between ${inr(Math.min(...zt))} and ${inr(Math.max(...zt))} at them, mostly because DP charges run from ${inr(Math.min(...zdp))} to ${inr(Math.max(...zdp))} per sell.` : '',
    same(intraSmall, intraBig) ? `On intraday, ${namesOf(intraSmall, 3)} ${isAre(intraSmall)} cheapest on both a ₹25,000 and a ₹25 lakh trade.` : `On intraday, ${namesOf(intraSmall, 3)} ${isAre(intraSmall)} cheapest on a ₹25,000 trade, but ${namesOf(intraBig, 3)} on a ₹25 lakh trade, because percentage fees grow with the order while flat fees do not.`,
    perLot.length ? `${perLot.length} plan${perLot.length > 1 ? 's charge' : ' charges'} options brokerage per lot rather than per order (${joinNames(perLot.map(fullName))}), which looks cheap on one lot and expensive on twenty.` : '',
    same(opt1, opt20) ? `On options, ${namesOf(opt1, 3)} ${isAre(opt1)} cheapest on both a one-lot and a twenty-lot order.` : `On options, ${namesOf(opt1, 3)} ${isAre(opt1)} cheapest on a one-lot ₹10,000 premium order, and ${namesOf(opt20, 3)} on a twenty-lot ₹1 lakh order.`,
  ].filter(Boolean);
  const body = `    <header class="bp-head">
      <h1>Cheapest broker in India, segment by segment</h1>
      <p class="lead">No broker is cheapest at everything. A plan that charges nothing on delivery can cost more on options, and a percentage-based plan that looks cheap on a small trade gets expensive on a big one. Each page below ranks all ${BROKERS.length} plans on real trades, with every tax and fee included.</p>
      <p class="checked">${MONTH_YEAR}. Broker rates checked ${RATES_DATE}.</p>
    </header>
    <ul class="g-grid">${tiles}</ul>
    <section class="panel" aria-labelledby="hub-t">
      <h2 id="hub-t">Cheapest and costliest plan in every segment</h2>
      <div class="table-scroll"><table class="ex-t gt">
        <thead><tr><th scope="col">Segment and example trade</th><th scope="col">Cheapest</th><th scope="col" class="num">Total</th><th scope="col">Costliest</th><th scope="col" class="num">Total</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table></div>
    </section>
    <section class="panel prose-s" aria-labelledby="hub-m">
      <h2 id="hub-m">What changes the ranking</h2>
      <ul class="notes">${moves.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    </section>`;
  return guidePage({ title: `Cheapest Broker in India by Segment (${MONTH_YEAR}) | ${BRAND}`, desc: `The cheapest stock broker for delivery, intraday, F&O, commodity and currency trading, with all ${BROKERS.length} plans ranked on real trades including STT, GST and DP charges.`, canonical: url, root, body, crumbs: [['Cheapest brokers', null]], jsonld: [crumbsLD([['Cheapest brokers', url]])] });
}

/* --- head-to-head comparisons --- */
const POP = ['Zerodha', 'Groww', 'Angel One', 'Upstox', 'Dhan', 'ICICI Direct', 'Kotak Neo', 'HDFC Sky', '5paisa'];
const PAIR_NAMES = [];
POP.forEach((a, i) => POP.slice(i + 1).forEach((b) => PAIR_NAMES.push([a, b])));
PAIR_NAMES.push(['Zerodha', 'FYERS'], ['Zerodha', 'm.Stock'], ['Zerodha', 'Motilal Oswal'], ['Zerodha', 'Shoonya'], ['Zerodha', 'Flattrade'], ['Groww', 'Paytm Money']);
const grp = (n) => groups.find((x) => x.name === n);
const pairList = PAIR_NAMES.map(([a, b]) => ({ A: grp(a), B: grp(b) })).filter((p) => p.A && p.B).map((p) => Object.assign(p, { slug: p.A.slug + '-vs-' + p.B.slug }));
const FEATURED = [['Zerodha', 'Groww'], ['Groww', 'Angel One'], ['Zerodha', 'Angel One'], ['Zerodha', 'Upstox'], ['Groww', 'Upstox'], ['Angel One', 'Upstox'], ['Zerodha', 'Dhan'], ['Groww', 'Dhan'], ['Zerodha', 'Kotak Neo'], ['Zerodha', 'ICICI Direct'], ['Zerodha', 'FYERS'], ['Upstox', 'Dhan']]
  .map(([a, b]) => pairList.find((p) => p.A.name === a && p.B.name === b)).filter(Boolean);
/* Comparison pages kept in search engines' index: the most-searched match-ups (FEATURED) plus pairs
   already earning Search Console impressions. The rest stay live and linked for visitors but carry
   noindex and are left out of the sitemap, so a young domain is not judged on dozens of near-identical
   pages. To promote a pair, add its slug here. */
const INDEX_PAIRS = new Set(FEATURED.map((p) => p.slug).concat(['zerodha-vs-flattrade', 'groww-vs-icici-direct']));
const indexedPair = (p) => INDEX_PAIRS.has(p.slug);
const TIE = 1;
const listSegs = (rows) => joinNames(rows.map((r) => SEG_WORD[r.s]));

function vsFacts(p) {
  const a = p.A.plans[0], b = p.B.plans[0];
  const rows = E.SEGS.map((s) => { const ca = E.compute(a, s, E.REF[s], E.REF[s], 1, 1), cb = E.compute(b, s, E.REF[s], E.REF[s], 1, 1); return { s, ca, cb, d: ca && cb ? ca.total - cb.total : null }; });
  const winsA = rows.filter((r) => r.d != null && r.d <= -TIE), winsB = rows.filter((r) => r.d != null && r.d >= TIE), ties = rows.filter((r) => r.d != null && Math.abs(r.d) < TIE);
  const onlyA = rows.filter((r) => r.ca && !r.cb), onlyB = rows.filter((r) => r.cb && !r.ca);
  const parts = [];
  const both = rows.filter((r) => r.d != null);
  if (both.length > 2 && winsA.length === both.length) parts.push(`${p.A.name} is cheaper in every segment both brokers offer.`);
  else if (both.length > 2 && winsB.length === both.length) parts.push(`${p.B.name} is cheaper in every segment both brokers offer.`);
  else if (winsA.length && winsB.length) parts.push(`${p.A.name} is cheaper for ${listSegs(winsA)}, and ${p.B.name} for ${listSegs(winsB)}.`);
  else if (winsA.length) parts.push(`${p.A.name} is cheaper for ${listSegs(winsA)}.`);
  else if (winsB.length) parts.push(`${p.B.name} is cheaper for ${listSegs(winsB)}.`);
  if (ties.length) parts.push(`${winsA.length || winsB.length ? 'They' : `${p.A.name} and ${p.B.name}`} cost about the same (within ₹1) for ${listSegs(ties)}.`);
  if (onlyA.length) parts.push(`Only ${p.A.name} offers ${listSegs(onlyA)}.`);
  if (onlyB.length) parts.push(`Only ${p.B.name} offers ${listSegs(onlyB)}.`);
  const del = rows[0];
  const noDp = [a, b].filter((x) => x.dp == null);
  if (del.ca && del.cb) parts.push(`On a ₹1 lakh delivery buy and sell, ${p.A.name} costs ${inr(del.ca.total)} and ${p.B.name} ${inr(del.cb.total)} including taxes${noDp.length ? '' : ' and the DP charge'}.` + (noDp.length ? ` ${joinNames(noDp.map((x) => x.name))} ${noDp.length > 1 ? 'do' : 'does'} not publish a DP charge, so ${noDp.length > 1 ? 'their totals leave' : 'its total leaves'} it out.` : ''));
  return { a, b, rows, winsA, winsB, ties, verdict: parts.join(' ') };
}

/* ---------- head to head: only where two plans actually differ ----------
   Each segment is costed across realistic order sizes (or lot counts for options), and the page talks
   about the ranges where one plan is cheaper. Segments where the two cost the same get one line. */
const VS_RANGE = { del: [5000, 2500000], intra: [10000, 5000000], fut: [200000, 10000000], cfut: [20000, 5000000], mfut: [50000, 5000000] };
const LOT_STEPS = [1, 2, 5, 10, 20];
const ROUND_SIZES = [10000, 25000, 50000, 100000, 200000, 500000, 1000000, 2500000, 5000000, 10000000];
const geoSizes = (lo, hi) => { const a = []; for (let v = lo; v < hi; v *= 1.1) a.push(Math.round(v)); a.push(hi); return a; };
const lotsWord = (n) => n + ' lot' + (n > 1 ? 's' : '');
const sizeWords = (s, v, lots) => PREM[s] ? `${lotsWord(lots)} (${amt(v)} premium)` : amt(v);

function segDiff(a, b, s) {
  const oa = !!a.r[s], ob = !!b.r[s];
  if (!oa || !ob) return { s, kind: oa ? 'onlyA' : ob ? 'onlyB' : 'none' };
  const at = (v, l) => { const x = E.compute(a, s, v, v, 1, l), y = E.compute(b, s, v, v, 1, l), d = x.total - y.total; return { v, lots: l, x, y, d, sg: Math.abs(d) < TIE ? 0 : Math.sign(d) }; };
  const pts = PREM[s] ? LOT_STEPS.map((l) => at(E.REF[s] * l, l)) : geoSizes(VS_RANGE[s][0], VS_RANGE[s][1]).map((v) => at(v, 1));
  const runs = [];
  pts.forEach((p) => { const r = runs[runs.length - 1]; if (r && r.sg === p.sg) { r.to = p; r.pts.push(p); } else runs.push({ sg: p.sg, from: p, to: p, pts: [p] }); });
  for (let i = 1; i < runs.length; i++) {
    if (PREM[s]) { runs[i].edge = runs[i].from.lots; continue; }
    let L = runs[i - 1].to.v, H = runs[i].from.v; const sg0 = runs[i - 1].sg;
    for (let k = 0; k < 40; k++) { const m = (L + H) / 2; if (at(m, 1).sg === sg0) L = m; else H = m; }
    runs[i].edge = H;
  }
  /* a stretch where one side is ahead by less than ₹3 a trade is treated as level */
  runs.forEach((r) => { if (r.sg !== 0 && Math.max(...r.pts.map((q) => Math.abs(q.d))) < 3) { r.sg = 0; r.minor = true; } });
  const merged = [];
  runs.forEach((r) => { const m = merged[merged.length - 1]; if (m && m.sg === r.sg) { m.to = r.to; m.pts = m.pts.concat(r.pts); m.minor = m.minor || r.minor; } else merged.push(r); });
  const ds = pts.map((p) => p.d);
  return { s, kind: merged.every((r) => r.sg === 0) ? 'same' : 'diff', runs: merged, pts, constant: Math.max(...ds) - Math.min(...ds) < 1, ref: at(E.REF[s], 1), at,
    maxA: Math.max(0, ...pts.map((q) => -q.d)), maxB: Math.max(0, ...pts.map((q) => q.d)) };
}

/* each stretch where one side is cheaper: { side, w: "intraday", range: "under about ₹65,000" } (range '' = every size) */
function winPhrases(D) {
  const w = SEG_WORD[D.s], out = [];
  D.runs.forEach((r, i) => {
    if (r.sg === 0) return;
    const first = i === 0, last = i === D.runs.length - 1;
    let range;
    if (first && last) range = '';
    else if (PREM[D.s]) range = first ? (r.to.lots === 1 ? 'of one lot' : `of up to ${r.to.lots} lots`) : last ? `of ${r.from.lots} lots or more` : `of ${r.from.lots} to ${r.to.lots} lots`;
    else range = first ? `under about ${niceAmt(D.runs[i + 1].edge)}` : last ? `above about ${niceAmt(r.edge)}` : `between about ${niceAmt(r.edge)} and ${niceAmt(D.runs[i + 1].edge)}`;
    out.push({ side: r.sg < 0 ? 'A' : 'B', w, range, text: range ? `${w} orders ${range}` : w });
  });
  return out;
}
/* "delivery at any size and intraday orders under about ₹65,000"; segments sharing a range are merged */
function winText(list) {
  const by = [];
  list.forEach((x) => { let g = by.find((y) => y.range === x.range); if (!g) by.push(g = { range: x.range, ws: [] }); g.ws.push(x.w); });
  by.sort((p, q) => (p.range === '' ? 0 : 1) - (q.range === '' ? 0 : 1));
  return by.map((g) => g.range ? `${listAnd(g.ws)} orders ${g.range}` : `${listAnd(g.ws)} at any size`);
}

/* a round order size inside a stretch, for a worked number */
function sampleIn(D, r) {
  if (PREM[D.s]) return r.pts[Math.floor(r.pts.length / 2)];
  const lo = r.from.v, hi = r.to.v, mid = Math.sqrt(lo * hi);
  const inside = ROUND_SIZES.filter((v) => v >= lo && v <= hi);
  const v = inside.length ? inside.reduce((p, q) => Math.abs(Math.log(q / mid)) < Math.abs(Math.log(p / mid)) ? q : p) : Math.round(mid);
  return D.at(v, 1);
}

function diffBullet(D, a, b, A, B, label) {
  const w = label || SEG_WORD[D.s];
  const ra = ruleProse(a.r[D.s]), rb = ruleProse(b.r[D.s]);
  let t = ra === rb ? `Both charge ${ra}` : `${A} charges ${ra}, ${B} ${rb}`;
  if (D.s === 'del' && a.dp != null && b.dp != null && Math.abs(a.dp - b.dp) >= 0.5) t += `${ra === rb ? ', but' : ', and'} ${a.dp > b.dp ? A : B}’s DP charge is ${inr(Math.abs(a.dp - b.dp))} higher (${inr(Math.max(a.dp, b.dp))} against ${inr(Math.min(a.dp, b.dp))} per sell)`;
  else if (D.s === 'del' && (a.dp == null) !== (b.dp == null)) t += `; ${a.dp == null ? A : B} does not publish a DP charge, so its delivery figures leave it out`;
  t += '. ';
  const sideName = (sg) => sg < 0 ? A : B;
  if (D.runs.length === 1) {
    const r = D.runs[0];
    if (D.constant) t += `That makes ${sideName(r.sg)} ${inr(Math.abs(D.ref.d))} cheaper on every ${w} buy and sell, whatever the size.`;
    else {
      const p0 = D.pts[0], p1 = D.pts[D.pts.length - 1];
      t += `${sideName(r.sg)} is cheaper at every size and the gap ${Math.abs(p1.d) >= Math.abs(p0.d) ? 'widens' : 'narrows'} as orders grow: ${inr(Math.abs(p0.d))} on ${sizeWords(D.s, p0.v, p0.lots)} bought and sold, ${inr(Math.abs(p1.d))} on ${sizeWords(D.s, p1.v, p1.lots)}.`;
    }
    return t;
  }
  const sameCap = a.r[D.s].a != null && a.r[D.s].a === b.r[D.s].a && a.r[D.s].t !== 'lot' && b.r[D.s].t !== 'lot';
  const parts = D.runs.map((r, i) => {
    const first = i === 0, last = i === D.runs.length - 1;
    const range = PREM[D.s] ? (first ? `up to ${lotsWord(r.to.lots)}` : last ? `from ${lotsWord(r.from.lots)} up` : `from ${r.from.lots} to ${lotsWord(r.to.lots)}`)
      : (first ? `under about ${niceAmt(D.runs[i + 1].edge)}` : last ? `above about ${niceAmt(r.edge)}` : `between about ${niceAmt(r.edge)} and ${niceAmt(D.runs[i + 1].edge)}`);
    if (r.sg === 0) return r.minor ? `${range} they are within a couple of rupees of each other` : sameCap && last ? `${range} both hit the ₹${a.r[D.s].a} cap and cost the same` : `${range} they cost the same`;
    const p = sampleIn(D, r);
    return `${range} ${sideName(r.sg)} is cheaper (${inr(Math.abs(p.d))} less on ${sizeWords(D.s, p.v, p.lots)} bought and sold)`;
  });
  return t + cap(parts.join('; ')) + '.';
}

function pairVerdict(p, diffs, yr) {
  const A = p.A.name, B = p.B.name;
  const live = diffs.filter((D) => D.kind === 'diff');
  const eqWins = (side) => winText(live.filter((D) => EQ.includes(D.s)).reduce((acc, D) => acc.concat(winPhrases(D).filter((x) => x.side === side)), []));
  /* currency and commodity: whole segments won outright, or only part of the size range */
  const dvWins = (side) => {
    const ds = live.filter((D) => DERIV.includes(D.s));
    const full = ds.filter((D) => D.runs.length === 1 && winPhrases(D)[0].side === side).map((D) => D.s);
    const part = ds.filter((D) => !full.includes(D.s) && winPhrases(D).some((x) => x.side === side)).map((D) => D.s);
    if (full.length === 4) return ['currency and commodity trades'];
    if (full.length + part.length >= 3) return [full.length >= 2 ? 'most currency and commodity trades' : 'some currency and commodity trades'];
    const out = [];
    if (full.length) out.push(segGroupLabel(full));
    if (part.length) out.push(`some ${segGroupLabel(part)} orders`);
    return out;
  };
  const aw = eqWins('A'), bw = eqWins('B'), ad = dvWins('A'), bd = dvWins('B');
  const eqMax = (k) => Math.max(0, ...diffs.filter((D) => EQ.includes(D.s) && D[k] != null).map((D) => D[k]));
  const never = (X, m) => m < 0.01 ? `${X} is never cheaper` : `${X} is never more than ${inr(m)} a trade cheaper`;
  let t;
  if (aw.length && !bw.length) t = `For stocks and F&O, ${A} is the cheaper of the two: it costs less for ${listGroups(aw)}, and ${never(B, eqMax('maxB'))}.`;
  else if (bw.length && !aw.length) t = `For stocks and F&O, ${B} is the cheaper of the two: it costs less for ${listGroups(bw)}, and ${never(A, eqMax('maxA'))}.`;
  else if (aw.length) t = `Neither wins outright. ${A} costs less for ${listGroups(aw)}; ${B} for ${listGroups(bw)}.`;
  else t = `On stocks and F&O, ${A} and ${B} cost the same${eqMax('maxA') + eqMax('maxB') >= 0.01 ? ', give or take a rupee or two' : ''}.`;
  if (ad.length || bd.length) {
    const lead = !aw.length && !bw.length ? 'The real difference is in currency and commodity: ' : 'In currency and commodity, ';
    t += ' ' + lead + [ad.length ? `${A} is cheaper on ${listGroups(ad)}` : '', bd.length ? `${B} on ${listGroups(bd)}` : ''].filter(Boolean).join(' and ').replace(/^(\w)/, (m) => m) + '.';
    if (!ad.length) t = t.replace(`: ${B} on `, `: ${B} is cheaper on `).replace(`, ${B} on `, `, ${B} is cheaper on `);
  }
  const big = yr.filter((r) => r.d != null).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
  if (big && Math.abs(big.d) >= 100) t += ` Over a year, the biggest gap is for ${big.pr.label}: ${inr0(Math.abs(big.d))} less at ${big.d < 0 ? A : B}.`;
  else if (big) t += ' Over a year, none of the trading patterns below differ by more than ₹100.';
  const sameEq = diffs.filter((D) => D.kind === 'same' && EQ.includes(D.s)).map((D) => SEG_WORD[D.s]);
  if (sameEq.length && (aw.length || bw.length)) t += ` ${cap(listAnd(sameEq))} cost the same at both.`;
  return t;
}

/* a real stock, traded where the two differ, line by line */
function pairExample(p, diffs, idx) {
  const a = p.A.plans[0], b = p.B.plans[0], A = p.A.name, B = p.B.name;
  const D = diffs.find((x) => x.kind === 'diff' && x.s === 'del') || diffs.find((x) => x.kind === 'diff' && x.s === 'intra');
  if (!D) return '';
  const run = D.runs.find((r) => r.sg !== 0);
  const target = sampleIn(D, run).v;
  const st = STOCK_ROWS.find((x) => x.s === STOCK_ROTA[(idx * 7 + 3) % STOCK_ROTA.length]);
  if (!st || !(st.p > 0) || st.p > target) return '';
  const qty = Math.max(1, Math.round(target / st.p));
  const v = qty * st.p, s = D.s;
  const ca = E.compute(a, s, v, v, 1, 1), cb = E.compute(b, s, v, v, 1, 1), d = ca.total - cb.total;
  const parts = [];
  if (Math.abs((ca.brok + ca.gstBrok) - (cb.brok + cb.gstBrok)) >= 0.01) parts.push('brokerage (with its GST)');
  const dpGap = !ca.dpMissing && !cb.dpMissing && Math.abs(ca.dp - cb.dp) >= 0.01;
  if (dpGap) parts.push('the DP charge');
  const noDp = [[ca, A], [cb, B]].filter(([c]) => c.dpMissing).map(([, n]) => n);
  const said = `Take ${qty} ${st.s} shares at the ${PRICES_DATE} NSE close of ${inr(st.p)}: ${inr(v, 0)}, ${s === 'intra' ? 'bought and sold the same day' : 'bought now and sold later at the same price'}. ${A} charges ${inr(ca.total)} in all and ${B} ${inr(cb.total)}. `
    + (Math.abs(d) < 0.005 ? 'On this exact trade they come out level.' : `STT, stamp duty and exchange fees are the same ${inr(ca.statutory)} at both, so the ${inr(Math.abs(d))} difference comes down ${noDp.length ? 'mostly ' : ''}to ${listAnd(parts)}.`);
  const line = (label, f) => `<tr><th scope="row">${label}</th><td class="num">${inr(f(ca))}</td><td class="num">${inr(f(cb))}</td></tr>`;
  return `<section class="panel" aria-labelledby="vs-ex">
      <h2 id="vs-ex">${qty} ${esc(st.s)} shares at ${esc(A)} and ${esc(B)}</h2>
      <p>${esc(said)}</p>
      <div class="table-scroll"><table class="ex-t gt">
        <thead><tr><th scope="col">${s === 'intra' ? 'Intraday' : 'Delivery'}, line by line</th><th scope="col" class="num">${esc(A)}</th><th scope="col" class="num">${esc(B)}</th></tr></thead>
        <tbody>
          ${line('Brokerage (both orders)', (c) => c.brok)}
          ${line('GST on brokerage (18%)', (c) => c.gstBrok)}
          ${s === 'del' ? `<tr><th scope="row">DP charge on the sell</th><td class="num">${ca.dpMissing ? 'Not published' : inr(ca.dp)}</td><td class="num">${cb.dpMissing ? 'Not published' : inr(cb.dp)}</td></tr>` : ''}
          ${line(s === 'del' ? 'STT (0.1% each side)' : 'STT (0.025% on the sell)', (c) => c.stt)}
          ${line('Exchange and SEBI fees, with GST', (c) => c.txn + c.gstOther)}
          ${line('Stamp duty (buy side)', (c) => c.stamp)}
          <tr class="tot-row"><th scope="row">Total you pay</th><td class="num"><b>${inr(ca.total)}</b></td><td class="num"><b>${inr(cb.total)}</b></td></tr>
        </tbody>
      </table></div>
      ${s === 'del' && noDp.length ? `<p class="fine">${esc(listAnd(noDp))} does not publish a DP charge, so its total leaves that fee out and the real gap is ${ca.dpMissing ? 'smaller' : 'larger'} by that amount.</p>` : ''}
    </section>`;
}

function vsPage(p) {
  const root = '../../';
  const url = SITE_URL + 'compare/' + p.slug + '/';
  const a = p.A.plans[0], b = p.B.plans[0], A = p.A.name, B = p.B.name;
  const idx = pairList.indexOf(p);
  const mod = modPair(p);
  const diffs = E.SEGS.map((s) => segDiff(a, b, s));
  const yr = ACTIVITY.map((pr) => { const ya = yearCost(a, pr), yb = yearCost(b, pr); return { pr, ya, yb, d: ya != null && yb != null ? ya - yb : null }; });
  const verdict = pairVerdict(p, diffs, yr);
  const planNote = (x) => x.plan !== 'Standard' ? ` <small>${esc(x.plan)}</small>` : '';
  /* where they differ */
  const eqDiff = diffs.filter((D) => D.kind === 'diff' && EQ.includes(D.s)), dvDiff = diffs.filter((D) => D.kind === 'diff' && DERIV.includes(D.s));
  const bullets = (list) => {
    const grp = [];
    list.forEach((D) => { const key = diffBullet(D, a, b, A, B, '§'); let x = grp.find((y) => y.key === key); if (!x) grp.push(x = { key, ds: [] }); x.ds.push(D); });
    return grp.map((x) => { const label = segGroupLabel(x.ds.map((D) => D.s)); return `<li><b>${esc(cap(label))}.</b> ${esc(diffBullet(x.ds[0], a, b, A, B, x.ds.length > 1 ? label.replace(' and ', ' or ') : null))}</li>`; }).join('');
  };
  const only = (side) => diffs.filter((D) => D.kind === side).map((D) => SEG_WORD[D.s]);
  const onlyTxt = [only('onlyA').length ? `Only ${A} offers ${listAnd(only('onlyA'))}.` : '', only('onlyB').length ? `Only ${B} offers ${listAnd(only('onlyB'))}.` : ''].filter(Boolean).join(' ');
  const same = diffs.filter((D) => D.kind === 'same');
  const sameRules = same.length && same.every((D) => ruleProse(a.r[D.s]) === ruleProse(b.r[D.s])) ? Array.from(new Set(same.map((D) => ruleProse(a.r[D.s])))) : null;
  const sameTxt = same.length ? `${cap(listAnd(same.map((D) => SEG_WORD[D.s])))} cost the same at both${sameRules && sameRules.length === 1 ? `: each charges ${sameRules[0]} there` : ' at every order size tested'}.` : '';
  /* if one side prices exactly like a third broker, say so: the reader can use that comparison too */
  const twinTxt = [p.A, p.B].map((g) => {
    const other = g === p.A ? p.B : p.A, tw = twinsOf(g).filter((x) => x !== other);
    if (!tw.length) return '';
    const alt = tw.map((x) => pairOf(other, x)).filter(Boolean);
    return `${g.name} prices stocks and F&O exactly like ${listAnd(tw.map((x) => x.name))}, DP charge included, so everything above holds for ${other.name} against ${tw.length > 1 ? 'them' : tw[0].name} too${alt.length ? `; see <a href="${root}compare/${alt[0].slug}/">${esc(alt[0].A.name)} vs ${esc(alt[0].B.name)}</a> for the full table` : ''}.`;
  }).filter(Boolean);
  const amcOf = (x) => /not (on|published)/i.test(x.amc) ? 'not listed on the plan page' : x.amc;
  const amcTxt = a.amc !== b.amc ? `Demat AMC: ${amcOf(a)} at ${A}, ${amcOf(b)} at ${B}. It is billed whether or not you trade, so it is not in the totals above.` : '';
  const diffSec = `<section class="panel prose-s" aria-labelledby="vs-diff">
      <h2 id="vs-diff">Where ${esc(A)} and ${esc(B)} differ</h2>
      ${eqDiff.length ? `<ul class="insights">${bullets(eqDiff)}</ul>` : `<p>On stocks and F&amp;O, nothing: ${esc(A)} and ${esc(B)} cost the same on every equity trade both offer.</p>`}
      ${dvDiff.length ? `<h3>Currency and commodity</h3><ul class="insights">${bullets(dvDiff)}</ul>` : ''}
      ${[sameTxt, onlyTxt, amcTxt].filter(Boolean).map((t) => `<p>${esc(t)}</p>`).concat(twinTxt.map((t) => `<p>${t}</p>`)).join('\n      ')}
    </section>`;
  /* how the gap moves with size, only where it does */
  const movingAll = diffs.filter((D) => D.kind === 'diff' && !D.constant);
  const moving = (movingAll.some((D) => EQ.includes(D.s)) ? movingAll.filter((D) => EQ.includes(D.s)) : movingAll).slice(0, 2);
  const sizeRows = (D) => {
    if (PREM[D.s]) return [1, 5, 20].map((l) => D.at(E.REF[D.s] * l, l));
    const vs = new Set(D.runs.map((r) => sampleIn(D, r).v).concat([E.REF[D.s], Math.min(VS_RANGE[D.s][1], 2500000), ROUND_SIZES.find((v) => v >= VS_RANGE[D.s][0])]));
    return Array.from(vs).sort((x, y) => x - y).map((v) => D.at(v, 1));
  };
  const sizeSec = moving.length ? `<section class="panel" aria-labelledby="vs-size">
      <h2 id="vs-size">How the gap changes with order size</h2>
      <div class="table-scroll"><table class="ex-t gt">
        <thead><tr><th scope="col">Bought and sold</th><th scope="col" class="num">${esc(A)}${planNote(a)}</th><th scope="col" class="num">${esc(B)}${planNote(b)}</th><th scope="col">Cheaper</th></tr></thead>
        <tbody>
          ${moving.map((D) => sizeRows(D).map((q) => { const z = { v: q.v, lots: q.lots }; return `<tr><th scope="row">${E.SEG_LABEL[D.s]}<small>${esc(sizeLabel(D.s, z))}</small></th><td class="num">${inr(q.x.total)}</td><td class="num">${inr(q.y.total)}</td><td>${Math.abs(q.d) < 0.005 ? 'Same' : `<span class="best">${esc(q.d < 0 ? A : B)}</span> by ${inr(Math.abs(q.d))}`}</td></tr>`; }).join('\n          ')).join('\n          ')}
        </tbody>
      </table></div>
    </section>` : '';
  /* a year of trading, only the patterns where they differ */
  const yrDiff = yr.filter((r) => r.d != null && Math.abs(r.d) >= 100).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const yrSame = yr.filter((r) => r.d != null && Math.abs(r.d) < 100);
  const yrNone = yr.filter((r) => r.d == null);
  const yrSec = `<section class="panel prose-s" aria-labelledby="vs-yr">
      <h2 id="vs-yr">Over a year of trading</h2>
      ${yrDiff.length ? `<div class="table-scroll"><table class="ex-t gt yr-t">
        <thead><tr><th scope="col">Trading pattern</th><th scope="col" class="num">${esc(A)}${planNote(a)}</th><th scope="col" class="num">${esc(B)}${planNote(b)}</th><th scope="col">Cheaper</th></tr></thead>
        <tbody>
          ${yrDiff.map((r) => `<tr><th scope="row">${r.pr.name}<small>${esc(r.pr.short)}</small></th><td class="num">${inr0(r.ya)}</td><td class="num">${inr0(r.yb)}</td><td><span class="best">${esc(r.d < 0 ? A : B)}</span> by ${inr0(Math.abs(r.d))}</td></tr>`).join('\n          ')}
        </tbody>
      </table></div>` : ''}
      ${yrSame.length ? `<p>${esc(`For ${listAnd(yrSame.map((r) => r.pr.label))}, a year costs the same at both, within ₹100${yrSame.length === 1 ? ` (${inr0(yrSame[0].ya)})` : ''}.`)}</p>` : ''}
      ${yrNone.length ? `<p>${esc(`No comparison for ${listAnd(yrNone.map((r) => r.pr.label))}: ${yrNone.every((r) => !a.r[r.pr.s]) ? A : yrNone.every((r) => !b.r[r.pr.s]) ? B : 'one of them'} does not offer or publish that segment.`)}</p>` : ''}
      <p class="fine">${YEAR_NOTE} Demat AMC is extra.</p>
    </section>`;
  const rc = (x) => (s) => x.r[s] ? esc(ruleText(x.r[s])) : (x.unl || []).includes(s) ? 'Rate not published' : 'Not offered';
  const cardRows = E.SEGS.map((s) => `<tr><th scope="row">${E.SEG_LABEL[s]}</th><td>${rc(a)(s)}</td><td>${rc(b)(s)}</td></tr>`).join('\n          ')
    + `\n          <tr><th scope="row">DP charge per sell</th><td>${a.dp == null ? 'Not published' : inr(a.dp)}</td><td>${b.dp == null ? 'Not published' : inr(b.dp)}</td></tr>`
    + `\n          <tr><th scope="row">Demat AMC</th><td>${esc(a.amc)}</td><td>${esc(b.amc)}</td></tr>`;
  const extraPlans = [p.A, p.B].filter((g) => g.plans.length > 1).map((g) => `<p class="fine">${esc(g.name)} also offers the ${esc(joinNames(g.plans.slice(1).map((x) => x.plan)))} plan, which changes some of these numbers. <a href="${root}brokers/${g.slug}/">See every ${esc(g.name)} plan</a>.</p>`).join('');
  const aggNote = [a, b].filter((x) => x.src === 'agg').map((x) => `<p class="fine">${esc(x.name)} does not publish its full rate card, so its rates come from comparison sites. Confirm with ${esc(x.name)} before opening an account.</p>`).join('');
  const related = pairList.filter((x) => x !== p && (x.A === p.A || x.B === p.A || x.A === p.B || x.B === p.B)).sort((x, y) => indexedPair(y) - indexedPair(x)).slice(0, 8);
  const desc = clip(verdict.split(/(?<=\.) /)[0] + ' Brokerage, DP and AMC side by side, with real trade costs including STT and GST.', 158);
  const body = `    <header class="bp-head">
      <h1>${esc(A)} vs ${esc(B)}: which is cheaper?</h1>
      <p class="lead verdict">${esc(verdict)}</p>
      ${byline(root, `Updated <time datetime="${mod}">${fmtISODate(mod)}</time> · Rates checked ${RATES_DATE} against ${srcLinks(a)} and ${srcLinks(b)}`)}
    </header>
    ${diffSec}
    ${pairExample(p, diffs, idx)}
    ${sizeSec}
    ${yrSec}
    ${pairStory(p, root)}
    ${miniCalc([a, b], `Try your own trade at ${A} and ${B}`)}
    <section class="panel" aria-labelledby="vs-rc">
      <h2 id="vs-rc">Rate cards side by side</h2>
      <div class="table-scroll"><table class="ex-t gt">
        <thead><tr><th scope="col">Charge</th><th scope="col"><a href="${root}brokers/${p.A.slug}/">${esc(A)}</a>${planNote(a)}</th><th scope="col"><a href="${root}brokers/${p.B.slug}/">${esc(B)}</a>${planNote(b)}</th></tr></thead>
        <tbody>
          ${cardRows}
        </tbody>
      </table></div>
      ${extraPlans}${aggNote}
    </section>
    <section class="panel" aria-labelledby="vs-w">
      <h2 id="vs-w">Fine print from each rate card</h2>
      <div class="two-col">
        <div><h3>${esc(A)}</h3><ul class="notes">${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
        <div><h3>${esc(B)}</h3><ul class="notes">${b.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
      </div>
    </section>
    <section class="panel" aria-labelledby="vs-more">
      <h2 id="vs-more">Related comparisons</h2>
      <ul class="cmp-links">${related.map((x) => `<li><a href="${root}compare/${x.slug}/">${esc(x.A.name)} vs ${esc(x.B.name)}</a></li>`).join('')}<li><a href="${root}compare/">All comparisons</a></li></ul>
      <h2 class="h-gap">Full rate cards</h2>
      <ul class="cmp-links"><li><a href="${root}brokers/${p.A.slug}/">${esc(A)} charges</a></li><li><a href="${root}brokers/${p.B.slug}/">${esc(B)} charges</a></li><li><a href="${root}cheapest-broker/">Cheapest broker by segment</a></li></ul>
    </section>`;
  return guidePage({ title: `${A} vs ${B} Brokerage Charges ${YEAR}: Which Is Cheaper? | ${BRAND}`, desc, canonical: url, root, body, calc: true, noindex: !indexedPair(p),
    crumbs: [['Compare brokers', root + 'compare/'], [`${A} vs ${B}`, null]], jsonld: [articleLD(`${A} vs ${B}: brokerage charges compared`, url, '2026-10-31', mod), crumbsLD([['Compare brokers', SITE_URL + 'compare/'], [`${A} vs ${B}`, url]])] });
}

function compareHub() {
  const root = '../';
  const url = SITE_URL + 'compare/';
  const by = [];
  pairList.forEach((p) => { let g = by.find((x) => x.g === p.A); if (!g) { g = { g: p.A, items: [] }; by.push(g); } g.items.push(p); });
  const cell = (F, sg) => { const r = F.rows.find((x) => x.s === sg); return r.d == null ? 'Not offered by both' : Math.abs(r.d) < TIE ? 'About the same' : `${esc(r.d < 0 ? F.pA : F.pB)} by ${inr(Math.abs(r.d))}`; };
  const topRows = FEATURED.map((p) => { const F = Object.assign(vsFacts(p), { pA: p.A.name, pB: p.B.name }); return `<tr><th scope="row"><a href="${root}compare/${p.slug}/">${esc(p.A.name)} vs ${esc(p.B.name)}</a></th><td>${cell(F, 'del')}</td><td>${cell(F, 'intra')}</td><td>${cell(F, 'opt')}</td></tr>`; }).join('\n          ');
  const splits = pairList.filter((p) => { const F = vsFacts(p), d = F.rows.find((x) => x.s === 'del').d, o = F.rows.find((x) => x.s === 'opt').d; return d != null && o != null && Math.abs(d) >= TIE && Math.abs(o) >= TIE && Math.sign(d) !== Math.sign(o); });
  const splitSaid = splits.length ? `In ${splits.length} of these ${pairList.length} match-ups, the broker that is cheaper for delivery is the more expensive one for options, which is why every comparison goes segment by segment.` : `Every comparison goes segment by segment, because a broker that is cheap on one kind of trade is not always cheap on another.`;
  const blocks = by.map((x) => `<section class="panel" aria-labelledby="cg-${x.g.slug}"><h2 id="cg-${x.g.slug}">${esc(x.g.name)} compared</h2><ul class="cmp-links">${x.items.map((p) => `<li><a href="${root}compare/${p.slug}/">${esc(p.A.name)} vs ${esc(p.B.name)}</a></li>`).join('')}</ul></section>`).join('\n    ');
  const body = `    <header class="bp-head">
      <h1>Compare brokers head to head</h1>
      <p class="lead">${pairList.length} side-by-side comparisons of India’s most-used brokers: who is cheaper in each segment, what small and large trades really cost with every tax included, and the fees to check before you open an account.</p>
      <p class="checked">Broker rates checked ${RATES_DATE}.</p>
      <a class="cta" href="${root}#calculator">Rank all ${BROKERS.length} plans for any NSE stock</a>
    </header>
    <section class="panel" aria-labelledby="cg-top">
      <h2 id="cg-top">The most-searched match-ups at a glance</h2>
      <p>${esc(splitSaid)}</p>
      <div class="table-scroll"><table class="ex-t gt">
        <thead><tr><th scope="col">Comparison</th><th scope="col">Delivery <small>₹1 lakh buy + sell</small></th><th scope="col">Intraday <small>₹1 lakh buy + sell</small></th><th scope="col">Options <small>₹10,000 premium</small></th></tr></thead>
        <tbody>
          ${topRows}
        </tbody>
      </table></div>
    </section>
    ${blocks}`;
  return guidePage({ title: `Compare Indian Stock Brokers Head to Head (${YEAR}) | ${BRAND}`, desc: `${pairList.length} broker comparisons, including Zerodha vs Groww, Angel One vs Upstox and Dhan vs Zerodha: brokerage, DP and AMC side by side with real trade costs.`, canonical: url, root, body, crumbs: [['Compare brokers', null]], jsonld: [crumbsLD([['Compare brokers', url]])] });
}

/* --- crypto exchange fees --- */
const CRYPTO = JSON.parse(read(path.join(ROOT, 'data', 'crypto.json')));
const CRYPTO_DATE = fmtISODate(istDate(CRYPTO.checkedAt));
function cryptoCosts(v) {
  return CRYPTO.list.filter((e) => e.fee != null).map((e) => {
    const fees = v * e.fee * 1.18 * 2, tds = v * 0.01;
    return { e, fees, tds, total: fees + tds };
  }).sort((a, b) => a.total - b.total);
}
function cryptoPage() {
  const root = '../';
  const url = SITE_URL + 'crypto/';
  const big = cryptoCosts(100000), small = cryptoCosts(10000);
  const lo = big[0], hi = big[big.length - 1];
  const unpub = CRYPTO.list.filter((e) => e.fee == null);
  const lead = `On a \u20B91 lakh buy and sell, published trading fees with GST run from ${inr(lo.fees)} at ${lo.e.name} to ${inr(hi.fees)} at ${hi.e.name} \u2014 and on top of that, every exchange must deduct 1% TDS (${inr(1000)}) when you sell, whichever you use. The TDS is not a fee: you claim it back against your income tax.`;
  const rows = big.map((r, i) => {
    const sm = small.find((x) => x.e === r.e);
    return `<tr${i === 0 ? ' class="win"' : ''}><td class="num rk">${i + 1}</td><th scope="row">${esc(r.e.name)}<small>${esc(r.e.feeLabel)}</small></th><td class="num c-s">${inr(sm.fees)}</td><td class="num"><b>${inr(r.fees)}</b></td><td class="num c-s">${inr(r.tds)}</td><td class="num">${inr(r.total)}</td></tr>`;
  }).join('\n          ');
  const unpubRows = unpub.map((e) => `<tr><td class="num rk">\u2014</td><th scope="row">${esc(e.name)}<small>${esc(e.feeLabel)}</small></th><td class="cx-note" colspan="4">Fee shown on the order screen; part of the cost sits in the spread</td></tr>`).join('\n          ');
  const cards = CRYPTO.list.map((e) => `<section class="panel" aria-labelledby="cx-${e.id}">
      <h2 id="cx-${e.id}">${esc(e.name)}</h2>
      <div class="table-scroll"><table class="ex-t gt"><tbody>
        <tr><th scope="row">Spot trading fee</th><td>${esc(e.feeLabel)}</td></tr>
        <tr><th scope="row">GST on the fee</th><td>${e.fee != null ? '18%, on top of the fee' : '18% on whatever fee is charged'}</td></tr>
        <tr><th scope="row">INR deposit</th><td>${esc(e.inrDeposit)}</td></tr>
        <tr><th scope="row">INR withdrawal</th><td>${esc(e.inrWithdrawal)}</td></tr>
      </tbody></table></div>
      <ul class="notes">${e.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <p class="fine">Source: <a href="${esc(e.src)}" target="_blank" rel="noopener">official fee page</a>, checked ${CRYPTO_DATE}.</p>
    </section>`).join('\n    ');
  const qa = [
    ['Which crypto exchange has the lowest fees in India?', `Among exchanges that publish their rates, ${lo.e.name} charges the lowest spot fee (${lo.e.feeLabel}): ${inr(lo.fees)} in fees and GST on a \u20B91 lakh buy and sell. ${hi.e.name} charges ${hi.e.feeLabel}, which comes to ${inr(hi.fees)} on the same trade. Checked ${CRYPTO_DATE}.`],
    ['Is the 1% TDS a fee?', 'No. Under section 194S, 1% of every sell is deducted at source and deposited against your PAN, like TDS on salary. You claim it back when you file your return, so it is a cash-flow cost, not money lost \u2014 but it does come out of every sell, at every exchange, on top of trading fees.'],
    ['How is crypto taxed in India?', 'Gains on crypto (virtual digital assets) are taxed at a flat 30% plus 4% cess, with no deduction except the cost of acquisition. Losses cannot be set off against other income or other crypto gains, and cannot be carried forward. This tax usually dwarfs the difference in exchange fees.'],
    ['Why do crypto trades cost more than stock trades?', 'A \u20B91 lakh delivery trade in stocks costs \u20B9233\u2013930 all-in at the brokers we track. The same value traded in crypto costs ' + inr(lo.total) + '\u2013' + inr(hi.total) + ' once fees, GST and the 1% TDS deduction are counted \u2014 and crypto gains are then taxed at 30% with no loss set-off, against 12.5% long-term capital gains for equity.']
  ];
  const body = `    <header class="bp-head">
      <h1>Crypto exchange fees in India</h1>
      <p class="lead">${esc(lead)}</p>
      <p class="checked">Rates checked ${CRYPTO_DATE} against each exchange\u2019s official fee page. FIU-registered exchanges only.</p>
      <a class="cta" href="${root}">Compare stock broker charges</a>
    </header>
    <section class="panel" aria-labelledby="cx-rank">
      <h2 id="cx-rank">What a round trip really deducts</h2>
      <p class="sub">One buy and one sell at the same price, market orders. \u201CFees + GST\u201D is what the exchange keeps; TDS is deducted on the sell and claimable against your income tax.</p>
      <div class="table-scroll"><table class="ex-t gt cx-t">
        <thead><tr><th scope="col" class="num">#</th><th scope="col">Exchange and spot fee</th><th scope="col" class="num c-s">Fees + GST on \u20B910,000</th><th scope="col" class="num">Fees + GST on \u20B91 lakh</th><th scope="col" class="num c-s">TDS on the \u20B91 lakh sell</th><th scope="col" class="num">Total deducted</th></tr></thead>
        <tbody>
          ${rows}
          ${unpubRows}
        </tbody>
      </table></div>
      <p class="fine">Fee tiers above assume a regular user below each exchange\u2019s volume threshold, paying fees in INR (no token discounts). Spreads are extra and vary by pair and moment.</p>
    </section>
    <section class="panel prose-s" aria-labelledby="cx-tax"><h2 id="cx-tax">The costs no exchange controls</h2>
      <p>Three costs are identical everywhere: <b>1% TDS</b> on every sell under section 194S (claimable in your return); <b>18% GST</b> on whatever fee the exchange charges; and <b>30% tax plus 4% cess</b> on gains, with no loss set-off. An exchange can only compete on its own fee and its spread \u2014 which is why the fee table above, small as the numbers look next to the taxes, is still the only part you can choose.</p>
    </section>
    ${cards}
    ${faqBlock(qa)}
    <section class="panel" aria-labelledby="cx-more">
      <h2 id="cx-more">Trading stocks too?</h2>
      <ul class="cmp-links"><li><a href="${root}">Brokerage calculator</a></li>${CHEAP.map((c) => `<li><a href="${root}${cheapUrl(c)}">Cheapest for ${esc(c.tile)}</a></li>`).join('')}<li><a href="${root}compare/">Compare brokers</a></li></ul>
    </section>`;
  const rankLD = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Indian crypto exchanges by published spot fee', itemListOrder: 'https://schema.org/ItemListOrderAscending', numberOfItems: big.length, itemListElement: big.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.e.name })) };
  return guidePage({ title: `Crypto Exchange Fees in India Compared (${MONTH_YEAR}) | ${BRAND}`, desc: `What a \u20B91 lakh crypto trade really deducts at ${joinNames(big.map((r) => r.e.name))}: trading fees, 18% GST and the 1% TDS, from each exchange\u2019s official fee page.`, canonical: url, root, body,
    crumbs: [['Crypto exchange fees', null]], jsonld: [articleLD('Crypto Exchange Fees in India Compared', url, '2026-11-16', latestDate('2026-11-17', istDate(CRYPTO.checkedAt))), rankLD, crumbsLD([['Crypto exchange fees', url]]), faqLD(qa)] });
}

/* home page section linking into the guides */
function guidesSection(root) {
  const tiles = CHEAP.map((c) => { const f = segFacts(c.segs[0]); return `<li><a class="g-tile panel" href="${root}${cheapUrl(c)}"><span class="g-k">Cheapest for ${esc(c.tile)}</span><b>${esc(namesOf(f.win, 2))}</b><span class="g-v">${inr(f.win[0].c.total)} on ${esc(SHORT_EX[f.s])}</span></a></li>`; }).join('');
  return `  <section class="guides" id="guides" aria-labelledby="gd-h">
    <div class="sec-head"><h2 id="gd-h">Cheapest broker by segment</h2><p>Who costs least right now on a typical trade, with every tax and fee included. Rankings update whenever a broker changes its rates.</p></div>
    <ul class="g-grid">${tiles}</ul>
    <nav aria-label="Popular comparisons"><p class="foot-h">Popular comparisons</p><ul class="cmp-links">${FEATURED.map((p) => `<li><a href="${root}compare/${p.slug}/">${esc(p.A.name)} vs ${esc(p.B.name)}</a></li>`).join('')}<li><a href="${root}compare/">All ${pairList.length} comparisons</a></li><li><a href="${root}crypto/">Crypto exchange fees</a></li></ul></nav>
  </section>`;
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
/* announcement ribbon: site.config.json "announcement" {id, label, text, href, until}; drops itself after "until" (builds run every two hours) */
const ANN = (() => {
  const a = CONFIG.announcement;
  if (!a || !a.text || !a.href) return null;
  if (a.until && new Date().toISOString().slice(0, 10) > a.until) return null;
  return a;
})();
function annRibbon(root, rel) {
  if (!ANN || rel === ANN.href.replace(/\/?$/, '/') + 'index.html') return '';
  const id = JSON.stringify(String(ANN.id || ANN.href));
  return `<aside class="ann" id="ann" aria-label="Site update">
  <a class="ann-a" href="${root}${ANN.href}"><span class="ann-tag">${esc(ANN.label || 'New')}</span><span class="ann-t">${esc(ANN.text)}<span class="ann-go" aria-hidden="true">\u2192</span></span></a>
  <button type="button" class="ann-x" aria-label="Dismiss this update"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
</aside>
<script>(function(){var a=document.getElementById('ann'),k='ds-ann',v=${id.replace(/</g, '\\u003c')};try{if(localStorage.getItem(k)===v){a.hidden=true;return}}catch(e){}a.querySelector('.ann-x').onclick=function(){a.hidden=true;try{localStorage.setItem(k,v)}catch(e){}}})();</script>`;
}
const w = (rel, s) => {
  if (ANN && rel.endsWith('.html')) {
    s = s.replace(/<body([^>]*)>/, (m, attrs) => {
      const r = /data-root="([^"]*)"/.exec(attrs);
      return m + '\n' + annRibbon(r ? r[1] : SITE_URL, rel);
    });
  }
  const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s);
};
w('index.html', buildHome(false));
w('assets/site.css', css);
w('assets/app.js', appJs);
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(OUT, 'assets', f));
for (const f of fs.readdirSync(DATA)) if (f.endsWith('.json')) w('data/' + f, read(path.join(DATA, f)));
groups.forEach((g) => w('brokers/' + g.slug + '/index.html', brokerPage(g)));
w('assets/engine.js', engineAsset);
w('assets/mini.js', miniSrc);
w('cheapest-broker/index.html', cheapHub());
CHEAP.forEach((c) => w(cheapUrl(c) + 'index.html', cheapPage(c)));
w('compare/index.html', compareHub());
w('crypto/index.html', cryptoPage());
pairList.forEach((p) => w('compare/' + p.slug + '/index.html', vsPage(p)));
w('404.html', notFound());
w('about/index.html', aboutPage());
w('how-we-calculate/index.html', methodPage());
w('feed.xml', rssFeed());
if (CONFIG.indexNowKey) w(CONFIG.indexNowKey + '.txt', CONFIG.indexNowKey);
w('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
/* lastmod per page: the same date as the page's dateModified (see CONTENT_REVISED above) */
const lastRates = istDate(status.ratesUpdatedAt || status.ratesCheckedAt || new Date().toISOString());
const allSegs = modSegs(E.SEGS);
const urls = [[SITE_URL, latestDate(pricesISO, lastRates), 'daily', '1.0'], [SITE_URL + 'how-we-calculate/', lastRates, 'weekly', '0.6'], [SITE_URL + 'about/', latestDate('2026-11-14', lastRates), 'monthly', '0.4']].concat(groups.map((g) => [SITE_URL + 'brokers/' + g.slug + '/', modBroker(g), 'weekly', '0.8']))
  .concat([[SITE_URL + 'cheapest-broker/', allSegs, 'weekly', '0.8']], CHEAP.map((c) => [SITE_URL + cheapUrl(c), modSegs(c.segs), 'weekly', '0.8']))
  .concat([[SITE_URL + 'compare/', allSegs, 'weekly', '0.7']], pairList.filter(indexedPair).map((p) => [SITE_URL + 'compare/' + p.slug + '/', modPair(p), 'weekly', '0.7']))
  .concat([[SITE_URL + 'crypto/', latestDate('2026-11-17', istDate(CRYPTO.checkedAt)), 'weekly', '0.7']]);
w('urls.txt', urls.map((u) => u[0]).join('\n') + '\n');
w('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d, f, p]) => `  <url><loc>${esc(u)}</loc><lastmod>${d}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')}\n</urlset>\n`);
w('manifest.webmanifest', JSON.stringify({ name: 'DalalScope brokerage calculator', short_name: BRAND, start_url: './', scope: './', display: 'standalone', background_color: '#061020', theme_color: '#061020', icons: [{ src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'assets/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, null, 1));
w('.nojekyll', '');
console.log('built', OUT, 'pages in sitemap:', urls.length, '(brokers ' + groups.length + ', cheapest ' + (CHEAP.length + 1) + ', comparisons ' + (pairList.filter(indexedPair).length + 1) + ' indexed of ' + (pairList.length + 1) + ')');
