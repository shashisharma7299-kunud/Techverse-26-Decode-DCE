from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
import hashlib
import json
import os
import secrets
import time


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data_store.json")


DEFAULT_QUESTIONS = [
    {"text": "No meant for crowds yet two often appear where unspoken stories quietly appear.", "answer": "notice board"},
    {"text": "I speak without a mouth and travel without feet. What am I?", "answer": "message"},
    {"text": "Find the key hidden between zero and one, where machines begin to dream.", "answer": "binary"},
    {"text": "I guard every account but hate being shared. What am I?", "answer": "password"},
    {"text": "A tiny square that opens a whole world when scanned.", "answer": "qr code"},
    {"text": "I am a bug that is welcomed only during testing.", "answer": "error"},
    {"text": "The faster I run, the hotter I become inside your computer.", "answer": "processor"},
    {"text": "I remember everything until the power goes away.", "answer": "ram"},
    {"text": "I connect rooms, labs, and phones without a visible wire.", "answer": "wifi"},
    {"text": "I am not a snake, yet coders use me to build quickly.", "answer": "python"},
    {"text": "I turn plain text into secrets and secrets back into plain text.", "answer": "cipher"},
    {"text": "I am the address that helps browsers find a home.", "answer": "url"},
    {"text": "I wear a hash but I am not breakfast. I verify data blocks.", "answer": "checksum"},
    {"text": "I am a chain where every block remembers the last.", "answer": "blockchain"},
    {"text": "I split big problems into small repeatable steps.", "answer": "algorithm"},
    {"text": "I am a map of decisions where every branch asks a question.", "answer": "flowchart"},
    {"text": "I am the cloud's local cousin, sitting quietly in the server room.", "answer": "server"},
    {"text": "I make copies so lost work can return from the past.", "answer": "backup"},
    {"text": "I am the final gate before code joins the main path.", "answer": "pull request"},
    {"text": "I reveal victory by turning confusion into a single answer.", "answer": "decode"},
]


def now_ms():
    return int(time.time() * 1000)


def clean(value):
    return " ".join(str(value or "").strip().lower().split())


def hash_password(password):
    return hashlib.sha256(str(password).encode("utf-8")).hexdigest()


def default_state():
    return {
        "adminPasswordHash": "",
        "gameActive": True,
        "gameMinutes": 45,
        "questions": DEFAULT_QUESTIONS,
        "players": [],
    }


def load_state():
    if not os.path.exists(DATA_FILE):
        state = default_state()
        save_state(state)
        return state

    with open(DATA_FILE, "r", encoding="utf-8") as file:
        state = json.load(file)

    base = default_state()
    base.update(state)
    base["questions"] = state.get("questions") or DEFAULT_QUESTIONS
    base["players"] = state.get("players") or []
    return base


def save_state(state):
    temp_file = DATA_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as file:
        json.dump(state, file, indent=2)
    os.replace(temp_file, DATA_FILE)


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def get_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def public_settings(state):
    return {
        "gameActive": state["gameActive"],
        "gameMinutes": state["gameMinutes"],
        "questionCount": len(state["questions"]),
    }


def penalty(index):
    if index < 10:
        return 1
    if index < 15:
        return 2
    return 3


def question_closed(player, index):
    answers = player.get("answers", {})
    attempts = player.get("attempts", {})
    return answers.get(str(index), {}).get("status") == "correct" or int(attempts.get(str(index), 0)) >= 3


def unlocked_index(state, player):
    for index in range(len(state["questions"])):
        if not question_closed(player, index):
            return index
    return max(0, len(state["questions"]) - 1)


def solved_count(state, player):
    answers = player.get("answers", {})
    return sum(1 for index in range(len(state["questions"])) if answers.get(str(index), {}).get("status") == "correct")


def attempt_count(player):
    return sum(int(value or 0) for value in player.get("attempts", {}).values())


def remaining_ms(player):
    return max(0, int(player.get("endsAt", 0)) - now_ms())


def player_status(player):
    if player.get("forcedEnded"):
        return "Ended by admin"
    if remaining_ms(player) <= 0:
        return "Time over"
    if player.get("submitted"):
        return "Submitted"
    return "Playing"


