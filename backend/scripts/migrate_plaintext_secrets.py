"""Scan saved graphs for plaintext secrets and optionally migrate them."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.registry import create_default_registry  # noqa: E402
from app.secrets.migration import build_default_graph_repository, migrate_plaintext_secrets  # noqa: E402
from app.secrets.service import SecretService  # noqa: E402
from app.secrets.store import JsonSecretMetadataStore  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Scan saved graphs for plaintext secrets and migrate them to secret_ref entries.',
    )
    parser.add_argument(
        '--graph-dir',
        type=Path,
        default=None,
        help='Override graph storage directory (default: saved_graphs)',
    )
    parser.add_argument(
        '--secret-store-dir',
        type=Path,
        default=None,
        help='Override secret store directory (default: ~/.starryai/secrets or env override)',
    )
    parser.add_argument(
        '--graph-id',
        action='append',
        default=[],
        help='Only scan/migrate the specified graph_id. Can be repeated.',
    )
    parser.add_argument(
        '--kind',
        default='generic',
        help='Secret kind assigned to migrated entries (default: generic)',
    )
    parser.add_argument(
        '--label-prefix',
        default='Migrated Secret',
        help='Label prefix used when creating migrated secrets',
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply changes. Default is dry-run scan only.',
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repository = build_default_graph_repository(storage_dir=args.graph_dir)
    secret_service = SecretService(
        metadata_store=JsonSecretMetadataStore(store_dir=args.secret_store_dir),
    )
    result = migrate_plaintext_secrets(
        graph_repository=repository,
        secret_service=secret_service,
        registry=create_default_registry(),
        graph_ids=list(args.graph_id) or None,
        apply_changes=args.apply,
        secret_kind=args.kind,
        label_prefix=args.label_prefix,
    )

    mode = 'APPLY' if args.apply else 'DRY-RUN'
    print(f'[{mode}] scanned_graphs={result.scanned_graphs} affected_graphs={result.affected_graphs} plaintext_occurrences={len(result.occurrences)} migrated_secrets={result.migrated_secrets}')
    if result.occurrences:
        print('Plaintext secret fields:')
        for item in result.occurrences:
            print(f'- graph={item.graph_id} node={item.node_id} type={item.node_type} field={item.field_path}')
    else:
        print('No plaintext secrets detected.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
