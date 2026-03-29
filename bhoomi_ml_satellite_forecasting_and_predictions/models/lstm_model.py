# BHOOMI — lstm_model.py

import logging
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

from config.constants import METRIC_RANGES, TRAINING_SPLIT_RATIO
from config.settings import MODEL_SAVE_DIR
from models.base_model import BaseModel

log = logging.getLogger(__name__)

METRIC_FEATURES = {
    "ndvi": ["ndvi", "vhi", "lst_celsius", "soil_moisture", "month_sin", "month_cos", "is_monsoon"],
    "vhi": ["vhi", "ndvi", "drought_risk", "soil_moisture", "month_sin", "month_cos"],
    "soil_moisture": ["soil_moisture", "rainfall_mm", "spi_30d", "ndvi", "month_sin", "month_cos", "is_monsoon"],
}


class _LSTMNet(nn.Module):
    """Bidirectional LSTM producing quantile outputs [q10, q50, q90]."""

    # OLD: hidden: int = 64
    def __init__(self, input_size: int, hidden: int = 32):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size, hidden, batch_first=True, bidirectional=True
        )
        self.dropout = nn.Dropout(0.2)
        self.fc = nn.Linear(hidden * 2, 3)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        out = self.dropout(out[:, -1, :])  # last time-step
        return self.fc(out)  # (batch, 3)


def _pinball_loss(
    y: torch.Tensor, q_hat: torch.Tensor, quantiles: list[float]
) -> torch.Tensor:
    """Pinball (quantile) loss summed over quantiles."""
    loss = torch.tensor(0.0, device=y.device)
    for i, q in enumerate(quantiles):
        err = y - q_hat[:, i]
        loss += torch.mean(torch.max(q * err, (q - 1) * err))
    return loss


