from __future__ import annotations

from collections.abc import Callable, Iterable
from copy import deepcopy
from typing import Any

from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

from app.secrets.models import build_secret_ref, is_secret_ref, normalize_secret_id

from .spec import ValidationIssue

SECRET_WIDGET_KEY = 'x-starryai-widget'
SECRET_FIELD_KEY = 'x-starryai-secret'
ORDER_KEY = 'x-starryai-order'
GROUP_KEY = 'x-starryai-group'
PLACEHOLDER_KEY = 'x-starryai-placeholder'
HELP_KEY = 'x-starryai-help'
TEXTAREA_WIDGET = 'textarea'
SECRET_WIDGET = 'secret'

SECRET_REF_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['$kind', 'secret_id'],
    'properties': {
        '$kind': {'const': 'secret_ref'},
        'secret_id': {
            'type': 'string',
            'minLength': 1,
        },
    },
}


def validate_node_config(
    *,
    node_id: str,
    config_schema: dict[str, Any],
    config: dict[str, Any],
    secret_exists: Callable[[str], bool] | None = None,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    effective_schema = build_design_time_schema(config_schema)
    validator = Draft202012Validator(effective_schema)
    for error in sorted(validator.iter_errors(config), key=lambda item: list(item.path)):
        field_path = format_json_path(error.absolute_path)
        issues.append(
            ValidationIssue(
                level='error',
                code='node.config_invalid',
                message=f'节点 {node_id} 配置非法 {field_path}: {error.message}',
            )
        )

    if secret_exists is not None:
        for field_path, secret_id in iter_secret_refs(config_schema, config):
            if not secret_exists(secret_id):
                issues.append(
                    ValidationIssue(
                        level='error',
                        code='node.secret_not_found',
                        message=f'节点 {node_id} Secret 引用不存在 {field_path}: {secret_id}',
                    )
                )
    return issues


def build_design_time_schema(schema: dict[str, Any]) -> dict[str, Any]:
    copied = deepcopy(schema)
    return _transform_schema(copied)


def resolve_secret_refs(
    config_schema: dict[str, Any],
    config: dict[str, Any],
    *,
    resolve_secret: Callable[[str], str],
) -> dict[str, Any]:
    resolved = deepcopy(config)
    for path, secret_id in iter_secret_refs(config_schema, config):
        set_value_at_path(resolved, parse_field_path(path), resolve_secret(secret_id))
    return resolved


def iter_secret_refs(config_schema: dict[str, Any], payload: Any, path: str = '') -> Iterable[tuple[str, str]]:
    if payload is None:
        return []
    items: list[tuple[str, str]] = []
    normalized_schema = resolve_nullable_schema(config_schema)

    if is_secret_schema(normalized_schema):
        if is_secret_ref(payload):
            secret_id = normalize_secret_id(payload.get('secret_id'))
            if secret_id:
                items.append((path or '<root>', secret_id))
        return items

    schema_type = normalized_schema.get('type')
    if schema_type == 'object' and isinstance(payload, dict):
        properties = normalized_schema.get('properties')
        if isinstance(properties, dict):
            for key, child_schema in properties.items():
                if key not in payload:
                    continue
                child_path = f'{path}.{key}' if path else str(key)
                items.extend(iter_secret_refs(child_schema, payload[key], child_path))
    return items


def is_secret_schema(schema: dict[str, Any]) -> bool:
    return bool(schema.get(SECRET_FIELD_KEY) or schema.get(SECRET_WIDGET_KEY) == SECRET_WIDGET)


def resolve_nullable_schema(schema: dict[str, Any]) -> dict[str, Any]:
    any_of = schema.get('anyOf')
    if isinstance(any_of, list):
        non_null_variants = [item for item in any_of if item.get('type') != 'null']
        if len(non_null_variants) == 1 and isinstance(non_null_variants[0], dict):
            merged = deepcopy(non_null_variants[0])
            for key in (SECRET_FIELD_KEY, SECRET_WIDGET_KEY, ORDER_KEY, GROUP_KEY, PLACEHOLDER_KEY, HELP_KEY):
                if key in schema and key not in merged:
                    merged[key] = schema[key]
            return merged
    return schema


def _transform_schema(schema: dict[str, Any]) -> dict[str, Any]:
    resolved = resolve_nullable_schema(schema)
    if is_secret_schema(resolved):
        transformed = deepcopy(SECRET_REF_SCHEMA)
        transformed['title'] = resolved.get('title', transformed.get('title'))
        transformed['description'] = resolved.get('description', transformed.get('description'))
        if _allows_null(schema):
            return {'anyOf': [transformed, {'type': 'null'}]}
        return transformed

    schema_type = resolved.get('type')
    if schema_type == 'object':
        properties = resolved.get('properties')
        if isinstance(properties, dict):
            resolved['properties'] = {
                key: _transform_schema(deepcopy(child_schema))
                for key, child_schema in properties.items()
            }
    return resolved


def _allows_null(schema: dict[str, Any]) -> bool:
    any_of = schema.get('anyOf')
    if not isinstance(any_of, list):
        return False
    return any(item.get('type') == 'null' for item in any_of if isinstance(item, dict))


def format_json_path(path_items: Iterable[Any]) -> str:
    path = '$'
    for item in path_items:
        if isinstance(item, int):
            path += f'[{item}]'
        else:
            path += f'.{item}'
    return path


def parse_field_path(path: str) -> list[str]:
    if not path or path == '<root>':
        return []
    return [part for part in path.split('.') if part]


def set_value_at_path(payload: dict[str, Any], path_parts: list[str], value: Any) -> None:
    if not path_parts:
        raise ValueError('不支持替换根级配置对象')
    current: Any = payload
    for part in path_parts[:-1]:
        if not isinstance(current, dict):
            raise ValueError(f'路径中间节点不是对象: {path_parts!r}')
        current = current.setdefault(part, {})
    if not isinstance(current, dict):
        raise ValueError(f'路径目标父节点不是对象: {path_parts!r}')
    current[path_parts[-1]] = value


__all__ = [
    'GROUP_KEY',
    'HELP_KEY',
    'ORDER_KEY',
    'PLACEHOLDER_KEY',
    'SECRET_FIELD_KEY',
    'SECRET_WIDGET',
    'SECRET_WIDGET_KEY',
    'TEXTAREA_WIDGET',
    'build_design_time_schema',
    'format_json_path',
    'iter_secret_refs',
    'resolve_secret_refs',
    'validate_node_config',
]
