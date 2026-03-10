from __future__ import annotations

from typing import Any


def parse_field_path(path: str) -> list[str | int]:
    if not path or path == "<root>":
        return []

    parts: list[str | int] = []
    buffer = ""
    index = 0
    while index < len(path):
        char = path[index]
        if char == ".":
            if buffer:
                parts.append(buffer)
                buffer = ""
            index += 1
            continue
        if char == "[":
            if buffer:
                parts.append(buffer)
                buffer = ""
            end = path.index("]", index)
            parts.append(int(path[index + 1 : end]))
            index = end + 1
            continue
        buffer += char
        index += 1
    if buffer:
        parts.append(buffer)
    return parts


def set_value_at_path(
    payload: dict[str, Any] | list[Any], path_parts: list[str | int], value: Any
) -> None:
    if not path_parts:
        raise ValueError("不支持替换根级配置对象")

    current: Any = payload
    for part in path_parts[:-1]:
        if isinstance(part, int):
            if not isinstance(current, list):
                raise ValueError(f"路径段不是数组: {path_parts!r}")
            current = current[part]
            continue
        if not isinstance(current, dict):
            raise ValueError(f"路径段不是对象: {path_parts!r}")
        current = current[part]

    final = path_parts[-1]
    if isinstance(final, int):
        if not isinstance(current, list):
            raise ValueError(f"路径终点父节点不是数组: {path_parts!r}")
        current[final] = value
        return
    if not isinstance(current, dict):
        raise ValueError(f"路径终点父节点不是对象: {path_parts!r}")
    current[final] = value


__all__ = ["parse_field_path", "set_value_at_path"]
