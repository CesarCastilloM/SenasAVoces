import json
from pathlib import Path
m = json.loads(Path('data/lsm_raw/_metadata.json').read_text(encoding='utf-8'))
samples = m.get('samples', {})
print(f'Total en metadata: {len(samples)}')
for k, v in samples.items():
    if 'glosario' in k:
        print(f'  {k}: {v["mode"]}')
