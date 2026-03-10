"""Unified multi-provider LLM chat node."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import field_validator

from app.core.config_validation import (
    SECRET_FIELD_KEY,
    SECRET_WIDGET,
    SECRET_WIDGET_KEY,
    TEXTAREA_WIDGET,
)
from app.core.node_async import AsyncNode
from app.core.node_base import NodeContext
from app.core.node_config import CommonNodeConfig, NodeField
from app.core.node_definition import NodeDefinition
from app.core.spec import NodeMode, NodeSpec, PortSpec

LLM_PRESET_IDS = (
    "openai",
    "deepseek",
    "qwen_openai",
    "openrouter",
    "anthropic",
    "gemini",
    "custom_openai",
)
LLMChatPresetId = Literal[
    "openai",
    "deepseek",
    "qwen_openai",
    "openrouter",
    "anthropic",
    "gemini",
    "custom_openai",
]
LLMAdapterId = Literal[
    "openai_chat_completions",
    "anthropic_messages",
    "gemini_generate_content",
]


@dataclass(frozen=True, slots=True)
class ProviderPreset:
    preset_id: str
    provider: str
    adapter: LLMAdapterId
    base_url: str
    api_path: str
    default_model: str
    default_temperature: float | None = 0.2
    default_top_p: float | None = None
    default_max_tokens: int | None = None
    auth_header_name: str = "Authorization"
    auth_scheme: str | None = "Bearer"
    extra_headers: tuple[tuple[str, str], ...] = ()


PRESETS: dict[str, ProviderPreset] = {
    "openai": ProviderPreset(
        preset_id="openai",
        provider="openai",
        adapter="openai_chat_completions",
        base_url="https://api.openai.com",
        api_path="/v1/chat/completions",
        default_model="gpt-4o-mini",
    ),
    "deepseek": ProviderPreset(
        preset_id="deepseek",
        provider="deepseek",
        adapter="openai_chat_completions",
        base_url="https://api.deepseek.com",
        api_path="/chat/completions",
        default_model="deepseek-chat",
    ),
    "qwen_openai": ProviderPreset(
        preset_id="qwen_openai",
        provider="qwen",
        adapter="openai_chat_completions",
        base_url="https://dashscope.aliyuncs.com/compatible-mode",
        api_path="/v1/chat/completions",
        default_model="qwen-plus",
    ),
    "openrouter": ProviderPreset(
        preset_id="openrouter",
        provider="openrouter",
        adapter="openai_chat_completions",
        base_url="https://openrouter.ai/api",
        api_path="/v1/chat/completions",
        default_model="openai/gpt-4o-mini",
    ),
    "anthropic": ProviderPreset(
        preset_id="anthropic",
        provider="anthropic",
        adapter="anthropic_messages",
        base_url="https://api.anthropic.com",
        api_path="/v1/messages",
        default_model="claude-sonnet-4-20250514",
        default_max_tokens=1024,
        auth_header_name="x-api-key",
        auth_scheme=None,
        extra_headers=(("anthropic-version", "2023-06-01"),),
    ),
    "gemini": ProviderPreset(
        preset_id="gemini",
        provider="gemini",
        adapter="gemini_generate_content",
        base_url="https://generativelanguage.googleapis.com",
        api_path="/v1beta/models/{model}:generateContent",
        default_model="gemini-2.5-flash",
        auth_header_name="x-goog-api-key",
        auth_scheme=None,
    ),
    "custom_openai": ProviderPreset(
        preset_id="custom_openai",
        provider="custom_openai",
        adapter="openai_chat_completions",
        base_url="https://api.openai.com",
        api_path="/v1/chat/completions",
        default_model="gpt-4o-mini",
    ),
}


@dataclass(frozen=True, slots=True)
class ProviderRequest:
    url: str
    headers: dict[str, str]
    body: dict[str, Any]
    effective_model: str


@dataclass(frozen=True, slots=True)
class TransportResponse:
    payload: dict[str, Any]
    headers: dict[str, str]


@dataclass(frozen=True, slots=True)
class NormalizedLLMResult:
    answer: str
    provider: str
    preset_id: str
    model: str
    finish_reason: str | None
    request_id: str | None
    response_id: str | None
    usage: dict[str, int]

    def to_result_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "answer": self.answer,
            "provider": self.provider,
            "preset_id": self.preset_id,
            "model": self.model,
            "usage": dict(self.usage),
        }
        if self.finish_reason:
            payload["finish_reason"] = self.finish_reason
        if self.request_id:
            payload["request_id"] = self.request_id
        if self.response_id:
            payload["response_id"] = self.response_id
        return payload

    def to_metrics(self) -> dict[str, Any]:
        metrics: dict[str, Any] = {
            "llm_provider": self.provider,
            "llm_preset_id": self.preset_id,
            "llm_model": self.model,
        }
        if self.finish_reason:
            metrics["llm_finish_reason"] = self.finish_reason
        if self.request_id:
            metrics["llm_request_id"] = self.request_id
        if self.response_id:
            metrics["llm_response_id"] = self.response_id
        prompt_tokens = self.usage.get("prompt_tokens")
        completion_tokens = self.usage.get("completion_tokens")
        total_tokens = self.usage.get("total_tokens")
        if prompt_tokens is not None:
            metrics["llm_prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            metrics["llm_completion_tokens"] = completion_tokens
        if total_tokens is not None:
            metrics["llm_total_tokens"] = total_tokens
        return metrics


def _trim_string(value: str) -> str:
    return value.strip()


def _trim_optional_string(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


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


def _merge_extra_body(body: dict[str, Any], extra_body_json: str) -> dict[str, Any]:
    if not extra_body_json:
        return body
    merged = dict(body)
    merged.update(json.loads(extra_body_json))
    return merged


def _normalize_gemini_model_name(model: str) -> str:
    trimmed = model.strip()
    if trimmed.startswith("models/"):
        return trimmed[len("models/") :]
    return trimmed


class LLMChatConfig(CommonNodeConfig):
    """Config for the unified chat-style LLM node."""

    preset_id: LLMChatPresetId = NodeField(
        default="openai",
        description="Provider preset used to resolve the endpoint and auth protocol.",
        json_schema_extra={"x-starryai-order": 10},
    )
    model: str | None = NodeField(
        default=None,
        description="Optional model override. Leave empty to use the preset default model.",
        json_schema_extra={"x-starryai-order": 20},
    )
    api_key: str | None = NodeField(
        default=None,
        description="API key used to access the remote LLM service.",
        json_schema_extra={
            "x-starryai-order": 30,
            SECRET_FIELD_KEY: True,
            SECRET_WIDGET_KEY: SECRET_WIDGET,
            "x-starryai-group": "auth",
            "x-starryai-placeholder": "Select or create a secret",
        },
    )
    system_prompt: str = NodeField(
        default="You are StarryAI's workflow LLM node.",
        description="Optional system prompt sent ahead of the user prompt.",
        json_schema_extra={
            "x-starryai-order": 40,
            SECRET_WIDGET_KEY: TEXTAREA_WIDGET,
        },
    )
    temperature: float | None = NodeField(
        default=0.2,
        ge=0.0,
        le=2.0,
        description="Sampling temperature.",
        json_schema_extra={"x-starryai-order": 50},
    )
    max_tokens: int | None = NodeField(
        default=None,
        ge=1,
        description="Optional maximum number of output tokens.",
        json_schema_extra={"x-starryai-order": 60},
    )
    top_p: float | None = NodeField(
        default=None,
        gt=0.0,
        le=1.0,
        description="Optional top-p sampling value.",
        json_schema_extra={"x-starryai-order": 70},
    )
    base_url_override: str | None = NodeField(
        default=None,
        description="Optional base URL override for compatible gateways or private deployments.",
        json_schema_extra={"x-starryai-order": 200},
    )
    extra_body_json: str = NodeField(
        default="",
        description="Optional extra request body JSON object for provider-specific parameters.",
        json_schema_extra={
            "x-starryai-order": 210,
            SECRET_WIDGET_KEY: TEXTAREA_WIDGET,
        },
    )

    @field_validator("model", "api_key", "base_url_override", mode="before")
    @classmethod
    def trim_optional_text_fields(cls, value: Any) -> str | None:
        if value is None:
            return None
        return _trim_optional_string(str(value))

    @field_validator("system_prompt", "extra_body_json", mode="before")
    @classmethod
    def trim_required_text_fields(cls, value: Any) -> str:
        return _trim_string(str(value))

    @field_validator("base_url_override")
    @classmethod
    def validate_base_url_override(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url_override must start with http:// or https://")
        return value.rstrip("/")

    @field_validator("extra_body_json")
    @classmethod
    def validate_extra_body_json(cls, value: str) -> str:
        if not value:
            return ""
        try:
            payload = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("extra_body_json must be valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("extra_body_json must be a JSON object")
        return value


class LLMChatNode(AsyncNode):
    """Unified chat node backed by provider presets."""

    ConfigModel = LLMChatConfig

    async def process(self, inputs: dict[str, Any], context: NodeContext) -> dict[str, Any]:
        _ = context
        cfg = (
            self.cfg
            if isinstance(self.cfg, LLMChatConfig)
            else LLMChatConfig.model_validate(self.config)
        )
        if not cfg.api_key:
            raise ValueError("api_key is required for llm.chat")

        prompt = str(inputs.get("prompt", ""))
        preset = self._resolve_preset(cfg.preset_id)
        request = self._build_provider_request(cfg, preset, prompt)
        transport = await self.send_request(
            url=request.url,
            headers=request.headers,
            body=request.body,
            timeout_s=cfg.timeout_s,
        )
        result = self._normalize_response(
            preset=preset,
            effective_model=request.effective_model,
            transport=transport,
        )
        return {
            "answer": result.answer,
            "result": result.to_result_payload(),
            "__node_metrics": result.to_metrics(),
        }

    @staticmethod
    def _resolve_preset(preset_id: str) -> ProviderPreset:
        try:
            return PRESETS[preset_id]
        except KeyError as exc:
            raise ValueError(f"unknown llm preset: {preset_id}") from exc

    def _build_provider_request(
        self,
        cfg: LLMChatConfig,
        preset: ProviderPreset,
        prompt: str,
    ) -> ProviderRequest:
        effective_model = (cfg.model or preset.default_model).strip()
        if not effective_model:
            raise ValueError(f"model is required for preset {preset.preset_id}")

        if preset.adapter == "openai_chat_completions":
            return self._build_openai_request(cfg, preset, prompt, effective_model)
        if preset.adapter == "anthropic_messages":
            return self._build_anthropic_request(cfg, preset, prompt, effective_model)
        if preset.adapter == "gemini_generate_content":
            return self._build_gemini_request(cfg, preset, prompt, effective_model)
        raise ValueError(f"unsupported adapter: {preset.adapter}")

    def _build_openai_request(
        self,
        cfg: LLMChatConfig,
        preset: ProviderPreset,
        prompt: str,
        effective_model: str,
    ) -> ProviderRequest:
        body: dict[str, Any] = {
            "model": effective_model,
            "messages": self._build_openai_messages(prompt=prompt, system_prompt=cfg.system_prompt),
        }
        temperature = cfg.temperature if cfg.temperature is not None else preset.default_temperature
        if temperature is not None:
            body["temperature"] = temperature
        top_p = cfg.top_p if cfg.top_p is not None else preset.default_top_p
        if top_p is not None:
            body["top_p"] = top_p
        max_tokens = cfg.max_tokens if cfg.max_tokens is not None else preset.default_max_tokens
        if max_tokens is not None:
            body["max_tokens"] = max_tokens

        headers = self._build_headers(
            api_key=cfg.api_key,
            preset=preset,
        )
        url = self._build_request_url(
            base_url=cfg.base_url_override or preset.base_url,
            api_path=preset.api_path,
        )
        return ProviderRequest(
            url=url,
            headers=headers,
            body=_merge_extra_body(body, cfg.extra_body_json),
            effective_model=effective_model,
        )

    def _build_anthropic_request(
        self,
        cfg: LLMChatConfig,
        preset: ProviderPreset,
        prompt: str,
        effective_model: str,
    ) -> ProviderRequest:
        body: dict[str, Any] = {
            "model": effective_model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": cfg.max_tokens or preset.default_max_tokens or 1024,
        }
        if cfg.system_prompt:
            body["system"] = cfg.system_prompt
        temperature = cfg.temperature if cfg.temperature is not None else preset.default_temperature
        if temperature is not None:
            body["temperature"] = temperature
        top_p = cfg.top_p if cfg.top_p is not None else preset.default_top_p
        if top_p is not None:
            body["top_p"] = top_p

        headers = self._build_headers(
            api_key=cfg.api_key,
            preset=preset,
        )
        url = self._build_request_url(
            base_url=cfg.base_url_override or preset.base_url,
            api_path=preset.api_path,
        )
        return ProviderRequest(
            url=url,
            headers=headers,
            body=_merge_extra_body(body, cfg.extra_body_json),
            effective_model=effective_model,
        )

    def _build_gemini_request(
        self,
        cfg: LLMChatConfig,
        preset: ProviderPreset,
        prompt: str,
        effective_model: str,
    ) -> ProviderRequest:
        normalized_model = _normalize_gemini_model_name(effective_model)
        body: dict[str, Any] = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ]
        }
        generation_config: dict[str, Any] = {}
        temperature = cfg.temperature if cfg.temperature is not None else preset.default_temperature
        if temperature is not None:
            generation_config["temperature"] = temperature
        top_p = cfg.top_p if cfg.top_p is not None else preset.default_top_p
        if top_p is not None:
            generation_config["topP"] = top_p
        max_tokens = cfg.max_tokens if cfg.max_tokens is not None else preset.default_max_tokens
        if max_tokens is not None:
            generation_config["maxOutputTokens"] = max_tokens
        if generation_config:
            body["generationConfig"] = generation_config
        if cfg.system_prompt:
            body["system_instruction"] = {
                "parts": [{"text": cfg.system_prompt}],
            }

        headers = self._build_headers(
            api_key=cfg.api_key,
            preset=preset,
        )
        api_path = preset.api_path.format(model=quote(normalized_model, safe=""))
        url = self._build_request_url(
            base_url=cfg.base_url_override or preset.base_url,
            api_path=api_path,
        )
        return ProviderRequest(
            url=url,
            headers=headers,
            body=_merge_extra_body(body, cfg.extra_body_json),
            effective_model=normalized_model,
        )

    @staticmethod
    def _build_headers(*, api_key: str | None, preset: ProviderPreset) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if api_key:
            auth_value = api_key if not preset.auth_scheme else f"{preset.auth_scheme} {api_key}"
            headers[preset.auth_header_name] = auth_value
        for key, value in preset.extra_headers:
            headers[key] = value
        return headers

    @staticmethod
    def _build_request_url(*, base_url: str, api_path: str) -> str:
        return f"{base_url.rstrip('/')}/{api_path.lstrip('/')}"

    @staticmethod
    def _build_openai_messages(*, prompt: str, system_prompt: str) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return messages

    async def send_request(
        self,
        *,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout_s: float | None,
    ) -> TransportResponse:
        request_timeout_s = timeout_s if timeout_s is not None else 60.0
        try:
            async with httpx.AsyncClient(timeout=request_timeout_s, follow_redirects=True) as client:
                response = await client.post(url, headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
                normalized_headers = {
                    str(key).lower(): str(value)
                    for key, value in response.headers.items()
                }
        except httpx.HTTPStatusError as exc:
            detail = self._summarize_response_text(exc.response.text)
            raise RuntimeError(
                f"llm.chat request failed status={exc.response.status_code}: {detail}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"llm.chat request failed: {exc}") from exc
        except ValueError as exc:
            raise RuntimeError("llm.chat response is not valid JSON") from exc

        if not isinstance(payload, dict):
            raise RuntimeError("llm.chat response must be a JSON object")
        return TransportResponse(payload=payload, headers=normalized_headers)

    def _normalize_response(
        self,
        *,
        preset: ProviderPreset,
        effective_model: str,
        transport: TransportResponse,
    ) -> NormalizedLLMResult:
        if preset.adapter == "openai_chat_completions":
            return self._normalize_openai_response(preset, effective_model, transport)
        if preset.adapter == "anthropic_messages":
            return self._normalize_anthropic_response(preset, effective_model, transport)
        if preset.adapter == "gemini_generate_content":
            return self._normalize_gemini_response(preset, effective_model, transport)
        raise ValueError(f"unsupported adapter: {preset.adapter}")

    def _normalize_openai_response(
        self,
        preset: ProviderPreset,
        effective_model: str,
        transport: TransportResponse,
    ) -> NormalizedLLMResult:
        payload = transport.payload
        answer = self._extract_openai_text(payload)
        usage = self._extract_openai_usage(payload)
        finish_reason = self._extract_openai_finish_reason(payload)
        request_id = self._extract_request_id(transport.headers, payload)
        response_id = self._extract_response_id(payload)
        model = str(payload.get("model") or effective_model)
        return NormalizedLLMResult(
            answer=answer,
            provider=preset.provider,
            preset_id=preset.preset_id,
            model=model,
            finish_reason=finish_reason,
            request_id=request_id,
            response_id=response_id,
            usage=usage,
        )

    def _normalize_anthropic_response(
        self,
        preset: ProviderPreset,
        effective_model: str,
        transport: TransportResponse,
    ) -> NormalizedLLMResult:
        payload = transport.payload
        answer = self._extract_anthropic_text(payload)
        usage = self._extract_anthropic_usage(payload)
        finish_reason = self._extract_optional_text(payload.get("stop_reason"))
        request_id = self._extract_request_id(transport.headers, payload)
        response_id = self._extract_response_id(payload)
        model = str(payload.get("model") or effective_model)
        return NormalizedLLMResult(
            answer=answer,
            provider=preset.provider,
            preset_id=preset.preset_id,
            model=model,
            finish_reason=finish_reason,
            request_id=request_id,
            response_id=response_id,
            usage=usage,
        )

    def _normalize_gemini_response(
        self,
        preset: ProviderPreset,
        effective_model: str,
        transport: TransportResponse,
    ) -> NormalizedLLMResult:
        payload = transport.payload
        answer = self._extract_gemini_text(payload)
        usage = self._extract_gemini_usage(payload)
        finish_reason = self._extract_gemini_finish_reason(payload)
        request_id = self._extract_request_id(transport.headers, payload)
        response_id = self._extract_response_id(payload)
        model = str(payload.get("modelVersion") or payload.get("model") or effective_model)
        return NormalizedLLMResult(
            answer=answer,
            provider=preset.provider,
            preset_id=preset.preset_id,
            model=model,
            finish_reason=finish_reason,
            request_id=request_id,
            response_id=response_id,
            usage=usage,
        )

    @classmethod
    def _extract_openai_text(cls, payload: dict[str, Any]) -> str:
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
        raise RuntimeError("llm.chat did not find answer text in the provider response")

    @classmethod
    def _extract_anthropic_text(cls, payload: dict[str, Any]) -> str:
        content = payload.get("content")
        if not isinstance(content, list):
            raise RuntimeError("anthropic response does not contain content blocks")
        fragments: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "text":
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                fragments.append(text.strip())
        if fragments:
            return "\n".join(fragments)
        raise RuntimeError("anthropic response does not contain text content")

    @classmethod
    def _extract_gemini_text(cls, payload: dict[str, Any]) -> str:
        candidates = payload.get("candidates")
        if not isinstance(candidates, list):
            raise RuntimeError("gemini response does not contain candidates")
        fragments: list[str] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content")
            if not isinstance(content, dict):
                continue
            parts = content.get("parts")
            if not isinstance(parts, list):
                continue
            for part in parts:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    fragments.append(text.strip())
            if fragments:
                return "\n".join(fragments)
        raise RuntimeError("gemini response does not contain text content")

    @staticmethod
    def _extract_openai_usage(payload: dict[str, Any]) -> dict[str, int]:
        usage = payload.get("usage")
        if not isinstance(usage, dict):
            return {}
        prompt_tokens = _coerce_int(usage.get("prompt_tokens", usage.get("input_tokens")))
        completion_tokens = _coerce_int(
            usage.get("completion_tokens", usage.get("output_tokens"))
        )
        total_tokens = _coerce_int(usage.get("total_tokens"))
        if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens
        return LLMChatNode._build_usage_dict(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )

    @staticmethod
    def _extract_anthropic_usage(payload: dict[str, Any]) -> dict[str, int]:
        usage = payload.get("usage")
        if not isinstance(usage, dict):
            return {}
        prompt_tokens = _coerce_int(usage.get("input_tokens"))
        completion_tokens = _coerce_int(usage.get("output_tokens"))
        total_tokens = None
        if prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens
        return LLMChatNode._build_usage_dict(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )

    @staticmethod
    def _extract_gemini_usage(payload: dict[str, Any]) -> dict[str, int]:
        usage = payload.get("usageMetadata")
        if not isinstance(usage, dict):
            return {}
        prompt_tokens = _coerce_int(usage.get("promptTokenCount"))
        completion_tokens = _coerce_int(usage.get("candidatesTokenCount"))
        total_tokens = _coerce_int(usage.get("totalTokenCount"))
        return LLMChatNode._build_usage_dict(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )

    @staticmethod
    def _build_usage_dict(
        *,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        total_tokens: int | None,
    ) -> dict[str, int]:
        usage: dict[str, int] = {}
        if prompt_tokens is not None:
            usage["prompt_tokens"] = prompt_tokens
        if completion_tokens is not None:
            usage["completion_tokens"] = completion_tokens
        if total_tokens is not None:
            usage["total_tokens"] = total_tokens
        return usage

    @staticmethod
    def _extract_openai_finish_reason(payload: dict[str, Any]) -> str | None:
        choices = payload.get("choices")
        if not isinstance(choices, list):
            return None
        for item in choices:
            if not isinstance(item, dict):
                continue
            finish_reason = item.get("finish_reason")
            if isinstance(finish_reason, str) and finish_reason.strip():
                return finish_reason.strip()
        return None

    @staticmethod
    def _extract_gemini_finish_reason(payload: dict[str, Any]) -> str | None:
        candidates = payload.get("candidates")
        if not isinstance(candidates, list):
            return None
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            finish_reason = candidate.get("finishReason")
            if isinstance(finish_reason, str) and finish_reason.strip():
                return finish_reason.strip()
        return None

    @staticmethod
    def _extract_request_id(headers: dict[str, str], payload: dict[str, Any]) -> str | None:
        for key in ("x-request-id", "request-id", "x-goog-request-id"):
            value = headers.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("request_id", "requestId"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _extract_response_id(payload: dict[str, Any]) -> str | None:
        for key in ("id", "responseId", "response_id"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

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
            if fragments:
                return "\n".join(fragments)
        return ""

    @staticmethod
    def _extract_optional_text(value: Any) -> str | None:
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    @staticmethod
    def _summarize_response_text(value: str, *, limit: int = 240) -> str:
        compact = " ".join(value.split())
        if not compact:
            return "<empty>"
        if len(compact) <= limit:
            return compact
        return f"{compact[:limit]}..."


LLM_CHAT_SPEC = NodeSpec(
    type_name="llm.chat",
    version="0.1.0",
    mode=NodeMode.ASYNC,
    inputs=[PortSpec(name="prompt", frame_schema="text.final", required=True)],
    outputs=[
        PortSpec(name="answer", frame_schema="text.final", required=True),
        PortSpec(name="result", frame_schema="json.object", required=True),
    ],
    description="Unified chat-style LLM node with provider presets and normalized outputs.",
    config_schema=LLMChatConfig.model_json_schema(),
)


NODE_DEFINITION = NodeDefinition(
    spec=LLM_CHAT_SPEC,
    impl_cls=LLMChatNode,
    config_model=LLMChatConfig,
)
