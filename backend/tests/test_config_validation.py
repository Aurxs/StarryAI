from __future__ import annotations

from app.core.config_validation import (
    SECRET_FIELD_KEY,
    build_design_time_schema,
    resolve_secret_refs,
    validate_node_config,
)


def _nested_array_secret_schema() -> dict[str, object]:
    return {
        'type': 'object',
        'properties': {
            'providers': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'credentials': {
                            'type': 'object',
                            'properties': {
                                'api_key': {
                                    'type': 'string',
                                    SECRET_FIELD_KEY: True,
                                }
                            },
                        }
                    },
                },
            }
        },
    }


def test_build_design_time_schema_transforms_secret_fields_inside_arrays() -> None:
    transformed = build_design_time_schema(_nested_array_secret_schema())
    api_key_schema = transformed['properties']['providers']['items']['properties']['credentials'][
        'properties'
    ]['api_key']

    assert api_key_schema['type'] == 'object'
    assert api_key_schema['properties']['$kind']['const'] == 'secret_ref'


def test_validate_node_config_accepts_secret_refs_inside_arrays() -> None:
    issues = validate_node_config(
        node_id='n_array_secret',
        config_schema=_nested_array_secret_schema(),
        config={
            'providers': [
                {
                    'credentials': {
                        '$kind': 'secret_ref',
                        'secret_id': 'array-main',
                    }
                }
            ]
        },
        secret_exists=lambda secret_id: secret_id == 'array-main',
    )

    assert issues == []


def test_resolve_secret_refs_resolves_secret_refs_inside_arrays() -> None:
    resolved = resolve_secret_refs(
        _nested_array_secret_schema(),
        {
            'providers': [
                {
                    'credentials': {
                        'api_key': {
                            '$kind': 'secret_ref',
                            'secret_id': 'array-main',
                        }
                    }
                }
            ]
        },
        resolve_secret=lambda secret_id: f'resolved:{secret_id}',
    )

    assert resolved == {
        'providers': [
            {
                'credentials': {
                    'api_key': 'resolved:array-main',
                }
            }
        ]
    }
