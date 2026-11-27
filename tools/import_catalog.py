"""Merge archive CSVs into the existing public catalog."""

import argparse
import csv
import json
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit

HEADERS = (
    "작품ID", "작품명(원문)", "한글 제목", "작가", "레이블",
    "발매권수", "완결여부", "확인권수", "TMW 번호",
)
VOLUME_HEADERS = ("작품ID", "확인 권 식별자", "TMW 번호")
COVER_HEADERS = ("작품ID", "표지 이미지 URL", "표지 출처 URL")
RATING_HEADERS = ("work_id", "value", "scale", "votes", "source", "basis")
PEEPO_HEADER = "Peepo 번호"
PART_FIELDS = ("tmwNumbers", "peepoNumbers")
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


def part_numbers(value):
    if not value or value == UNKNOWN:
        return set()
    return {integer(number.strip(), 1) for number in value.split(",")}


def read_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        headers = tuple(next(reader, []))
        if headers not in (HEADERS, HEADERS + (PEEPO_HEADER,)):
            raise ValueError("작품 CSV의 9개 또는 10개 열 이름과 순서를 확인하세요.")

        rows = {}
        for cells in reader:
            line = reader.line_num
            try:
                values = [cell.strip() for cell in cells]
                if len(values) != len(headers) or not all(values[:8]):
                    raise ValueError("작품 CSV의 값을 확인하세요. 확인되지 않은 항목은 미확인으로 적으세요.")
                catalog_id, original, title, author, label, released, status, confirmed = values[:8]
                tmw_numbers = part_numbers(values[8])
                peepo_numbers = part_numbers(values[9]) if len(headers) == 10 else set()
                if not tmw_numbers and not peepo_numbers:
                    raise ValueError("TMW 또는 Peepo에 확인한 차수를 입력하세요.")
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
                    "tmwNumbers": tmw_numbers,
                    "peepoNumbers": peepo_numbers,
                }
            except ValueError as error:
                raise ValueError(f"CSV {line}행: {error}") from error
    return rows


def read_volume_ledger(path, rows):
    labels_by_work = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        headers = tuple(next(reader, []))
        if headers not in (VOLUME_HEADERS, VOLUME_HEADERS + (PEEPO_HEADER,)):
            raise ValueError("권별 기록의 3개 또는 4개 열 이름과 순서를 확인하세요.")
        for cells in reader:
            try:
                if len(cells) != len(headers):
                    raise ValueError("권별 기록의 열 개수를 확인하세요.")
                catalog_id, label, *parts = (cell.strip() for cell in cells)
                work_id = catalog_id.lower()
                if work_id not in rows:
                    raise ValueError(f"작품 CSV에 없는 작품ID ({catalog_id!r})")
                archive_parts = [
                    (field, number) for field, number in zip(PART_FIELDS, parts)
                    if number and number != UNKNOWN
                ]
                if len(archive_parts) != 1:
                    raise ValueError("행마다 TMW 번호 또는 Peepo 번호 하나를 입력하세요.")
                field, number = archive_parts[0]
                if integer(number, 1) not in rows[work_id][field]:
                    raise ValueError(f"작품 CSV에 없는 출처 차수 ({number!r})")
                if not label or label == UNKNOWN:
                    raise ValueError("실제로 확인한 권 식별자를 입력하세요.")
                numeric = re.fullmatch(r"([0-9]+)(\.[0-9]+)?", label)
                if numeric:
                    label = (numeric[1].lstrip("0") or "0") + (numeric[2] or "")
                labels_by_work.setdefault(work_id, set()).add(label)
            except ValueError as error:
                raise ValueError(f"권별 기록 {reader.line_num}행: {error}") from error
    return labels_by_work


def public_https_url(value):
    if not re.fullmatch(r"https://[^\s\\\x00-\x1f\x7f]+", value, re.IGNORECASE):
        raise ValueError("URL은 공개 HTTPS 주소여야 합니다.")
    parsed = urlsplit(value)
    if not parsed.hostname or parsed.username is not None or parsed.password is not None:
        raise ValueError("URL의 호스트와 인증 정보 포함 여부를 확인하세요.")
    # Accessing the port validates any explicit port string.
    if parsed.port == 0:
        raise ValueError("URL의 포트를 확인하세요.")
    return value


def read_covers(path):
    covers = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        if tuple(next(reader, [])) != COVER_HEADERS:
            raise ValueError("표지 CSV의 3개 열 이름과 순서를 확인하세요.")
        for cells in reader:
            try:
                if len(cells) != len(COVER_HEADERS):
                    raise ValueError("표지 CSV의 열 개수를 확인하세요.")
                catalog_id, url, source_url = (cell.strip() for cell in cells)
                work_id = catalog_id.lower()
                if not work_id or work_id in covers:
                    raise ValueError(f"표지 CSV의 작품ID를 확인하세요 ({catalog_id!r})")
                covers[work_id] = {"url": public_https_url(url), "source": public_https_url(source_url)}
            except ValueError as error:
                raise ValueError(f"표지 CSV {reader.line_num}행: {error}") from error
    return covers


