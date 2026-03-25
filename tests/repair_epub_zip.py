#!/usr/bin/env python3
"""
Repair EPUB files by unpacking and rebuilding them with system zip/unzip.

Why this exists:
- Some EPUBs may be produced with ZIP metadata combinations that strict readers reject.
- Repacking with the platform zip tool often yields broadly compatible ZIP output.

Key guarantees:
- Preserves source EPUB modification time on repaired file.
- On macOS, attempts to preserve source creation time using SetFile when available.
- Keeps EPUB structure requirements: `mimetype` is first and stored (uncompressed).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import fnmatch
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class FileTimes:
    atime_ns: int
    mtime_ns: int
    birthtime: float | None


@dataclass
class RepairResult:
    source: Path
    destination: Path
    changed: bool
    warning: str | None = None


class RepairError(RuntimeError):
    pass


def read_file_times(path: Path) -> FileTimes:
    stat = path.stat()
    birth = getattr(stat, "st_birthtime", None)
    return FileTimes(
        atime_ns=stat.st_atime_ns, mtime_ns=stat.st_mtime_ns, birthtime=birth
    )


def format_setfile_date(timestamp: float) -> str:
    dt = _dt.datetime.fromtimestamp(timestamp)
    return dt.strftime("%m/%d/%Y %H:%M:%S")


def try_restore_creation_time_macos(path: Path, birthtime: float) -> str | None:
    setfile = shutil.which("SetFile")
    if not setfile:
        return (
            "Could not restore creation date: SetFile was not found "
            "(install Xcode Command Line Tools to enable)."
        )

    date_string = format_setfile_date(birthtime)
    proc = subprocess.run(
        [setfile, "-d", date_string, str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.strip()
        return (
            f"Could not restore creation date via SetFile: {stderr or 'unknown error'}"
        )
    return None


def restore_file_times(path: Path, original: FileTimes) -> str | None:
    os.utime(path, ns=(original.atime_ns, original.mtime_ns))

    if platform.system() != "Darwin":
        return None
    if original.birthtime is None:
        return (
            "Creation date was not available on source file; only mtime was restored."
        )

    return try_restore_creation_time_macos(path, original.birthtime)


def run_cmd(cmd: list[str], cwd: Path | None = None) -> None:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.strip()
        stdout = proc.stdout.strip()
        details = stderr or stdout or "command failed"
        raise RepairError(f"Command failed ({' '.join(cmd)}): {details}")


def ensure_tools_available() -> None:
    missing = [tool for tool in ("zip", "unzip") if shutil.which(tool) is None]
    if missing:
        raise RepairError(f"Required tools not found in PATH: {', '.join(missing)}")


def find_epubs(folder: Path, pattern: str) -> list[Path]:
    candidates = [p for p in folder.rglob("*") if p.is_file()]
    matched = [
        p
        for p in candidates
        if fnmatch.fnmatch(p.name.lower(), pattern.lower())
        and p.suffix.lower() == ".epub"
    ]
    return sorted(matched)


def copy_over_existing(src: Path, dst: Path) -> None:
    with src.open("rb") as in_f, dst.open("wb") as out_f:
        shutil.copyfileobj(in_f, out_f)


def build_repacked_epub(source_epub: Path, temp_output: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="repair_epub_") as td:
        temp_root = Path(td)
        extracted = temp_root / "extracted"
        extracted.mkdir(parents=True, exist_ok=True)

        run_cmd(["unzip", "-qq", str(source_epub), "-d", str(extracted)])

        mimetype_path = extracted / "mimetype"
        if not mimetype_path.is_file():
            raise RepairError(
                "Not a valid EPUB layout: missing 'mimetype' entry after extraction"
            )

        run_cmd(["zip", "-X0q", str(temp_output), "mimetype"], cwd=extracted)
        run_cmd(
            ["zip", "-Xr9q", str(temp_output), ".", "-x", "mimetype"], cwd=extracted
        )


def default_output_for(source: Path, suffix: str) -> Path:
    return source.with_name(f"{source.stem}{suffix}{source.suffix}")


def repair_one(
    source: Path,
    destination: Path,
    in_place: bool,
    overwrite: bool,
    dry_run: bool,
) -> RepairResult:
    if not source.exists() or not source.is_file():
        raise RepairError(f"Input file does not exist: {source}")
    if source.suffix.lower() != ".epub":
        raise RepairError(f"Input is not an EPUB file: {source}")

    original_times = read_file_times(source)

    if in_place:
        actual_destination = source
    else:
        actual_destination = destination
        if actual_destination.exists() and not overwrite:
            raise RepairError(
                f"Destination exists (use --overwrite): {actual_destination}"
            )

    if dry_run:
        return RepairResult(
            source=source, destination=actual_destination, changed=False
        )

    with tempfile.TemporaryDirectory(prefix="repair_epub_out_") as td:
        tmp_output = Path(td) / "repacked.epub"
        build_repacked_epub(source, tmp_output)

        if in_place:
            copy_over_existing(tmp_output, actual_destination)
        else:
            if actual_destination.exists():
                copy_over_existing(tmp_output, actual_destination)
            else:
                actual_destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(tmp_output), str(actual_destination))

    warning = restore_file_times(actual_destination, original_times)
    return RepairResult(
        source=source, destination=actual_destination, changed=True, warning=warning
    )


def process_files(
    sources: Iterable[Path],
    suffix: str,
    in_place: bool,
    overwrite: bool,
    dry_run: bool,
    verbose: bool,
    ignore_errors: bool,
) -> int:
    total = 0
    repaired = 0
    failed = 0

    for source in sources:
        total += 1
        destination = source if in_place else default_output_for(source, suffix)

        try:
            result = repair_one(
                source=source,
                destination=destination,
                in_place=in_place,
                overwrite=overwrite,
                dry_run=dry_run,
            )
            state = "DRY-RUN" if dry_run else "REPAIRED"
            print(f"[{state}] {result.source} -> {result.destination}")
            if result.warning:
                print(f"  warning: {result.warning}")
            if not dry_run:
                repaired += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"[FAILED] {source}: {exc}", file=sys.stderr)
            if verbose:
                import traceback

                traceback.print_exc()
            if not ignore_errors:
                break

    print(
        f"Summary: total={total}, repaired={repaired}, failed={failed}, dry_run={dry_run}"
    )

    return 1 if failed > 0 else 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Repair EPUB files by unpacking and rezipping with system zip/unzip."
    )

    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--input", type=Path, help="Input EPUB file path")
    source_group.add_argument(
        "--folder", type=Path, help="Folder to process recursively"
    )

    parser.add_argument(
        "--output", type=Path, help="Output EPUB file path (single-file mode)"
    )
    parser.add_argument(
        "--glob",
        default="*.epub",
        help="Filename glob for folder mode (default: *.epub)",
    )
    parser.add_argument(
        "--suffix",
        default="_fixed",
        help="Suffix for output filenames in folder mode when not --in-place",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Replace each source EPUB in place",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite destination file if it exists (non in-place mode)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Show actions without writing files"
    )
    parser.add_argument(
        "--ignore-errors",
        action="store_true",
        help="Continue processing after per-file failures",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Print stack traces on failures"
    )

    args = parser.parse_args(argv)

    if args.input:
        if args.output and args.in_place:
            parser.error("--output cannot be used with --in-place")
        if not args.output and not args.in_place:
            args.output = default_output_for(args.input, args.suffix)

    if args.folder and args.output:
        parser.error("--output is only valid with --input")

    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    try:
        ensure_tools_available()
    except RepairError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.input:
        sources = [args.input]
        return process_files(
            sources=sources,
            suffix=args.suffix,
            in_place=args.in_place,
            overwrite=args.overwrite,
            dry_run=args.dry_run,
            verbose=args.verbose,
            ignore_errors=args.ignore_errors,
        )

    folder = args.folder
    if not folder.exists() or not folder.is_dir():
        print(f"Folder does not exist: {folder}", file=sys.stderr)
        return 2

    sources = find_epubs(folder, args.glob)
    if not sources:
        print(f"No EPUB files matched in {folder} with glob {args.glob}")
        return 0

    return process_files(
        sources=sources,
        suffix=args.suffix,
        in_place=args.in_place,
        overwrite=args.overwrite,
        dry_run=args.dry_run,
        verbose=args.verbose,
        ignore_errors=args.ignore_errors,
    )


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
