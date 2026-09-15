import hashlib
import json
import os
import re
import queue
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import zipfile
import xml.etree.ElementTree as ET
from threading import Thread
from datetime import datetime

# The attendance export is always rewritten to the same file.
EXCEL_PATH = r"A:\RMC_Local_Installer\payload\public\uploads\attendance_exports\latest_attendance_export.xlsx"
STATE_PATH = os.path.join(os.path.dirname(EXCEL_PATH), ".absentee_monitor_state.json")

# SMS8 API settings.
SMS8_API_URL = os.getenv("SMS8_API_URL", "https://app.sms8.io/services/send.php").strip()
SMS8_API_KEY = os.getenv("SMS8_API_KEY", "").strip()
SMS8_DEVICE_IDS_RAW = os.getenv("SMS8_DEVICE_IDS", "").strip()
SMS8_USE_RANDOM_DEVICE = os.getenv("SMS8_USE_RANDOM_DEVICE", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
SMS8_PRIORITY = os.getenv("SMS8_PRIORITY", "0").strip() or "0"
SMS8_MESSAGE_TYPE = os.getenv("SMS8_MESSAGE_TYPE", "sms").strip() or "sms"

PROCESS_EXISTING_ON_START = os.getenv("ABSENTEE_PROCESS_EXISTING_ON_START", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
MAX_READ_RETRIES = max(1, int(os.getenv("ABSENTEE_READ_RETRIES", "5")))
READ_RETRY_DELAY_SECONDS = max(1, int(os.getenv("ABSENTEE_READ_RETRY_DELAY_SECONDS", "2")))
TRIGGER_HOST = os.getenv("ABSENTEE_TRIGGER_HOST", "127.0.0.1").strip() or "127.0.0.1"
TRIGGER_PORT = max(1, int(os.getenv("ABSENTEE_TRIGGER_PORT", "8765")))
TRIGGER_PATH = os.getenv("ABSENTEE_TRIGGER_PATH", "/trigger").strip() or "/trigger"

NS_MAIN = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
NS_REL = {"r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def log(message, level="INFO"):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{level}] {message}", flush=True)


def env_flag(name, default=False):
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def normalize_text(value):
    return str(value or "").strip()


def normalize_phone(value):
    digits = re.sub(r"\D+", "", normalize_text(value))
    if not digits:
        return ""
    if len(digits) > 10:
        # The app stores Indian numbers in multiple formats; keeping the last 10 digits
        # matches the existing approval logic in the main portal.
        digits = digits[-10:]
    return digits


def format_sms8_number(value):
    raw = normalize_text(value)
    if not raw:
        return ""
    if raw.startswith("+"):
        return raw
    digits = re.sub(r"\D+", "", raw)
    if len(digits) == 10:
        return f"+91{digits}"
    if digits.startswith("91") and len(digits) == 12:
        return f"+{digits}"
    return f"+{digits}" if digits else ""


def build_sms8_number_variants(value):
    raw = normalize_text(value)
    digits = re.sub(r"\D+", "", raw)
    if not digits:
        return []
    # SMS8's documented API examples use the local mobile number without a +91 prefix.
    return [digits[-10:]]


def hash_text(value):
    return hashlib.sha1(normalize_text(value).encode("utf-8")).hexdigest()


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as handle:
            state = json.load(handle)
            if isinstance(state, dict):
                state.setdefault("sent_row_keys", {})
                return state
    except FileNotFoundError:
        pass
    except Exception as exc:
        log(f"State file could not be read: {exc}", level="WARN")
    return {"sent_row_keys": {}}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)


def column_index(cell_reference):
    letters = re.sub(r"\d+", "", normalize_text(cell_reference)).upper()
    result = 0
    for char in letters:
        result = result * 26 + (ord(char) - 64)
    return max(0, result - 1)


def load_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []

    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings = []
    for si in root.findall("m:si", NS_MAIN):
        pieces = []
        for node in si.iter():
            if node.tag.endswith("}t") and node.text:
                pieces.append(node.text)
        strings.append("".join(pieces))
    return strings


def collect_cell_text(node):
    pieces = []
    for part in node.iter():
        if part.tag.endswith("}t") and part.text:
            pieces.append(part.text)
    return normalize_text("".join(pieces))


def resolve_sheet_path(zf):
    # The export currently has one sheet, but resolving it through workbook.xml keeps
    # the parser resilient if that changes later.
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    sheet = workbook.find("m:sheets/m:sheet", NS_MAIN)
    if sheet is None:
        return "xl/worksheets/sheet1.xml"

    rel_id = sheet.attrib.get(f"{{{NS_REL['r']}}}id")
    if not rel_id or "xl/_rels/workbook.xml.rels" not in zf.namelist():
        return "xl/worksheets/sheet1.xml"

    rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    for rel in rels_root:
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib.get("Target", "")
            if target.startswith("/"):
                target = target.lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"
            return target
    return "xl/worksheets/sheet1.xml"


def extract_cell_value(cell, shared_strings):
    cell_type = cell.attrib.get("t", "")
    value_node = cell.find("m:v", NS_MAIN)
    inline_text = cell.find(".//m:t", NS_MAIN)

    if cell_type == "s" and value_node is not None and value_node.text is not None:
        try:
            index = int(value_node.text)
            return normalize_text(shared_strings[index]) if 0 <= index < len(shared_strings) else ""
        except ValueError:
            return ""

    if cell_type == "inlineStr" and inline_text is not None:
        return collect_cell_text(cell)

    if value_node is not None and value_node.text is not None:
        return normalize_text(value_node.text)

    return ""


def read_workbook_rows(xlsx_path):
    with zipfile.ZipFile(xlsx_path) as archive:
        shared_strings = load_shared_strings(archive)
        sheet_path = resolve_sheet_path(archive)
        sheet_root = ET.fromstring(archive.read(sheet_path))

    rows = []
    for row_node in sheet_root.findall(".//m:sheetData/m:row", NS_MAIN):
        row_values = []
        for cell in row_node.findall("m:c", NS_MAIN):
            cell_ref = cell.attrib.get("r", "")
            idx = column_index(cell_ref)
            while len(row_values) <= idx:
                row_values.append("")
            row_values[idx] = extract_cell_value(cell, shared_strings)
        rows.append(row_values)
    return rows


def clean_header(value):
    return re.sub(r"\s+", " ", normalize_text(value)).strip().lower()


def find_header_index(rows):
    for index, row in enumerate(rows):
        header_tokens = {clean_header(cell) for cell in row if normalize_text(cell)}
        if "status" in header_tokens and ("uid" in header_tokens or "s no" in header_tokens):
            return index
    return None


def extract_metadata(rows, limit_index):
    metadata = {}
    for row in rows[:limit_index]:
        if len(row) < 2:
            continue
        key = normalize_text(row[0])
        value = normalize_text(row[1])
        if key and value:
            metadata[key] = value
    return metadata


def build_records(rows):
    header_index = find_header_index(rows)
    if header_index is None:
        raise ValueError("Could not find the attendance header row.")

    headers = [normalize_text(cell) for cell in rows[header_index]]
    normalized_headers = [clean_header(h) for h in headers]
    metadata = extract_metadata(rows, header_index)
    records = []

    for row in rows[header_index + 1 :]:
        if not any(normalize_text(cell) for cell in row):
            continue

        record = {}
        for idx, header in enumerate(headers):
            if not header:
                continue
            record[header] = normalize_text(row[idx]) if idx < len(row) else ""
            record[clean_header(header)] = record[header]

        # Carry the metadata down to every record so the SMS message can stay descriptive.
        for key, value in metadata.items():
            if key not in record:
                record[key] = value
            normalized_key = clean_header(key)
            if normalized_key not in record:
                record[normalized_key] = value

        records.append(record)

    return metadata, headers, normalized_headers, records


def get_value(record, *candidates):
    for candidate in candidates:
        key = clean_header(candidate)
        if key in record and normalize_text(record[key]):
            return normalize_text(record[key])
        if candidate in record and normalize_text(record[candidate]):
            return normalize_text(record[candidate])
    return ""


def derive_recipient(record):
    return normalize_phone(
        get_value(
            record,
            "Guardian Phone",
            "Father Phone",
            "Parent Phone",
            "Student Phone",
            "Phone",
        )
    )


def summarize_names(names, limit=5):
    if not names:
        return ""
    preview = ", ".join(names[:limit])
    if len(names) > limit:
        preview += f", ... (+{len(names) - limit} more)"
    return preview


def derive_message(record):
    message = get_value(record, "Automated Message", "Message")
    if message:
        return message

    student_name = get_value(record, "Name")
    batch = get_value(record, "Batch")
    class_name = get_value(record, "Class")
    session_name = get_value(record, "Session Name", "Session")
    session_date = get_value(record, "Session Date")
    arrival_time = get_value(record, "Arrival Time")
    status = get_value(record, "Status").lower()

    if status == "late":
        return (
            f"Hello {student_name or 'Student'}, you arrived late for {session_name or 'class'} "
            f"in batch {batch or '-'} on {session_date or '-'}. "
            f"Class: {class_name or '-'}. Arrival time: {arrival_time or 'N/A'}."
        )

    return (
        f"Hello {student_name or 'Student'}, your ward was absent for {session_name or 'class'} "
        f"in batch {batch or '-'} on {session_date or '-'}. Class: {class_name or '-'}."
    )


def build_row_key(metadata, record):
    session_id = get_value(record, "Session ID") or metadata.get("Session ID") or metadata.get("Session")
    generated_at = metadata.get("Generated At") or metadata.get("Generated") or metadata.get("GeneratedAt")
    unique_parts = [
        session_id,
        generated_at,
        get_value(record, "Session Name", "Session"),
        get_value(record, "Batch"),
        get_value(record, "UID"),
        get_value(record, "Status"),
        get_value(record, "Session Date"),
        get_value(record, "Arrival Time"),
        derive_recipient(record),
        derive_message(record),
    ]
    return hash_text("|".join(unique_parts))


def parse_device_ids():
    if not SMS8_DEVICE_IDS_RAW:
        return []

    try:
        decoded = json.loads(SMS8_DEVICE_IDS_RAW)
        if isinstance(decoded, list):
            return [normalize_text(item) for item in decoded if normalize_text(item)]
        if isinstance(decoded, str):
            SMS8_DEVICE_IDS_RAW_LOCAL = decoded
        else:
            SMS8_DEVICE_IDS_RAW_LOCAL = SMS8_DEVICE_IDS_RAW
    except Exception:
        SMS8_DEVICE_IDS_RAW_LOCAL = SMS8_DEVICE_IDS_RAW

    parts = re.split(r"[,\n;]+", SMS8_DEVICE_IDS_RAW_LOCAL)
    return [normalize_text(part) for part in parts if normalize_text(part)]


def normalize_device_slot(device_id):
    raw = normalize_text(device_id)
    if not raw:
        return ""
    if "|" in raw:
        left, right = raw.split("|", 1)
        return f"{normalize_text(left)}|{normalize_text(right) or '0'}"
    return f"{raw}|0"


def build_sms8_params(number, message):
    params = {
        "key": SMS8_API_KEY,
        "number": format_sms8_number(number),
        "message": message,
        "type": SMS8_MESSAGE_TYPE,
        "prioritize": SMS8_PRIORITY,
    }

    return params


def send_sms8(number, message):
    params = build_sms8_params(number, message)
    number_variants = build_sms8_number_variants(number)
    if number_variants:
        params["number"] = number_variants[0]

    device_ids = parse_device_ids()
    if device_ids:
        first_device = normalize_text(device_ids[0])
        if "|" in first_device:
            first_device = normalize_text(first_device.split("|", 1)[0])
        params["devices"] = first_device
        params["useRandomDevice"] = "1"
        params["option"] = "0"

    query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    request_url = f"{SMS8_API_URL}?{query}"
    req = urllib.request.Request(request_url, method="GET")
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    )
    req.add_header("Accept", "*/*")
    req.add_header("Accept-Language", "en-US,en;q=0.9")
    req.add_header("Cache-Control", "no-cache")
    req.add_header("Pragma", "no-cache")
    req.add_header("Referer", "https://app.sms8.io/")
    req.add_header("Origin", "https://app.sms8.io")
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8", errors="replace")
        return response.status, body


