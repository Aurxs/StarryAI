"""Plaintext secret migration tests."""

from __future__ import annotations

from app.core.config_validation import SECRET_FIELD_KEY
from app.core.registry import create_default_registry
from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec, NodeMode, NodeSpec, PortSpec
from app.core.registry import NodeTypeRegistry
from app.secrets.migration import migrate_plaintext_secrets, scan_graph_for_plaintext_secrets
from app.secrets.service import SecretService
from app.secrets.store import InMemorySecretValueProvider, JsonSecretMetadataStore
from app.services.graph_repository import FileGraphRepository


def _graph_with_plaintext_secret(graph_id: str = 'graph_plaintext_secret') -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        version='0.1.0',
        nodes=[
            NodeInstanceSpec(node_id='n1', type_name='mock.input', config={'content': 'hello'}),
            NodeInstanceSpec(
                node_id='n2',
                type_name='mock.llm',
                config={
                    'model': 'mock-llm-v1',
                    'api_key': 'sk-plaintext-secret',
                },
            ),
            NodeInstanceSpec(node_id='n3', type_name='mock.output', config={}),
        ],
        edges=[
            EdgeSpec(source_node='n1', source_port='text', target_node='n2', target_port='prompt'),
            EdgeSpec(source_node='n2', source_port='answer', target_node='n3', target_port='in'),
        ],
        metadata={},
    )


def test_scan_graph_detects_plaintext_secret_fields() -> None:
    graph = _graph_with_plaintext_secret()
    occurrences = scan_graph_for_plaintext_secrets(graph, registry=create_default_registry())

    assert len(occurrences) == 1
    assert occurrences[0].graph_id == 'graph_plaintext_secret'
    assert occurrences[0].node_id == 'n2'
    assert occurrences[0].node_type == 'mock.llm'
    assert occurrences[0].field_path == 'api_key'


def test_migrate_plaintext_secrets_updates_graph_and_creates_secret(tmp_path) -> None:
    graph_repo = FileGraphRepository(storage_dir=tmp_path / 'graphs')
    secret_service = SecretService(
        metadata_store=JsonSecretMetadataStore(
            store_dir=tmp_path / 'secrets',
            provider=InMemorySecretValueProvider(),
        )
    )
    graph_repo.save_graph(_graph_with_plaintext_secret())

    result = migrate_plaintext_secrets(
        graph_repository=graph_repo,
        secret_service=secret_service,
        registry=create_default_registry(),
        apply_changes=True,
        secret_kind='api_key',
        label_prefix='Migrated',
    )

    assert result.scanned_graphs == 1
    assert result.affected_graphs == 1
    assert result.migrated_secrets == 1

    loaded = graph_repo.get_graph('graph_plaintext_secret')
    migrated_node = next(node for node in loaded.nodes if node.node_id == 'n2')
    api_key_value = migrated_node.config['api_key']
    assert api_key_value['$kind'] == 'secret_ref'
    secret_id = api_key_value['secret_id']
    assert secret_service.exists(secret_id) is True
    assert secret_service.resolve_value(secret_id) == 'sk-plaintext-secret'


def test_migrate_plaintext_secrets_dry_run_keeps_graph_unchanged(tmp_path) -> None:
    graph_repo = FileGraphRepository(storage_dir=tmp_path / 'graphs')
    secret_service = SecretService(
        metadata_store=JsonSecretMetadataStore(
            store_dir=tmp_path / 'secrets',
            provider=InMemorySecretValueProvider(),
        )
    )
    graph_repo.save_graph(_graph_with_plaintext_secret())

    result = migrate_plaintext_secrets(
        graph_repository=graph_repo,
        secret_service=secret_service,
        registry=create_default_registry(),
        apply_changes=False,
    )

    assert result.scanned_graphs == 1
    assert result.affected_graphs == 1
    assert result.migrated_secrets == 0

    loaded = graph_repo.get_graph('graph_plaintext_secret')
    migrated_node = next(node for node in loaded.nodes if node.node_id == 'n2')
    assert migrated_node.config['api_key'] == 'sk-plaintext-secret'


def test_migrate_plaintext_secrets_updates_nested_array_fields(tmp_path) -> None:
    graph_repo = FileGraphRepository(storage_dir=tmp_path / 'graphs')
    secret_service = SecretService(
        metadata_store=JsonSecretMetadataStore(
            store_dir=tmp_path / 'secrets',
            provider=InMemorySecretValueProvider(),
        )
    )
    registry = NodeTypeRegistry()
    registry.register(
        NodeSpec(
            type_name='test.array.secret',
            mode=NodeMode.ASYNC,
            inputs=[],
            outputs=[PortSpec(name='out', frame_schema='json.object', required=True)],
            config_schema={
                'type': 'object',
                'properties': {
                    'providers': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'properties': {
                                'api_key': {
                                    'type': 'string',
                                    SECRET_FIELD_KEY: True,
                                }
                            },
                        },
                    }
                },
            },
        )
    )
    graph_repo.save_graph(
        GraphSpec(
            graph_id='graph_plaintext_array_secret',
            version='0.1.0',
            nodes=[
                NodeInstanceSpec(
                    node_id='n1',
                    type_name='test.array.secret',
                    config={'providers': [{'api_key': 'sk-array-secret'}]},
                )
            ],
            edges=[],
            metadata={},
        )
    )

    result = migrate_plaintext_secrets(
        graph_repository=graph_repo,
        secret_service=secret_service,
        registry=registry,
        apply_changes=True,
    )

    assert result.migrated_secrets == 1

    loaded = graph_repo.get_graph('graph_plaintext_array_secret')
    migrated_node = loaded.nodes[0]
    api_key_value = migrated_node.config['providers'][0]['api_key']
    assert api_key_value['$kind'] == 'secret_ref'
    assert secret_service.resolve_value(api_key_value['secret_id']) == 'sk-array-secret'
