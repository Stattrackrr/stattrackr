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
from typing import Dict, List, Tuple

from common import MODEL_DIR, ensure_dir, now_iso, slug_time
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

    # Optional sklearn models.
    try:
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.linear_model import Ridge
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        ridge = Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("model", Ridge(alpha=1.0, random_state=42)),
            ]
        )
        ridge.fit(X_train, y_train)
        ridge_pred = [float(x) for x in ridge.predict(X_val)]
        ridge_metrics = {"mae": mae(y_val, ridge_pred), "rmse": rmse(y_val, ridge_pred)}

        hgb = HistGradientBoostingRegressor(
            random_state=42,
            max_depth=5,
            learning_rate=0.05,
            max_iter=250,
            min_samples_leaf=20,
        )
        hgb.fit(X_train, y_train)
        hgb_pred = [float(x) for x in hgb.predict(X_val)]
        hgb_metrics = {"mae": mae(y_val, hgb_pred), "rmse": rmse(y_val, hgb_pred)}

        candidates = [
            ("baseline", baseline_metrics["mae"], None, baseline_val_pred),
            ("ridge", ridge_metrics["mae"], ridge, ridge_pred),
            ("hgb", hgb_metrics["mae"], hgb, hgb_pred),
        ]
        candidates.sort(key=lambda x: x[1])
        model_choice, _, model_obj, val_pred = candidates[0]
        if model_choice == "ridge":
            selected_predict_fn = lambda data: [float(x) for x in ridge.predict(data)]
        elif model_choice == "hgb":
            selected_predict_fn = lambda data: [float(x) for x in hgb.predict(data)]
        else:
            selected_predict_fn = lambda data: [baseline_predict_vector(v) for v in data]

        metrics_extra = {
            "baseline": baseline_metrics,
            "ridge": ridge_metrics,
            "hgb": hgb_metrics,
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
        with open(model_pickle_abs, "wb") as f:
            pickle.dump(model_obj, f)

    drop_candidates = build_drop_candidates(
        models_dir,
        feature_importance,
        lookback=max(1, int(args.drop_candidate_lookback)),
        min_consecutive_negative=max(2, int(args.drop_candidate_min_runs)),
    )

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
    }

    artifact_path = os.path.join(models_dir, f"{version}.json")
    latest_path = os.path.join(models_dir, "latest-model.json")
    metrics_path = os.path.join(models_dir, f"{version}.metrics.json")
    with open(artifact_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)
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


if __name__ == "__main__":
    main()
