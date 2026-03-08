from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.secrets.models import SecretCatalogEntry, SecretUsageEntry


class SecretListResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')

    count: int = Field(ge=0)
    items: list[SecretCatalogEntry] = Field(default_factory=list)


class CreateSecretRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    label: str = Field(..., min_length=1)
    value: str = Field(..., min_length=1)
    kind: str = Field(default='generic', min_length=1)
    description: str = Field(default='')
    secret_id: str | None = Field(default=None)


class UpdateSecretRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    label: str | None = None
    kind: str | None = None
    description: str | None = None


class RotateSecretRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    value: str = Field(..., min_length=1)


class SecretUsageResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')

    secret_id: str
    usage_count: int = Field(ge=0)
    in_use: bool
    items: list[SecretUsageEntry] = Field(default_factory=list)
