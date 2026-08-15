"""
Modelo LSTM + Attention para clasificacion de senas dinamicas.
Entrena con CrossEntropy + Supervised Contrastive Loss para forzar
separacion entre clases de senas parecidas (ej. "90" vs "BIEN").
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


class TemporalAttention(nn.Module):
    """Attention pooling sobre la dimension temporal: aprende que frames
    del gesto son mas discriminativos (ej. el pico de movimiento)."""

    def __init__(self, hidden_dim):
        super().__init__()
        self.attn = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.Tanh(),
            nn.Linear(hidden_dim // 2, 1),
        )

    def forward(self, x):
        # x: (B, T, H)
        scores = self.attn(x)              # (B, T, 1)
        weights = torch.softmax(scores, dim=1)
        pooled = (x * weights).sum(dim=1)  # (B, H)
        return pooled, weights.squeeze(-1)


class SignClassifier(nn.Module):
    """
    input_dim=372 (124 landmarks * 3), BiLSTM de 2 capas + attention pooling
    + cabeza de proyeccion (embedding, para contrastive loss) + cabeza de
    clasificacion (logits, para cross-entropy).
    """

    def __init__(self, input_dim=372, hidden_dim=128, num_classes=200,
                 num_layers=2, dropout=0.3, embed_dim=64):
        super().__init__()
        self.input_norm = nn.LayerNorm(input_dim)
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        lstm_out_dim = hidden_dim * 2
        self.attn_pool = TemporalAttention(lstm_out_dim)
        self.dropout = nn.Dropout(dropout)

        self.embed_head = nn.Sequential(
            nn.Linear(lstm_out_dim, embed_dim * 2),
            nn.ReLU(),
            nn.Linear(embed_dim * 2, embed_dim),
        )
        self.classifier = nn.Linear(lstm_out_dim, num_classes)

    def forward(self, x, return_attn=False):
        # x: (B, T, input_dim)
        x = self.input_norm(x)
        out, _ = self.lstm(x)             # (B, T, 2H)
        pooled, attn_w = self.attn_pool(out)
        pooled = self.dropout(pooled)
        logits = self.classifier(pooled)
        embed = F.normalize(self.embed_head(pooled), dim=-1)
        if return_attn:
            return logits, embed, attn_w
        return logits, embed


def supervised_contrastive_loss(embeddings, labels, temperature=0.1):
    """
    SupCon loss (Khosla et al. 2020). Acerca embeddings de la misma clase
    y aleja los de clases distintas dentro del batch. Esto es lo que
    directamente ataca el problema de senas confundibles (ej. 90 vs BIEN):
    fuerza a que sus representaciones sean mas distinguibles.
    """
    device = embeddings.device
    batch_size = embeddings.shape[0]
    labels = labels.view(-1, 1)
    mask = torch.eq(labels, labels.T).float().to(device)  # (B,B) 1 si misma clase

    sim = torch.matmul(embeddings, embeddings.T) / temperature  # (B,B)
    sim_max, _ = torch.max(sim, dim=1, keepdim=True)
    sim = sim - sim_max.detach()  # estabilidad numerica

    logits_mask = torch.ones_like(mask) - torch.eye(batch_size, device=device)
    mask = mask * logits_mask

    exp_sim = torch.exp(sim) * logits_mask
    log_prob = sim - torch.log(exp_sim.sum(dim=1, keepdim=True) + 1e-12)

    pos_counts = mask.sum(dim=1)
    valid = pos_counts > 0
    if valid.sum() == 0:
        return torch.tensor(0.0, device=device)
    mean_log_prob_pos = (mask * log_prob).sum(dim=1)[valid] / pos_counts[valid]
    loss = -mean_log_prob_pos.mean()
    return loss
