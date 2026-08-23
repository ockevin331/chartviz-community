#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
from importlib import metadata
from pathlib import Path
from typing import Any, Iterable


class LicenseInventoryError(RuntimeError):
    pass


_INVALID_LICENSES = {"", "UNKNOWN", "UNLICENSED", "NONE", "N/A"}
_LICENSE_ALIASES = {"MIT License": "MIT"}
_REQUIREMENT = re.compile(r"^([A-Za-z0-9_.-]+)==([^\s;]+)(?:\s*;.*)?$")


def _normalized_license(value: object, *, package: str) -> str:
    license_value = str(value or "").strip()
    if license_value.upper() in _INVALID_LICENSES:
        raise LicenseInventoryError(f"missing or unknown license for {package}")
    return _LICENSE_ALIASES.get(license_value, license_value)


def _entry(
    *, ecosystem: str, name: str, version: str, license_value: object, source: str
) -> dict[str, str]:
    if not name or not version or not source:
        raise LicenseInventoryError(f"incomplete dependency metadata for {name or 'package'}")
    return {
        "ecosystem": ecosystem,
        "license": _normalized_license(license_value, package=f"{name}@{version}"),
        "name": name,
        "source": source,
        "version": version,
    }


def parse_pnpm_license_report(report: object) -> list[dict[str, str]]:
    if not isinstance(report, dict):
        raise LicenseInventoryError("pnpm license report must be a JSON object")
    entries: list[dict[str, str]] = []
    for packages in report.values():
        if not isinstance(packages, list):
            raise LicenseInventoryError("pnpm license group must be an array")
        for package in packages:
            if not isinstance(package, dict):
                raise LicenseInventoryError("pnpm package entry must be an object")
            name = str(package.get("name", "")).strip()
            versions = package.get("versions")
            if not isinstance(versions, list) or not versions:
                raise LicenseInventoryError(f"missing versions for npm package {name}")
            for version_value in versions:
                version = str(version_value).strip()
                source = str(package.get("homepage", "")).strip()
                if not source:
                    source = f"https://www.npmjs.com/package/{name}/v/{version}"
                entries.append(
                    _entry(
                        ecosystem="npm",
                        name=name,
                        version=version,
                        license_value=package.get("license"),
                        source=source,
                    )
                )
    return sorted(entries, key=lambda item: (item["name"].lower(), item["version"]))


def _python_requirements(repo: Path) -> list[tuple[str, str]]:
    result = subprocess.run(
        [
            "uv",
            "export",
            "--project",
            "services/community",
            "--format",
            "requirements-txt",
            "--no-dev",
            "--no-emit-project",
            "--no-hashes",
        ],
        cwd=repo,
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    requirements: list[tuple[str, str]] = []
    for raw_line in result.stdout.splitlines():
        match = _REQUIREMENT.match(raw_line.strip())
        if match:
            requirements.append((match.group(1), match.group(2)))
    return requirements


def installed_python_inventory(repo: Path) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for requested_name, locked_version in _python_requirements(repo):
        try:
            distribution = metadata.distribution(requested_name)
        except metadata.PackageNotFoundError:
            # A locked dependency guarded by a platform marker is absent when
            # it is not part of the current runtime environment.
            continue
        actual_name = str(distribution.metadata.get("Name") or requested_name)
        if distribution.version != locked_version:
            raise LicenseInventoryError(
                f"installed version mismatch for {actual_name}: "
                f"{distribution.version} != {locked_version}"
            )
        license_value = distribution.metadata.get("License-Expression")
        if not license_value:
            license_value = distribution.metadata.get("License")
        entries.append(
            _entry(
                ecosystem="pypi",
                name=actual_name,
                version=distribution.version,
                license_value=license_value,
                source=f"https://pypi.org/project/{actual_name}/{distribution.version}/",
            )
        )
    return sorted(entries, key=lambda item: (item["name"].lower(), item["version"]))


def node_inventory(repo: Path) -> list[dict[str, str]]:
    result = subprocess.run(
        ["pnpm", "licenses", "list", "--prod", "--json"],
        cwd=repo,
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise LicenseInventoryError("pnpm returned invalid license JSON") from error
    return parse_pnpm_license_report(report)


def combine_inventory(*groups: Iterable[dict[str, str]]) -> dict[str, object]:
    packages = [entry for group in groups for entry in group]
    packages.sort(key=lambda item: (item["ecosystem"], item["name"].lower(), item["version"]))
    return {"schemaVersion": 1, "packages": packages}


def write_inventory(repo: Path, output: Path) -> None:
    payload = combine_inventory(node_inventory(repo), installed_python_inventory(repo))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Community dependency licenses")
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    write_inventory(args.repo.resolve(strict=True), args.output)
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
