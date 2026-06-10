import numpy as np, json
from pathlib import Path

idx = json.loads(Path('data/templates/index.json').read_text(encoding='utf-8'))
empty, valid = [], []
by_cat = {}
for cat, entries in idx.items():
    by_cat[cat] = {'valid': 0, 'empty': 0}
    for e in entries:
        slug = e.get('slug') or e.get('label', '').upper().replace(' ', '_')
        p = Path('data/templates') / cat / f'{slug}.npz'
        if not p.exists():
            continue
        h = np.load(p)['hands']
        valid_frames = sum(1 for t in range(h.shape[0]) if not np.all(h[t, 0] == 0))
        if valid_frames < 3:
            empty.append(f'{cat}/{slug}')
            by_cat[cat]['empty'] += 1
        else:
            valid.append((cat, slug, valid_frames))
            by_cat[cat]['valid'] += 1

print(f'Total: {len(empty)+len(valid)}')
print(f'Validas (>=3 frames): {len(valid)}')
print(f'Vacias: {len(empty)}')
print()
for c, d in by_cat.items():
    print(f'  {c}: {d["valid"]} validas / {d["empty"]} vacias')
print()
print('Primeras 15 validas:')
for v in valid[:15]:
    print(f'  {v[0]}/{v[1]} ({v[2]} frames)')
