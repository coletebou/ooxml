"""Summarize one hydra seat for the review comment (hydra-review.yml, step "Summarize the seat").

Reads what the autoreview helper left in HYDRA_DIR/out (report.md, report.json, status.json,
console.log, exit, merge-base) and its private run record in HYDRA_DIR/history, and writes
HYDRA_DIR/artifact/: the report files plus seat.json, the seat's outcome for the summary job.

The run record (metadata.json) holds only model ids, counts, durations and short enums, never
prompts, report text or environment values. seat.json keeps the subset the summary needs,
including the model that actually ran: Claude reports it (model_actual_source "engine_reported");
Codex reports none, so for a Codex seat it is the model the helper passed on the command line.

The route check follows the hydra panel script (hydra-autoreview.sh --report): the last completed
attempt must use the requested model, compared across Bedrock route spellings.
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

PANEL_FILES = ("report.md", "report.json", "status.json", "console.log")
TAIL_LINES = 40


def read_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def norm(model):
    """A model id without route prefix or context suffix, as hydra-autoreview.sh compares them."""
    value = (model or "").lower()
    value = re.sub(r"^(global|us|eu|apac)\.", "", value)
    value = re.sub(r"^(openai|anthropic)\.", "", value)
    return value.replace("[1m]", "").replace("claude-", "")


def route_check(requested, attempts):
    done = [attempt for attempt in attempts if attempt.get("status") == "completed"]
    if not attempts:
        return "UNKNOWN"
    if not done:
        return "NO-REPORT"
    last = done[-1]
    for model in (last.get("model"), last.get("model_actual")):
        if model and norm(model) != norm(requested):
            return "SUBSTITUTED:" + str(model)
    if last.get("reason") == "route_fallback":
        return "SAME-MODEL-ROUTE-FALLBACK"
    return "OK"


def total_cost(runs):
    costs = [run.get("cost_usd") for run in runs if isinstance(run.get("cost_usd"), (int, float))]
    return round(sum(costs), 6) if costs else None


def main():
    hydra = Path(os.environ["HYDRA_DIR"])
    out = hydra / "out"
    artifact = hydra / "artifact"
    artifact.mkdir(parents=True, exist_ok=True)

    requested = os.environ["SEAT_MODEL"]
    status = read_json(out / "status.json") or {}
    report = read_json(out / "report.json")
    console = read_text(out / "console.log") or ""
    exit_text = (read_text(out / "exit") or "").strip()
    records = sorted((hydra / "history" / "runs").glob("*/metadata.json"))
    meta = read_json(records[-1]) if records else None
    meta = meta if isinstance(meta, dict) else {}
    attempts = [attempt for attempt in meta.get("attempts") or [] if isinstance(attempt, dict)]
    runs = [run for run in meta.get("reviewer_runs") or [] if isinstance(run, dict)]
    done = [attempt for attempt in attempts if attempt.get("status") == "completed"]
    # Only a completed attempt says which model wrote the report.
    last = done[-1] if done else {}

    produced = bool(status.get("report_produced")) and isinstance(report, dict)
    findings = report.get("findings") if isinstance(report, dict) else None
    seat = {
        "schema": 1,
        "seat": os.environ["SEAT"],
        "engine": os.environ["SEAT_ENGINE"],
        "requested_model": requested,
        "head_sha": os.environ.get("HEAD_SHA"),
        "merge_base": (read_text(out / "merge-base") or "").strip() or None,
        "helper_exit_code": int(exit_text) if re.fullmatch(r"-?\d+", exit_text) else None,
        "report_produced": produced,
        "status": status.get("status"),
        "reason": status.get("reason"),
        "timed_out": status.get("timed_out"),
        "route_check": route_check(requested, attempts),
        # The model the engine or the command line says ran; attempt_model is the model the
        # attempt asked for, the only record when the engine reported nothing.
        "model_actual": last.get("model_actual"),
        "model_actual_source": last.get("model_actual_source"),
        "attempt_model": last.get("model"),
        "attempts": [
            {key: attempt.get(key) for key in (
                "model", "model_actual", "model_actual_source", "auth", "profile", "reason",
                "status", "refusal", "duration_seconds")}
            for attempt in attempts
        ],
        "duration_seconds": meta.get("duration_seconds"),
        "cost_usd": total_cost(runs),
        "verdict": report.get("overall_correctness") if isinstance(report, dict) else None,
        "finding_count": len(findings) if isinstance(findings, list) else None,
        "console_tail": None if produced else "\n".join(console.splitlines()[-TAIL_LINES:]),
    }

    for name in PANEL_FILES:
        if (out / name).is_file():
            shutil.copyfile(out / name, artifact / name)
    with open(artifact / "seat.json", "w", encoding="utf-8") as handle:
        json.dump(seat, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps({key: seat[key] for key in (
        "seat", "requested_model", "model_actual", "route_check", "status", "reason",
        "finding_count", "helper_exit_code")}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
