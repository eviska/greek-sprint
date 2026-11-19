#!/usr/bin/env python3
"""Tiny local web server and JSON store for the Greek Sprint."""

from __future__ import annotations

import json
import mimetypes
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DECK_FILE = DATA / "cards.json"
PROGRESS_FILE = DATA / "progress.json"
STORIES_DIR = DATA / "stories"
HOST = "127.0.0.1"
PORT = 8000


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def load_deck() -> list[dict]:
    deck = json.loads(DECK_FILE.read_text(encoding="utf-8"))
    if not isinstance(deck, list):
        raise ValueError("cards.json must contain a JSON array")
    seen_ids: set[str] = set()
    for index, card in enumerate(deck):
        if not isinstance(card, dict):
            raise ValueError(f"Card at position {index} must be a JSON object")
        card_id = card.get("id")
        try:
            parsed_id = uuid.UUID(card_id)
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError(f"Card at position {index} must have a UUID id") from error
        if parsed_id.version != 4 or str(parsed_id) != card_id.lower():
            raise ValueError(f"Card at position {index} id must be a canonical UUIDv4")
        if card_id in seen_ids:
            raise ValueError(f"Duplicate card id: {card_id}")
        seen_ids.add(card_id)
        if not all(isinstance(card.get(key), str) and card[key] for key in ("greek", "ukrainian", "type", "source")):
            raise ValueError(f"Card {card_id} must include greek, ukrainian, type, and source")
    return deck


def load_stories() -> list[dict]:
    stories = []
    for story_file in sorted(STORIES_DIR.glob("*.json")):
        if story_file.name == "index.json":
            continue
        story = json.loads(story_file.read_text(encoding="utf-8"))
        if not isinstance(story, dict) or not all(isinstance(story.get(key), str) for key in ("id", "title", "perspective")):
            raise ValueError(f"Invalid story metadata in {story_file.name}")
        if not isinstance(story.get("paragraphs"), list) or not all(isinstance(line, str) for line in story["paragraphs"]):
            raise ValueError(f"Story paragraphs must be a list of strings in {story_file.name}")
        stories.append(story)
    return stories


def empty_progress() -> dict:
    return {
        "version": 1,
        "updatedAt": None,
        "totals": {"sessions": 0, "answers": 0, "correct": 0, "incorrect": 0, "best": 0},
        "cards": {},
        "lessons": {},
    }


def load_progress() -> dict:
    if not PROGRESS_FILE.exists():
        save_progress(empty_progress())
    try:
        saved = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        base = empty_progress()
        base.update({key: value for key, value in saved.items() if key in {"version", "updatedAt"}})
        base["totals"].update(saved.get("totals", {}))
        base["cards"] = saved.get("cards", {})
        base["lessons"] = saved.get("lessons", {})
        return base
    except (json.JSONDecodeError, AttributeError, TypeError):
        return empty_progress()