def process_workbook(state):
    if not os.path.exists(EXCEL_PATH):
        log(f"Waiting for export file: {EXCEL_PATH}", level="WARN")
        return

    if not SMS8_API_KEY:
        log(
            "SMS8_API_KEY is not configured yet. The watcher is ready, but it cannot send messages "
            "until the API key is added.",
            level="WARN",
        )
        return

    try:
        rows = None
        last_exc = None
        for attempt in range(1, MAX_READ_RETRIES + 1):
            try:
                rows = read_workbook_rows(EXCEL_PATH)
                break
            except (zipfile.BadZipFile, KeyError, ET.ParseError, ValueError, IndexError) as exc:
                last_exc = exc
                if attempt < MAX_READ_RETRIES:
                    time.sleep(READ_RETRY_DELAY_SECONDS)
                    continue
                raise
        metadata, headers, _, records = build_records(rows or [])
    except (zipfile.BadZipFile, KeyError, ET.ParseError, ValueError, IndexError) as exc:
        log(f"Workbook is not ready yet: {exc}", level="WARN")
        return
    except Exception as exc:
        log(f"Failed to read the export workbook: {exc}", level="ERROR")
        return

    target_records = []
    skipped_without_phone = []
    for record in records:
        status = get_value(record, "Status")
        if status not in {"Absent", "Late"}:
            continue
        recipient = derive_recipient(record)
        if not recipient:
            skipped_without_phone.append(get_value(record, "Name") or "student")
            continue
        row_key = build_row_key(metadata, record)
        if state["sent_row_keys"].get(row_key):
            continue
        target_records.append((row_key, record, recipient))

    if skipped_without_phone:
        log(
            f"Skipped {len(skipped_without_phone)} row(s) without recipient phone: "
            f"{summarize_names(skipped_without_phone)}",
            level="WARN",
        )

    if not target_records:
        return

    log(f"Found {len(target_records)} new absentee rows to send through SMS8.")
    all_succeeded = True

    for row_key, record, recipient in target_records:
        name = get_value(record, "Name") or "Student"
        status = get_value(record, "Status")
        message = derive_message(record)
        try:
            response_code, response_body = send_sms8(recipient, message)
            if 200 <= response_code < 300:
                log(
                    f"SMS sent for {name} ({status}) to {recipient}. Response: {response_body[:200]}",
                    level="SYSTEM",
                )
                state["sent_row_keys"][row_key] = {
                    "sent_at": datetime.now().isoformat(),
                    "name": name,
                    "recipient": recipient,
                    "status": status,
                }
                save_state(state)
            else:
                all_succeeded = False
                log(
                    f"SMS8 returned HTTP {response_code} for {name} ({recipient}): {response_body}",
                    level="ERROR",
                )
        except urllib.error.HTTPError as exc:
            all_succeeded = False
            body = exc.read().decode("utf-8", errors="replace") if exc.fp else str(exc)
            log(f"SMS8 HTTP error for {name} ({recipient}): {exc.code} {body}", level="ERROR")
        except Exception as exc:
            all_succeeded = False
            log(f"SMS send failed for {name} ({recipient}): {exc}", level="ERROR")

    state["last_attempt_at"] = datetime.now().isoformat()
    if all_succeeded:
        state["last_success_at"] = datetime.now().isoformat()
    # Save partial progress so already-sent rows do not repeat.
    save_state(state)


