"""Verify the prepared archive against its manifest without running the website."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'inspection/backup-manifest.json').read_text(encoding='utf-8'))
expected = set()
for entry in manifest['files']:
    relative = entry['path']
    expected.add(relative)
    path = root / 'snapshot' / relative
    data = path.read_bytes()
    assert len(data) == entry['bytes'], f'Size mismatch: {relative}'
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], f'Hash mismatch: {relative}'
actual = {p.relative_to(root / 'snapshot').as_posix() for p in (root / 'snapshot').rglob('*') if p.is_file()}
assert actual == expected, 'Archive files differ from manifest'
print(f'PASS: {len(expected)} archive files match the manifest.')
