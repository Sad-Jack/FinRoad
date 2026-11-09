"""Package only the public demo and the empty downloadable app for GitHub Pages."""
from pathlib import Path
from build_standalone import build

ROOT = Path(__file__).resolve().parents[1]

def build_site():
    target = ROOT / 'output' / 'site'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'index.html').write_text(build(demo=True))
    (target / 'FinRoad.html').write_text(build())
    (target / '.nojekyll').touch()
    print(f'Built public demo and download in {target.relative_to(ROOT)}')

if __name__ == '__main__':
    build_site()
