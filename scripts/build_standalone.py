"""Build the distributable HTML from source, without bundler dependencies or user data."""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def build():
    modules = {}
    chunks = []
    for filename in ('work-calendar.js', 'finance.js', 'compact.js', 'storage.js', 'date-picker.js', 'app.js'):
        source = (ROOT / 'public' / filename).read_text()
        def replace_import(match):
            return f'const {{{match[1]}}} = {modules[match[2]]};'
        source = re.sub(r"^import \{([^}]+)\} from './([^']+)';", replace_import, source, flags=re.M)
        exports = re.findall(r'^export (?:function|const) (\w+)', source, flags=re.M)
        source = re.sub(r'^export ', '', source, flags=re.M)
        if re.search(r'^import |^export ', source, flags=re.M):
            raise ValueError(f'Unsupported module syntax in {filename}')
        module = 'module_' + str(len(modules))
        modules[filename] = module
        chunks.append(f'const {module} = (() => {{\n{source}\nreturn {{{",".join(exports)}}};\n}})();')
    html = (ROOT / 'public/index.html').read_text()
    favicon = base64.b64encode((ROOT / 'public/favicon.svg').read_bytes()).decode()
    html = html.replace('href="/favicon.svg"', f'href="data:image/svg+xml;base64,{favicon}"')
    css = (ROOT / 'public/style.css').read_text()
    html = html.replace('<link rel="stylesheet" href="/style.css">', f'<style>\n{css}\n</style>')
    script = '\n'.join(chunks).replace('</script', '<\\/script')
    html = html.replace('<script type="module" src="/app.js"></script>', f'<script>\n{script}\n</script>')
    policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
    html = html.replace('<head>', f'<head><meta http-equiv="Content-Security-Policy" content="{policy}">')
    return html

if __name__ == '__main__':
    target = ROOT / 'FinRoad.html'
    target.write_text(build())
    print(f'Built {target.name} ({target.stat().st_size} bytes)')
