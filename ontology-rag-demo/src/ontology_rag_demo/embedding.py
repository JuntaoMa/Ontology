from __future__ import annotations

import hashlib
import re
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from .settings import Settings


class Embedder(Protocol):
    @property
    def dimension(self) -> int: ...

    def encode(self, texts: list[str]) -> NDArray[np.float32]: ...


class DeterministicEmbedder:
    """Small offline embedder for tests and plumbing checks, not quality evaluation."""

    def __init__(self, dimension: int = 64) -> None:
        self._dimension = dimension

    @property
    def dimension(self) -> int:
        return self._dimension

    def encode(self, texts: list[str]) -> NDArray[np.float32]:
        vectors = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            tokens = re.findall(r"[\w-]+", text.casefold(), flags=re.UNICODE)
            for token in tokens:
                digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
                index = int.from_bytes(digest[:4], "big") % self.dimension
                sign = 1.0 if digest[4] & 1 else -1.0
                vectors[row, index] += sign
            norm = float(np.linalg.norm(vectors[row]))
            if norm == 0:
                vectors[row, 0] = 1.0
            else:
                vectors[row] /= norm
        return vectors


class BgeM3Embedder:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = None
        self._dimension = 1024

    @property
    def dimension(self) -> int:
        return self._dimension

    def _load(self):
        if self._model is not None:
            return self._model

        if self.settings.embedding_device == "mps":
            import torch

            if not torch.backends.mps.is_available():
                raise RuntimeError(
                    "EMBEDDING_DEVICE=mps was requested but PyTorch MPS is unavailable"
                )

        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(
            self.settings.embedding_model,
            device=self.settings.embedding_device,
        )
        model.max_seq_length = self.settings.embedding_max_length
        dimension = model.get_embedding_dimension()
        if dimension is not None:
            self._dimension = int(dimension)
        self._model = model
        return model

    def encode(self, texts: list[str]) -> NDArray[np.float32]:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        model = self._load()
        vectors = model.encode(
            texts,
            batch_size=self.settings.embedding_batch_size,
            convert_to_numpy=True,
            normalize_embeddings=self.settings.embedding_normalize,
            show_progress_bar=len(texts) > self.settings.embedding_batch_size,
        )
        return np.asarray(vectors, dtype=np.float32)


def build_embedder(settings: Settings) -> Embedder:
    if settings.embedding_backend == "deterministic":
        return DeterministicEmbedder()
    return BgeM3Embedder(settings)
