"""saved_graphs 示例图运行测试。"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.core.graph_builder import GraphBuilder
from app.core.registry import create_default_registry
from app.core.scheduler import GraphScheduler
from app.core.spec import GraphSpec


ROOT_DIR = Path(__file__).resolve().parents[2]
SAVED_GRAPHS_DIR = ROOT_DIR / "saved_graphs"


def _load_saved_graph(graph_id: str) -> GraphSpec:
    payload = json.loads((SAVED_GRAPHS_DIR / f"{graph_id}.json").read_text(encoding="utf-8"))
    return GraphSpec.model_validate(payload)


@pytest.mark.parametrize(
    "graph_id,passive_node_id",
    [
        ("graph_data_variable_math", "n2"),
        ("graph_data_staging_motion", "n3"),
    ],
)
def test_saved_graph_examples_compile_and_run(graph_id: str, passive_node_id: str) -> None:
    async def _run() -> None:
        graph = _load_saved_graph(graph_id)
        compiled = GraphBuilder(create_default_registry()).build(graph)
        state = await GraphScheduler().run(compiled, run_id=f"run_{graph_id}", stream_id="stream_saved_graphs")

        assert state.status == "completed"
        assert state.node_states[passive_node_id].status == "passive"

    asyncio.run(_run())
