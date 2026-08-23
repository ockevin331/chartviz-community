#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


@dataclass(frozen=True, order=True)
class AuditFinding:
    code: str
    path: str
    detail: str


@dataclass(frozen=True)
class AuditReport:
    findings: tuple[AuditFinding, ...]

    @property
    def ok(self) -> bool:
        return not self.findings

    def format(self) -> str:
        if self.ok:
            return "Community public audit passed."
        return "\n".join(
            f"{finding.code} {finding.path}: {finding.detail}"
            for finding in self.findings
        )


_PRIVATE_PREFIXES = (
    "docs/superpowers/",
    "public/creem/",
    "public/images/",
    "services/api/",
    "services/web/",
    "store-assets/",
    "web/",
)
_FORBIDDEN_PARTS = {
    ".git",
    ".venv",
    ".wxt",
    "__pycache__",
    "dist",
    "node_modules",
}
_FORBIDDEN_NAMES = {".env", ".DS_Store"}
_ALLOWED_BINARY_PREFIXES = ("public/icons/",)
_ALLOWED_BINARY_SUFFIXES = {".png"}
_SKIP_CONTACT_SCAN = (
    "LICENSES/",
    "THIRD_PARTY_LICENSES.json",
    "SOURCE_MANIFEST.json",
)
_ALLOWED_EMAIL_DOMAINS = {"chartviz.xyz", "example.com"}
_ALLOWED_DOMAINS = {
    "10jqka.com.cn",
    "abstra.io",
    "apache.org",
    "app.hyperliquid.xyz",
    "binance.com",
    "bitget.com",
    "bybit.com",
    "chartviz.xyz",
    "coinbase.com",
    "crypto.com",
    "developercertificate.org",
    "docs.astral.sh",
    "example.com",
    "example.invalid",
    "files.pythonhosted.org",
    "gate.com",
    "gate.io",
    "gnu.org",
    "github.com",
    "htx.com",
    "kucoin.com",
    "mexc.com",
    "mozilla.org",
    "npmjs.com",
    "okx.com",
    "openrouter.ai",
    "pdm-project.org",
    "pypi.org",
    "python-poetry.org",
    "stockpage.10jqka.com.cn",
    "tradingview.com",
    "upbit.com",
    "vergex.trade",
    "www.chartviz.xyz",
    "www.w3.org",
}
_EMAIL = re.compile(r"(?<![\w.+-])([\w.+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![\w.-])")
_URL_HOST = re.compile(r"https?://(?:[^\s/@]+@)?(?:\*\.)?([A-Za-z0-9.-]+)", re.IGNORECASE)
_PRIVATE_IMPORT = re.compile(r"(?:from\s+chartviz_api\b|import\s+chartviz_api\b)")
_SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bnp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
    re.compile(r"(?:postgresql|redis)" + r"://[^\s/:]+:[^\s/@]+@", re.IGNORECASE),
)
_ASSIGNMENT = re.compile(
    r"^(?:OPENROUTER_API_KEY|CHARTVIZ_LLM_API_KEY|CHARTVIZ_LOCAL_API_TOKEN)[ \t]*=[ \t]*([^\s#]+)",
    re.MULTILINE,
)
_SAFE_ASSIGNMENT_PREFIXES = ("your-", "replace-with", "test-", "openapi-", "${")


