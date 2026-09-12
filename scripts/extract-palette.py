from pathlib import Path
import json
import re
import shutil
root = Path(__file__).resolve().parents[1]
source = next(root.glob('snapshot/*_files/5123*')).read_text(encoding='utf-8')
start = source.index("A=JSON.parse('") + len("A=JSON.parse('")
end = source.index("')", start)
mapping = json.loads(source[start:end])
palette = [{'hex': color, 'codes': codes} for color, codes in mapping.items()]
assert len(palette) > 200
(root / 'public/palette.json').write_text(json.dumps(palette, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
# The small image is the saved strawberry site mark, preserved without modification.
assets = next(root.glob('snapshot/*_files'))
shutil.copyfile(assets / 'logtu.jpg', root / 'public/strawberry.jpg')
page = root / 'public/index.html'
page.write_text(page.read_text(encoding='utf-8').replace('strawberry.png', 'strawberry.jpg'), encoding='utf-8')
print(f'Extracted {len(palette)} palette entries; original brand identifiers retained.')
