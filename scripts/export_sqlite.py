"""One-time, read-only export from the old SQLite database. Does not start a server."""
import argparse
import json
import sqlite3
from pathlib import Path

def export_database(database, output):
    with sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True) as conn:
        row = conn.execute('SELECT body FROM state WHERE id=1').fetchone()
    if row is None:
        raise ValueError('В базе нет записей FinRoad')
    state = json.loads(row[0])
    # Exclusive creation protects an existing backup from accidental replacement.
    with Path(output).open('x', encoding='utf-8') as target:
        target.write(json.dumps(state, ensure_ascii=False, indent=2))
    Path(output).chmod(0o600)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    export_database(args.database, args.output)
    print(f'Экспорт сохранён: {args.output}')
