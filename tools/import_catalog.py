"""Merge the nine-column archive CSV into the existing public catalog."""

import argparse
import csv
import json
import re
from pathlib import Path
from tempfile import NamedTemporaryFile

HEADERS = (
    "작품ID", "작품명(원문)", "한글 제목", "작가", "레이블",
    "발매권수", "완결여부", "확인권수", "TMW 번호",
)
UNKNOWN = "미확인"
COMPLETION = {"완결": "completed", "미완결": "ongoing", UNKNOWN: "unknown"}
CATALOG = Path(__file__).resolve().parents[1] / "docs" / "data" / "games.json"
MAX_SAFE_INTEGER = 2**53 - 1


def integer(value, minimum):
    if not re.fullmatch(r"[0-9]+", value):
        raise ValueError(f"정수가 필요합니다 ({value!r})")
    number = int(value)
    if not minimum <= number <= MAX_SAFE_INTEGER:
        raise ValueError(f"{minimum} 이상의 안전한 정수가 필요합니다 ({value!r})")
    return number


def read_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        if tuple(next(reader, [])) != HEADERS:
            raise ValueError("CSV 첫 줄의 9개 열 이름과 순서를 확인하세요.")

        rows = {}
        for cells in reader:
            line = reader.line_num
            try:
                if len(cells) != len(HEADERS) or any(not cell.strip() for cell in cells):
                    raise ValueError("9개 값을 입력하세요. 확인되지 않은 값은 미확인으로 적으세요.")
                catalog_id, original, title, author, label, released, status, confirmed, numbers = (
                    cell.strip() for cell in cells
                )
                if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,99}", catalog_id):
                    raise ValueError(f"잘못된 작품ID ({catalog_id!r})")
                work_id = catalog_id.lower()
                if work_id in rows:
                    raise ValueError(f"중복 작품ID ({catalog_id!r})")
                if status not in COMPLETION:
                    raise ValueError(f"잘못된 완결여부 ({status!r})")
                rows[work_id] = {
                    "catalogId": catalog_id,
                    "original": original,
                    "title": title,
                    "author": author,
                    "label": label,
                    "released": None if released == UNKNOWN else integer(released, 0),
                    "status": COMPLETION[status],
                    "confirmedVolumes": None if confirmed == UNKNOWN else integer(confirmed, 0),
                    "tmwNumbers": {integer(number.strip(), 1) for number in numbers.split(",")},
                }
            except ValueError as error:
                raise ValueError(f"CSV {line}행: {error}") from error
    return rows


def merge_row(work_id, row, existing):
    novel = {**(existing or {"id": work_id, "score": None}), "catalogId": row["catalogId"]}
    for field in ("original", "title", "author", "label"):
        if row[field] != UNKNOWN or not novel.get(field):
            novel[field] = row[field]

    completion = dict(novel.get("completion") or {})
    if row["released"] is not None:
        completion["volumes"] = row["released"]
    if row["status"] != "unknown" or not completion.get("status"):
        completion["status"] = row["status"]
    novel["completion"] = completion

    if row["confirmedVolumes"] is not None:
        novel["confirmedVolumes"] = row["confirmedVolumes"]
    novel["tmwNumbers"] = sorted(set(novel.get("tmwNumbers") or ()) | row["tmwNumbers"])
    return novel


def merge_catalog(data, rows):
    if data.get("version") != 1 or not isinstance(data.get("novels"), list):
        raise ValueError("지원하지 않는 아카이브 데이터 형식입니다.")

    novels = {novel["id"]: novel for novel in data["novels"]}
    if len(novels) != len(data["novels"]):
        raise ValueError("현재 아카이브에 중복 작품ID가 있습니다.")

    added = updated = 0
    for work_id, row in rows.items():
        existing = novels.get(work_id)
        merged = merge_row(work_id, row, existing)
        if existing is None:
            added += 1
        elif merged != existing:
            updated += 1
        novels[work_id] = merged
    return {**data, "novels": list(novels.values())}, added, updated


def replace_catalog(path, old_bytes, data):
    with NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        try:
            temporary.write((json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        except Exception:
            temporary.close()
            temporary_path.unlink(missing_ok=True)
            raise
    try:
        if path.read_bytes() != old_bytes:
            raise ValueError("가져오는 동안 아카이브가 변경됐습니다. 최신 상태에서 다시 실행하세요.")
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        old_bytes = args.catalog.read_bytes()
        merged, added, updated = merge_catalog(json.loads(old_bytes), read_rows(args.csv_file))
        if (added or updated) and not args.dry_run:
            replace_catalog(args.catalog, old_bytes, merged)
    except (OSError, ValueError, csv.Error, TypeError, KeyError, AttributeError) as error:
        parser.exit(1, f"가져오기 실패: {error}\n")

    print(f"추가 {added}건, 갱신 {updated}건, 전체 {len(merged['novels'])}건")


if __name__ == "__main__":
    main()
