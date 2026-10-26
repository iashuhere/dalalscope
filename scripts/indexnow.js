#!/usr/bin/env node
/*
 * Tells Bing, Yandex and other IndexNow search engines which pages just changed, so they
 * recrawl within minutes instead of days. Run after a deploy, with the list of changed files:
 *
 *   SITE_URL=https://example.github.io/dalalscope/ CHANGED="data/news.json" node scripts/indexnow.js
 *
 * Only pages whose content changed are submitted; status-only commits submit nothing.
 * Reads _site/urls.txt, so run scripts/build_site.js first.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
let site = process.env.SITE_URL || '';
if (!site || !cfg.indexNowKey) { console.log('IndexNow: no SITE_URL or key; skipping'); process.exit(0); }
if (!site.endsWith('/')) site += '/';
const changed = (process.env.CHANGED || '').split(/\s+/).filter(Boolean);
const all = fs.readFileSync(path.join(ROOT, '_site', 'urls.txt'), 'utf8').split('\n').filter(Boolean);

const wide = changed.some((f) => f === 'ALL' || f.startsWith('src/') || f.startsWith('assets/') || f === 'scripts/build_site.js' || f === 'data/brokers.json' || f === 'site.config.json');
let urls = wide ? all : [];
if (!wide) {
  if (changed.some((f) => f.startsWith('data/prices') || f === 'data/news.json')) urls.push(site);
  if (changed.includes('data/changes.json')) urls.push(site + 'how-we-calculate/');
}
urls = [...new Set(urls)];
if (!urls.length) { console.log('IndexNow: nothing that search engines index changed (' + (changed.join(', ') || 'no files') + ')'); process.exit(0); }

const u = new URL(site);
const body = JSON.stringify({ host: u.host, key: cfg.indexNowKey, keyLocation: site + cfg.indexNowKey + '.txt', urlList: urls });
const req = https.request({ hostname: 'api.indexnow.org', path: '/indexnow', method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
  console.log('IndexNow: submitted', urls.length, 'URL(s), response', res.statusCode);
  res.resume();
});
req.on('error', (e) => console.log('IndexNow: request failed:', e.message));
req.end(body);