class BiLSTMModel(BaseModel):
    """Global BiLSTM trained on ALL grids. One model per metric."""

    def __init__(
        self,
        metric: str,
        horizon_days: int,
        # OLD: seq_len=90, hidden=64, epochs=10
        seq_len: int = 30,
        hidden: int = 32,
        lr: float = 0.001,
        epochs: int = 5,
    ):
        super().__init__(metric, grid_id="global", horizon_days=horizon_days)
        self.seq_len = seq_len
        self.hidden = hidden
        self.lr = lr
        self.epochs = epochs
        self.net: _LSTMNet | None = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    @staticmethod
    def _add_time_features(df: pd.DataFrame) -> pd.DataFrame:
        month = df["captured_at"].dt.month
        df["month_sin"] = np.sin(2 * np.pi * month / 12)
        df["month_cos"] = np.cos(2 * np.pi * month / 12)
        return df

    def prepare_sequences(
        self, df: pd.DataFrame
    ) -> tuple[torch.Tensor, torch.Tensor]:
        features = METRIC_FEATURES[self.metric]
        target = self.metric
        vmin, vmax = METRIC_RANGES[target]

        all_X, all_y = [], []
        for _, grp in df.groupby("grid_id"):
            grp = grp.sort_values("captured_at")
            vals = grp[features].copy().fillna(0)
            # normalise each feature to [0, 1]
            for f in features:
                fmin, fmax = METRIC_RANGES.get(f, (vals[f].min(), vals[f].max()))
                vals[f] = (vals[f] - fmin) / (fmax - fmin + 1e-8)
            target_vals = (grp[target].fillna(0).values - vmin) / (vmax - vmin + 1e-8)
            arr = np.nan_to_num(vals.values, nan=0.0)
            for i in range(self.seq_len, len(arr)):
                all_X.append(arr[i - self.seq_len : i])
                all_y.append(target_vals[i])

        X = torch.tensor(np.array(all_X), dtype=torch.float32)
        y = torch.tensor(np.array(all_y), dtype=torch.float32)
        return X, y

    def fit(self, merged_df: pd.DataFrame) -> None:  # type: ignore[override]
        df = merged_df.copy()
        df["captured_at"] = pd.to_datetime(df["captured_at"])
        df = self._add_time_features(df)

        all_dates = df["captured_at"].sort_values().unique()
        split_date = all_dates[int(len(all_dates) * TRAINING_SPLIT_RATIO)]
        train_df = df[df["captured_at"] <= split_date]
        val_df = df[df["captured_at"] > split_date]

        X_train, y_train = self.prepare_sequences(train_df)
        X_val, y_val = self.prepare_sequences(val_df)
        log.info("Sequences — train: %d, val: %d", len(X_train), len(X_val))

        if len(X_train) == 0:
            raise ValueError("LSTM: No training sequences produced")

        input_size = X_train.shape[2]
        self.net = _LSTMNet(input_size, self.hidden).to(self.device)
        optimiser = torch.optim.Adam(self.net.parameters(), lr=self.lr)
        quantiles = [0.1, 0.5, 0.9]
        best_val_loss = np.inf
        best_state = None
        has_val = len(X_val) > 0

        batch_size = 256
        for epoch in range(1, self.epochs + 1):
            self.net.train()
            perm = torch.randperm(len(X_train))
            epoch_loss = 0.0
            n_batches = 0
            for start in range(0, len(X_train), batch_size):
                idx = perm[start : start + batch_size]
                xb = X_train[idx].to(self.device)
                yb = y_train[idx].to(self.device)
                q_hat = self.net(xb)
                loss = _pinball_loss(yb, q_hat, quantiles)
                optimiser.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.net.parameters(), 1.0)
                optimiser.step()
                epoch_loss += loss.item()
                n_batches += 1

            # validation
            if has_val:
                self.net.eval()
                with torch.no_grad():
                    q_hat_v = self.net(X_val.to(self.device))
                    val_loss = _pinball_loss(
                        y_val.to(self.device), q_hat_v, quantiles
                    ).item()
            else:
                val_loss = epoch_loss / max(n_batches, 1)

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_state = self.net.state_dict()

            # OLD: epoch % 10
            if epoch % 1 == 0:
                log.info(
                    "Epoch %d/%d -- train %.4f  val %.4f",
                    epoch,
                    self.epochs,
                    epoch_loss / max(n_batches, 1),
                    val_loss,
                )

        if best_state is not None:
            self.net.load_state_dict(best_state)
        save_path = Path(MODEL_SAVE_DIR) / f"lstm_{self.metric}.pt"
        torch.save(self.net.state_dict(), save_path)
        log.info("Best LSTM saved -> %s (val_loss=%.4f)", save_path, best_val_loss)

    def predict(self, grid_df: pd.DataFrame, steps: int) -> dict:  # type: ignore[override]
        if self.net is None:
            raise RuntimeError("Model not fitted / loaded")

        df = grid_df.copy()
        df["captured_at"] = pd.to_datetime(df["captured_at"])
        df = self._add_time_features(df)
        features = METRIC_FEATURES[self.metric]
        vmin, vmax = METRIC_RANGES[self.metric]

        vals = df[features].tail(self.seq_len).copy()
        for f in features:
            fmin, fmax = METRIC_RANGES.get(f, (vals[f].min(), vals[f].max()))
            vals[f] = (vals[f] - fmin) / (fmax - fmin + 1e-8)
        window = vals.values.copy()  # (seq_len, n_features)

        self.net.eval()
        q10_list, q50_list, q90_list = [], [], []
        with torch.no_grad():
            for _ in range(steps):
                x = torch.tensor(window[np.newaxis, :, :], dtype=torch.float32).to(
                    self.device
                )
                out = self.net(x)  # (1, 3)
                q10, q50, q90 = out[0].cpu().numpy()
                q10_list.append(float(q10 * (vmax - vmin) + vmin))
                q50_list.append(float(q50 * (vmax - vmin) + vmin))
                q90_list.append(float(q90 * (vmax - vmin) + vmin))
                # autoregressive: append q50 as target col (first feature)
                new_row = window[-1].copy()
                new_row[0] = q50
                window = np.vstack([window[1:], new_row[np.newaxis, :]])

        return {
            "val": np.clip(q50_list, vmin, vmax).tolist(),
            "lo": np.clip(q10_list, vmin, vmax).tolist(),
            "hi": np.clip(q90_list, vmin, vmax).tolist(),
        }
