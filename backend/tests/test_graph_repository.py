"""graph repository 行为测试。"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import pytest

from app.core.spec import EdgeSpec, GraphSpec, NodeInstanceSpec
from app.services.graph_repository import FileGraphRepository, GraphNotFoundError


def _sample_graph(graph_id: str = "graph_repo_case") -> GraphSpec:
    return GraphSpec(
        graph_id=graph_id,
        version="0.1.0",
        nodes=[
            NodeInstanceSpec(node_id="n1", type_name="mock.input"),
            NodeInstanceSpec(node_id="n2", type_name="mock.output"),
        ],
        edges=[
            EdgeSpec(
                source_node="n1",
                source_port="text",
                target_node="n2",
                target_port="in",
            )
        ],
        metadata={},
    )


def _legacy_path(storage_dir: Path, graph_id: str) -> Path:
    encoded = base64.urlsafe_b64encode(graph_id.encode("utf-8")).decode("ascii").rstrip("=")
    return storage_dir / f"{encoded}.json"


def test_save_graph_uses_plain_graph_id_filename(tmp_path: Path) -> None:
    repo = FileGraphRepository(storage_dir=tmp_path)
    repo.save_graph(_sample_graph("graph_plain_name"))

    assert (tmp_path / "graph_plain_name.json").exists()
    assert not _legacy_path(tmp_path, "graph_plain_name").exists()


def test_get_graph_reads_legacy_encoded_filename(tmp_path: Path) -> None:
    repo = FileGraphRepository(storage_dir=tmp_path)
    graph = _sample_graph("graph_legacy")
    payload = graph.model_dump(mode="json")
    legacy = _legacy_path(tmp_path, graph.graph_id)
    legacy.write_text(json.dumps(payload), encoding="utf-8")

    loaded = repo.get_graph("graph_legacy")
    assert loaded.graph_id == "graph_legacy"
    assert len(loaded.nodes) == 2


def test_save_graph_removes_legacy_file_when_plain_file_written(tmp_path: Path) -> None:
    repo = FileGraphRepository(storage_dir=tmp_path)
    graph = _sample_graph("graph_cleanup")
    payload = graph.model_dump(mode="json")
    legacy = _legacy_path(tmp_path, graph.graph_id)
    legacy.write_text(json.dumps(payload), encoding="utf-8")
    assert legacy.exists()

    repo.save_graph(graph)

    assert not legacy.exists()
    assert (tmp_path / "graph_cleanup.json").exists()


def test_list_graphs_deduplicates_same_graph_id_across_legacy_and_plain_files(
    tmp_path: Path,
) -> None:
    repo = FileGraphRepository(storage_dir=tmp_path)
    graph = _sample_graph("graph_dupe")
    payload = graph.model_dump(mode="json")
    legacy = _legacy_path(tmp_path, graph.graph_id)
    plain = tmp_path / "graph_dupe.json"

    legacy.write_text(json.dumps(payload), encoding="utf-8")
    plain.write_text(json.dumps(payload), encoding="utf-8")
    os.utime(legacy, (legacy.stat().st_atime, legacy.stat().st_mtime - 5))

    records = repo.list_graphs()
    matched = [item for item in records if item.graph_id == "graph_dupe"]
    assert len(matched) == 1
    assert matched[0].updated_at == plain.stat().st_mtime


@pytest.mark.parametrize("graph_id", ["", " ", "a/b", r"a\\b", ".", ".."])
def test_invalid_graph_id_paths_are_rejected(tmp_path: Path, graph_id: str) -> None:
    repo = FileGraphRepository(storage_dir=tmp_path)
    with pytest.raises((ValueError, GraphNotFoundError)):
        repo.get_graph(graph_id)

