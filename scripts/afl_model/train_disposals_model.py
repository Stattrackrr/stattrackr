#!/usr/bin/env python3
"""
Train AFL disposals model from generated dataset.

Usage:
  python scripts/afl_model/train_disposals_model.py
  python scripts/afl_model/train_disposals_model.py --dataset data/afl-model/datasets/afl-disposals-train-*.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import pickle
import random

import joblib
from typing import Any, Dict, List, Tuple

from common import MODEL_DIR, ensure_dir, get_projections_dir, now_iso, slug_time
from build_dataset import FEATURE_COLUMNS


def read_rows(path: str) -> List[dict]:
    out: List[dict] = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            out.append(row)
    return out


def to_float(v, default=0.0) -> float:
    try:
        n = float(v)
        return n if math.isfinite(n) else default
    except Exception:
        return default


def mae(y_true: List[float], y_pred: List[float]) -> float:
    return sum(abs(a - b) for a, b in zip(y_true, y_pred)) / max(1, len(y_true))


def rmse(y_true: List[float], y_pred: List[float]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(y_true, y_pred)) / max(1, len(y_true)))


def baseline_predict_row(row: Dict[str, float]) -> float:
    # Strongly weight recent form and blend with opportunity/context features.
    score = (
        row["roll3_mean"] * 0.35
        + row["roll5_mean"] * 0.30
        + row["roll10_mean"] * 0.18
        + row["lag1"] * 0.10
        + (row["tog_roll5_mean"] * 0.03)
        + (row["cp_roll5_mean"] * 0.03)
        + (row["up_roll5_mean"] * 0.01)
    )
    # Dampen extreme volatility.
    score -= row["roll5_std"] * 0.08
    return max(0.0, score)


def baseline_predict_vector(vec: List[float]) -> float:
    row = {name: vec[idx] for idx, name in enumerate(FEATURE_COLUMNS)}
    return baseline_predict_row(row)


def parse_xy(rows: List[dict]) -> Tuple[List[List[float]], List[float]]:
    X: List[List[float]] = []
    y: List[float] = []
    for r in rows:
        X.append([to_float(r.get(c, 0.0), 0.0) for c in FEATURE_COLUMNS])
        y.append(to_float(r.get("target_disposals", 0.0), 0.0))
    return X, y


def time_series_splits(n_rows: int, folds: int) -> List[Tuple[Tuple[int, int], Tuple[int, int]]]:
    folds = max(1, int(folds))
    if n_rows < 120:
        split = max(30, int(n_rows * 0.8))
        if split >= n_rows:
            split = max(20, n_rows - 1)
        return [((0, split), (split, n_rows))]
    min_train = max(50, int(n_rows * 0.5))
    remaining = max(1, n_rows - min_train)
    window = max(20, remaining // (folds + 1))
    out: List[Tuple[Tuple[int, int], Tuple[int, int]]] = []
    train_end = min_train
    for _ in range(folds):
        val_end = min(n_rows, train_end + window)
        if val_end - train_end < 10:
            break
        out.append(((0, train_end), (train_end, val_end)))
        train_end = val_end
        if train_end >= n_rows - 10:
            break
    if not out:
        split = max(30, int(n_rows * 0.8))
        if split >= n_rows:
            split = max(20, n_rows - 1)
        out = [((0, split), (split, n_rows))]
    return out


def evaluate_grid_candidate(
    X: List[List[float]],
    y: List[float],
    splits: List[Tuple[Tuple[int, int], Tuple[int, int]]],
    param_grid: List[Dict[str, Any]],
    builder,
) -> Tuple[Dict[str, Any], Dict[str, float]]:
    best_params = param_grid[0]
    best_score = float("inf")
    best_metrics = {"mae": float("inf"), "rmse": float("inf")}
    for params in param_grid:
        maes: List[float] = []
        rmses: List[float] = []
        failed = False
        for (tr_s, tr_e), (va_s, va_e) in splits:
            x_tr = X[tr_s:tr_e]
            y_tr = y[tr_s:tr_e]
            x_va = X[va_s:va_e]
            y_va = y[va_s:va_e]
            if not x_tr or not x_va:
                continue
            try:
                model = builder(params)
                model.fit(x_tr, y_tr)
                pred = [float(v) for v in model.predict(x_va)]
            except Exception:
                failed = True
                break
            maes.append(mae(y_va, pred))
            rmses.append(rmse(y_va, pred))
        if failed or not maes:
            continue
        avg_mae = sum(maes) / len(maes)
        avg_rmse = sum(rmses) / len(rmses)
        if avg_mae < best_score:
            best_score = avg_mae
            best_params = params
            best_metrics = {"mae": avg_mae, "rmse": avg_rmse}
    return best_params, best_metrics


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def clamp_prob(p: float) -> float:
    return max(1e-6, min(1.0 - 1e-6, float(p)))


def log_loss(y_true: List[int], y_prob: List[float]) -> float:
    if not y_true:
        return 0.0
    total = 0.0
    for y, p in zip(y_true, y_prob):
        pp = clamp_prob(p)
        total += -(y * math.log(pp) + (1 - y) * math.log(1.0 - pp))
    return total / len(y_true)


def brier_score(y_true: List[int], y_prob: List[float]) -> float:
    if not y_true:
        return 0.0
    return sum((float(y) - float(p)) ** 2 for y, p in zip(y_true, y_prob)) / len(y_true)


def normalize_name(value: str) -> str:
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", " ")
    )


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


def build_snapshot_key(player_name: str, commence_time: str) -> str:
    wk = week_key_from_date_str(commence_time)
    name = normalize_name(player_name)
    if not name or not wk:
        return ""
    return f"{name}|{wk}"


def read_json_file(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def load_settled_calibration_rows(max_projection_files: int = 160) -> List[dict]:
    history_path = os.path.join(MODEL_DIR, "history", "disposals-line-history.json")
    history_payload = read_json_file(history_path) or {}
    history_rows = history_payload.get("rows", []) if isinstance(history_payload, dict) else []
    if not isinstance(history_rows, list):
        history_rows = []
    actual_by_snapshot: Dict[str, dict] = {}
    for row in history_rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("snapshotKey") or "").strip()
        actual = row.get("actualDisposals")
        line = row.get("line")
        try:
            actual_f = float(actual)
            line_f = float(line)
        except Exception:
            continue
        if not math.isfinite(actual_f) or not math.isfinite(line_f):
            continue
        actual_by_snapshot[key] = {
            "actualDisposals": actual_f,
            "line": line_f,
        }
    if not actual_by_snapshot:
        return []

    projections_dir = get_projections_dir()
    if not os.path.exists(projections_dir):
        return []
    projection_files = [
        f
        for f in os.listdir(projections_dir)
        if f.startswith("disposals-projections-") and f.endswith(".json")
    ]
    projection_files.sort(reverse=True)
    projection_files = projection_files[: max(1, max_projection_files)]

    selected: Dict[str, dict] = {}
    for fn in projection_files:
        payload = read_json_file(os.path.join(projections_dir, fn))
        rows = payload.get("rows", []) if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            feat = row.get("featureSnapshot")
            if not isinstance(feat, dict):
                continue
            key = build_snapshot_key(str(row.get("playerName") or ""), str(row.get("commenceTime") or ""))
            if not key or key in selected:
                continue
            if key not in actual_by_snapshot:
                continue
            line = row.get("line")
            try:
                line_f = float(line)
            except Exception:
                continue
            if not math.isfinite(line_f):
                continue
            selected[key] = {
                "snapshotKey": key,
                "line": line_f,
                "featureSnapshot": feat,
                "sigma": row.get("sigma"),
            }
    out: List[dict] = []
    for key, base in selected.items():
        actual = actual_by_snapshot.get(key)
        if not actual:
            continue
        out.append(
            {
                "snapshotKey": key,
                "line": float(base["line"]),
                "actualDisposals": float(actual["actualDisposals"]),
                "featureSnapshot": dict(base["featureSnapshot"]),
                "sigma": base.get("sigma"),
            }
        )
    return out


def fit_platt_calibrator(raw_probs: List[float], outcomes: List[int]) -> Tuple[float, float]:
    a = 1.0
    b = 0.0
    lr = 0.05
    n = max(1, len(raw_probs))
    for _ in range(900):
        grad_a = 0.0
        grad_b = 0.0
        for p, y in zip(raw_probs, outcomes):
            s = math.log(clamp_prob(p) / (1.0 - clamp_prob(p)))
            z = a * s + b
            pred = 1.0 / (1.0 + math.exp(-z))
            diff = pred - float(y)
            grad_a += diff * s
            grad_b += diff
        a -= lr * (grad_a / n)
        b -= lr * (grad_b / n)
        lr *= 0.999
    return float(a), float(b)


def calibrate_prob_platt(p: float, a: float, b: float) -> float:
    s = math.log(clamp_prob(p) / (1.0 - clamp_prob(p)))
    z = (a * s) + b
    return 1.0 / (1.0 + math.exp(-z))


def permutation_feature_importance(
    X_val: List[List[float]],
    y_val: List[float],
    base_pred: List[float],
    predict_fn,
) -> List[Dict[str, float]]:
    if not X_val or not y_val or len(X_val) != len(y_val):
        return []
    base_mae = mae(y_val, base_pred)
    out: List[Dict[str, float]] = []
    for idx, feature in enumerate(FEATURE_COLUMNS):
        shuffled = [row[:] for row in X_val]
        col = [row[idx] for row in shuffled]
        rng = random.Random(42 + idx)
        rng.shuffle(col)
        for row_i, v in enumerate(col):
            shuffled[row_i][idx] = v
        pred = predict_fn(shuffled)
        perm_mae = mae(y_val, pred)
        out.append(
            {
                "feature": feature,
                "maeLift": round(perm_mae - base_mae, 6),
                "permutedMae": round(perm_mae, 6),
            }
        )
    out.sort(key=lambda x: x["maeLift"], reverse=True)
    return out


def sample_validation_for_importance(
    X_val: List[List[float]],
    y_val: List[float],
    val_pred: List[float],
    max_rows: int,
) -> Tuple[List[List[float]], List[float], List[float]]:
    if max_rows <= 0 or len(X_val) <= max_rows:
        return X_val, y_val, val_pred
    rng = random.Random(42)
    idxs = list(range(len(X_val)))
    rng.shuffle(idxs)
    keep = set(idxs[:max_rows])
    X_s = [row for i, row in enumerate(X_val) if i in keep]
    y_s = [v for i, v in enumerate(y_val) if i in keep]
    p_s = [v for i, v in enumerate(val_pred) if i in keep]
    return X_s, y_s, p_s


def build_drop_candidates(
    models_dir: str,
    current_feature_importance: List[Dict[str, float]],
    lookback: int = 8,
    min_consecutive_negative: int = 3,
    negative_threshold: float = -0.0002,
) -> List[Dict[str, float]]:
    by_feature: Dict[str, List[float]] = {}
    current_lift = {
        str(item.get("feature")): float(item.get("maeLift", 0.0))
        for item in current_feature_importance
        if item.get("feature") is not None
    }
    for f, lift in current_lift.items():
        by_feature.setdefault(f, []).append(lift)

    try:
        files = [
            f
            for f in os.listdir(models_dir)
            if f.startswith("afl-disp-") and f.endswith(".json") and f != "latest-model.json"
        ]
        files.sort(reverse=True)
        for fn in files[:lookback]:
            try:
                with open(os.path.join(models_dir, fn), "r", encoding="utf-8") as fh:
                    payload = json.load(fh)
                fi = payload.get("featureImportance", [])
                if not isinstance(fi, list):
                    continue
                for item in fi:
                    feature = str(item.get("feature", ""))
                    if not feature:
                        continue
                    lift = float(item.get("maeLift", 0.0))
                    by_feature.setdefault(feature, []).append(lift)
            except Exception:
                continue
    except Exception:
        return []

    out: List[Dict[str, float]] = []
    for feature, lifts in by_feature.items():
        if not lifts:
            continue
        consecutive = 0
        for lift in lifts:
            if lift <= negative_threshold:
                consecutive += 1
            else:
                break
        if consecutive >= min_consecutive_negative:
            out.append(
                {
                    "feature": feature,
                    "consecutiveNegativeRuns": consecutive,
                    "recentLifts": [round(x, 6) for x in lifts[: min(6, len(lifts))]],
                }
            )
    out.sort(key=lambda x: x["consecutiveNegativeRuns"], reverse=True)
    return out


def latest_dataset_path() -> str:
    ds_dir = os.path.join(MODEL_DIR, "datasets")
    if not os.path.exists(ds_dir):
        raise FileNotFoundError("No dataset directory. Run build_dataset.py first.")
    files = [f for f in os.listdir(ds_dir) if f.startswith("afl-disposals-train-") and f.endswith(".csv")]
    if not files:
        raise FileNotFoundError("No dataset CSV files found. Run build_dataset.py first.")
    files.sort()
    return os.path.join(ds_dir, files[-1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="")
    parser.add_argument("--importance-max-rows", type=int, default=1200)
    parser.add_argument("--drop-candidate-lookback", type=int, default=8)
    parser.add_argument("--drop-candidate-min-runs", type=int, default=5)
    parser.add_argument("--candidate-only", action="store_true")
    parser.add_argument("--calibration-min-samples", type=int, default=60)
    parser.add_argument("--cv-folds", type=int, default=3)
    parser.add_argument("--tune-depth", choices=["standard", "deep"], default="standard")
    args = parser.parse_args()

    dataset_path = args.dataset.strip() or latest_dataset_path()
    rows = read_rows(dataset_path)
    rows = [r for r in rows if r.get("date")]
    rows.sort(key=lambda r: r.get("date", ""))
    if len(rows) < 200:
        raise RuntimeError(f"Not enough rows ({len(rows)}). Build more history first.")

    split_idx = max(50, int(len(rows) * 0.8))
    train_rows = rows[:split_idx]
    val_rows = rows[split_idx:]

    X_train, y_train = parse_xy(train_rows)
    X_val, y_val = parse_xy(val_rows)

    baseline_val_pred = [baseline_predict_row({c: to_float(r.get(c, 0.0), 0.0) for c in FEATURE_COLUMNS}) for r in val_rows]
    baseline_metrics = {
        "mae": mae(y_val, baseline_val_pred),
        "rmse": rmse(y_val, baseline_val_pred),
    }

    model_choice = "baseline"
    model_pickle_rel = None
    model_obj = None
    val_pred = baseline_val_pred
    selected_predict_fn = lambda data: [baseline_predict_vector(v) for v in data]

    # Optional sklearn models + walk-forward tuning.
    try:
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.linear_model import Ridge
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        splits = time_series_splits(len(X_train), int(args.cv_folds))
        deep_mode = str(args.tune_depth) == "deep"

        ridge_grid = (
            [{"alpha": x} for x in (0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0)]
            if deep_mode
            else [{"alpha": x} for x in (0.5, 1.0, 2.0, 4.0)]
        )

        def build_ridge(params: Dict[str, Any]):
            return Pipeline(
                steps=[
                    ("scaler", StandardScaler()),
                    ("model", Ridge(alpha=float(params.get("alpha", 1.0)), random_state=42)),
                ]
            )

        ridge_best_params, ridge_cv_metrics = evaluate_grid_candidate(
            X_train, y_train, splits, ridge_grid, build_ridge
        )
        ridge = build_ridge(ridge_best_params)
        ridge.fit(X_train, y_train)
        ridge_pred = [float(x) for x in ridge.predict(X_val)]
        ridge_metrics = {
            "mae": mae(y_val, ridge_pred),
            "rmse": rmse(y_val, ridge_pred),
            "cv_mae": ridge_cv_metrics["mae"],
            "cv_rmse": ridge_cv_metrics["rmse"],
            "bestParams": ridge_best_params,
        }

        if deep_mode:
            hgb_grid = [
                {"max_depth": d, "learning_rate": lr, "max_iter": mi, "min_samples_leaf": msl}
                for d in (4, 5, 6)
                for lr in (0.03, 0.05, 0.08)
                for mi in (220, 320)
                for msl in (12, 20, 30)
            ]
        else:
            hgb_grid = [
                {"max_depth": 5, "learning_rate": 0.05, "max_iter": 250, "min_samples_leaf": 20},
                {"max_depth": 4, "learning_rate": 0.05, "max_iter": 220, "min_samples_leaf": 20},
            ]

        def build_hgb(params: Dict[str, Any]):
            return HistGradientBoostingRegressor(
                random_state=42,
                max_depth=int(params.get("max_depth", 5)),
                learning_rate=float(params.get("learning_rate", 0.05)),
                max_iter=int(params.get("max_iter", 250)),
                min_samples_leaf=int(params.get("min_samples_leaf", 20)),
            )

        hgb_best_params, hgb_cv_metrics = evaluate_grid_candidate(
            X_train, y_train, splits, hgb_grid, build_hgb
        )
        hgb = build_hgb(hgb_best_params)
        hgb.fit(X_train, y_train)
        hgb_pred = [float(x) for x in hgb.predict(X_val)]
        hgb_metrics = {
            "mae": mae(y_val, hgb_pred),
            "rmse": rmse(y_val, hgb_pred),
            "cv_mae": hgb_cv_metrics["mae"],
            "cv_rmse": hgb_cv_metrics["rmse"],
            "bestParams": hgb_best_params,
        }

        rf_metrics = None
        rf = None
        rf_pred: List[float] = []
        if deep_mode:
            rf_grid = [
                {"n_estimators": n, "max_depth": md, "min_samples_leaf": msl}
                for n in (300, 500)
                for md in (8, 12, None)
                for msl in (1, 3, 6)
            ]

            def build_rf(params: Dict[str, Any]):
                return RandomForestRegressor(
                    random_state=42,
                    n_estimators=int(params.get("n_estimators", 300)),
                    max_depth=None if params.get("max_depth") is None else int(params.get("max_depth")),
                    min_samples_leaf=int(params.get("min_samples_leaf", 1)),
                    n_jobs=-1,
                )

            rf_best_params, rf_cv_metrics = evaluate_grid_candidate(
                X_train, y_train, splits, rf_grid, build_rf
            )
            rf = build_rf(rf_best_params)
            rf.fit(X_train, y_train)
            rf_pred = [float(x) for x in rf.predict(X_val)]
            rf_metrics = {
                "mae": mae(y_val, rf_pred),
                "rmse": rmse(y_val, rf_pred),
                "cv_mae": rf_cv_metrics["mae"],
                "cv_rmse": rf_cv_metrics["rmse"],
                "bestParams": rf_best_params,
            }

        candidates = [
            ("baseline", baseline_metrics["mae"], None, baseline_val_pred),
            ("ridge", ridge_metrics["mae"], ridge, ridge_pred),
            ("hgb", hgb_metrics["mae"], hgb, hgb_pred),
        ]
        if rf is not None and rf_metrics is not None:
            candidates.append(("rf", rf_metrics["mae"], rf, rf_pred))
        candidates.sort(key=lambda x: x[1])
        model_choice, _, model_obj, val_pred = candidates[0]
        if model_choice == "ridge":
            selected_predict_fn = lambda data: [float(x) for x in ridge.predict(data)]
        elif model_choice == "hgb":
            selected_predict_fn = lambda data: [float(x) for x in hgb.predict(data)]
        elif model_choice == "rf" and rf is not None:
            selected_predict_fn = lambda data: [float(x) for x in rf.predict(data)]
        else:
            selected_predict_fn = lambda data: [baseline_predict_vector(v) for v in data]

        metrics_extra = {
            "baseline": baseline_metrics,
            "ridge": ridge_metrics,
            "hgb": hgb_metrics,
            **({"rf": rf_metrics} if rf_metrics is not None else {}),
        }
    except Exception:
        metrics_extra = {"baseline": baseline_metrics}

    # Residual sigma for probability conversion.
    residuals = [a - b for a, b in zip(y_val, val_pred)]
    residual_std = math.sqrt(sum(r * r for r in residuals) / max(1, len(residuals)))
    residual_std = max(2.0, residual_std)
    X_imp, y_imp, pred_imp = sample_validation_for_importance(
        X_val,
        y_val,
        val_pred,
        max(0, int(args.importance_max_rows)),
    )
    feature_importance = permutation_feature_importance(X_imp, y_imp, pred_imp, selected_predict_fn)

    version = f"afl-disp-{slug_time()}"
    models_dir = os.path.join(MODEL_DIR, "models")
    ensure_dir(models_dir)

    if model_obj is not None:
        model_pickle_rel = os.path.join("models", f"{version}.pkl").replace("\\", "/")
        model_pickle_abs = os.path.join(MODEL_DIR, model_pickle_rel.replace("/", os.sep))
        # Compressed joblib keeps large RF/HGB artifacts smaller; compatible with joblib.load in scorers.
        joblib.dump(model_obj, model_pickle_abs, compress=3)

    drop_candidates = build_drop_candidates(
        models_dir,
        feature_importance,
        lookback=max(1, int(args.drop_candidate_lookback)),
        min_consecutive_negative=max(2, int(args.drop_candidate_min_runs)),
    )

    def predict_expected(feature_map: Dict[str, float]) -> float:
        if model_choice == "baseline" or model_obj is None:
            return max(0.0, baseline_predict_row(feature_map))
        vec = [[float(feature_map.get(c, 0.0)) for c in FEATURE_COLUMNS]]
        return max(0.0, float(model_obj.predict(vec)[0]))

    settled_rows = load_settled_calibration_rows()
    calibration_payload = {
        "createdAt": now_iso(),
        "modelVersion": version,
        "method": "identity",
        "sampleCount": 0,
        "metricsBefore": {},
        "metricsAfter": {},
    }
    if len(settled_rows) >= max(20, int(args.calibration_min_samples)):
        y_true: List[int] = []
        p_raw: List[float] = []
        for row in settled_rows:
            line = float(row.get("line", 0.0))
            actual = float(row.get("actualDisposals", 0.0))
            if not math.isfinite(line) or not math.isfinite(actual) or abs(actual - line) < 1e-9:
                continue
            feat_raw = row.get("featureSnapshot")
            if not isinstance(feat_raw, dict):
                continue
            feat = {c: float(feat_raw.get(c, 0.0)) for c in FEATURE_COLUMNS}
            expected = predict_expected(feat)
            sigma_row = row.get("sigma")
            try:
                sigma = float(sigma_row)
            except Exception:
                sigma = residual_std
            sigma = max(2.0, sigma if math.isfinite(sigma) else residual_std)
            prob_over = 1.0 - normal_cdf((line - expected) / sigma if sigma > 0 else 0.0)
            p_raw.append(clamp_prob(prob_over))
            y_true.append(1 if actual > line else 0)

        if len(y_true) >= max(20, int(args.calibration_min_samples)):
            try:
                from sklearn.isotonic import IsotonicRegression

                iso = IsotonicRegression(out_of_bounds="clip")
                y_iso = [float(x) for x in iso.fit_transform(p_raw, y_true)]
                calibration_payload = {
                    "createdAt": now_iso(),
                    "modelVersion": version,
                    "method": "isotonic",
                    "sampleCount": len(y_true),
                    "xThresholds": [float(x) for x in iso.X_thresholds_],
                    "yThresholds": [float(y) for y in iso.y_thresholds_],
                    "metricsBefore": {
                        "brier": round(brier_score(y_true, p_raw), 6),
                        "logLoss": round(log_loss(y_true, p_raw), 6),
                    },
                    "metricsAfter": {
                        "brier": round(brier_score(y_true, y_iso), 6),
                        "logLoss": round(log_loss(y_true, y_iso), 6),
                    },
                }
            except Exception:
                a, b = fit_platt_calibrator(p_raw, y_true)
                y_cal = [calibrate_prob_platt(p, a, b) for p in p_raw]
                calibration_payload = {
                    "createdAt": now_iso(),
                    "modelVersion": version,
                    "method": "platt",
                    "sampleCount": len(y_true),
                    "a": round(a, 8),
                    "b": round(b, 8),
                    "metricsBefore": {
                        "brier": round(brier_score(y_true, p_raw), 6),
                        "logLoss": round(log_loss(y_true, p_raw), 6),
                    },
                    "metricsAfter": {
                        "brier": round(brier_score(y_true, y_cal), 6),
                        "logLoss": round(log_loss(y_true, y_cal), 6),
                    },
                }

    calibration_rel = os.path.join("models", f"{version}.calibration.json").replace("\\", "/")
    calibration_abs = os.path.join(MODEL_DIR, calibration_rel.replace("/", os.sep))
    with open(calibration_abs, "w", encoding="utf-8") as f:
        json.dump(calibration_payload, f, indent=2)

    artifact = {
        "version": version,
        "createdAt": now_iso(),
        "datasetPath": dataset_path,
        "featureColumns": FEATURE_COLUMNS,
        "modelType": model_choice,
        "modelPicklePath": model_pickle_rel,
        "residualStd": residual_std,
        "metrics": metrics_extra,
        "featureImportance": feature_importance,
        "dropCandidates": drop_candidates,
        "validationRows": len(val_rows),
        "trainRows": len(train_rows),
        "importanceRowsUsed": len(X_imp),
        "calibrationPath": calibration_rel,
        "calibrationMethod": calibration_payload.get("method"),
        "calibrationSampleCount": calibration_payload.get("sampleCount"),
    }

    artifact_path = os.path.join(models_dir, f"{version}.json")
    latest_path = os.path.join(models_dir, "latest-model.json")
    latest_candidate_path = os.path.join(models_dir, "latest-candidate-model.json")
    metrics_path = os.path.join(models_dir, f"{version}.metrics.json")
    latest_calibration_path = os.path.join(models_dir, "latest-calibration.json")
    latest_candidate_calibration_path = os.path.join(models_dir, "latest-candidate-calibration.json")
    with open(artifact_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)
    with open(latest_candidate_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)
    with open(latest_candidate_calibration_path, "w", encoding="utf-8") as f:
        json.dump(calibration_payload, f, indent=2)
    if not args.candidate_only:
        with open(latest_path, "w", encoding="utf-8") as f:
            json.dump(artifact, f, indent=2)
        with open(latest_calibration_path, "w", encoding="utf-8") as f:
            json.dump(calibration_payload, f, indent=2)
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "version": version,
                "createdAt": artifact["createdAt"],
                "modelType": model_choice,
                "metrics": metrics_extra,
            },
            f,
            indent=2,
        )
    print(f"Trained model: {version} ({model_choice})")
    print(f"Calibration: {calibration_payload.get('method')} ({calibration_payload.get('sampleCount', 0)} samples)")


if __name__ == "__main__":
    main()
