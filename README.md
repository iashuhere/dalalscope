# DalalScope

**What will your broker charge you?** Pick any NSE-listed stock and a quantity to see what 25 Indian broker plans charge for that exact trade: commission, GST, STT, exchange and SEBI fees, stamp duty and DP charges. DalalScope also ranks brokers by segment (F&O, currency, commodity), has a page for each broker's charges, and carries a broker news feed.

## How it is built

`scripts/build_site.js` renders the site into `_site/` from `src/` and `data/` on every deploy:

- `about/`, `how-we-calculate/`: who runs the site, data sources, corrections, the full formula and a public log of rate changes (`data/changes.json`)
- `feed.xml`: RSS feed of broker news; `<key>.txt`: IndexNow key (changed pages are submitted to Bing and other IndexNow engines after each deploy by `scripts/indexnow.js`)
- `index.html`: the calculator, a rate-card table and FAQ (static HTML for search engines), with a starter list of popular stocks inline; the full list of every NSE stock loads in the background
- `brokers/<name>/`: one page per broker with its charges by segment, a typical trade's all-in cost, its rank, DP and AMC
- `sitemap.xml`, `robots.txt`, `404.html`, `manifest.webmanifest`, share image and icons

## How the data stays current

| File | What it holds | Updated by |
|---|---|---|
| `data/prices.json`, `data/prices-meta.json` | NSE closing prices for every listed stock | GitHub Actions (`.github/workflows/site.yml`) every two hours; writes only when a new trading day is out |
| `data/news.json` | Latest 40 broker headlines with short summaries | Scheduled Claude task, hourly 6:38 am to 10:38 pm IST, via `scripts/update_data.py news` |
| `data/brokers.json` | Each broker plan's rate card | Scheduled Claude task, checked daily against official charges pages, via `scripts/update_data.py brokers` |
| `data/changes.json` | Public log of every rate change | `scripts/update_data.py brokers` |
| `data/status.json` | When news and rates were last checked or changed | `scripts/update_data.py` |

Every push to `main` rebuilds and redeploys. Open pages re-check `data/` every three minutes, so visitors see updates without reloading.

Live site: https://iashuhere.github.io/dalalscope/

Prices are end-of-day closes from NSE's bhavcopy (fallback: [veer0608/bhavcopy-pipeline](https://github.com/veer0608/bhavcopy-pipeline)). Broker rates come from each broker's published charges page. DalalScope compares published prices; it is not investment advice.

Site settings (owner name, contact email, Search Console and Bing verification codes) live in `site.config.json`.

## Run locally

```sh
node scripts/build_site.js            # writes _site/
cd _site && python3 -m http.server 8765
```
