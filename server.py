"""FinRoad: loopback-only web app, Python standard library + SQLite."""
import argparse
import json
import os
import sqlite3
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get('FINROAD_DB', ROOT / 'data' / 'finroad.sqlite3'))
MAX_BODY = 2_000_000


def empty_state():
    return dict(schema=1, demo=False, balance=None, balanceDate=date.today().isoformat(), transactions=[], debts=[], incomeSources=[], completed={})


def validate(state):
    if not isinstance(state, dict) or state.get('schema') != 1:
        raise ValueError('Неизвестный формат данных')
    def money(value, nullable=False, signed=False):
        if nullable and value is None:
            return
        if type(value) is not int or abs(value) > 10**13 or (not signed and value < 0):
            raise ValueError('Некорректная сумма')
    def day(value):
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError('Некорректная дата')
        if not '2000-01-01' <= value <= '2100-12-31':
            raise ValueError('Дата должна быть между 2000 и 2100 годами')
    money(state.get('balance'), nullable=True, signed=True)
    # Accept old backups, but drop the retired reserve setting.
    state.pop('reserve', None)
    day(state.get('balanceDate'))
    if type(state.get('demo')) is not bool:
        raise ValueError('Некорректный режим данных')
    identifiers = set()
    for collection in ('transactions', 'debts'):
        rows = state.get(collection)
        if not isinstance(rows, list) or len(rows) > 2000:
            raise ValueError('Слишком много записей')
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('Некорректная запись')
            key = row.get('id')
            if not isinstance(key, str) or not key or len(key) > 100 or key in identifiers:
                raise ValueError('Некорректный идентификатор')
            identifiers.add(key)
            if not isinstance(row.get('name'), str) or not row['name'].strip() or len(row['name']) > 120:
                raise ValueError('Укажи название до 120 символов')
            if 'draft' in row and (type(row['draft']) is not bool or collection != 'transactions' or row.get('kind') != 'expense'):
                raise ValueError('Некорректная незаполненная запись')
            incomplete = collection == 'transactions' and row.get('draft') is True
            money(row.get('amount'), nullable=collection == 'debts' or incomplete)
            if collection == 'transactions':
                if row.get('kind') not in ('income', 'expense') or row.get('repeat') not in ('once', 'monthly', 'yearly'):
                    raise ValueError('Некорректный тип операции')
                if row.get('date') is not None or not incomplete:
                    day(row.get('date'))
                if 'day' in row and (row['repeat'] != 'monthly' or type(row['day']) is not int or not 1 <= row['day'] <= 31):
                    raise ValueError('Выбери число платежа от 1 до 31')
            else:
                if row.get('kind') not in ('loan', 'card', 'personal', 'mortgage'):
                    raise ValueError('Некорректный тип долга')
                if row.get('due'):
                    day(row['due'])
    sources = state.get('incomeSources', [])
    if not isinstance(sources, list) or len(sources) > 1000:
        raise ValueError('Некорректные источники дохода')
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError('Некорректный источник дохода')
        key = source.get('id')
        if not isinstance(key, str) or not key or len(key) > 100 or key in identifiers or key + '-advance' in identifiers:
            raise ValueError('Некорректный идентификатор дохода')
        identifiers.update((key, key + '-advance'))
        if not isinstance(source.get('name'), str) or not source['name'].strip() or len(source['name']) > 100:
            raise ValueError('Укажи название источника до 100 символов')
        money(source.get('amount'))
        if source['amount'] <= 0 or source.get('repeat') not in ('once', 'monthly'):
            raise ValueError('Некорректный источник дохода')
        for field in ('taxRate', 'salaryShare'):
            if type(source.get(field)) is not int or not 0 <= source[field] <= 10000:
                raise ValueError('Процент должен быть от 0 до 100')
        if source['repeat'] == 'monthly':
            for field, required in (('salaryDay', source['salaryShare'] > 0), ('advanceDay', source['salaryShare'] < 10000)):
                if required and field in source and (type(source[field]) is not int or not 1 <= source[field] <= 31):
                    raise ValueError('Выбери число выплаты от 1 до 31')
        day(source.get('date'))
        if source['repeat'] == 'monthly' and source['salaryShare'] < 10000:
            day(source.get('advanceDate'))
    completed = state.get('completed')
    if not isinstance(completed, dict) or len(completed) > 20000:
        raise ValueError('Некорректная история')
    for key, value in completed.items():
        if not isinstance(key, str) or len(key) > 160 or not isinstance(value, dict):
            raise ValueError('Некорректная история')
        money(value.get('delta'), signed=True)
        day(value.get('paidOn'))
        if 'balanceDelta' in value:
            money(value['balanceDelta'], signed=True)
        if 'amount' in value:
            money(value['amount'])
        if 'date' in value:
            day(value['date'])
        if 'kind' in value and value['kind'] not in ('income', 'expense'):
            raise ValueError('Некорректная история')
        if 'name' in value and (not isinstance(value['name'], str) or len(value['name']) > 120):
            raise ValueError('Некорректная история')
        if value.get('debtId') is not None:
            if not isinstance(value['debtId'], str) or len(value['debtId']) > 100 or 'amount' not in value:
                raise ValueError('Некорректная история долга')
    debts = {row['id']: row for row in state['debts']}
    scheduled = {}
    for row in state['transactions']:
        loan_id = row.get('loanDebtId')
        if loan_id is not None:
            if (not isinstance(loan_id, str) or loan_id not in debts or
                    debts[loan_id]['kind'] not in ('loan', 'mortgage') or
                    row.get('debtId') is not None or row['kind'] != 'expense' or
                    row['repeat'] not in ('once', 'monthly') or (not row.get('draft') and row['amount'] <= 0)):
                raise ValueError('Некорректный платёж по кредиту')
            if row['repeat'] == 'monthly' and sum(t.get('loanDebtId') == loan_id for t in state['transactions']) > 1:
                raise ValueError('У долга уже есть расписание платежей')
        debt_id = row.get('debtId')
        if debt_id is None:
            continue
        if not isinstance(debt_id, str) or debt_id not in debts:
            raise ValueError('Долг для погашения не найден')
        debt = debts[debt_id]
        if row['kind'] != 'expense' or row['repeat'] != 'once' or (not row.get('draft') and row['amount'] <= 0):
            raise ValueError('Погашение должно быть разовым расходом больше нуля')
        if f"{row['id']}:{row['date']}" in completed:
            continue
        if debt['kind'] not in ('card', 'personal'):
            raise ValueError('Погашения доступны для кредитных карт и личных долгов')
        if row.get('draft'):
            continue
        if debt.get('due') and row['date'] > debt['due']:
            raise ValueError('Запланированное погашение позже срока долга')
        scheduled[debt_id] = scheduled.get(debt_id, 0) + row['amount']
        if debt['amount'] is not None and scheduled[debt_id] > debt['amount']:
            raise ValueError('Погашения превышают остаток долга. Сначала измени план погашений')
    return state


