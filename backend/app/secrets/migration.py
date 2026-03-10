from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config_validation import is_secret_schema, resolve_nullable_schema
from app.core.payload_path import parse_field_path, set_value_at_path
from app.core.registry import NodeTypeRegistry, create_default_registry
from app.core.spec import GraphSpec
from app.secrets.models import SecretCreateInput, build_secret_ref, is_secret_ref, normalize_secret_id
from app.secrets.service import SecretService
from app.services.graph_repository import FileGraphRepository


@dataclass(slots=True)
class PlaintextSecretOccurrence:
    graph_id: str
    node_id: str
    node_type: str
    field_path: str


@dataclass(slots=True)
class SecretMigrationResult:
    scanned_graphs: int
    affected_graphs: int
    migrated_secrets: int
    occurrences: list[PlaintextSecretOccurrence]


def scan_graph_for_plaintext_secrets(
    graph: GraphSpec,
    *,
    registry: NodeTypeRegistry,
) -> list[PlaintextSecretOccurrence]:
    occurrences: list[PlaintextSecretOccurrence] = []
    for node in graph.nodes:
        try:
            spec = registry.get(node.type_name)
        except Exception:
            continue
        schema = spec.config_schema or {}
        for field_path, _value in _iter_plaintext_secret_values(schema, node.config):
            occurrences.append(
                PlaintextSecretOccurrence(
                    graph_id=graph.graph_id,
                    node_id=node.node_id,
                    node_type=node.type_name,
                    field_path=field_path,
                )
            )
    return occurrences


def migrate_plaintext_secrets(
    *,
    graph_repository: FileGraphRepository,
    secret_service: SecretService,
    registry: NodeTypeRegistry | None = None,
    graph_ids: list[str] | None = None,
    apply_changes: bool = False,
    secret_kind: str = 'generic',
    label_prefix: str = 'Migrated Secret',
) -> SecretMigrationResult:
    registry = registry or create_default_registry()
    occurrences: list[PlaintextSecretOccurrence] = []
    affected_graphs = 0
    migrated_secrets = 0

    if graph_ids:
        target_graph_ids = graph_ids
    else:
        target_graph_ids = [record.graph_id for record in graph_repository.list_graphs()]

    for graph_id in target_graph_ids:
        graph = graph_repository.get_graph(graph_id)
        graph_occurrences = scan_graph_for_plaintext_secrets(graph, registry=registry)
        occurrences.extend(graph_occurrences)
        if not graph_occurrences:
            continue

        affected_graphs += 1
        if not apply_changes:
            continue

        graph_payload = graph.model_dump(mode='json')
        node_payloads = graph_payload.get('nodes', [])
        if not isinstance(node_payloads, list):
            continue

        for node_payload in node_payloads:
            if not isinstance(node_payload, dict):
                continue
            node_id = str(node_payload.get('node_id', ''))
            type_name = str(node_payload.get('type_name', ''))
            if not node_id or not type_name:
                continue
            try:
                spec = registry.get(type_name)
            except Exception:
                continue
            config = node_payload.get('config')
            if not isinstance(config, dict):
                continue

            for field_path, secret_value in _iter_plaintext_secret_values(spec.config_schema or {}, config):
                label = f'{label_prefix} {graph_id}/{node_id}/{field_path}'
                metadata = secret_service.create_secret(
                    SecretCreateInput(
                        label=label,
                        value=str(secret_value),
                        kind=secret_kind,
                        description=f'Migrated from graph={graph_id}, node={node_id}, field={field_path}',
                        secret_id=_build_migrated_secret_id(
                            graph_id=graph_id,
                            node_id=node_id,
                            field_path=field_path,
                        ),
                    )
                )
                set_value_at_path(
                    config,
                    parse_field_path(field_path),
                    build_secret_ref(metadata.secret_id),
                )
                migrated_secrets += 1

        graph_repository.save_graph(GraphSpec.model_validate(graph_payload))

    return SecretMigrationResult(
        scanned_graphs=len(target_graph_ids),
        affected_graphs=affected_graphs,
        migrated_secrets=migrated_secrets,
        occurrences=occurrences,
    )


def _iter_plaintext_secret_values(
    schema: dict[str, Any],
    payload: Any,
    path: str = '',
) -> list[tuple[str, Any]]:
    if payload is None:
        return []

    resolved_schema = resolve_nullable_schema(schema)
    if is_secret_schema(resolved_schema):
        if is_secret_ref(payload):
            return []
        return [(path or '<root>', payload)]

    items: list[tuple[str, Any]] = []
    schema_type = resolved_schema.get('type')
    if schema_type == 'object' and isinstance(payload, dict):
        properties = resolved_schema.get('properties')
        if isinstance(properties, dict):
            for key, child_schema in properties.items():
                if key not in payload:
                    continue
                child_path = f'{path}.{key}' if path else str(key)
                items.extend(_iter_plaintext_secret_values(child_schema, payload[key], child_path))
        return items

    if schema_type == 'array' and isinstance(payload, list):
        item_schema = resolved_schema.get('items')
        if isinstance(item_schema, dict):
            for index, value in enumerate(payload):
                child_path = f'{path}[{index}]' if path else f'[{index}]'
                items.extend(_iter_plaintext_secret_values(item_schema, value, child_path))
    return items


def _build_migrated_secret_id(*, graph_id: str, node_id: str, field_path: str) -> str:
    prefix = normalize_secret_id(f'migrated-{graph_id}-{node_id}') or 'migrated'
    digest = hashlib.sha1(
        f'{graph_id}\0{node_id}\0{field_path}'.encode('utf-8')
    ).hexdigest()[:12]
    return f'{prefix}.{digest}'


def build_default_graph_repository(storage_dir: Path | None = None) -> FileGraphRepository:
    return FileGraphRepository(storage_dir=storage_dir)


__all__ = [
    'PlaintextSecretOccurrence',
    'SecretMigrationResult',
    'build_default_graph_repository',
    'migrate_plaintext_secrets',
    'scan_graph_for_plaintext_secrets',
]
