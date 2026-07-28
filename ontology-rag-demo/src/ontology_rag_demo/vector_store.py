from __future__ import annotations

import re
from pathlib import Path

import lancedb
import numpy as np
import pyarrow as pa
from numpy.typing import NDArray

from .ingestion import Chunk

VALID_TABLE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


class LanceDBVectorStore:
    def __init__(self, uri: Path, table_name: str) -> None:
        if not VALID_TABLE_NAME.fullmatch(table_name):
            raise ValueError("LanceDB table name must contain only letters, digits and underscores")
        self.uri = uri
        self.table_name = table_name

    def rebuild(
        self,
        chunks: list[Chunk],
        vectors: NDArray[np.float32],
    ) -> int:
        if not chunks:
            raise ValueError("Cannot build an index without chunks")
        if vectors.ndim != 2 or vectors.shape[0] != len(chunks):
            raise ValueError("Vector count must match chunk count")

        self.uri.mkdir(parents=True, exist_ok=True)
        dimension = int(vectors.shape[1])
        data = pa.table(
            {
                "id": pa.array([chunk.id for chunk in chunks], type=pa.string()),
                "text": pa.array([chunk.text for chunk in chunks], type=pa.string()),
                "source": pa.array([chunk.source for chunk in chunks], type=pa.string()),
                "chunk_index": pa.array([chunk.chunk_index for chunk in chunks], type=pa.int32()),
                "content_type": pa.array(
                    [chunk.content_type for chunk in chunks], type=pa.string()
                ),
                "vector": pa.array(
                    vectors.tolist(),
                    type=pa.list_(pa.float32(), dimension),
                ),
            }
        )
        database = lancedb.connect(self.uri)
        database.create_table(self.table_name, data=data, mode="overwrite")
        return len(chunks)

    def search(self, query_vector: NDArray[np.float32], *, top_k: int) -> list[dict]:
        if not self.exists():
            raise RuntimeError("LanceDB index is missing; run `ontology-rag build-index` first")
        vector = np.asarray(query_vector, dtype=np.float32).reshape(-1)
        table = lancedb.connect(self.uri).open_table(self.table_name)
        expected_dimension = table.schema.field("vector").type.list_size
        if vector.size != expected_dimension:
            raise RuntimeError(
                f"Embedding dimension {vector.size} does not match the existing "
                f"LanceDB index dimension {expected_dimension}; rebuild the index"
            )
        rows = (
            table.search(vector)
            .metric("cosine")
            .limit(top_k)
            .select(
                [
                    "id",
                    "text",
                    "source",
                    "chunk_index",
                    "content_type",
                    "_distance",
                ]
            )
            .to_list()
        )
        return [
            {
                "id": row["id"],
                "text": row["text"],
                "source": row["source"],
                "chunk_index": row["chunk_index"],
                "content_type": row["content_type"],
                "distance": float(row["_distance"]),
            }
            for row in rows
        ]

    def exists(self) -> bool:
        if not self.uri.is_dir():
            return False
        return self.table_name in lancedb.connect(self.uri).list_tables().tables
