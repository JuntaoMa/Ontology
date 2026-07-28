from __future__ import annotations

import httpx

from .ontology import GraphRetrievalResult
from .settings import Settings

SYSTEM_PROMPT = """你是一个基于本体和检索证据回答问题的助手。
只能根据提供的本体子图与文档片段回答。
如果证据不足，明确说明无法从当前证据确认。
回答中使用 [source:chunk_index] 标出文档依据，不要编造引用。"""


class QwenClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def answer(
        self,
        question: str,
        vector_hits: list[dict],
        graph_result: GraphRetrievalResult,
    ) -> str:
        base_url, api_key, model = self.settings.require_qwen()
        document_context = "\n\n".join(
            f"[{hit['source']}:{hit['chunk_index']}]\n{hit['text']}" for hit in vector_hits
        )
        user_prompt = (
            f"问题：\n{question}\n\n"
            f"本体子图证据：\n{graph_result.to_context()}\n\n"
            f"文档证据：\n{document_context or '没有命中文档。'}"
        )
        payload = {
            "model": model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(
            timeout=self.settings.qwen_timeout_seconds,
            headers=headers,
        ) as client:
            response = await client.post(f"{base_url}/chat/completions", json=payload)
            response.raise_for_status()
            body = response.json()
        try:
            return str(body["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("Qwen API returned an unexpected response shape") from exc