def connect():
    connection = sqlite3.connect(DB, timeout=10)
    connection.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL)')
    connection.execute('INSERT OR IGNORE INTO state VALUES (1, 0, ?)', (json.dumps(empty_state()),))
    connection.commit()
    return connection


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        expected = f'127.0.0.1:{self.server.server_port}'
        hosts = (expected, f'localhost:{self.server.server_port}')
        origin = self.headers.get('Origin')
        return self.headers.get('Host') in hosts and (not origin or origin in tuple('http://' + host for host in hosts))

    def respond(self, code, body, mime='application/json; charset=utf-8'):
        data = json.dumps(body, ensure_ascii=False).encode() if mime.startswith('application/json') else body
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.allowed():
            return self.respond(403, {'error': 'Только локальный доступ'})
        path = self.path.split('?')[0]
        if path == '/api/state':
            with connect() as connection:
                revision, body = connection.execute('SELECT revision, body FROM state WHERE id=1').fetchone()
            state = json.loads(body)
            state.pop('reserve', None)
            return self.respond(200, dict(revision=revision, state=state))
        assets = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'), '/compact.js': ('compact.js', 'text/javascript'), '/finance.js': ('finance.js', 'text/javascript'), '/work-calendar.js': ('work-calendar.js', 'text/javascript'), '/style.css': ('style.css', 'text/css'), '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
        if path not in assets:
            return self.respond(404, {'error': 'Не найдено'})
        filename, mime = assets[path]
        self.respond(200, (ROOT / 'public' / filename).read_bytes(), mime + '; charset=utf-8')

    def do_PUT(self):
        if not self.allowed():
            return self.respond(403, {'error': 'Только локальный доступ'})
        if self.path != '/api/state':
            return self.respond(404, {'error': 'Не найдено'})
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= MAX_BODY:
                raise ValueError('Файл слишком большой или пустой')
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('Требуется JSON')
            payload = json.loads(self.rfile.read(size))
            state = validate(payload['state'])
            with connect() as connection:
                result = connection.execute('UPDATE state SET body=?, revision=revision+1 WHERE id=1 AND revision=?', (json.dumps(state, ensure_ascii=False), payload['revision']))
                if result.rowcount != 1:
                    return self.respond(409, {'error': 'Данные изменены в другой вкладке. Обнови страницу перед сохранением.'})
                revision = connection.execute('SELECT revision FROM state WHERE id=1').fetchone()[0]
            self.respond(200, dict(revision=revision))
        except (ValueError, KeyError, TypeError) as error:
            self.respond(400, {'error': str(error)})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    DB.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(DB.parent, 0o700)
    with connect():
        pass
    os.chmod(DB, 0o600)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'FinRoad → http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
