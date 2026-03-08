"""节点定义文件的约定测试。"""

from __future__ import annotations

from pathlib import Path


def test_node_modules_use_nodefield_for_business_config_fields() -> None:
    nodes_dir = Path(__file__).resolve().parents[1] / "app" / "nodes"
    python_files = sorted(path for path in nodes_dir.glob("*.py") if path.name != "__init__.py")

    offenders: list[str] = []
    for path in python_files:
        source = path.read_text(encoding="utf-8")
        if "from pydantic import Field" in source:
            offenders.append(path.name)

    assert offenders == [], (
        "节点定义文件中的业务配置字段已统一要求使用 NodeField；"
        f"请改造这些文件: {', '.join(offenders)}"
    )
