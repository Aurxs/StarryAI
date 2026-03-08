"""OpenAI-compatible LLM node."""

from __future__ import annotations

import json
from typing import Any

import httpx
from pydantic import field_validator

from app.core.config_validation import SECRET_FIELD_KEY, SECRET_WIDGET, SECRET_WIDGET_KEY, TEXTAREA_WIDGET
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec


def _trim_string(value: str) -> str:
    return value.strip()


class OpenAICompatibleLLMConfig(CommonNodeConfig):
    """Config for OpenAI-compatible chat completion nodes."""

    base_url: str = NodeField(
        default="https://api.openai.com",
        description="Base URL of the LLM service.",
        json_schema_extra={"x-starryai-order": 10},
    )
    api_path: str = NodeField(
        default="/v1/chat/completions",
        description="Request path. Supports either a full URL or a relative path.",
        json_schema_extra={"x-starryai-order": 20},
    )
    model: str = NodeField(
        default="gpt-4o-mini",
        description="Target model name.",
        json_schema_extra={"x-starryai-order": 30},
    )
    api_key: str | None = NodeField(
        default=None,
        description="API key used to access the remote LLM service.",
        json_schema_extra={
            "x-starryai-order": 40,
            SECRET_FIELD_KEY: True,
            SECRET_WIDGET_KEY: SECRET_WIDGET,
            "x-starryai-group": "auth",
            "x-starryai-placeholder": "Select or create a secret",
        },
    )
    auth_header_name: str = NodeField(
        default="Authorization",
        description="Authentication header name, such as Authorization or api-key.",
        json_schema_extra={"x-starryai-order": 50},
    )
    auth_scheme: str = NodeField(
        default="Bearer",
        description="Authentication scheme. Leave empty to send the API key directly.",
        json_schema_extra={"x-starryai-order": 60},
    )
    system_prompt: str = NodeField(
        default="You are StarryAI's workflow LLM node.",
        description="System prompt sent to the model.",
        json_schema_extra={
            "x-starryai-order": 70,
            SECRET_WIDGET_KEY: TEXTAREA_WIDGET,
        },
    )
    temperature: float | None = NodeField(
        default=0.2,
        ge=0.0,
        le=2.0,
        description="Sampling temperature.",
        json_schema_extra={"x-starryai-order": 80},
    )
    max_tokens: int | None = NodeField(
        default=None,
        ge=1,
        description="Maximum number of output tokens. Leave empty to let the service decide.",
        json_schema_extra={"x-starryai-order": 90},
    )
    top_p: float | None = NodeField(
        default=None,
        gt=0.0,
        le=1.0,
        description="Top-p sampling parameter.",
        json_schema_extra={"x-starryai-order": 100},
    )
    extra_body_json: str = NodeField(
        default="",
        description="Extra request body JSON object used to inject provider-specific parameters.",
        json_schema_extra={
            "x-starryai-order": 110,
            SECRET_WIDGET_KEY: TEXTAREA_WIDGET,
        },
    )

    @field_validator("base_url", "api_path", "model", "auth_header_name", "auth_scheme", "system_prompt", "extra_body_json")
    @classmethod
    def trim_text_fields(cls, value: str) -> str:
        return _trim_string(value)

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url 必须以 http:// 或 https:// 开头")
        return value.rstrip("/")

    @field_validator("api_path")
    @classmethod
    def validate_api_path(cls, value: str) -> str:
        if not value:
            raise ValueError("api_path 不能为空")
        if value.startswith(("http://", "https://")):
            return value
        if not value.startswith("/"):
            return f"/{value}"
        return value

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        if not value:
            raise ValueError("model 不能为空")
        return value

    @field_validator("auth_header_name")
    @classmethod
    def validate_auth_header_name(cls, value: str) -> str:
        if not value:
            raise ValueError("auth_header_name 不能为空")
        return value

    @field_validator("extra_body_json")
    @classmethod
    def validate_extra_body_json(cls, value: str) -> str:
        if not value:
            return ""
        try:
            payload = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("extra_body_json 必须是合法 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("extra_body_json 必须是 JSON 对象")
        return value


class OpenAICompatibleLLMNode(AsyncNode):
    """Real LLM node backed by an OpenAI-compatible chat completion API."""

    ConfigModel = OpenAICompatibleLLMConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        cfg = self.cfg if isinstance(self.cfg, OpenAICompatibleLLMConfig) else OpenAICompatibleLLMConfig.model_validate(self.config)
        if not cfg.api_key:
            raise ValueError("api_key 未配置，无法调用真实 LLM")

        prompt = str(inputs.get("prompt", ""))
        request_url = self.build_request_url(cfg)
        headers = self.build_headers(cfg)
        body = self.build_request_body(cfg, prompt)
        response_payload = await self.send_request(
            url=request_url,
            headers=headers,
            body=body,
            timeout_s=cfg.timeout_s,
        )

        answer = self.extract_text(response_payload)
        metrics = self.extract_usage_metrics(response_payload, fallback_model=cfg.model)
        return {
            "answer": answer,
            "__node_metrics": metrics,
        }

    @staticmethod
    def build_request_url(cfg: OpenAICompatibleLLMConfig) -> str:
        if cfg.api_path.startswith(("http://", "https://")):
            return cfg.api_path
        return f"{cfg.base_url.rstrip('/')}/{cfg.api_path.lstrip('/')}"

    @staticmethod
    def build_headers(cfg: OpenAICompatibleLLMConfig) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if cfg.api_key:
            auth_value = cfg.api_key if not cfg.auth_scheme else f"{cfg.auth_scheme} {cfg.api_key}"
            headers[cfg.auth_header_name] = auth_value
        return headers

    @staticmethod
    def build_request_body(cfg: OpenAICompatibleLLMConfig, prompt: str) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        if cfg.system_prompt:
            messages.append({"role": "system", "content": cfg.system_prompt})
        messages.append({"role": "user", "content": prompt})

        body: dict[str, Any] = {
            "model": cfg.model,
            "messages": messages,
        }
        if cfg.temperature is not None:
            body["temperature"] = cfg.temperature
        if cfg.max_tokens is not None:
            body["max_tokens"] = cfg.max_tokens
        if cfg.top_p is not None:
            body["top_p"] = cfg.top_p
        if cfg.extra_body_json:
            body.update(json.loads(cfg.extra_body_json))
        return body

    async def send_request(
        self,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> dict[str, Any]:
        request_timeout_s = timeout_s if timeout_s is not None else 60.0
        try:
            async with httpx.AsyncClient(timeout=request_timeout_s, follow_redirects=True) as client:
                response = await client.post(url, headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as exc:
            detail = self._summarize_response_text(exc.response.text)
            raise RuntimeError(
                f"LLM 请求失败 status={exc.response.status_code}: {detail}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"LLM 请求失败: {exc}") from exc
        except ValueError as exc:
            raise RuntimeError("LLM 响应不是合法 JSON") from exc

        if not isinstance(payload, dict):
            raise RuntimeError("LLM 响应必须是 JSON 对象")
        return payload

    @classmethod
    def extract_text(cls, payload: dict[str, Any]) -> str:
        direct_text = payload.get("output_text")
        if isinstance(direct_text, str) and direct_text.strip():
            return direct_text.strip()

        choices = payload.get("choices")
        if isinstance(choices, list):
            for item in choices:
                if not isinstance(item, dict):
                    continue
                message = item.get("message")
                if isinstance(message, dict):
                    content_text = cls._extract_message_content(message.get("content"))
                    if content_text:
                        return content_text
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    return text.strip()

        output_items = payload.get("output")
        if isinstance(output_items, list):
            fragments: list[str] = []
            for item in output_items:
                if not isinstance(item, dict):
                    continue
                content_items = item.get("content")
                if not isinstance(content_items, list):
                    continue
                for content_item in content_items:
                    if not isinstance(content_item, dict):
                        continue
                    text = content_item.get("text")
                    if isinstance(text, str) and text.strip():
                        fragments.append(text.strip())
            if fragments:
                return "\n".join(fragments)

        content_text = cls._extract_message_content(payload.get("content"))
        if content_text:
            return content_text

        raise RuntimeError("LLM 响应中未找到可用文本内容")

    @staticmethod
    def extract_usage_metrics(payload: dict[str, Any], *, fallback_model: str) -> dict[str, Any]:
        metrics: dict[str, Any] = {
            "llm_model": str(payload.get("model") or fallback_model),
        }
        usage = payload.get("usage")
        if not isinstance(usage, dict):
            return metrics

        prompt_tokens = OpenAICompatibleLLMNode._coerce_int(
            usage.get("prompt_tokens", usage.get("input_tokens"))
        )
        completion_tokens = OpenAICompatibleLLMNode._coerce_int(
            usage.get("completion_tokens", usage.get("output_tokens"))
        )
        total_tokens = OpenAICompatibleLLMNode._coerce_int(usage.get("total_tokens"))

        if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens

        if prompt_tokens is not None:
            metrics["llm_prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            metrics["llm_completion_tokens"] = completion_tokens
        if total_tokens is not None:
            metrics["llm_total_tokens"] = total_tokens
        return metrics

    @classmethod
    def _extract_message_content(cls, content: Any) -> str:
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            fragments: list[str] = []
            for item in content:
                if isinstance(item, str) and item.strip():
                    fragments.append(item.strip())
                    continue
                if not isinstance(item, dict):
                    continue
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    fragments.append(text.strip())
                    continue
                if item.get("type") == "text":
                    nested_text = item.get("text")
                    if isinstance(nested_text, str) and nested_text.strip():
                        fragments.append(nested_text.strip())
            if fragments:
                return "\n".join(fragments)
        return ""

    @staticmethod
    def _coerce_int(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
        return None

    @staticmethod
    def _summarize_response_text(value: str, *, limit: int = 240) -> str:
        compact = " ".join(value.split())
        if not compact:
            return "<empty>"
        if len(compact) <= limit:
            return compact
        return f"{compact[:limit]}..."


OPENAI_COMPATIBLE_LLM_SPEC = NodeSpec(
    type_name="llm.openai_compatible",
    version="0.1.0",
    mode=NodeMode.ASYNC,
    inputs=[PortSpec(name="prompt", frame_schema="text.final", required=True)],
    outputs=[PortSpec(name="answer", frame_schema="text.final", required=True)],
    description="Real LLM node compatible with the OpenAI Chat Completions API.",
    config_schema=OpenAICompatibleLLMConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=OPENAI_COMPATIBLE_LLM_SPEC,
    impl_cls=OpenAICompatibleLLMNode,
    config_model=OpenAICompatibleLLMConfig,
)
