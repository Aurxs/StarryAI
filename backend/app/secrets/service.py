from __future__ import annotations

import threading
from collections import Counter
from typing import Any

from app.core.spec import GraphSpec
from app.services.graph_repository import FileGraphRepository, get_graph_repository

from .models import (
    SecretCatalogEntry,
    SecretCreateInput,
    SecretMetadata,
    SecretMetadataPatch,
    SecretUsageEntry,
    SecretUsageSummary,
    is_secret_ref,
    normalize_secret_id,
)
from .store import (
    JsonSecretMetadataStore,
    SecretAlreadyExistsError,
    SecretInUseError,
    SecretNotFoundError,
    SecretStoreError,
)


class SecretService:
    """Coordinates metadata persistence and secret value storage."""

    def __init__(self, metadata_store: JsonSecretMetadataStore | None = None) -> None:
        self.metadata_store = metadata_store or JsonSecretMetadataStore()
        self._lock = threading.RLock()

    def list_secret_entries(
        self,
        *,
        repository: FileGraphRepository | None = None,
    ) -> list[SecretCatalogEntry]:
        usage = self.build_usage_index(repository=repository)
        items = [
            SecretCatalogEntry(
                **metadata.model_dump(mode='json'),
                usage_count=int(usage.get(metadata.secret_id, 0)),
                in_use=bool(usage.get(metadata.secret_id, 0)),
            )
            for metadata in self.list_metadata()
        ]
        items.sort(key=lambda item: (item.label.lower(), item.secret_id))
        return items

    def list_metadata(self) -> list[SecretMetadata]:
        payload = self.metadata_store.load_index()
        return [
            SecretMetadata.model_validate(item)
            for item in payload.values()
        ]

    def get_metadata(self, secret_id: str) -> SecretMetadata:
        payload = self.metadata_store.load_index()
        normalized_secret_id = self._require_secret_id(secret_id)
        try:
            raw_item = payload[normalized_secret_id]
        except KeyError as exc:
            raise SecretNotFoundError(f'secret 不存在: {normalized_secret_id}') from exc
        return SecretMetadata.model_validate(raw_item)

    def create_secret(self, raw_input: SecretCreateInput) -> SecretMetadata:
        normalized_secret_id = raw_input.secret_id or self._generate_secret_id(raw_input.label)
        now = self.metadata_store.timestamp()
        metadata = SecretMetadata(
            secret_id=normalized_secret_id,
            label=raw_input.label,
            kind=raw_input.kind,
            description=raw_input.description,
            provider=self.metadata_store.provider.name,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            payload = self.metadata_store.load_index()
            if metadata.secret_id in payload:
                raise SecretAlreadyExistsError(f'secret_id 已存在: {metadata.secret_id}')
            self.metadata_store.provider.set_value(metadata.secret_id, raw_input.value)
            payload[metadata.secret_id] = metadata.model_dump(mode='json')
            self.metadata_store.save_index(payload)
        return metadata

    def update_metadata(self, secret_id: str, patch: SecretMetadataPatch) -> SecretMetadata:
        normalized_secret_id = self._require_secret_id(secret_id)
        with self._lock:
            payload = self.metadata_store.load_index()
            try:
                current = SecretMetadata.model_validate(payload[normalized_secret_id])
            except KeyError as exc:
                raise SecretNotFoundError(f'secret 不存在: {normalized_secret_id}') from exc
            updated = current.model_copy(
                update={
                    'label': patch.label if patch.label is not None else current.label,
                    'kind': patch.kind if patch.kind is not None else current.kind,
                    'description': (
                        patch.description if patch.description is not None else current.description
                    ),
                    'updated_at': self.metadata_store.timestamp(),
                }
            )
            payload[normalized_secret_id] = updated.model_dump(mode='json')
            self.metadata_store.save_index(payload)
        return updated

    def rotate_secret(self, secret_id: str, value: str) -> SecretMetadata:
        normalized_secret_id = self._require_secret_id(secret_id)
        if not value:
            raise ValueError('secret value 不能为空')
        with self._lock:
            payload = self.metadata_store.load_index()
            try:
                current = SecretMetadata.model_validate(payload[normalized_secret_id])
            except KeyError as exc:
                raise SecretNotFoundError(f'secret 不存在: {normalized_secret_id}') from exc
            self.metadata_store.provider.set_value(normalized_secret_id, value)
            updated = current.model_copy(update={'updated_at': self.metadata_store.timestamp()})
            payload[normalized_secret_id] = updated.model_dump(mode='json')
            self.metadata_store.save_index(payload)
        return updated

    def delete_secret(self, secret_id: str, *, repository: FileGraphRepository | None = None) -> None:
        normalized_secret_id = self._require_secret_id(secret_id)
        usage = self.get_usage(normalized_secret_id, repository=repository)
        if usage.in_use:
            raise SecretInUseError(f'secret 仍被引用，禁止删除: {normalized_secret_id}')
        with self._lock:
            payload = self.metadata_store.load_index()
            if normalized_secret_id not in payload:
                raise SecretNotFoundError(f'secret 不存在: {normalized_secret_id}')
            payload.pop(normalized_secret_id, None)
            self.metadata_store.save_index(payload)
            self.metadata_store.provider.delete_value(normalized_secret_id)

    def exists(self, secret_id: str) -> bool:
        normalized_secret_id = self._require_secret_id(secret_id)
        payload = self.metadata_store.load_index()
        return normalized_secret_id in payload

    def resolve_value(self, secret_id: str) -> str:
        normalized_secret_id = self._require_secret_id(secret_id)
        if not self.exists(normalized_secret_id):
            raise SecretNotFoundError(f'secret 不存在: {normalized_secret_id}')
        return self.metadata_store.provider.get_value(normalized_secret_id)

    def get_usage(
        self,
        secret_id: str,
        *,
        repository: FileGraphRepository | None = None,
    ) -> SecretUsageSummary:
        normalized_secret_id = self._require_secret_id(secret_id)
        repository = repository or get_graph_repository()
        items: list[SecretUsageEntry] = []
        for record in repository.list_graphs():
            try:
                graph = repository.get_graph(record.graph_id)
            except Exception:
                continue
            items.extend(_collect_graph_usage(graph, target_secret_id=normalized_secret_id))
        return SecretUsageSummary(
            secret_id=normalized_secret_id,
            usage_count=len(items),
            in_use=bool(items),
            items=items,
        )

    def build_usage_index(
        self,
        *,
        repository: FileGraphRepository | None = None,
    ) -> Counter[str]:
        repository = repository or get_graph_repository()
        usage_counter: Counter[str] = Counter()
        for record in repository.list_graphs():
            try:
                graph = repository.get_graph(record.graph_id)
            except Exception:
                continue
            for node in graph.nodes:
                usage_counter.update(secret_id for _field_path, secret_id in _walk_secret_refs(node.config))
        return usage_counter

    def _generate_secret_id(self, label: str) -> str:
        base = normalize_secret_id(label)
        if not base:
            raise ValueError(f'无法从 label 生成 secret_id: {label!r}')
        payload = self.metadata_store.load_index()
        if base not in payload:
            return base
        suffix = 1
        while f'{base}.{suffix}' in payload:
            suffix += 1
        return f'{base}.{suffix}'

    @staticmethod
    def _require_secret_id(secret_id: Any) -> str:
        normalized_secret_id = normalize_secret_id(secret_id)
        if not normalized_secret_id:
            raise ValueError(f'非法 secret_id: {secret_id!r}')
        return normalized_secret_id


def _collect_graph_usage(
    graph: GraphSpec,
    *,
    target_secret_id: str | None = None,
) -> list[SecretUsageEntry]:
    items: list[SecretUsageEntry] = []
    for node in graph.nodes:
        for field_path, secret_id in _walk_secret_refs(node.config):
            if target_secret_id is not None and secret_id != target_secret_id:
                continue
            items.append(
                SecretUsageEntry(
                    graph_id=graph.graph_id,
                    node_id=node.node_id,
                    field_path=field_path,
                )
            )
    return items


def _walk_secret_refs(payload: Any, path: str = '') -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    if is_secret_ref(payload):
        secret_id = normalize_secret_id(payload.get('secret_id'))
        if secret_id:
            items.append((path or '<root>', secret_id))
        return items

    if isinstance(payload, dict):
        for key, value in payload.items():
            next_path = f'{path}.{key}' if path else str(key)
            items.extend(_walk_secret_refs(value, next_path))
    elif isinstance(payload, list):
        for index, value in enumerate(payload):
            next_path = f'{path}[{index}]'
            items.extend(_walk_secret_refs(value, next_path))
    return items


_secret_service_singleton: SecretService | None = None


def get_secret_service() -> SecretService:
    global _secret_service_singleton
    if _secret_service_singleton is None:
        _secret_service_singleton = SecretService()
    return _secret_service_singleton


def reset_secret_service_for_testing(metadata_store: JsonSecretMetadataStore | None = None) -> None:
    global _secret_service_singleton
    _secret_service_singleton = SecretService(metadata_store=metadata_store)


__all__ = [
    'SecretService',
    'SecretAlreadyExistsError',
    'SecretInUseError',
    'SecretNotFoundError',
    'SecretStoreError',
    'get_secret_service',
    'reset_secret_service_for_testing',
]
