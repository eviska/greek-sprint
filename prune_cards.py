#!/usr/bin/env python3
"""Move well-known cards out of the active Greek Sprint deck."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DECK_FILE = DATA_DIR / "cards.json"
PROGRESS_FILE = DATA_DIR / "progress.json"
ARCHIVE_FILE = DATA_DIR / "retired-cards.json"
MIN_CORRECT = 5


def read_json(path: Path, expected_type: type) -> Any:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"Не знайдено файл: {path.relative_to(ROOT)}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Некоректний JSON у {path.relative_to(ROOT)}: {error}") from error
    if not isinstance(value, expected_type):
        raise SystemExit(f"Неправильний формат {path.relative_to(ROOT)}: очікується {expected_type.__name__}.")
    return value


def write_json_atomic(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=f"Архівує картки щонайменше з {MIN_CORRECT} правильними відповідями."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="лише показати картки для архівування, не змінюючи файли",
    )
    args = parser.parse_args()

    deck = read_json(DECK_FILE, list)
    progress = read_json(PROGRESS_FILE, dict)
    progress_cards = progress.get("cards", {})
    if not isinstance(progress_cards, dict):
        raise SystemExit("Некоректний формат progress.json: поле cards має бути об'єктом.")

    archive = read_json(ARCHIVE_FILE, list) if ARCHIVE_FILE.exists() else []
    archive_by_id: dict[str, dict[str, Any]] = {}
    for card in archive:
        if not isinstance(card, dict) or not isinstance(card.get("id"), str):
            raise SystemExit("Некоректний запис у data/retired-cards.json: кожна картка має містити id.")
        if card["id"] in archive_by_id:
            raise SystemExit(f"Повторний ID у data/retired-cards.json: {card['id']}")
        archive_by_id[card["id"]] = card

    selected: list[dict[str, Any]] = []
    remaining: list[dict[str, Any]] = []
    for card in deck:
        if not isinstance(card, dict) or not isinstance(card.get("id"), str):
            raise SystemExit("Некоректна картка у data/cards.json: кожна картка має містити id.")
        state = progress_cards.get(card["id"], {})
        correct = state.get("correct", 0) if isinstance(state, dict) else 0
        suspended = state.get("suspended", False) if isinstance(state, dict) else False
        if (
            not suspended
            and isinstance(correct, int)
            and not isinstance(correct, bool)
            and correct >= MIN_CORRECT
        ):
            selected.append(card)
        else:
            remaining.append(card)

    selected.sort(key=lambda card: card.get("greek", "").casefold())
    if args.dry_run:
        print("Попередній перегляд: файли не змінено.")
    if not selected:
        print("Немає активних карток із п’ятьма або більше правильними відповідями.")
        return

    for card in selected:
        correct = progress_cards[card["id"]]["correct"]
        print(f"{card.get('greek', '(без грецького тексту)')} — {card.get('ukrainian', '')} ({correct} правильних)")
    print(f"Карток для перенесення до архіву: {len(selected)}")

    if args.dry_run:
        return

    for card in selected:
        archive_by_id.setdefault(card["id"], card)
    archived = sorted(archive_by_id.values(), key=lambda card: card.get("greek", "").casefold())

    # Write the archive first: an interruption can leave a duplicate, but cannot lose a card.
    write_json_atomic(ARCHIVE_FILE, archived)
    write_json_atomic(DECK_FILE, remaining)
    print(f"Перенесено {len(selected)} карток. Статистику в progress.json збережено.")


if __name__ == "__main__":
    main()
