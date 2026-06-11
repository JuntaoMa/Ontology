"""JudgeBackend 双适配（plan §4.5）：CLI（订阅，demo 默认）/ API / cassette 回放。

选择顺序（AC-J-BACKEND）：config 显式指定 > ANTHROPIC_API_KEY 用 Api >
claude CLI 可用用 Cli > 都没有 → None（调用方落 cassette-only 模式）。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Protocol

DEFAULT_MODEL = "claude-opus-4-8"

_DISALLOWED_TOOLS = ("Bash,Edit,Write,Read,Glob,Grep,WebSearch,WebFetch,"
                     "Task,NotebookEdit,TodoWrite")


@dataclass
class BackendResponse:
    text: str
    tokens_in: int = 0
    tokens_out: int = 0


class JudgeBackend(Protocol):
    name: str
    def complete(self, system: str, prompt: str, model: str) -> BackendResponse: ...


class CliBackend:
    """claude -p headless：走 Claude Code 订阅认证，无需 API key。"""
    name = "cli"

    def __init__(self, binary: str = "claude", timeout: int = 300):
        self.binary = binary
        self.timeout = timeout

    def complete(self, system: str, prompt: str, model: str) -> BackendResponse:
        cmd = [self.binary, "-p", "--output-format", "json",
               "--model", model,
               "--system-prompt", system,
               "--disallowedTools", _DISALLOWED_TOOLS]
        proc = subprocess.run(cmd, input=prompt, capture_output=True,
                              text=True, timeout=self.timeout)
        if proc.returncode != 0:
            raise RuntimeError(f"claude CLI 退出码 {proc.returncode}: {proc.stderr[:300]}")
        envelope = json.loads(proc.stdout)
        usage = envelope.get("usage", {}) or {}
        return BackendResponse(
            text=envelope.get("result", ""),
            tokens_in=int(usage.get("input_tokens", 0) or 0),
            tokens_out=int(usage.get("output_tokens", 0) or 0))


class ApiBackend:
    """anthropic SDK：服务化/批量场景。"""
    name = "api"

    def __init__(self, api_key: str | None = None):
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()

    def complete(self, system: str, prompt: str, model: str) -> BackendResponse:
        resp = self.client.messages.create(
            model=model, max_tokens=16000, system=system,
            messages=[{"role": "user", "content": prompt}])
        text = next((b.text for b in resp.content if b.type == "text"), "")
        return BackendResponse(text=text,
                               tokens_in=resp.usage.input_tokens,
                               tokens_out=resp.usage.output_tokens)


def select_backend(config: dict | None = None) -> JudgeBackend | None:
    cfg = (config or {}).get("judge", {})
    if "backend_obj" in cfg:                      # 测试注入
        return cfg["backend_obj"]
    explicit = cfg.get("backend")
    if explicit == "cassette":
        return None
    if explicit == "api":
        return ApiBackend()
    if explicit == "cli":
        return CliBackend()
    if os.environ.get("ANTHROPIC_API_KEY"):
        return ApiBackend()
    if shutil.which("claude"):
        return CliBackend()
    return None
