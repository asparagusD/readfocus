"""A small in-memory stand-in for the Supabase client, for the ingestion tests.

It understands the calls the ingestion code makes: select, insert, update,
upsert (with on_conflict and ignore_duplicates), eq, in_, lt, is_, order,
limit and execute, plus Storage download. Rows are copied through JSON on
the way in and out, as they would be over HTTP.
"""

import json
from types import SimpleNamespace


def _copy(value):
    return json.loads(json.dumps(value))


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.action = db, name, [], ("select", None)
        self.orders, self.max_rows = [], None

    def select(self, columns="*", count=None):
        return self

    def insert(self, values):
        self.action = ("insert", values)
        return self

    def update(self, values):
        self.action = ("update", values)
        return self

    def upsert(self, values, on_conflict="", ignore_duplicates=False):
        self.action = ("upsert", (values, [k.strip() for k in on_conflict.split(",")], ignore_duplicates))
        return self

    def eq(self, column, value):
        self.filters.append(lambda r: r.get(column) == value)
        return self

    def in_(self, column, values):
        self.filters.append(lambda r: r.get(column) in values)
        return self

    def lt(self, column, value):
        self.filters.append(lambda r: r.get(column) is not None and r[column] < value)
        return self

    def is_(self, column, value):
        assert value == "null"
        self.filters.append(lambda r: r.get(column) is None)
        return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def limit(self, count):
        self.max_rows = count
        return self

    def execute(self):
        self.db.calls.append((self.name, self.action[0]))
        if self.name in self.db.broken:
            raise RuntimeError(f"{self.name} is down")
        rows = self.db.tables.setdefault(self.name, [])
        kind, values = self.action
        if kind == "insert":
            new = [dict(v, id=v.get("id") or self.db.new_id(self.name))
                   for v in _copy(values if isinstance(values, list) else [values])]
            rows.extend(new)
            return SimpleNamespace(data=_copy(new))
        if kind == "upsert":
            given, keys, ignore = values
            written = []
            for value in _copy(given if isinstance(given, list) else [given]):
                same = [r for r in rows if all(r.get(k) == value.get(k) for k in keys)]
                if same and ignore:
                    continue
                if same:
                    same[0].update(value)
                    written.append(same[0])
                else:
                    value.setdefault("id", self.db.new_id(self.name))
                    rows.append(value)
                    written.append(value)
            return SimpleNamespace(data=_copy(written))
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if kind == "update":
            for r in matched:
                r.update(_copy(values))
        for column, desc in reversed(self.orders):
            matched.sort(key=lambda r: r.get(column), reverse=desc)
        if self.max_rows is not None:
            matched = matched[: self.max_rows]
        return SimpleNamespace(data=_copy(matched))


class Bucket:
    def __init__(self, db):
        self.db = db

    def upload(self, file, path, file_options=None):
        self.db.calls.append(("storage", "upload"))
        self.db.files[path] = file

    def download(self, path):
        self.db.calls.append(("storage", "download"))
        return self.db.files[path]


class MemoryDb:
    def __init__(self):
        self.tables, self.calls, self.broken, self.files = {}, [], set(), {}
        self._ids = 0
        self.storage = SimpleNamespace(from_=lambda bucket: Bucket(self))

    def new_id(self, table):
        self._ids += 1
        return f"{table}-{self._ids}"

    def table(self, name):
        return Query(self, name)
