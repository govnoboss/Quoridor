"""Texel-style weight fitting: logistic regression on extracted position features.

Features are standardized before fitting (zero mean / unit std) with a small L2
regularization; weights are then mapped back to raw units. A train/test split by
game guards against overfitting on correlated positions from the same game.

Run:  python tools/texel/fit_weights.py
"""
import json
import numpy as np
from pathlib import Path
from scipy.optimize import minimize

HERE = Path(__file__).parent
FEAT = HERE / "features.jsonl"
L2 = 1e-3


def load():
    X, y, games = [], [], []
    names = None
    with open(FEAT, encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            if i == 0 and "features" in d:
                names = d["features"]
                continue
            X.append(d["f"])
            y.append(d["y"])
            games.append(d["gi"])
    return np.asarray(X, float), np.asarray(y, float), np.asarray(games), names


def nll(w, Z, y, l2=0.0):
    z = Z @ w
    return float(np.mean(np.logaddexp(0, z) - y * z) + l2 * np.sum(w[:-1] ** 2))


def fit(Z, y):
    w0 = np.zeros(Z.shape[1])
    res = minimize(nll, w0, args=(Z, y, L2), method="L-BFGS-B",
                   options={"maxiter": 3000})
    return res.x


def stats(Z, y, w):
    z = Z @ w
    p = 1.0 / (1.0 + np.exp(-z))
    return float(np.mean((p > 0.5) == (y > 0.5))), float(np.mean(np.logaddexp(0, z) - y * z))


def main():
    X, y, games, names = load()
    n, m = X.shape

    # split by game: 80% train / 20% test (deterministic)
    uniq = np.unique(games)
    rng = np.random.default_rng(42)
    rng.shuffle(uniq)
    test_games = set(uniq[: max(1, len(uniq) // 5)])
    tr = np.array([g not in test_games for g in games])
    te = ~tr

    mu, sd = X.mean(0), X.std(0)
    # constant bias column (all ones) must stay as an intercept, not become zeros
    bias_cols = np.all(np.abs(X - 1.0) < 1e-12, axis=0)
    mu[bias_cols] = 0.0
    sd[bias_cols] = 1.0
    sd[sd < 1e-9] = 1.0
    Z = (X - mu) / sd

    w_std = fit(Z[tr], y[tr])
    acc_tr, ll_tr = stats(Z[tr], y[tr], w_std)
    acc_te, ll_te = stats(Z[te], y[te], w_std)

    # map back to raw units: eval = w_std . ((x-mu)/sd) = (w_std/sd).x - sum(w_std*mu/sd)
    w_raw = w_std / sd
    K = 400.0 / max(1e-9, np.std(X @ w_raw))

    print(f"positions={n} features={m} games={len(uniq)} (test games={len(test_games)})")
    print(f"train acc={acc_tr:.4f} ll={ll_tr:.4f}   test acc={acc_te:.4f} ll={ll_te:.4f}")
    print(f"K(scale to 400cp spread)={K:.2f}")
    print()
    print(f"{'feature':16s} {'std-weight':>12s} {'raw weight':>12s} {'xK':>10s}")
    for name, ws, wr in zip(names, w_std, w_raw):
        print(f"{name:16s} {ws:12.4f} {wr:12.6f} {wr * K:10.2f}")

    out = {
        "features": names,
        "w_std": [float(v) for v in w_std],
        "w_raw": [float(v) for v in w_raw],
        "w_scaled": [float(v * K) for v in w_raw],
        "mu": [float(v) for v in mu],
        "sd": [float(v) for v in sd],
        "K": float(K),
        "acc_train": acc_tr, "acc_test": acc_te,
        "ll_train": ll_tr, "ll_test": ll_te,
        "n_positions": int(n), "n_games": int(len(uniq)),
    }
    (HERE / "texel_weights.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nsaved -> {HERE / 'texel_weights.json'}")


if __name__ == "__main__":
    main()