def read_ratings(path):
    ratings = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        if tuple(next(reader, [])) != RATING_HEADERS:
            raise ValueError("평점 CSV의 열 이름과 순서를 확인하세요.")
        for cells in reader:
            try:
                if len(cells) != len(RATING_HEADERS):
                    raise ValueError("평점 CSV의 열 개수를 확인하세요.")
                catalog_id, value, scale, votes, url, basis = (cell.strip() for cell in cells)
                work_id = catalog_id.lower()
                if not work_id or work_id in ratings:
                    raise ValueError(f"평점 CSV의 작품ID를 확인하세요 ({catalog_id!r})")
                if any(not re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{1,6})?", v) for v in (value, scale)):
                    raise ValueError("원점수와 만점은 양수여야 합니다.")
                raw, maximum = Decimal(value), Decimal(scale)
                if not 0 < raw <= maximum:
                    raise ValueError("원점수가 만점 이하여야 합니다.")
                score = (raw * 10 / maximum).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
                rating = {"value": float(raw), "scale": float(maximum), "source": public_https_url(url)}
                if votes:
                    rating["count"] = integer(votes, 1)
                if basis:
                    rating["basis"] = basis
                ratings[work_id] = {"score": float(score), "rating": rating}
            except ValueError as error:
                raise ValueError(f"평점 CSV {reader.line_num}행: {error}") from error
    return ratings


def volume_sort_key(label):
    numbered = re.match(r"([0-9]+(?:\.[0-9]+)?)(.*)", label)
    if numbered:
        return (0, Decimal(numbered[1]), numbered[2], label)
    split_volume_order = {"上": 0, "上巻": 0, "中": 1, "中巻": 1, "下": 2, "下巻": 2}
    return (1, split_volume_order.get(label, 3), "", label)


def format_volumes(labels):
    segments = []
    start = end = None
    for label in sorted(labels, key=volume_sort_key):
        number = int(label) if re.fullmatch(r"[0-9]+", label) else None
        if end is not None and number == end + 1:
            end = number
            continue
        if start is not None:
            segments.append(f"{start:02}" if start == end else f"{start:02}~{end:02}")
        start = end = number
        if number is None:
            decimal = re.fullmatch(r"([0-9]+)(\.[0-9]+)", label)
            segments.append(decimal[1].zfill(2) + decimal[2] if decimal else label)
    if start is not None:
        segments.append(f"{start:02}" if start == end else f"{start:02}~{end:02}")
    return ", ".join(segments)


def merge_row(work_id, row, existing, volume_labels):
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

    previous_count = novel.get("confirmedVolumes")
    if row["confirmedVolumes"] is not None:
        novel["confirmedVolumes"] = row["confirmedVolumes"]
    count = novel.get("confirmedVolumes")
    if volume_labels is not None:
        if volume_labels and (count is None or len(volume_labels) > count):
            raise ValueError(f"{row['catalogId']}의 확인권수와 권별 기록을 확인하세요.")
        if volume_labels and len(volume_labels) == count:
            novel["confirmedVolumeDisplay"] = format_volumes(volume_labels)
        else:
            novel.pop("confirmedVolumeDisplay", None)
    elif previous_count != count:
        novel.pop("confirmedVolumeDisplay", None)
    for field in PART_FIELDS:
        if row[field]:
            novel[field] = sorted(set(novel.get(field) or ()) | row[field])
    return novel


def merge_catalog(data, rows, volume_ledger=None, covers=None, ratings=None):
    if data.get("version") != 1 or not isinstance(data.get("novels"), list):
        raise ValueError("지원하지 않는 아카이브 데이터 형식입니다.")

    novels = {novel["id"]: novel for novel in data["novels"]}
    if len(novels) != len(data["novels"]):
        raise ValueError("현재 아카이브에 중복 작품ID가 있습니다.")
    existing_ids = set(novels)

    added = 0
    updated = set()
    for work_id, row in rows.items():
        existing = novels.get(work_id)
        labels = None if volume_ledger is None else volume_ledger.get(work_id, ())
        merged = merge_row(work_id, row, existing, labels)
        if existing is None:
            added += 1
        elif merged != existing:
            updated.add(work_id)
        novels[work_id] = merged

    for work_id, cover in (covers or {}).items():
        if work_id not in novels:
            raise ValueError(f"아카이브와 작품 CSV에 없는 표지 작품ID ({work_id!r})")
        if novels[work_id].get("cover") != cover:
            novels[work_id] = {**novels[work_id], "cover": cover}
            if work_id in existing_ids:
                updated.add(work_id)
    for work_id, rating in (ratings or {}).items():
        if work_id not in novels:
            raise ValueError(f"아카이브와 작품 CSV에 없는 평점 작품ID ({work_id!r})")
        previous = novels[work_id]
        merged = {**previous, **rating}
        if merged != previous and work_id in existing_ids:
            updated.add(work_id)
        novels[work_id] = merged
    return {**data, "novels": list(novels.values())}, added, len(updated)


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
    parser.add_argument("csv_file", type=Path, nargs="?")
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--volume-ledger", type=Path)
    parser.add_argument("--covers", type=Path)
    parser.add_argument("--ratings", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if (not any((args.csv_file, args.covers, args.ratings))) or (args.volume_ledger and not args.csv_file):
        parser.error("작품 CSV, --covers, --ratings 중 하나가 필요합니다. --volume-ledger는 작품 CSV와 함께 사용합니다.")

    try:
        old_bytes = args.catalog.read_bytes()
        rows = read_rows(args.csv_file) if args.csv_file else {}
        volume_ledger = read_volume_ledger(args.volume_ledger, rows) if args.volume_ledger else None
        covers = read_covers(args.covers) if args.covers else None
        ratings = read_ratings(args.ratings) if args.ratings else None
        merged, added, updated = merge_catalog(json.loads(old_bytes), rows, volume_ledger, covers, ratings)
        if (added or updated) and not args.dry_run:
            replace_catalog(args.catalog, old_bytes, merged)
    except (OSError, ValueError, csv.Error, TypeError, KeyError, AttributeError) as error:
        parser.exit(1, f"가져오기 실패: {error}\n")

    print(f"추가 {added}건, 갱신 {updated}건, 전체 {len(merged['novels'])}건")


if __name__ == "__main__":
    main()
