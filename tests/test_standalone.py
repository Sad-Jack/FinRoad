import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

class StandaloneTest(unittest.TestCase):
    def test_distributed_file_matches_sources_and_has_no_external_dependencies(self):
        html = module('build_standalone').build()
        self.assertEqual((ROOT / 'FinRoad.html').read_text(), html)
        self.assertNotIn('type="module"', html)
        self.assertNotIn('src="/', html)
        self.assertNotIn('/api/state', html)
        self.assertNotIn('fetch(', html)
        self.assertIn("connect-src 'none'", html)

    def test_demo_has_an_explicit_temporary_mode_and_download_is_an_empty_app(self):
        builder = module('build_standalone')
        demo, standalone = builder.build(demo=True), builder.build()
        self.assertIn('<body data-demo="true">', demo)
        self.assertIn('download="FinRoad.html"', demo)
        self.assertIn('data-action="reset-demo"', demo)
        self.assertNotIn('<body data-demo="true">', standalone)
        self.assertNotIn('class="demo-intro"', standalone)
        self.assertNotIn('type="module"', demo)
        self.assertIn("connect-src 'none'", demo)

    def test_export_keeps_original_database_and_existing_backup_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, output = Path(tmp) / 'old.sqlite3', Path(tmp) / 'backup.json'
            data = {'schema': 1, 'name': 'Synthetic fixture'}
            with sqlite3.connect(db) as conn:
                conn.execute('CREATE TABLE state (id INTEGER, body TEXT)')
                conn.execute('INSERT INTO state VALUES (1, ?)', (json.dumps(data),))
            before = db.read_bytes()
            exporter = module('export_sqlite')
            exporter.export_database(db, output)
            self.assertEqual(json.loads(output.read_text()), data)
            self.assertEqual(db.read_bytes(), before)
            with self.assertRaises(FileExistsError):
                exporter.export_database(db, output)

    def test_missing_database_does_not_create_an_empty_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'missing.sqlite3'
            with self.assertRaises(sqlite3.OperationalError):
                module('export_sqlite').export_database(db, Path(tmp) / 'backup.json')
            self.assertFalse(db.exists())