def _allowed_domain(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    if normalized == "localhost" or normalized.endswith(".test"):
        return True
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        pass
    else:
        return address.is_loopback or address.is_private
    return any(normalized == domain or normalized.endswith(f".{domain}") for domain in _ALLOWED_DOMAINS)


def _regular_files(root: Path) -> tuple[list[Path], list[AuditFinding]]:
    files: list[Path] = []
    findings: list[AuditFinding] = []
    for directory, names, filenames in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        for name in list(names):
            child = directory_path / name
            if child.is_symlink():
                relative = child.relative_to(root).as_posix()
                findings.append(AuditFinding("CVPUB_SYMLINK", relative, "symbolic links are forbidden"))
                names.remove(name)
        for name in filenames:
            child = directory_path / name
            relative = child.relative_to(root).as_posix()
            if child.is_symlink():
                findings.append(AuditFinding("CVPUB_SYMLINK", relative, "symbolic links are forbidden"))
            elif child.is_file():
                files.append(child)
    return files, findings


def _scan_manifest(root: Path, files: list[Path]) -> list[AuditFinding]:
    manifest_path = root / "SOURCE_MANIFEST.json"
    if not manifest_path.exists():
        return []
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = payload["files"]
        if payload.get("schemaVersion") != 1 or not isinstance(entries, list):
            raise ValueError("invalid schema")
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return [AuditFinding("CVPUB_MANIFEST", "SOURCE_MANIFEST.json", "manifest is invalid")]

    expected: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            return [AuditFinding("CVPUB_MANIFEST", "SOURCE_MANIFEST.json", "manifest entry is invalid")]
        relative = str(entry.get("path", ""))
        pure_path = PurePosixPath(relative)
        if not relative or pure_path.is_absolute() or ".." in pure_path.parts:
            return [AuditFinding("CVPUB_MANIFEST", "SOURCE_MANIFEST.json", "manifest path is unsafe")]
        expected[relative] = str(entry.get("sha256", ""))

    actual_paths = {
        path.relative_to(root).as_posix()
        for path in files
        if path != manifest_path
    }
    findings: list[AuditFinding] = []
    if set(expected) != actual_paths:
        findings.append(
            AuditFinding("CVPUB_MANIFEST", "SOURCE_MANIFEST.json", "file list does not match the release tree")
        )
    for relative in sorted(set(expected) & actual_paths):
        digest = hashlib.sha256((root / relative).read_bytes()).hexdigest()
        if not re.fullmatch(r"[a-f0-9]{64}", expected[relative]) or digest != expected[relative]:
            findings.append(AuditFinding("CVPUB_MANIFEST", relative, "file hash does not match"))
    return findings


def audit_release(root: Path, *, checklist: Path | None = None) -> AuditReport:
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("release root must be a directory")
    files, findings = _regular_files(root)

    for path in files:
        relative = path.relative_to(root).as_posix()
        parts = set(PurePosixPath(relative).parts)
        if any(relative.startswith(prefix) for prefix in _PRIVATE_PREFIXES):
            findings.append(AuditFinding("CVPUB_PRIVATE_PATH", relative, "private path is forbidden"))
        if parts & _FORBIDDEN_PARTS or path.name in _FORBIDDEN_NAMES:
            findings.append(AuditFinding("CVPUB_FORBIDDEN_FILE", relative, "generated or private file is forbidden"))

        data = path.read_bytes()
        is_binary = b"\0" in data or path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp"}
        if is_binary:
            allowed_binary = (
                path.suffix.lower() in _ALLOWED_BINARY_SUFFIXES
                and any(relative.startswith(prefix) for prefix in _ALLOWED_BINARY_PREFIXES)
            )
            if not allowed_binary:
                findings.append(AuditFinding("CVPUB_BINARY", relative, "binary asset is not allowlisted"))
            continue

        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            findings.append(AuditFinding("CVPUB_BINARY", relative, "non-UTF-8 file is not allowlisted"))
            continue
        if _PRIVATE_IMPORT.search(text):
            findings.append(AuditFinding("CVPUB_PRIVATE_IMPORT", relative, "private chartviz_api import"))
        if any(pattern.search(text) for pattern in _SECRET_PATTERNS):
            findings.append(AuditFinding("CVPUB_SECRET", relative, "credential-like content detected"))
        for match in _ASSIGNMENT.finditer(text):
            value = match.group(1)
            if not value.startswith(_SAFE_ASSIGNMENT_PREFIXES):
                findings.append(AuditFinding("CVPUB_SECRET", relative, "non-placeholder credential assignment"))
                break

        if not relative.startswith(_SKIP_CONTACT_SCAN):
            for match in _EMAIL.finditer(text):
                if match.group(2).lower() not in _ALLOWED_EMAIL_DOMAINS:
                    findings.append(AuditFinding("CVPUB_EMAIL", relative, "unapproved email domain"))
                    break
            for match in _URL_HOST.finditer(text):
                if not _allowed_domain(match.group(1)):
                    findings.append(AuditFinding("CVPUB_DOMAIN", relative, "unapproved URL domain"))
                    break

    findings.extend(_scan_manifest(root, files))
    if checklist is not None:
        checklist_text = checklist.read_text(encoding="utf-8")
        if re.search(r"^- \[ \]", checklist_text, re.MULTILINE):
            findings.append(AuditFinding("CVPUB_REVIEW", checklist.name, "manual review is incomplete"))

    return AuditReport(tuple(sorted(set(findings))))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit a ChartViz Community public tree")
    parser.add_argument("root", type=Path)
    parser.add_argument("--checklist", type=Path)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report = audit_release(args.root, checklist=args.checklist)
    print(report.format())
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
