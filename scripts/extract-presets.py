"""Extract original preset data without executing the captured JavaScript."""
from pathlib import Path
import re
import json

root = Path(__file__).resolve().parents[1]
text = next(root.glob('snapshot/*_files/5123*')).read_text(encoding='utf-8')
data = {name: json.loads(value) for name, value in re.findall(r"(\w+)=JSON.parse\('([^']*)'\)", text)}
variables = {
    'MARD': ['eh', 'eg', 'eF', 'eC'],
    'COCO': ['em', 'eb', 'ep', 'ey'],
    '漫漫': ['eE', 'eD', 'ef', 'eA'],
    '盼盼': ['ej', 'eN', 'eM', 'eO'],
    '咪小窝': ['ek', 'ev', 'eB', 'ew'],
}
known = {c['hex'] for c in json.loads((root / 'public/palette.json').read_text(encoding='utf-8'))}
presets = {}
for brand, names in variables.items():
    presets[brand] = {}
    for count, name in zip([291, 221, 144, 120], names):
        colors = [c.upper() for c in data[name]['selectedHexValues']]
        assert len(colors) == len(set(colors)) == count, (brand, count)
        assert set(colors) <= known, (brand, 'unknown colors')
        presets[brand][str(count)] = colors
(root / 'public/presets.json').write_text(json.dumps(presets, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Verified 20 original brand presets: unique colors, exact counts, complete palette coverage.')