def ensure_directory(path):
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)


trigger_queue = queue.Queue()


class TriggerHandler(BaseHTTPRequestHandler):
    server_version = "RMCAbsenteeTrigger/1.0"

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"status": "error", "error": "Not found"})

    def do_POST(self):
        if self.path.rstrip("/") != TRIGGER_PATH.rstrip("/"):
            self._send_json(404, {"status": "error", "error": "Not found"})
            return

        payload = {}
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            length = 0
        if length > 0:
            raw = self.rfile.read(length)
            if raw:
                try:
                    payload = json.loads(raw.decode("utf-8"))
                except Exception:
                    payload = {}

        trigger_queue.put(payload)
        self._send_json(202, {"status": "queued"})

    def log_message(self, _format, *args):
        return


def trigger_worker(state):
    while True:
        payload = trigger_queue.get()
        if payload is None:
            return
        session_id = payload.get("session_id") or payload.get("session") or "-"
        batch_id = payload.get("batch_id") or "-"
        export_file = payload.get("export_file") or "-"
        log(
            f"Trigger received for session {session_id} batch {batch_id} export {export_file}.",
            level="SYSTEM",
        )
        try:
            process_workbook(state)
        except Exception as exc:
            log(f"Triggered run failed: {exc}", level="ERROR")


def main():
    ensure_directory(EXCEL_PATH)
    state = load_state()

    log("--- RMC SMS8 Absentee Monitor Started ---", level="BOOT")
    log(f"Watching workbook: {EXCEL_PATH}", level="BOOT")
    log(f"Listening for close-session triggers on http://{TRIGGER_HOST}:{TRIGGER_PORT}{TRIGGER_PATH}", level="BOOT")
    log(f"State file: {STATE_PATH}", level="BOOT")
    log(f"SMS8 API URL: {SMS8_API_URL}", level="BOOT")
    log(
        "SMS8 device mode: "
        + ("random connected device" if SMS8_USE_RANDOM_DEVICE and not parse_device_ids() else "explicit device list"),
        level="BOOT",
    )

    if not SMS8_API_KEY:
        log(
            "Set SMS8_API_KEY before starting the service. The monitor will stay idle until a trigger arrives.",
            level="WARN",
        )

    worker = Thread(target=trigger_worker, args=(state,), daemon=True)
    worker.start()

    server = ThreadingHTTPServer((TRIGGER_HOST, TRIGGER_PORT), TriggerHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        raise
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Monitor stopped by user.", level="SYSTEM")
