"""Refresh data/prices.json with the latest NSE closing prices.

Tries NSE's own end-of-day bhavcopy archive first, then falls back to the public
mirror at github.com/veer0608/bhavcopy-pipeline. Writes nothing unless it finds a
trading day newer than the one already published, so scheduled runs that find
nothing new leave the repo untouched.
"""
import csv, datetime, gzip, io, json, os, subprocess, sys, tempfile, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
KEEP = {'EQ': '', 'BE': 'T2T', 'BZ': 'Z', 'SM': 'SME', 'ST': 'SME'}
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def build(rows, date):
    out = {}
    for r in rows:
        ser = (r.get('SctySrs') or '').strip()
        if ser not in KEEP:
            continue
        sym = (r.get('TckrSymb') or '').strip()
        name = ' '.join((r.get('FinInstrmNm') or '').split()).replace('|', '/')
        try:
            px = float(r['ClsPric'])
        except Exception:
            continue
        if px <= 0 or not sym or not name:
            continue
        if sym in out and out[sym][3] == '':
            continue
        out[sym] = (sym, name, px, KEEP[ser])
    items = sorted(out.values())
    data = '\n'.join('%s|%s|%s|%s' % (s, n, ('%.2f' % p).rstrip('0').rstrip('.'), t) for s, n, p, t in items)
    return {'date': date, 'count': len(items), 'data': data, 'updatedAt': now_utc()}, out


def from_nse(day):
    url = 'https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_%s_F_0000.csv.zip' % day.strftime('%Y%m%d')
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://www.nseindia.com/'})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            blob = resp.read()
        z = zipfile.ZipFile(io.BytesIO(blob))
        name = [n for n in z.namelist() if n.lower().endswith('.csv')][0]
        return list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8')))
    except Exception as e:
        print('NSE', day, 'unavailable:', type(e).__name__, str(e)[:80])
        return None


def from_mirror():
    tmp = tempfile.mkdtemp()
    repo = os.path.join(tmp, 'bc')
    subprocess.run(['git', 'clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', 'https://github.com/veer0608/bhavcopy-pipeline.git', repo], check=True)
    files = subprocess.run(['git', '-C', repo, 'ls-tree', '-r', '--name-only', 'HEAD'], check=True, capture_output=True, text=True).stdout.split()
    files = sorted(f for f in files if f.startswith('data/raw/NSE/') and f.endswith('.csv.gz'))
    if not files:
        return None, None
    path = files[-1]
    subprocess.run(['git', '-C', repo, 'checkout', '-q', 'HEAD', '--', path], check=True)
    date = os.path.basename(path)[:10]
    return date, list(csv.DictReader(gzip.open(os.path.join(repo, path), 'rt', encoding='utf-8')))


def main():
    meta_path = os.path.join(DATA, 'prices-meta.json')
    have = ''
    if os.path.exists(meta_path):
        have = json.load(open(meta_path)).get('date', '')
    today = datetime.datetime.now(IST).date()
    date, rows, source = None, None, None
    for back in range(0, 8):
        day = today - datetime.timedelta(days=back)
        if day.isoformat() <= have:
            break
        if day.weekday() >= 5:
            continue
        rows = from_nse(day)
        if rows:
            date, source = day.isoformat(), 'NSE archive'
            break
    if not rows:
        try:
            d2, r2 = from_mirror()
        except Exception as e:
            print('mirror unavailable:', e)
            d2, r2 = None, None
        if d2 and d2 > have:
            date, rows, source = d2, r2, 'bhavcopy mirror'
    if not rows:
        print('No newer trading day than', have or 'none')
        return 0
    doc, idx = build(rows, date)
    size = len(json.dumps(doc, ensure_ascii=False).encode())
    rel = idx.get('RELIANCE')
    print(source, date, doc['count'], 'stocks', 'RELIANCE', rel, 'bytes', size)
    if doc['count'] < 2000 or not rel or rel[2] <= 0:
        print('Sanity check failed; leaving prices unchanged')
        return 1
    json.dump(doc, open(os.path.join(DATA, 'prices.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'date': date, 'count': doc['count'], 'source': source, 'updatedAt': doc['updatedAt']}, open(meta_path, 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
