#!/usr/bin/env python3
"""Restricted, atomic deployer for PerumNet Mailcow login branding."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

MAX_PAYLOAD_BYTES = 7 * 1024 * 1024
MAILCOW_ROOT = Path(os.environ.get("MAILCOW_ROOT", "/opt/mailcow-dockerized")).resolve()
BACKUP_ROOT = Path(os.environ.get("MAIL_BRANDING_BACKUP_DIR", "/var/backups/perumnet-mail-branding")).resolve()
HEALTH_URL = os.environ.get("MAIL_BRANDING_HEALTH_URL", "https://mail.perumnet.id/")
ALLOWED_FILES = {
    "css": Path("data/web/css/build/0081-custom-mailcow.css"),
    "logo": Path("data/web/img/perumnet-mail-brand.png"),
    "favicon": Path("data/web/favicon.png"),
}
MAX_FILE_BYTES = {"css": 512 * 1024, "logo": 2 * 1024 * 1024, "favicon": 2 * 1024 * 1024}


class DeployError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DeployError(message)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def read_payload() -> dict:
    raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw) > MAX_PAYLOAD_BYTES:
        fail("Payload exceeds the maximum size")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DeployError("Payload is not valid JSON") from exc
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1 or payload.get("action") != "apply":
        fail("Unsupported payload schema or action")
    if payload.get("theme") not in {"enterprise", "perumnet"}:
        fail("Unsupported theme")
    for field, maximum in (("versionId", 100), ("contentHash", 64), ("browserTitle", 80), ("mainName", 80)):
        value = payload.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > maximum:
            fail(f"Invalid {field}")
        if any(ord(char) < 32 for char in value):
            fail(f"Control characters are not allowed in {field}")
    return payload


def decode_files(payload: dict) -> dict[str, bytes]:
    files = payload.get("files")
    if not isinstance(files, dict) or set(files) != set(ALLOWED_FILES):
        fail("The file manifest is incomplete")
    decoded: dict[str, bytes] = {}
    for name, expected_path in ALLOWED_FILES.items():
        item = files.get(name)
        if not isinstance(item, dict) or item.get("path") != str(expected_path):
            fail(f"Unexpected destination for {name}")
        try:
            content = base64.b64decode(item.get("contentBase64", ""), validate=True)
        except (ValueError, TypeError) as exc:
            raise DeployError(f"Invalid base64 content for {name}") from exc
        if not content or len(content) > MAX_FILE_BYTES[name]:
            fail(f"Invalid size for {name}")
        if item.get("sha256") != sha256(content):
            fail(f"Checksum mismatch for {name}")
        decoded[name] = content
    if b"#login_user" not in decoded["css"] or b"\x00" in decoded["css"]:
        fail("CSS does not contain the Mailcow login scope")
    png_signature = b"\x89PNG\r\n\x1a\n"
    if not decoded["logo"].startswith(png_signature) or not decoded["favicon"].startswith(png_signature):
        fail("Logo and favicon must be normalized PNG files")
    combined = decoded["css"] + decoded["logo"] + decoded["favicon"] + payload["browserTitle"].encode()
    if payload.get("contentHash") != sha256(combined):
        fail("Combined content hash mismatch")
    return decoded


def redis(*arguments: str) -> str:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "redis-mailcow",
            "sh",
            "-c",
            'REDISCLI_AUTH="$REDISPASS" exec redis-cli "$@"',
            "redis-cli",
            *arguments,
        ],
        cwd=MAILCOW_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    return result.stdout.strip()


def backup_current(version_id: str) -> tuple[Path, dict[str, bool], dict[str, str]]:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_version = "".join(char for char in version_id if char.isalnum() or char in "-_")[:80]
    backup_dir = BACKUP_ROOT / f"{timestamp}-{safe_version}"
    backup_dir.mkdir(parents=True, mode=0o700, exist_ok=False)
    existed: dict[str, bool] = {}
    for name, relative in ALLOWED_FILES.items():
        source = MAILCOW_ROOT / relative
        existed[name] = source.exists()
        if source.exists():
            shutil.copy2(source, backup_dir / name)
    redis_values = {"TITLE_NAME": redis("GET", "TITLE_NAME"), "MAIN_NAME": redis("GET", "MAIN_NAME")}
    (backup_dir / "state.json").write_text(
        json.dumps({"existed": existed, "redis": redis_values}, ensure_ascii=False),
        encoding="utf-8",
    )
    os.chmod(backup_dir / "state.json", 0o600)
    return backup_dir, existed, redis_values


def atomic_write(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def restore(backup_dir: Path, existed: dict[str, bool], redis_values: dict[str, str]) -> None:
    for name, relative in ALLOWED_FILES.items():
        destination = MAILCOW_ROOT / relative
        if existed[name]:
            atomic_write(destination, (backup_dir / name).read_bytes())
        else:
            destination.unlink(missing_ok=True)
    for key, value in redis_values.items():
        redis("SET", key, value)


def health_check(browser_title: str) -> None:
    request = urllib.request.Request(HEALTH_URL, headers={"User-Agent": "PerumNet-Mail-Branding-Health/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        content = response.read(1_000_000).decode("utf-8", errors="replace")
        if response.status != 200:
            fail(f"Mailcow health returned HTTP {response.status}")
    if "login_user" not in content or f"<title>{html.escape(browser_title)}</title>" not in content:
        fail("Mailcow login page did not expose the expected title or form")


def prune_backups() -> None:
    backups = sorted((item for item in BACKUP_ROOT.iterdir() if item.is_dir()), reverse=True)
    for stale in backups[30:]:
        shutil.rmtree(stale, ignore_errors=True)


def main() -> None:
    if os.geteuid() != 0:
        fail("The deployer must run as root through the restricted sudo rule")
    payload = read_payload()
    decoded = decode_files(payload)
    backup_dir, existed, redis_values = backup_current(payload["versionId"])
    try:
        for name, relative in ALLOWED_FILES.items():
            atomic_write(MAILCOW_ROOT / relative, decoded[name])
        redis("SET", "TITLE_NAME", payload["browserTitle"])
        redis("SET", "MAIN_NAME", payload["mainName"])
        health_check(payload["browserTitle"])
    except Exception:
        restore(backup_dir, existed, redis_values)
        raise
    prune_backups()
    print(json.dumps({
        "ok": True,
        "versionId": payload["versionId"],
        "contentHash": payload["contentHash"],
        "backup": str(backup_dir),
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