def save_progress(progress: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    progress["updatedAt"] = iso(now_utc())
    temp_file = PROGRESS_FILE.with_suffix(".json.tmp")
    temp_file.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_file.replace(PROGRESS_FILE)


class SprintHandler(BaseHTTPRequestHandler):
    server_version = "GreekSprint/1.0"

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length < 1 or length > 65536:
            raise ValueError("Request body must be between 1 and 65536 bytes")
        try:
            data = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as exc:
            raise ValueError("Request body must be valid JSON") from exc
        if not isinstance(data, dict):
            raise ValueError("Request body must be a JSON object")
        return data

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler method name
        path = unquote(urlparse(self.path).path)
        if path.startswith("/lessons/"):
            lesson_id = path.removeprefix("/lessons/").strip("/")
            lesson_files = json.loads((DATA / "lessons" / "index.json").read_text(encoding="utf-8"))
            known_ids = {
                json.loads((DATA / "lessons" / filename).read_text(encoding="utf-8")).get("id")
                for filename in lesson_files
            }
            if lesson_id not in known_ids:
                self.send_error(404, "Lesson not found")
                return
            path = "/lesson.html"
        if path == "/api/cards":
            self.send_json(load_deck())
            return
        if path == "/api/stories":
            self.send_json(load_stories())
            return
        if path == "/api/progress":
            self.send_json(load_progress())
            return
        if path == "/":
            path = "/index.html"
        file_path = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in file_path.parents or not file_path.is_file():
            self.send_error(404, "Not found")
            return
        content = file_path.read_bytes()
        mime, _ = mimetypes.guess_type(file_path.name)
        if file_path.suffix == ".js":
            mime = "text/javascript"
        self.send_response(200)
        self.send_header("Content-Type", f"{mime or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler method name
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            progress = load_progress()
            if path == "/api/answer":
                self.record_answer(data, progress)
            elif path == "/api/finish":
                self.record_finish(data, progress)
            elif path == "/api/card-status":
                self.update_card_status(data, progress)
            elif path == "/api/lesson-progress":
                self.update_lesson_progress(data, progress)
            else:
                self.send_error(404, "Unknown API endpoint")
                return
            save_progress(progress)
            self.send_json({"ok": True})
        except (ValueError, KeyError, TypeError) as error:
            self.send_json({"error": str(error)}, status=400)

    @staticmethod
    def record_answer(data: dict, progress: dict) -> None:
        card_id = data.get("cardId")
        correct = data.get("correct")
        card_ids = {card.get("id") for card in load_deck()}
        if not isinstance(card_id, str) or card_id not in card_ids:
            raise ValueError("Unknown card id")
        if not isinstance(correct, bool):
            raise ValueError("correct must be true or false")

        now = now_utc()
        state = progress["cards"].setdefault(card_id, {
            "seen": 0, "correct": 0, "incorrect": 0, "streak": 0,
            "intervalDays": 0, "lastSeen": None, "nextDue": None,
        })
        state["seen"] += 1
        state["lastSeen"] = iso(now)
        if correct:
            state["correct"] += 1
            state["streak"] += 1
            intervals = [1, 3, 7, 14, 30]
            state["intervalDays"] = intervals[min(state["streak"] - 1, len(intervals) - 1)]
            progress["totals"]["correct"] += 1
        else:
            state["incorrect"] += 1
            state["streak"] = 0
            state["intervalDays"] = 0.25  # повтор приблизно через шість годин
            progress["totals"]["incorrect"] += 1
        state["nextDue"] = iso(now + timedelta(days=state["intervalDays"]))
        progress["totals"]["answers"] += 1

    @staticmethod
    def record_finish(data: dict, progress: dict) -> None:
        score = data.get("score")
        answers = data.get("answers")
        if not isinstance(score, int) or not isinstance(answers, int) or score < 0 or answers < score:
            raise ValueError("score and answers must be valid non-negative integers")
        progress["totals"]["sessions"] += 1
        progress["totals"]["best"] = max(progress["totals"].get("best", 0), score)

    @staticmethod
    def update_card_status(data: dict, progress: dict) -> None:
        card_id = data.get("cardId")
        status = data.get("status")
        card_ids = {card.get("id") for card in load_deck()}
        if not isinstance(card_id, str) or card_id not in card_ids:
            raise ValueError("Unknown card id")
        if status not in {"active", "paused", "learning"}:
            raise ValueError("status must be active, paused, or learning")

        state = progress["cards"].setdefault(card_id, {
            "seen": 0, "correct": 0, "incorrect": 0, "streak": 0,
            "intervalDays": 0, "lastSeen": None, "nextDue": None,
        })
        state["suspended"] = status == "paused"
        if status == "learning":
            state["streak"] = 0
            state["intervalDays"] = 0
            state["nextDue"] = iso(now_utc())
        elif status == "active" and state.get("seen", 0) == 0:
            state["nextDue"] = None

    @staticmethod
    def update_lesson_progress(data: dict, progress: dict) -> None:
        lesson_id = data.get("lessonId")
        state = data.get("state")
        lesson_files = json.loads((DATA / "lessons" / "index.json").read_text(encoding="utf-8"))
        known_ids = {
            json.loads((DATA / "lessons" / filename).read_text(encoding="utf-8")).get("id")
            for filename in lesson_files
        }
        if not isinstance(lesson_id, str) or lesson_id not in known_ids:
            raise ValueError("Unknown lesson id")
        if not isinstance(state, dict):
            raise ValueError("state must be an object")
        completed = state.get("completed", [])
        attempts = state.get("attempts", {})
        answers = state.get("answers", {})
        draft = state.get("draft", "")
        feedback = state.get("feedback", "")
        if (not isinstance(completed, list) or not all(isinstance(value, str) for value in completed)
                or not isinstance(attempts, dict) or not isinstance(answers, dict)
                or not isinstance(draft, str) or len(draft) > 12000
                or not isinstance(feedback, str) or len(feedback) > 12000):
            raise ValueError("Invalid lesson progress")
        progress.setdefault("lessons", {})[lesson_id] = {
            "completed": completed,
            "attempts": attempts,
            "answers": answers,
            "draft": draft,
            "feedback": feedback,
            "updatedAt": iso(now_utc()),
        }

    def log_message(self, format_string: str, *args: object) -> None:
        # Keep the local server log concise and free of request payloads.
        print(f"{self.log_date_time_string()} {self.command} {self.path} {args[1] if len(args) > 1 else ''}")


if __name__ == "__main__":
    load_deck()
    load_stories()
    load_progress()
    print(f"Грецький спринт відкритий: http://{HOST}:{PORT}")
    print("Зупинити сервер: Ctrl+C")
    try:
        HTTPServer((HOST, PORT), SprintHandler).serve_forever()
    except KeyboardInterrupt:
        print("\nСервер зупинено.")
