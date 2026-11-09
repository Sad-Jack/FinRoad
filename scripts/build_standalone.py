"""Build the distributable HTML from source, without bundler dependencies or user data."""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def build(demo=False):
    modules = {}
    chunks = []
    for filename in ('work-calendar.js', 'finance.js', 'compact.js', 'storage.js', 'demo.js', 'date-picker.js', 'app.js'):
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
    if demo:
        html = html.replace('<body>', '<body data-demo="true">')
        html = html.replace('<title>FinRoad · Финансы под звёздами</title>', '<title>FinRoad · Попробовать на примере</title>')
        banner = '''<section class="demo-intro" aria-label="Знакомство с FinRoad">
          <div class="demo-copy"><a class="demo-brand" href="https://github.com/Sad-Jack/FinRoad">FinRoad</a><span class="demo-badge">ДЕМО · ВЫМЫШЛЕННЫЕ ДАННЫЕ</span>
          <h1>Хватит ли денег до зарплаты?</h1>
          <p>В исходном примере итог за месяц положительный, но до зарплаты денег не хватает. Меняй суммы и даты во вкладках «Платежи» и «Доход» — прогноз пересчитается.</p>
          <small>Изменения в демо действуют до перезагрузки. Скачанный файл откроется с пустым планом и будет сохранять твои записи в браузере.</small></div>
          <div class="demo-actions"><a class="button primary" href="FinRoad.html" download="FinRoad.html">Скачать для себя</a><button class="button" type="button" data-action="reset-demo">Вернуть пример</button><a class="demo-source" href="https://github.com/Sad-Jack/FinRoad">Код и инструкция на GitHub ↗</a></div>
        </section>'''
        html = html.replace('</main>', '</main>' + banner)
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
