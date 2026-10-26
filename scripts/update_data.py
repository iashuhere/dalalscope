"""Safe edits to DalalScope's data files, used by the hourly news-and-rates job.

  python3 scripts/update_data.py news NEW_ITEMS.json   add headlines (validated, de-duplicated, newest 40 kept)
  python3 scripts/update_data.py brokers BROKERS.json  replace the broker list after a rate change (validated)
  python3 scripts/update_data.py checked news|rates     record that a check ran, even if nothing changed

Every command prints what it changed and exits non-zero on bad input, leaving the files untouched.
"""
import datetime, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
WHO = ['Zerodha', 'Groww', 'Angel One', 'Upstox', 'Dhan', 'FYERS', '5paisa', 'Kotak Neo', 'HDFC Sky', 'ICICI Direct',
       'Motilal Oswal', 'm.Stock', 'Shoonya', 'Paytm Money', 'Flattrade', 'Sahi', 'Alice Blue', 'Samco', 'Sharekhan',
       'IIFL Capital', 'Tradejini', 'INDmoney', 'ProStocks', 'Bajaj Broking', 'SEBI', 'Industry']
TAGS = ['Pricing', 'New product', 'Rule change', 'Tax change', 'Market share', 'Growth', 'Outage', 'Penalty', 'Rebrand']
SEGS = ['del', 'intra', 'fut', 'opt', 'cfut', 'copt', 'mfut', 'mopt']
KEEP = 40


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load(name, default):
    p = os.path.join(DATA, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else default


def save(name, obj):
    p = os.path.join(DATA, name)
    tmp = p + '.tmp'
    json.dump(obj, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    os.replace(tmp, p)


def die(msg):
    print('ERROR:', msg)
    sys.exit(1)


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def check_item(n):
    for k in ('id', 'd', 'who', 'tag', 'title', 'body', 'srcName', 'srcUrl'):
        if not isinstance(n.get(k), str) or not n[k].strip():
            die('item missing %s: %r' % (k, n.get('title')))
    if not re.fullmatch(r'[a-z0-9-]{8,80}', n['id']):
        die('bad id %r (lowercase letters, digits, hyphens; 8-80 chars)' % n['id'])
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', n['d']):
        die('bad date %r' % n['d'])
    if n['who'] not in WHO:
        die('who must be one of %s, got %r' % (WHO, n['who']))
    if n['tag'] not in TAGS:
        die('tag must be one of %s, got %r' % (TAGS, n['tag']))
    if len(n['title']) > 90:
        die('title over 90 characters: %r' % n['title'])
    if len(n['body']) > 320:
        die('body over 320 characters: %r' % n['title'])
    if not re.fullmatch(r'https://[^\s"\'<>]+', n['srcUrl']):
        die('srcUrl must be an https URL: %r' % n['srcUrl'])


def cmd_news(path):
    new = json.load(open(path, encoding='utf-8'))
    if isinstance(new, dict):
        new = new.get('items', [])
    doc = load('news.json', {'items': []})
    items = doc.get('items', [])
    have_ids = {i['id'] for i in items}
    have_urls = {i.get('srcUrl') for i in items}
    have_titles = {norm(i['title']) for i in items}
    added = []
    for n in new:
        check_item(n)
        if n['id'] in have_ids or n['srcUrl'] in have_urls or norm(n['title']) in have_titles:
            print('skip duplicate:', n['title'])
            continue
        n = {k: n[k].strip() for k in ('id', 'd', 'who', 'tag', 'title', 'body', 'srcName', 'srcUrl')}
        n['addedAt'] = now()
        items.append(n); added.append(n)
        have_ids.add(n['id']); have_urls.add(n['srcUrl']); have_titles.add(norm(n['title']))
    items.sort(key=lambda i: (i['d'], i.get('addedAt', '')), reverse=True)
    pruned = items[KEEP:]
    items = items[:KEEP]
    st = load('status.json', {})
    st['newsCheckedAt'] = now()
    if added or pruned:
        save('news.json', {'updatedAt': now(), 'items': items})
        st['newsUpdatedAt'] = now()
    save('status.json', st)
    print('added %d, pruned %d, total %d' % (len(added), len(pruned), len(items)))
    for n in added:
        print('  +', n['d'], n['who'], '|', n['title'])


def valid_rule(r):
    if r is None:
        return True
    if not isinstance(r, dict) or r.get('t') not in ('z', 'f', 'l', 'p', 'lot'):
        return False
    a, p = r.get('a'), r.get('p')
    if r['t'] in ('f', 'lot'):
        return isinstance(a, (int, float)) and 0 <= a <= 500
    if r['t'] == 'p':
        return isinstance(p, (int, float)) and 0 <= p <= 0.025
    if r['t'] == 'l':
        return isinstance(a, (int, float)) and 0 <= a <= 500 and isinstance(p, (int, float)) and 0 <= p <= 0.025
    return True


SEG_NAME = {'del': 'delivery', 'intra': 'intraday', 'fut': 'futures', 'opt': 'options', 'cfut': 'currency futures',
            'copt': 'currency options', 'mfut': 'commodity futures', 'mopt': 'commodity options'}


def describe(r):
    if r is None:
        return 'not offered'
    pct = lambda p: ('%.4f' % (p * 100)).rstrip('0').rstrip('.') + '%'
    t = r['t']
    if t == 'z':
        return '₹0'
    if t == 'f':
        return '₹%g per order' % r['a']
    if t == 'l':
        return '₹%g or %s (whichever is lower)%s' % (r['a'], pct(r['p']), ', min ₹5' if r.get('mn') else '')
    if t == 'p':
        return '%s of trade value' % pct(r['p'])
    if t == 'lot':
        return '₹%g per lot' % r['a']
    return '?'


def log_changes(lines):
    log = load('changes.json', {'items': []})
    log['items'].insert(0, {'at': now(), 'changes': lines})
    log['items'] = log['items'][:200]
    save('changes.json', log)


def cmd_brokers(path):
    new = json.load(open(path, encoding='utf-8'))
    if isinstance(new, dict):
        new = new.get('list', [])
    old = load('brokers.json', {}).get('list', [])
    if [b.get('id') for b in new] != [b.get('id') for b in old]:
        die('plans must keep the same ids in the same order: %s' % [b.get('id') for b in old])
    changes = []
    for b, o in zip(new, old):
        for k in ('id', 'name', 'plan', 'src', 'amc', 'r', 'notes', 'links'):
            if k not in b:
                die('%s is missing %s' % (b.get('id'), k))
        if b['name'] != o['name'] or b['plan'] != o['plan']:
            die('%s: name and plan must not change' % b['id'])
        for s in SEGS:
            if not valid_rule(b['r'].get(s)):
                die('%s %s has an invalid rule %r' % (b['id'], s, b['r'].get(s)))
            if b['r'].get(s) != o['r'].get(s):
                changes.append('%s %s: %s → %s' % (b['name'] + ('' if b['plan'] == 'Standard' else ' (' + b['plan'] + ')'), SEG_NAME[s], describe(o['r'].get(s)), describe(b['r'].get(s))))
        if not (b.get('dp') is None or (isinstance(b['dp'], (int, float)) and 0 <= b['dp'] <= 100)):
            die('%s dp must be null or 0-100 rupees' % b['id'])
        unl = b.get('unl', [])
        if not (isinstance(unl, list) and all(s in SEGS and b['r'].get(s) is None for s in unl)):
            die('%s unl must list only segments whose rule is null' % b['id'])
        for k in ('dp', 'amc', 'notes', 'links', 'unl'):
            if b.get(k) != o.get(k):
                if k == 'dp':
                    changes.append('%s DP charge per sell: %s → %s' % (b['name'], 'not published' if o.get('dp') is None else '₹%.2f' % o['dp'], 'not published' if b.get('dp') is None else '₹%.2f' % b['dp']))
                elif k == 'amc':
                    changes.append('%s demat AMC: %s → %s' % (b['name'], o.get('amc'), b.get('amc')))
                else:
                    changes.append('%s %s updated' % (b['name'], k))
        for l in b['links']:
            if not (isinstance(l, list) and len(l) == 2 and re.fullmatch(r'https://[^\s"\'<>]+', l[1])):
                die('%s has a bad link %r' % (b['id'], l))
    st = load('status.json', {})
    st['ratesCheckedAt'] = now()
    if changes:
        doc = load('brokers.json', {})
        doc.update({'list': new, 'updatedAt': now(), 'checkedAt': now()})
        save('brokers.json', doc)
        st['ratesUpdatedAt'] = now()
        log_changes([c for c in changes if not c.endswith(' notes updated') and not c.endswith(' links updated')] or ['Notes and source links updated'])
    save('status.json', st)
    print('%d change(s)' % len(changes))
    for c in changes:
        print('  ', c)


def cmd_checked(what):
    if what not in ('news', 'rates'):
        die('checked takes news or rates')
    st = load('status.json', {})
    st[what + 'CheckedAt'] = now()
    if what == 'rates':
        doc = load('brokers.json', None)
        if doc:
            doc['checkedAt'] = now()
            save('brokers.json', doc)
    save('status.json', st)
    print('recorded', what, 'check at', st[what + 'CheckedAt'])


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('news', 'brokers', 'checked'):
        print(__doc__)
        sys.exit(2)
    {'news': cmd_news, 'brokers': cmd_brokers, 'checked': cmd_checked}[sys.argv[1]](sys.argv[2])
