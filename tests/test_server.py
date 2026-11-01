import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import server


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        server.DB = Path(self.temp.name) / 'test.sqlite3'
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, data=None, extra=None):
        request = Request(self.url + '/api/state', data=json.dumps(data).encode() if data else None, headers={'Content-Type': 'application/json', **(extra or {})}, method='PUT' if data else 'GET')
        try:
            with urlopen(request) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_persistence_and_conflict(self):
        code, original = self.request()
        self.assertEqual(code, 200)
        original['state']['balance'] = 12345
        self.assertEqual(self.request(original)[0], 200)
        self.assertEqual(self.request()[1]['state']['balance'], 12345)
        self.assertEqual(self.request(original)[0], 409)
        with server.connect() as db:
            persisted = json.loads(db.execute('SELECT body FROM state').fetchone()[0])
        self.assertEqual(persisted['balance'], 12345)

    def test_rejects_external_origin_and_host(self):
        self.assertEqual(self.request(extra={'Origin': 'https://example.org'})[0], 403)
        self.assertEqual(self.request(extra={'Host': 'example.org'})[0], 403)

    def test_rejects_invalid_import_without_overwriting(self):
        payload = self.request()[1]
        payload['state']['balance'] = '1000'
        self.assertEqual(self.request(payload)[0], 400)
        self.assertIsNone(self.request()[1]['state']['balance'])

    def test_old_backup_reserve_is_removed_without_changing_balance(self):
        payload = self.request()[1]
        payload['state'].update(balance=8500000, reserve=1000000)
        self.assertEqual(self.request(payload)[0], 200)
        restored = self.request()[1]['state']
        self.assertEqual(restored['balance'], 8500000)
        self.assertNotIn('reserve', restored)

    def test_rejects_duplicate_ids_and_invalid_dates(self):
        state = server.empty_state()
        item = dict(id='one', name='Rent', amount=100, kind='expense', repeat='monthly', date='2026-02-31')
        state['transactions'] = [item]
        with self.assertRaises(ValueError):
            server.validate(state)
        item['date'] = '2026-02-28'
        state['transactions'].append(item.copy())
        with self.assertRaises(ValueError):
            server.validate(state)

    def test_loan_schedule_validation_and_persistence(self):
        payload = self.request()[1]
        state = payload['state']
        state['debts'] = [dict(id='loan', name='Loan', kind='loan', amount=500, due=None)]
        state['transactions'] = [dict(id='payment', loanDebtId='loan', name='Loan', kind='expense', repeat='monthly', amount=1000, date='2026-11-05')]
        self.assertEqual(self.request(payload)[0], 200)
        self.assertEqual(self.request()[1]['state']['transactions'][0]['loanDebtId'], 'loan')
        for patch in [dict(loanDebtId='missing'), dict(kind='income'), dict(repeat='yearly'), dict(amount=0), dict(debtId='loan')]:
            candidate = json.loads(json.dumps(state))
            candidate['transactions'][0].update(patch)
            with self.assertRaises(ValueError):
                server.validate(candidate)
        candidate = json.loads(json.dumps(state))
        candidate['transactions'].append(dict(candidate['transactions'][0], id='duplicate'))
        with self.assertRaises(ValueError):
            server.validate(candidate)

    def test_multiple_dated_loan_payments_persist(self):
        payload = self.request()[1]
        state = payload['state']
        state['debts'] = [dict(id='loan', name='Loan', kind='loan', amount=3400000, due=None)]
        state['transactions'] = [dict(id='first', loanDebtId='loan', name='Loan', kind='expense', repeat='once', amount=700000, date='2026-11-08'), dict(id='second', loanDebtId='loan', name='Loan', kind='expense', repeat='once', amount=1200000, date='2026-11-23')]
        self.assertEqual(self.request(payload)[0], 200)
        self.assertEqual(self.request()[1]['state']['transactions'], state['transactions'])
        state['transactions'][0]['repeat'] = 'monthly'
        with self.assertRaises(ValueError):
            server.validate(state)

    def test_optional_payment_fields_persist(self):
        payload = self.request()[1]
        state = payload['state']
        state['debts'] = [dict(id='loan', name='Loan', kind='loan', amount=None, due=None)]
        state['transactions'] = [dict(id='partial', loanDebtId='loan', name='Loan', kind='expense', repeat='once', amount=12345, date=None, draft=True), dict(id='empty', name='Personal', kind='expense', repeat='once', amount=None, date=None, draft=True)]
        self.assertEqual(self.request(payload)[0], 200)
        self.assertEqual(self.request()[1]['state']['transactions'], state['transactions'])
        self.assertIsNone(self.request()[1]['state']['debts'][0]['amount'])
        state['transactions'][0].pop('draft')
        with self.assertRaises((ValueError, TypeError)):
            server.validate(state)

    def test_payment_day_validation_and_persistence(self):
        payload = self.request()[1]
        payload['state']['transactions'] = [dict(id='bill', name='Bill', kind='expense', repeat='monthly', amount=1000, date='2026-11-01', day=31)]
        self.assertEqual(self.request(payload)[0], 200)
        self.assertEqual(self.request()[1]['state']['transactions'][0]['day'], 31)
        for patch in [dict(day=0), dict(day=32), dict(day=1.5), dict(day='10'), dict(repeat='once')]:
            candidate = json.loads(json.dumps(payload['state']))
            candidate['transactions'][0].update(patch)
            with self.assertRaises(ValueError):
                server.validate(candidate)

    def test_income_sources_persist_and_validate(self):
        payload = self.request()[1]
        source = dict(id='job', name='Job', amount=10000000, taxRate=1300, salaryShare=5000, repeat='monthly', date='2026-11-01', advanceDate='2026-11-01', salaryDay=10, advanceDay=31)
        payload['state']['incomeSources'] = [source]
        self.assertEqual(self.request(payload)[0], 200)
        self.assertEqual(self.request()[1]['state']['incomeSources'], [source])
        for patch in [dict(taxRate=10001), dict(salaryShare=-1), dict(taxRate=1.5), dict(advanceDate=None), dict(date='2026-02-30'), dict(amount=0), dict(repeat='yearly'), dict(salaryDay=0), dict(advanceDay=32), dict(salaryDay=10.5), dict(salaryDay='10')]:
            candidate = json.loads(json.dumps(payload['state']))
            candidate['incomeSources'][0].update(patch)
            with self.assertRaises(ValueError):
                server.validate(candidate)
        candidate = json.loads(json.dumps(payload['state']))
        candidate['transactions'] = [dict(id='job-advance', name='Collision', amount=100, kind='income', repeat='once', date='2026-11-10')]
        with self.assertRaises(ValueError):
            server.validate(candidate)

    def test_repayment_validation_and_persistence(self):
        payload = self.request()[1]
        state = payload['state']
        state['debts'] = [dict(id='friend', name='Friend', kind='personal', amount=5000, due='2026-11-30')]
        state['transactions'] = [dict(id='pay', debtId='friend', name='Friend', kind='expense', repeat='once', amount=2000, date='2026-11-10')]
        self.assertEqual(self.request(payload)[0], 200)
        self.assertEqual(self.request()[1]['state']['transactions'][0]['debtId'], 'friend')
        for patch in [dict(amount=5001), dict(repeat='monthly'), dict(kind='income'), dict(date='2026-12-01'), dict(debtId='missing')]:
            candidate = json.loads(json.dumps(state))
            candidate['transactions'][0].update(patch)
            with self.assertRaises(ValueError):
                server.validate(candidate)
        candidate = json.loads(json.dumps(state))
        candidate['transactions'].append(dict(candidate['transactions'][0], id='second', amount=4000))
        with self.assertRaises(ValueError):
            server.validate(candidate)
        self.assertEqual(self.request()[1]['state']['transactions'][0]['amount'], 2000)


if __name__ == '__main__':
    unittest.main()
