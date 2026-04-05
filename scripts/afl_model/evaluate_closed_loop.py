#!/usr/bin/env python3
"""
Evaluate candidate vs current AFL disposals model on settled picks, with guardrails.

Usage:
  python scripts/afl_model/evaluate_closed_loop.py --promote-if-pass
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import os
import pickle
import shutil
from typing import Dict, List, Optional, Tuple

from build_dataset import FEATURE_COLUMNS
from common import MODEL_DIR, now_iso, write_json
from train_disposals_model import baseline_predict_row


def safe_read_json(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def clamp_prob(p: float) -> float:
    return max(1e-6, min(1.0 - 1e-6, float(p)))


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def to_float(value) -> Optional[float]:
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def normalize_name(value: str) -> str:
    return str(value or "").strip().lower().replace("-", " ")


def normalize_bookmaker(value: str) -> str:
    return "".join(ch for ch in normalize_name(value) if ch.isalnum())


def week_key_from_date_str(value: str) -> str:
    raw = str(value or "").strip()
    if len(raw) < 10:
        return ""
    try:
        from datetime import date
        d = date.fromisoformat(raw[:10])
        iso = d.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    except Exception:
        return ""


def snapshot_key(player_name: str, commence_time: str) -> str:
    wk = week_key_from_date_str(commence_time)
    nm = normalize_name(player_name)
    if not wk or not nm:
        return ""
    return f"{nm}|{wk}"


def load_model_artifact(path: str) -> dict:
    payload = safe_read_json(path)
    if not isinstance(payload, dict):
        raise FileNotFoundError(f"Model artifact missing/invalid: {path}")
    return payload


def load_model_object(artifact: dict):
    rel = str(artifact.get("modelPicklePath") or "").strip()
    if not rel:
        return None
    abs_path = os.path.join(MODEL_DIR, rel.replace("/", os.sep))
    if not os.path.exists(abs_path):
        return None
    try:
        with open(abs_path, "rb") as fh:
            return pickle.load(fh)
    except Exception:
        return None


def predict_expected(artifact: dict, model_obj, feat_raw: dict) -> float:
    feat = {c: float(feat_raw.get(c, 0.0)) for c in FEATURE_COLUMNS}
    if str(artifact.get("modelType") or "") == "baseline" or model_obj is None:
        return max(0.0, baseline_predict_row(feat))
    vec = [[feat[c] for c in FEATURE_COLUMNS]]
    try:
        return max(0.0, float(model_obj.predict(vec)[0]))
    except Exception:
        return max(0.0, baseline_predict_row(feat))


def load_calibration(artifact: dict) -> dict:
    rel = str(artifact.get("calibrationPath") or "").strip()
    if rel:
        payload = safe_read_json(os.path.join(MODEL_DIR, rel.replace("/", os.sep)))
        if isinstance(payload, dict):
            return payload
    fallback = safe_read_json(os.path.join(MODEL_DIR, "models", "latest-calibration.json"))
    if isinstance(fallback, dict):
        return fallback
    return {"method": "identity"}


def apply_calibration(prob: float, calibration: dict) -> float:
    method = str(calibration.get("method") or "identity").lower().strip()
    p = clamp_prob(prob)
    if method == "platt":
        try:
            a = float(calibration.get("a"))
            b = float(calibration.get("b"))
            s = math.log(p / (1.0 - p))
            return clamp_prob(1.0 / (1.0 + math.exp(-((a * s) + b))))
        except Exception:
            return p
    if method == "isotonic":
        x_vals = calibration.get("xThresholds")
        y_vals = calibration.get("yThresholds")
        if not isinstance(x_vals, list) or not isinstance(y_vals, list):
            return p
        if len(x_vals) != len(y_vals) or len(x_vals) < 2:
            return p
        try:
            x = [float(v) for v in x_vals]
            y = [clamp_prob(float(v)) for v in y_vals]
        except Exception:
            return p
        if p <= x[0]:
            return y[0]
        if p >= x[-1]:
            return y[-1]
        idx = bisect.bisect_left(x, p)
        x0, x1 = x[idx - 1], x[idx]
        y0, y1 = y[idx - 1], y[idx]
        if abs(x1 - x0) < 1e-12:
            return y0
        ratio = (p - x0) / (x1 - x0)
        return clamp_prob(y0 + ratio * (y1 - y0))
    return p


def load_settled_samples(max_projection_files: int) -> List[dict]:
    history_payload = safe_read_json(os.path.join(MODEL_DIR, "history", "disposals-line-history.json")) or {}
    history_rows = history_payload.get("rows", []) if isinstance(history_payload, dict) else []
    if not isinstance(history_rows, list):
        history_rows = []
    actual_by_key: Dict[str, dict] = {}
    for row in history_rows:
        if not isinstance(row, dict):
            continue
        if row.get("isVoid") is True:
            continue
        key = str(row.get("snapshotKey") or "").strip()
        try:
            actual = float(row.get("actualDisposals"))
            line = float(row.get("line"))
        except Exception:
            continue
        if not math.isfinite(actual) or not math.isfinite(line):
            continue
        actual_by_key[key] = {
            "actualDisposals": actual,
            "line": line,
            "gameDate": row.get("gameDate"),
            "bookmaker": row.get("bookmaker"),
            "playerName": row.get("playerName"),
        }
    if not actual_by_key:
        return []

    projections_dir = os.path.join(MODEL_DIR, "projections")
    files = []
    if os.path.exists(projections_dir):
        files = [f for f in os.listdir(projections_dir) if f.startswith("disposals-projections-") and f.endswith(".json")]
    files.sort(reverse=True)
    files = files[: max(1, max_projection_files)]

    selected: Dict[str, dict] = {}
    market_track: Dict[str, Dict[str, Optional[float]]] = {}
    for fn in files:
        payload = safe_read_json(os.path.join(projections_dir, fn))
        rows = payload.get("rows", []) if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            continue
        per_file_lowest: Dict[str, dict] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            feat = row.get("featureSnapshot")
            if not isinstance(feat, dict):
                continue
            key = snapshot_key(str(row.get("playerName") or ""), str(row.get("commenceTime") or ""))
            if not key or key not in actual_by_key:
                continue
            market_p_over = to_float(row.get("marketPOver"))
            track = market_track.setdefault(key, {"latest": None, "open": None})
            if market_p_over is not None:
                if track["latest"] is None:
                    track["latest"] = market_p_over
                track["open"] = market_p_over
            try:
                line = float(row.get("line"))
            except Exception:
                continue
            if not math.isfinite(line):
                continue
            existing = per_file_lowest.get(key)
            if existing is None:
                per_file_lowest[key] = row
                continue
            try:
                existing_line = float(existing.get("line"))
            except Exception:
                existing_line = line
            if line < existing_line:
                per_file_lowest[key] = row
                continue
            if abs(line - existing_line) < 1e-9:
                bm_cur = normalize_bookmaker(str(row.get("bookmaker") or ""))
                bm_prev = normalize_bookmaker(str(existing.get("bookmaker") or ""))
                if bm_cur < bm_prev:
                    per_file_lowest[key] = row
        for key, row in per_file_lowest.items():
            if key not in selected:
                selected[key] = row

    out: List[dict] = []
    for key, proj in selected.items():
        actual = actual_by_key.get(key)
        if not actual:
            continue
        feat = proj.get("featureSnapshot")
        if not isinstance(feat, dict):
            continue
        out.append(
            {
                "snapshotKey": key,
                "featureSnapshot": feat,
                "sigma": proj.get("sigma"),
                "marketPOver": proj.get("marketPOver"),
                "line": float(actual["line"]),
                "actualDisposals": float(actual["actualDisposals"]),
                "gameDate": actual.get("gameDate"),
                "playerName": actual.get("playerName"),
                "marketPOverOpen": market_track.get(key, {}).get("open"),
                "marketPOverLatest": market_track.get(key, {}).get("latest"),
            }
        )
    return out


def make_calibration_bins(outcomes: List[int], probs: List[float], bins: int = 10) -> List[dict]:
    bucket = [{"n": 0, "sumP": 0.0, "sumY": 0.0} for _ in range(bins)]
    for y, p in zip(outcomes, probs):
        idx = min(bins - 1, max(0, int(p * bins)))
        b = bucket[idx]
        b["n"] += 1
        b["sumP"] += p
        b["sumY"] += float(y)
    out: List[dict] = []
    for i, b in enumerate(bucket):
        if b["n"] == 0:
            continue
        out.append(
            {
                "bin": i,
                "count": b["n"],
                "avgPred": round(b["sumP"] / b["n"], 4),
                "avgActual": round(b["sumY"] / b["n"], 4),
            }
        )
    return out


def evaluate_model(name: str, artifact: dict, samples: List[dict]) -> Tuple[dict, List[dict]]:
    model_obj = load_model_object(artifact)
    calibration = load_calibration(artifact)
    residual_std = max(2.0, float(artifact.get("residualStd") or 6.0))
    outcomes: List[int] = []
    probs: List[float] = []
    abs_err: List[float] = []
    clv_values: List[float] = []
    clv_positive = 0
    clv_count = 0
    details: List[dict] = []
    for sample in samples:
        feat = sample.get("featureSnapshot")
        if not isinstance(feat, dict):
            continue
        line = float(sample.get("line", 0.0))
        actual = float(sample.get("actualDisposals", 0.0))
        if not math.isfinite(line) or not math.isfinite(actual) or abs(actual - line) < 1e-9:
            continue
        expected = predict_expected(artifact, model_obj, feat)
        sigma_raw = sample.get("sigma")
        try:
            sigma = float(sigma_raw)
        except Exception:
            sigma = residual_std
        sigma = max(2.0, sigma if math.isfinite(sigma) else residual_std)
        p_raw = 1.0 - normal_cdf((line - expected) / sigma if sigma > 0 else 0.0)
        p_over = apply_calibration(p_raw, calibration)
        y = 1 if actual > line else 0
        pick = 1 if p_over >= 0.5 else 0
        outcomes.append(y)
        probs.append(p_over)
        abs_err.append(abs(expected - actual))
        result = "Win" if pick == y else "Loss"
        model_side = "Over" if pick == 1 else "Under"
        actual_side = "Over" if y == 1 else "Under"
        m_open = to_float(sample.get("marketPOverOpen"))
        m_latest = to_float(sample.get("marketPOverLatest"))
        clv_lite = None
        if m_open is not None and m_latest is not None:
            # Positive = market moved toward model side.
            if model_side == "Over":
                clv_lite = m_latest - m_open
            else:
                clv_lite = m_open - m_latest
            clv_count += 1
            clv_values.append(clv_lite)
            if clv_lite > 0:
                clv_positive += 1
        details.append(
            {
                "snapshotKey": sample.get("snapshotKey"),
                "playerName": sample.get("playerName"),
                "gameDate": sample.get("gameDate"),
                "line": round(line, 2),
                "actualDisposals": round(actual, 2),
                "expectedDisposals": round(expected, 2),
                "pOver": round(p_over, 4),
                "pOverRaw": round(p_raw, 4),
                "modelSide": model_side,
                "actualSide": actual_side,
                "result": result,
                "featureSnapshot": feat,
                "marketPOver": sample.get("marketPOver"),
                "marketPOverOpen": m_open,
                "marketPOverLatest": m_latest,
                "clvLite": round(clv_lite, 6) if clv_lite is not None else None,
            }
        )
    sample_count = len(outcomes)
    if sample_count == 0:
        return (
            {
                "name": name,
                "sampleCount": 0,
                "hitRate": 0.0,
                "brierScore": 0.0,
                "logLoss": 0.0,
                "mae": 0.0,
                "avgClvLite": 0.0,
                "positiveClvRate": 0.0,
                "clvSampleCount": 0,
                "calibrationBins": [],
                "calibrationMethod": calibration.get("method", "identity"),
                "modelVersion": artifact.get("version"),
            },
            [],
        )
    hits = sum(1 for d in details if d["result"] == "Win")
    ll = 0.0
    for y, p in zip(outcomes, probs):
        pp = clamp_prob(p)
        ll += -(y * math.log(pp) + (1 - y) * math.log(1.0 - pp))
    metrics = {
        "name": name,
        "sampleCount": sample_count,
        "hitRate": round(hits / sample_count, 6),
        "brierScore": round(sum((float(y) - float(p)) ** 2 for y, p in zip(outcomes, probs)) / sample_count, 6),
        "logLoss": round(ll / sample_count, 6),
        "mae": round(sum(abs_err) / sample_count, 6),
        "avgClvLite": round((sum(clv_values) / len(clv_values)), 6) if clv_values else 0.0,
        "positiveClvRate": round((clv_positive / clv_count), 6) if clv_count > 0 else 0.0,
        "clvSampleCount": clv_count,
        "calibrationBins": make_calibration_bins(outcomes, probs, bins=10),
        "calibrationMethod": calibration.get("method", "identity"),
        "modelVersion": artifact.get("version"),
    }
    return metrics, details


def summarize_reasons(details: List[dict], max_items: int = 8) -> dict:
    wins = [d for d in details if d.get("result") == "Win"]
    losses = [d for d in details if d.get("result") == "Loss"]
    miss_types: Dict[str, int] = {}
    for d in losses:
        key = f"{d.get('modelSide')}->{d.get('actualSide')}"
        miss_types[key] = miss_types.get(key, 0) + 1
    sorted_miss_types = sorted(miss_types.items(), key=lambda kv: kv[1], reverse=True)

    def avg_feature(rows: List[dict], key: str) -> float:
        vals: List[float] = []
        for r in rows:
            feat = r.get("featureSnapshot")
            if not isinstance(feat, dict):
                continue
            try:
                v = float(feat.get(key))
            except Exception:
                continue
            if math.isfinite(v):
                vals.append(v)
        return round(sum(vals) / len(vals), 4) if vals else 0.0

    focus_features = [
        "delta_disp_3v10",
        "delta_tog_3v10",
        "opp_role_disp_index",
        "opp_allow_disposals",
        "rest_days",
    ]
    win_feature_avgs = {k: avg_feature(wins, k) for k in focus_features}
    loss_feature_avgs = {k: avg_feature(losses, k) for k in focus_features}
    top_losses = sorted(
        losses,
        key=lambda d: abs(float(d.get("expectedDisposals", 0.0)) - float(d.get("line", 0.0))),
        reverse=True,
    )[:max_items]
    top_wins = sorted(
        wins,
        key=lambda d: abs(float(d.get("expectedDisposals", 0.0)) - float(d.get("line", 0.0))),
        reverse=True,
    )[:max_items]
    return {
        "lossTypeCounts": [{"type": k, "count": v} for k, v in sorted_miss_types],
        "winFeatureAverages": win_feature_avgs,
        "lossFeatureAverages": loss_feature_avgs,
        "topWins": top_wins,
        "topLosses": top_losses,
    }


def bucket_metrics(details: List[dict], bucket_name: str, picker) -> List[dict]:
    buckets: Dict[str, Dict[str, float]] = {}
    for row in details:
        label = picker(row)
        if not label:
            continue
        b = buckets.setdefault(label, {"n": 0.0, "wins": 0.0})
        b["n"] += 1.0
        if row.get("result") == "Win":
            b["wins"] += 1.0
    out = []
    for label, vals in buckets.items():
        n = int(vals["n"])
        wins = int(vals["wins"])
        out.append(
            {
                "bucketType": bucket_name,
                "bucket": label,
                "count": n,
                "hitRate": round((wins / n), 6) if n > 0 else 0.0,
            }
        )
    out.sort(key=lambda x: x["bucket"])
    return out


def write_model_card(history_dir: str, payload: dict, candidate_details: List[dict]) -> None:
    confidence_buckets = bucket_metrics(
        candidate_details,
        "confidence",
        lambda r: (
            "high_0.65_plus"
            if to_float(r.get("pOver")) is not None and (to_float(r.get("pOver")) >= 0.65 or to_float(r.get("pOver")) <= 0.35)
            else "mid_0.57_0.65"
            if to_float(r.get("pOver")) is not None and (to_float(r.get("pOver")) >= 0.57 or to_float(r.get("pOver")) <= 0.43)
            else "low"
        ),
    )
    edge_buckets = bucket_metrics(
        candidate_details,
        "edge",
        lambda r: (
            "edge_8_plus"
            if (
                to_float(r.get("marketPOver")) is not None
                and to_float(r.get("pOver")) is not None
                and abs(float(r.get("pOver")) - float(r.get("marketPOver"))) >= 0.08
            )
            else "edge_5_8"
            if (
                to_float(r.get("marketPOver")) is not None
                and to_float(r.get("pOver")) is not None
                and abs(float(r.get("pOver")) - float(r.get("marketPOver"))) >= 0.05
            )
            else "edge_under_5"
        ),
    )

    model_card = {
        "generatedAt": payload.get("generatedAt"),
        "modelVersion": payload.get("candidate", {}).get("modelVersion"),
        "sampleCount": payload.get("sampleCount", 0),
        "guardrailsPass": payload.get("decision", {}).get("pass"),
        "promoted": payload.get("decision", {}).get("promoted"),
        "candidateMetrics": payload.get("candidate"),
        "currentMetrics": payload.get("current"),
        "deltas": payload.get("deltas"),
        "confidenceBuckets": confidence_buckets,
        "edgeBuckets": edge_buckets,
        "topLossTypes": payload.get("reasonSummary", {}).get("lossTypeCounts", [])[:5],
    }
    write_json(os.path.join(history_dir, "model-card-latest.json"), model_card)

    md = []
    md.append("# AFL Disposals Model Card")
    md.append("")
    md.append(f"- Generated: {model_card['generatedAt']}")
    md.append(f"- Model: {model_card.get('modelVersion')}")
    md.append(f"- Sample count: {model_card.get('sampleCount')}")
    md.append(f"- Guardrails pass: {model_card.get('guardrailsPass')}")
    md.append(f"- Promoted: {model_card.get('promoted')}")
    c = model_card.get("candidateMetrics") or {}
    md.append(
        f"- Candidate metrics: hit {round(float(c.get('hitRate', 0.0))*100,2)}%, brier {c.get('brierScore')}, logloss {c.get('logLoss')}, clv+ {round(float(c.get('positiveClvRate', 0.0))*100,2)}%"
    )
    md.append("")
    md.append("## Confidence Buckets")
    for row in confidence_buckets:
        md.append(f"- {row['bucket']}: n={row['count']}, hit={round(float(row['hitRate'])*100,2)}%")
    md.append("")
    md.append("## Edge Buckets")
    for row in edge_buckets:
        md.append(f"- {row['bucket']}: n={row['count']}, hit={round(float(row['hitRate'])*100,2)}%")
    md.append("")
    md.append("## Top Loss Types")
    for row in (model_card.get("topLossTypes") or []):
        md.append(f"- {row.get('type')}: {row.get('count')}")
    with open(os.path.join(history_dir, "model-card-latest.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(md) + "\n")


def promote_if_needed(pass_guardrails: bool, promote_flag: bool, candidate_artifact_path: str, candidate_projections_path: str) -> Dict[str, str]:
    info: Dict[str, str] = {}
    if not pass_guardrails or not promote_flag:
        info["promoted"] = "false"
        return info
    models_dir = os.path.join(MODEL_DIR, "models")
    latest_model_path = os.path.join(models_dir, "latest-model.json")
    shutil.copyfile(candidate_artifact_path, latest_model_path)
    info["latestModel"] = latest_model_path

    candidate_artifact = load_model_artifact(candidate_artifact_path)
    cal_rel = str(candidate_artifact.get("calibrationPath") or "").strip()
    if cal_rel:
        candidate_calibration_path = os.path.join(MODEL_DIR, cal_rel.replace("/", os.sep))
        if os.path.exists(candidate_calibration_path):
            latest_calibration_path = os.path.join(models_dir, "latest-calibration.json")
            shutil.copyfile(candidate_calibration_path, latest_calibration_path)
            info["latestCalibration"] = latest_calibration_path

    if candidate_projections_path and os.path.exists(candidate_projections_path):
        latest_projections_path = os.path.join(MODEL_DIR, "latest-disposals-projections.json")
        shutil.copyfile(candidate_projections_path, latest_projections_path)
        info["latestProjections"] = latest_projections_path
    info["promoted"] = "true"
    return info


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-artifact", default=os.path.join(MODEL_DIR, "models", "latest-candidate-model.json"))
    parser.add_argument("--current-artifact", default=os.path.join(MODEL_DIR, "models", "latest-model.json"))
    parser.add_argument("--candidate-projections", default=os.path.join(MODEL_DIR, "latest-candidate-disposals-projections.json"))
    parser.add_argument("--max-projection-files", type=int, default=220)
    parser.add_argument("--min-samples", type=int, default=100)
    parser.add_argument("--freeze-fail-streak", type=int, default=3)
    parser.add_argument("--promote-if-pass", action="store_true")
    args = parser.parse_args()

    current_artifact = load_model_artifact(args.current_artifact)
    candidate_artifact_payload = safe_read_json(args.candidate_artifact)
    candidate_artifact = (
        candidate_artifact_payload
        if isinstance(candidate_artifact_payload, dict)
        else current_artifact
    )
    samples = load_settled_samples(args.max_projection_files)

    candidate_metrics, candidate_details = evaluate_model("candidate", candidate_artifact, samples)
    current_metrics, current_details = evaluate_model("current", current_artifact, samples)
    reason_summary = summarize_reasons(candidate_details)

    sample_count = int(min(candidate_metrics.get("sampleCount", 0), current_metrics.get("sampleCount", 0)))
    cur_brier = float(current_metrics.get("brierScore", 0.0))
    cand_brier = float(candidate_metrics.get("brierScore", 0.0))
    cur_logloss = float(current_metrics.get("logLoss", 0.0))
    cand_logloss = float(candidate_metrics.get("logLoss", 0.0))
    cur_hit = float(current_metrics.get("hitRate", 0.0))
    cand_hit = float(candidate_metrics.get("hitRate", 0.0))

    brier_improvement = ((cur_brier - cand_brier) / cur_brier) if cur_brier > 0 else 0.0
    logloss_change = ((cand_logloss - cur_logloss) / cur_logloss) if cur_logloss > 0 else 0.0
    hit_rate_delta = cand_hit - cur_hit

    guardrails = {
        "minSamples": int(args.min_samples),
        "minBrierImprovement": 0.01,
        "maxLogLossIncrease": 0.005,
        "maxHitRateDrop": 0.015,
    }
    history_dir = os.path.join(MODEL_DIR, "history")
    os.makedirs(history_dir, exist_ok=True)
    perf_history_path = os.path.join(history_dir, "model-performance-history.json")
    perf_history_payload = safe_read_json(perf_history_path)
    previous_rows = perf_history_payload.get("rows", []) if isinstance(perf_history_payload, dict) else []
    if not isinstance(previous_rows, list):
        previous_rows = []

    fail_streak = 0
    for row in reversed(previous_rows):
        if bool(row.get("pass")):
            break
        fail_streak += 1
    freeze_active = fail_streak >= max(1, int(args.freeze_fail_streak))

    guardrail_checks = {
        "sampleCountOk": sample_count >= guardrails["minSamples"],
        "brierOk": brier_improvement >= guardrails["minBrierImprovement"],
        "logLossOk": logloss_change <= guardrails["maxLogLossIncrease"],
        "hitRateOk": hit_rate_delta >= -guardrails["maxHitRateDrop"],
        "freezeInactive": not freeze_active,
    }
    pass_guardrails = all(guardrail_checks.values())
    promotion_info = promote_if_needed(pass_guardrails, args.promote_if_pass, args.candidate_artifact, args.candidate_projections)

    payload = {
        "generatedAt": now_iso(),
        "sampleCount": sample_count,
        "candidateArtifactPath": args.candidate_artifact,
        "candidateFallbackToCurrent": not isinstance(candidate_artifact_payload, dict),
        "guardrails": guardrails,
        "checks": guardrail_checks,
        "deltas": {
            "brierImprovement": round(brier_improvement, 6),
            "logLossChange": round(logloss_change, 6),
            "hitRateDelta": round(hit_rate_delta, 6),
        },
        "decision": {
            "pass": pass_guardrails,
            "promoted": promotion_info.get("promoted") == "true",
            "freezeActive": freeze_active,
            "freezeFailStreak": fail_streak,
            "promotionInfo": promotion_info,
        },
        "candidate": candidate_metrics,
        "current": current_metrics,
        "reasonSummary": reason_summary,
    }

    latest_eval_path = os.path.join(history_dir, "model-eval-latest.json")

    write_json(latest_eval_path, payload)
    perf_rows = previous_rows
    perf_rows.append(
        {
            "generatedAt": payload["generatedAt"],
            "sampleCount": sample_count,
            "pass": payload["decision"]["pass"],
            "promoted": payload["decision"]["promoted"],
            "candidate": candidate_metrics,
            "current": current_metrics,
            "deltas": payload["deltas"],
            "checks": guardrail_checks,
        }
    )
    perf_rows = perf_rows[-500:]
    write_json(
        perf_history_path,
        {
            "generatedAt": now_iso(),
            "count": len(perf_rows),
            "rows": perf_rows,
        },
    )
    write_model_card(history_dir, payload, candidate_details)
    print(f"Evaluated settled samples: {sample_count}")
    print(f"Guardrails pass: {pass_guardrails}")
    print(f"Freeze active: {freeze_active} (streak={fail_streak})")
    print(f"Promoted: {payload['decision']['promoted']}")


if __name__ == "__main__":
    main()

