from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SECRET_REF_KIND = 'secret_ref'
SECRET_ID_PATTERN = re.compile(r'^[a-z0-9]+(?:[._-][a-z0-9]+)*$')


class SecretRef(BaseModel):
    """Graph-stored secret reference envelope."""

    model_config = ConfigDict(extra='forbid', populate_by_name=True)

    kind: Literal['secret_ref'] = Field(default='secret_ref', alias='$kind')
    secret_id: str = Field(..., min_length=1)

    @field_validator('secret_id')
    @classmethod
    def validate_secret_id(cls, value: str) -> str:
        normalized = normalize_secret_id(value)
        if not normalized:
            raise ValueError('secret_id 不能为空')
        return normalized


class SecretMetadata(BaseModel):
    """Stored secret metadata without the raw secret value."""

    model_config = ConfigDict(extra='forbid')

    secret_id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    kind: str = Field(default='generic', min_length=1)
    description: str = Field(default='')
    provider: str = Field(default='unknown', min_length=1)
    created_at: float
    updated_at: float

    @field_validator('secret_id')
    @classmethod
    def validate_secret_id(cls, value: str) -> str:
        normalized = normalize_secret_id(value)
        if not normalized:
            raise ValueError('secret_id 不能为空')
        return normalized

    @field_validator('label', 'kind')
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError('字段不能为空')
        return normalized

    @field_validator('description')
    @classmethod
    def trim_optional_text(cls, value: str) -> str:
        return value.strip()


class SecretUsageEntry(BaseModel):
    """Single graph/node usage record for a secret."""

    model_config = ConfigDict(extra='forbid')

    graph_id: str
    node_id: str
    field_path: str


class SecretUsageSummary(BaseModel):
    """Usage information returned to the frontend."""

    model_config = ConfigDict(extra='forbid')

    secret_id: str
    usage_count: int = Field(default=0, ge=0)
    in_use: bool = False
    items: list[SecretUsageEntry] = Field(default_factory=list)


class SecretCatalogEntry(BaseModel):
    """Secret metadata plus usage snapshot for list endpoints."""

    model_config = ConfigDict(extra='forbid')

    secret_id: str
    label: str
    kind: str
    description: str
    provider: str
    created_at: float
    updated_at: float
    usage_count: int = Field(default=0, ge=0)
    in_use: bool = False


class SecretCreateInput(BaseModel):
    """Validated secret create payload."""

    model_config = ConfigDict(extra='forbid')

    label: str = Field(..., min_length=1)
    value: str = Field(..., min_length=1)
    kind: str = Field(default='generic', min_length=1)
    description: str = Field(default='')
    secret_id: str | None = Field(default=None)

    @field_validator('label', 'kind')
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError('字段不能为空')
        return normalized

    @field_validator('description')
    @classmethod
    def trim_optional_text(cls, value: str) -> str:
        return value.strip()

    @field_validator('value')
    @classmethod
    def validate_value(cls, value: str) -> str:
        if not value:
            raise ValueError('secret value 不能为空')
        return value

    @field_validator('secret_id')
    @classmethod
    def normalize_optional_secret_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = normalize_secret_id(value)
        if not normalized:
            raise ValueError('secret_id 非法')
        return normalized


class SecretMetadataPatch(BaseModel):
    """Editable secret metadata fields."""

    model_config = ConfigDict(extra='forbid')

    label: str | None = Field(default=None)
    kind: str | None = Field(default=None)
    description: str | None = Field(default=None)

    @field_validator('label', 'kind')
    @classmethod
    def trim_optional_required_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError('字段不能为空')
        return normalized

    @field_validator('description')
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


def normalize_secret_id(raw_value: Any) -> str:
    if not isinstance(raw_value, str):
        return ''
    normalized = raw_value.strip().lower()
    if not normalized:
        return ''
    normalized = re.sub(r'\s+', '-', normalized)
    normalized = re.sub(r'[^a-z0-9._-]+', '-', normalized)
    normalized = re.sub(r'-{2,}', '-', normalized).strip('._-')
    if not normalized or not SECRET_ID_PATTERN.match(normalized):
        return ''
    return normalized


def build_secret_ref(secret_id: str) -> dict[str, str]:
    normalized = normalize_secret_id(secret_id)
    if not normalized:
        raise ValueError(f'非法 secret_id: {secret_id!r}')
    return {'$kind': SECRET_REF_KIND, 'secret_id': normalized}


def is_secret_ref(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get('$kind') != SECRET_REF_KIND:
        return False
    return bool(normalize_secret_id(payload.get('secret_id')))


__all__ = [
    'SECRET_ID_PATTERN',
    'SECRET_REF_KIND',
    'SecretCatalogEntry',
    'SecretCreateInput',
    'SecretMetadata',
    'SecretMetadataPatch',
    'SecretRef',
    'SecretUsageEntry',
    'SecretUsageSummary',
    'build_secret_ref',
    'is_secret_ref',
    'normalize_secret_id',
]