def safe_player_summary(state, player):
    return {
        "id": player["id"],
        "leaderName": player["leaderName"],
        "teamName": player["teamName"],
        "registrationNo": player["registrationNo"],
        "score": player.get("score", 0),
        "progress": solved_count(state, player),
        "attempts": attempt_count(player),
        "remainingMs": remaining_ms(player),
        "timeLimitMinutes": player.get("timeLimitMinutes", state["gameMinutes"]),
        "status": player_status(player),
        "feedback": player.get("feedback", ""),
        "submitted": bool(player.get("submitted")),
    }


def full_admin_state(state):
    players = [safe_player_summary(state, player) for player in state["players"]]
    leaderboard = sorted(players, key=lambda item: (-item["score"], -item["progress"], item["teamName"].lower()))
    for index, player in enumerate(leaderboard, start=1):
        player["rank"] = index

    return {
        "settings": public_settings(state),
        "hasAdminPassword": bool(state.get("adminPasswordHash")),
        "players": players,
        "leaderboard": leaderboard,
        "questions": state["questions"],
    }


def full_scorecard(state, player):
    rows = []
    for index, question in enumerate(state["questions"]):
        answer = player.get("answers", {}).get(str(index), {})
        rows.append({
            "number": index + 1,
            "question": question["text"],
            "status": answer.get("status", "Locked/Open"),
            "attempts": int(player.get("attempts", {}).get(str(index), 0)),
            "lastAnswer": answer.get("answer", ""),
        })

    summary = safe_player_summary(state, player)
    summary["questions"] = rows
    return summary


def find_player(state, player_id):
    return next((player for player in state["players"] if player["id"] == player_id), None)


def find_player_by_registration(state, registration_no):
    target = clean(registration_no)
    return next((player for player in state["players"] if clean(player.get("registrationNo")) == target), None)


class DecodeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.strip("/").split("/")
        if parsed.path.startswith("/api/"):
            self.handle_api("GET", path, {})
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.strip("/").split("/")
        if parsed.path.startswith("/api/"):
            try:
                self.handle_api("POST", path, get_json(self))
            except json.JSONDecodeError:
                json_response(self, 400, {"error": "Invalid JSON"})
            return
        json_response(self, 404, {"error": "Not found"})

    def handle_api(self, method, path, data):
        state = load_state()

        if path == ["api", "state"] and method == "GET":
            json_response(self, 200, public_settings(state))
            return

        if path == ["api", "player", "login"] and method == "POST":
            self.player_login(state, data)
            return

        if len(path) == 3 and path[:2] == ["api", "player"] and method == "GET":
            self.player_state(state, path[2])
            return

        if len(path) == 4 and path[:2] == ["api", "player"] and path[3] == "begin" and method == "POST":
            self.player_begin(state, path[2])
            return

        if len(path) == 4 and path[:2] == ["api", "player"] and path[3] == "answer" and method == "POST":
            self.player_answer(state, path[2], data)
            return

        if len(path) == 4 and path[:2] == ["api", "player"] and path[3] == "feedback" and method == "POST":
            self.player_feedback(state, path[2], data)
            return

        if path == ["api", "admin", "login"] and method == "POST":
            self.admin_login(state, data)
            return

        if path == ["api", "admin", "dashboard"] and method == "POST":
            if not self.require_admin(state, data):
                return
            json_response(self, 200, full_admin_state(state))
            return

        if path == ["api", "admin", "settings"] and method == "POST":
            if not self.require_admin(state, data):
                return
            self.admin_settings(state, data)
            return

        if path == ["api", "admin", "event"] and method == "POST":
            if not self.require_admin(state, data):
                return
            state["gameActive"] = bool(data.get("gameActive"))
            save_state(state)
            json_response(self, 200, full_admin_state(state))
            return

        if path == ["api", "admin", "questions"] and method == "POST":
            if not self.require_admin(state, data):
                return
            self.admin_questions(state, data)
            return

        if path == ["api", "admin", "clear-players"] and method == "POST":
            if not self.require_admin(state, data):
                return
            state["players"] = []
            save_state(state)
            json_response(self, 200, full_admin_state(state))
            return

        if len(path) == 5 and path[:3] == ["api", "admin", "players"] and method == "POST":
            if not self.require_admin(state, data):
                return
            self.admin_player_action(state, path[3], path[4], data)
            return

        json_response(self, 404, {"error": "API route not found"})

    def require_admin(self, state, data):
        password = data.get("password", "")
        if not state.get("adminPasswordHash") or hash_password(password) != state["adminPasswordHash"]:
            json_response(self, 403, {"error": "Wrong admin password"})
            return False
        return True

    def player_login(self, state, data):
        if not state["gameActive"]:
            json_response(self, 403, {"error": "The event is closed by admin."})
            return

        leader = str(data.get("leaderName", "")).strip()
        team = str(data.get("teamName", "")).strip()
        registration = str(data.get("registrationNo", "")).strip()
        if not leader or not team or not registration:
            json_response(self, 400, {"error": "All fields are required."})
            return

        player = find_player_by_registration(state, registration)
        if not player:
            player = {
                "id": secrets.token_hex(12),
                "leaderName": leader,
                "teamName": team,
                "registrationNo": registration,
                "score": 0,
                "answers": {},
                "attempts": {},
                "timeLimitMinutes": state["gameMinutes"],
                "startedAt": 0,
                "endsAt": 0,
                "feedback": "",
                "forcedEnded": False,
                "submitted": False,
            }
            state["players"].append(player)
            save_state(state)

        json_response(self, 200, {"playerId": player["id"], "settings": public_settings(state)})

    def player_begin(self, state, player_id):
        player = find_player(state, player_id)
        if not player:
            json_response(self, 404, {"error": "Player not found"})
            return
        if player.get("startedAt", 0) == 0:
            player["startedAt"] = now_ms()
            player["endsAt"] = now_ms() + int(player["timeLimitMinutes"]) * 60 * 1000
            save_state(state)
        self.player_state(state, player_id)

    def player_state(self, state, player_id):
        player = find_player(state, player_id)
        if not player:
            json_response(self, 404, {"error": "Player not found"})
            return

        current = unlocked_index(state, player)
        question = state["questions"][current] if state["questions"] else {"text": "No question set.", "answer": ""}
        attempts = int(player.get("attempts", {}).get(str(current), 0))
        answer = player.get("answers", {}).get(str(current), {})
        is_closed = question_closed(player, current)

        payload = {
            "settings": public_settings(state),
            "player": safe_player_summary(state, player),
            "currentQuestion": {
                "index": current,
                "number": current + 1,
                "text": question["text"],
                "attempts": attempts,
                "attemptsLeft": max(0, 3 - attempts),
                "closed": is_closed,
                "solved": answer.get("status") == "correct",
            },
            "questionStatuses": [
                {
                    "number": index + 1,
                    "current": index == current,
                    "locked": index > current,
                    "closed": question_closed(player, index),
                    "solved": player.get("answers", {}).get(str(index), {}).get("status") == "correct",
                }
                for index in range(len(state["questions"]))
            ],
        }
        json_response(self, 200, payload)

    def player_answer(self, state, player_id, data):
        player = find_player(state, player_id)
        if not player:
            json_response(self, 404, {"error": "Player not found"})
            return
        if not state["gameActive"] or player_status(player) != "Playing":
            json_response(self, 403, {"error": "Game is not active for this player."})
            return

        index = unlocked_index(state, player)
        if question_closed(player, index):
            self.player_state(state, player_id)
            return

        guess = str(data.get("answer", "")).strip()
        attempts = int(player.get("attempts", {}).get(str(index), 0)) + 1
        player.setdefault("attempts", {})[str(index)] = attempts
        correct = clean(guess) == clean(state["questions"][index]["answer"])

        if correct:
            player.setdefault("answers", {})[str(index)] = {"status": "correct", "answer": guess}
            player["score"] = int(player.get("score", 0)) + 10
            message = "Correct. Next question unlocked."
        else:
            player.setdefault("answers", {})[str(index)] = {"status": "wrong", "answer": guess}
            deduction = penalty(index)
            player["score"] = int(player.get("score", 0)) - deduction
            left = max(0, 3 - attempts)
            message = f"Incorrect. {left} attempts left. -{deduction} marks."
            if left == 0:
                message = f"Incorrect. Attempts finished. Next question unlocked. -{deduction} marks."

        if all(question_closed(player, q_index) for q_index in range(len(state["questions"]))):
            player["submitted"] = True

        save_state(state)
        response = {"message": message}
        response.update(json.loads(json.dumps(self.make_player_payload(state, player))))
        json_response(self, 200, response)

    def make_player_payload(self, state, player):
        current = unlocked_index(state, player)
        question = state["questions"][current]
        attempts = int(player.get("attempts", {}).get(str(current), 0))
        return {
            "settings": public_settings(state),
            "player": safe_player_summary(state, player),
            "currentQuestion": {
                "index": current,
                "number": current + 1,
                "text": question["text"],
                "attempts": attempts,
                "attemptsLeft": max(0, 3 - attempts),
                "closed": question_closed(player, current),
                "solved": player.get("answers", {}).get(str(current), {}).get("status") == "correct",
            },
            "questionStatuses": [
                {
                    "number": index + 1,
                    "current": index == current,
                    "locked": index > current,
                    "closed": question_closed(player, index),
                    "solved": player.get("answers", {}).get(str(index), {}).get("status") == "correct",
                }
                for index in range(len(state["questions"]))
            ],
        }

    def player_feedback(self, state, player_id, data):
        player = find_player(state, player_id)
        if not player:
            json_response(self, 404, {"error": "Player not found"})
            return
        player["feedback"] = str(data.get("feedback", "")).strip()
        player["submitted"] = True
        save_state(state)
        json_response(self, 200, {"ok": True})

    def admin_login(self, state, data):
        password = str(data.get("password", ""))
        new_password = str(data.get("newPassword", ""))
        if not state.get("adminPasswordHash"):
            if len(new_password) < 4:
                json_response(self, 400, {"error": "Create an admin password with at least 4 characters."})
                return
            state["adminPasswordHash"] = hash_password(new_password)
            save_state(state)
            password = new_password

        if hash_password(password) != state["adminPasswordHash"]:
            json_response(self, 403, {"error": "Wrong admin password"})
            return

        json_response(self, 200, full_admin_state(state))

    def admin_settings(self, state, data):
        minutes = max(1, int(data.get("gameMinutes", state["gameMinutes"])))
        state["gameMinutes"] = minutes

        if data.get("resetAllTimers"):
            for player in state["players"]:
                if player_status(player) == "Playing":
                    player["timeLimitMinutes"] = minutes
                    player["startedAt"] = now_ms()
                    player["endsAt"] = now_ms() + minutes * 60 * 1000
                    player["forcedEnded"] = False
                    player["submitted"] = False

        save_state(state)
        json_response(self, 200, full_admin_state(state))

    def admin_questions(self, state, data):
        questions = []
        for item in data.get("questions", []):
            text = str(item.get("text", "")).strip()
            answer = str(item.get("answer", "")).strip()
            if text and answer:
                questions.append({"text": text, "answer": answer})

        state["questions"] = questions[:20] or [{"text": "Add your first question here.", "answer": "answer"}]
        save_state(state)
        json_response(self, 200, full_admin_state(state))

    def admin_player_action(self, state, player_id, action, data):
        player = find_player(state, player_id)
        if not player:
            json_response(self, 404, {"error": "Player not found"})
            return

        if action == "time":
            minutes = max(1, int(data.get("minutes", player.get("timeLimitMinutes", state["gameMinutes"]))))
            player["timeLimitMinutes"] = minutes
            player["startedAt"] = now_ms()
            player["endsAt"] = now_ms() + minutes * 60 * 1000
            player["forcedEnded"] = False
            player["submitted"] = False
        elif action == "end":
            player["forcedEnded"] = True
            player["submitted"] = True
            player["endsAt"] = now_ms()
        elif action == "restart":
            player["score"] = 0
            player["answers"] = {}
            player["attempts"] = {}
            player["feedback"] = ""
            player["startedAt"] = now_ms()
            player["endsAt"] = now_ms() + int(player.get("timeLimitMinutes", state["gameMinutes"])) * 60 * 1000
            player["forcedEnded"] = False
            player["submitted"] = False
        elif action == "scorecard":
            json_response(self, 200, full_scorecard(state, player))
            return
        else:
            json_response(self, 404, {"error": "Unknown player action"})
            return

        save_state(state)
        json_response(self, 200, full_admin_state(state))


if __name__ == "__main__":
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", "8000"))
    print(f"Decode DCE server running at http://localhost:{port}")
    print("Students on same Wi-Fi should open http://YOUR-LAPTOP-IP:8000")
    ThreadingHTTPServer((host, port), DecodeHandler).serve_forever()
