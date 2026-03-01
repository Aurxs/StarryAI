"""图定义文件仓库。"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path

from app.core.spec import GraphSpec

GRAPH_STORAGE_DIR_ENV = "STARRYAI_GRAPH_STORE_DIR"


class GraphNotFoundError(FileNotFoundError):
    """图文件不存在。"""


class GraphRepositoryError(RuntimeError):
    """图仓库读写失败。"""


@dataclass(slots=True)
class GraphSummaryRecord:
    """图摘要记录。"""

    graph_id: str
    version: str
    updated_at: float


def _resolve_default_storage_dir() -> Path:
    overridden = os.getenv(GRAPH_STORAGE_DIR_ENV, "").strip()
    if overridden:
        return Path(overridden).expanduser().resolve()
    # graph_repository.py -> services -> app -> backend -> repo_root
    return Path(__file__).resolve().parents[3] / "saved_graphs"


class FileGraphRepository:
    """基于本地 JSON 文件的图仓库。"""

    def __init__(self, storage_dir: Path | None = None) -> None:
        self.storage_dir = storage_dir or _resolve_default_storage_dir()

    def list_graphs(self) -> list[GraphSummaryRecord]:
        """列出已保存图的摘要。"""
        self._ensure_storage_dir()
        records_by_graph_id: dict[str, GraphSummaryRecord] = {}
        for file_path in self.storage_dir.glob("*.json"):
            try:
                payload = self._read_graph_payload(file_path)
                graph_id = str(payload.get("graph_id", "")).strip()
                if not graph_id:
                    continue
                version = str(payload.get("version", "0.1.0")).strip() or "0.1.0"
                candidate = GraphSummaryRecord(
                    graph_id=graph_id,
                    version=version,
                    updated_at=file_path.stat().st_mtime,
                )
                previous = records_by_graph_id.get(graph_id)
                if previous is None or candidate.updated_at >= previous.updated_at:
                    records_by_graph_id[graph_id] = candidate
            except (json.JSONDecodeError, OSError, ValueError):
                continue

        records = list(records_by_graph_id.values())
        records.sort(key=lambda item: item.updated_at, reverse=True)
        return records

    def get_graph(self, graph_id: str) -> GraphSpec:
        """按 graph_id 读取图定义。"""
        path = self._resolve_existing_graph_file_path(graph_id)
        if not path.exists():
            raise GraphNotFoundError(f"图不存在: {graph_id}")

        try:
            payload = self._read_graph_payload(path)
            return GraphSpec.model_validate(payload)
        except json.JSONDecodeError as exc:
            raise GraphRepositoryError(f"图文件 JSON 无法解析: {graph_id}") from exc
        except OSError as exc:
            raise GraphRepositoryError(f"图文件读取失败: {graph_id}") from exc

    def save_graph(self, graph: GraphSpec) -> GraphSummaryRecord:
        """保存图定义。"""
        self._ensure_storage_dir()
        path = self._graph_file_path(graph.graph_id)
        legacy_path = self._legacy_graph_file_path(graph.graph_id)
        tmp_path = path.with_suffix(".tmp")
        payload = graph.model_dump(mode="json")

        try:
            with tmp_path.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
            os.replace(tmp_path, path)
            if legacy_path != path and legacy_path.exists():
                legacy_path.unlink()
            updated_at = path.stat().st_mtime
        except OSError as exc:
            raise GraphRepositoryError(f"图文件保存失败: {graph.graph_id}") from exc
        finally:
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass

        return GraphSummaryRecord(
            graph_id=graph.graph_id,
            version=graph.version,
            updated_at=updated_at,
        )

    def delete_graph(self, graph_id: str) -> None:
        """删除图定义。"""
        path = self._resolve_existing_graph_file_path(graph_id)
        if not path.exists():
            raise GraphNotFoundError(f"图不存在: {graph_id}")
        try:
            path.unlink()
        except OSError as exc:
            raise GraphRepositoryError(f"图文件删除失败: {graph_id}") from exc

    def _ensure_storage_dir(self) -> None:
        try:
            self.storage_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise GraphRepositoryError(f"图存储目录不可用: {self.storage_dir}") from exc

    def _graph_file_path(self, graph_id: str) -> Path:
        normalized_graph_id = graph_id.strip()
        if not normalized_graph_id:
            raise ValueError("graph_id 不能为空")
        if normalized_graph_id in {".", ".."}:
            raise ValueError("graph_id 非法")
        if "/" in normalized_graph_id or "\\" in normalized_graph_id:
            raise ValueError("graph_id 不能包含路径分隔符")
        if normalized_graph_id.endswith(".json"):
            return self.storage_dir / normalized_graph_id
        return self.storage_dir / f"{normalized_graph_id}.json"

    def _legacy_graph_file_path(self, graph_id: str) -> Path:
        normalized_graph_id = graph_id.strip()
        encoded = base64.urlsafe_b64encode(normalized_graph_id.encode("utf-8")).decode("ascii")
        safe_id = encoded.rstrip("=") or "graph"
        return self.storage_dir / f"{safe_id}.json"

    def _resolve_existing_graph_file_path(self, graph_id: str) -> Path:
        normalized_graph_id = graph_id.strip()
        if not normalized_graph_id:
            raise ValueError("graph_id 不能为空")
        path = self._graph_file_path(normalized_graph_id)
        if path.exists():
            return path
        legacy_path = self._legacy_graph_file_path(normalized_graph_id)
        if legacy_path.exists():
            return legacy_path
        return path

    @staticmethod
    def _read_graph_payload(path: Path) -> dict[str, object]:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("图文件内容必须为对象")
        return payload


_graph_repository_singleton: FileGraphRepository | None = None


def get_graph_repository() -> FileGraphRepository:
    """获取全局图仓库。"""
    global _graph_repository_singleton
    if _graph_repository_singleton is None:
        _graph_repository_singleton = FileGraphRepository()
    return _graph_repository_singleton


def reset_graph_repository_for_testing(storage_dir: Path | None = None) -> None:
    """重置图仓库（供测试隔离使用）。"""
    global _graph_repository_singleton
    _graph_repository_singleton = FileGraphRepository(storage_dir=storage_dir)


__all__ = [
    "GRAPH_STORAGE_DIR_ENV",
    "FileGraphRepository",
    "GraphNotFoundError",
    "GraphRepositoryError",
    "GraphSummaryRecord",
    "get_graph_repository",
    "reset_graph_repository_for_testing",
]
