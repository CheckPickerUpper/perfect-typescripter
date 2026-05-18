#!/usr/bin/env python3
"""Install perfect-typescripter into OpenCode.

Symlinks the OpenCode bundle into ~/.config/opencode/plugins/ and copies
skills/agents into the matching OpenCode dirs. Cross-platform: works on
WSL, Linux, macOS, and Windows (uses Path.home()).
"""

import argparse
import os
import shutil
import sys
from pathlib import Path

INSTALLER_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = INSTALLER_DIR.parent
BUNDLE_PATH = INSTALLER_DIR / "perfect-typescripter-opencode-bundle.js"
SKILLS_SRC = PLUGIN_ROOT / "skills"
AGENTS_SRC = PLUGIN_ROOT / "agents"

OPENCODE_HOME = Path.home() / ".config" / "opencode"
PLUGINS_DIR = OPENCODE_HOME / "plugins"
SKILLS_DIR = OPENCODE_HOME / "skills"
AGENTS_DIR = OPENCODE_HOME / "agent"

SYMLINK_TARGET = PLUGINS_DIR / "perfect-typescripter-opencode-bundle.js"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions without writing files.",
    )
    parser.add_argument(
        "--mode",
        choices=("symlink", "copy"),
        default="symlink",
        help="symlink (default) or copy the bundle into OpenCode's plugin dir.",
    )
    return parser.parse_args()


def _ensure_dir(target_dir: Path, dry_run: bool) -> None:
    if target_dir.exists():
        return
    if dry_run:
        print(f"  [dry-run] would create {target_dir}")
        return
    target_dir.mkdir(parents=True, exist_ok=True)
    print(f"  [created] {target_dir}")


def _install_bundle(mode: str, dry_run: bool) -> None:
    if not BUNDLE_PATH.is_file():
        sys.exit(f"error: bundle missing at {BUNDLE_PATH}")
    if SYMLINK_TARGET.exists() or SYMLINK_TARGET.is_symlink():
        if dry_run:
            print(f"  [dry-run] would remove existing {SYMLINK_TARGET}")
        else:
            SYMLINK_TARGET.unlink()
    if dry_run:
        print(f"  [dry-run] would {mode} {BUNDLE_PATH} -> {SYMLINK_TARGET}")
        return
    if mode == "symlink":
        os.symlink(BUNDLE_PATH, SYMLINK_TARGET)
        print(f"  [symlinked] {SYMLINK_TARGET} -> {BUNDLE_PATH}")
    else:
        shutil.copy2(BUNDLE_PATH, SYMLINK_TARGET)
        print(f"  [copied]    {SYMLINK_TARGET} <- {BUNDLE_PATH}")


def _install_dir_contents(src: Path, dst: Path, label: str, dry_run: bool) -> None:
    if not src.is_dir():
        return
    for entry in sorted(src.iterdir()):
        target = dst / entry.name
        if target.exists() or target.is_symlink():
            if dry_run:
                print(f"  [dry-run] would replace {target}")
            else:
                if target.is_dir() and not target.is_symlink():
                    shutil.rmtree(target)
                else:
                    target.unlink()
        if dry_run:
            print(f"  [dry-run] would symlink {entry} -> {target}")
            continue
        os.symlink(entry, target)
        print(f"  [{label}]   {target} -> {entry}")


def main() -> int:
    args = _parse_args()
    print(f"Installing perfect-typescripter into {OPENCODE_HOME}")
    _ensure_dir(PLUGINS_DIR, args.dry_run)
    _ensure_dir(SKILLS_DIR, args.dry_run)
    _ensure_dir(AGENTS_DIR, args.dry_run)
    _install_bundle(args.mode, args.dry_run)
    _install_dir_contents(SKILLS_SRC, SKILLS_DIR, "skill", args.dry_run)
    _install_dir_contents(AGENTS_SRC, AGENTS_DIR, "agent", args.dry_run)
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
