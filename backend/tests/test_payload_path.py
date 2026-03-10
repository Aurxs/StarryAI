from __future__ import annotations

import pytest

from app.core.payload_path import parse_field_path, set_value_at_path


def test_parse_field_path_supports_object_and_array_segments() -> None:
    assert parse_field_path("auth.providers[0].api_key") == [
        "auth",
        "providers",
        0,
        "api_key",
    ]


def test_set_value_at_path_updates_nested_list_items() -> None:
    payload = {
        "auth": {
            "providers": [
                {"api_key": "old"},
                {"api_key": "stay"},
            ]
        }
    }

    set_value_at_path(payload, ["auth", "providers", 0, "api_key"], "new")

    assert payload["auth"]["providers"][0]["api_key"] == "new"
    assert payload["auth"]["providers"][1]["api_key"] == "stay"


def test_set_value_at_path_updates_mixed_object_array_paths() -> None:
    payload = {
        "providers": [
            {"credentials": {"api_key": "old"}},
            {"credentials": {"api_key": "stay"}},
        ]
    }

    set_value_at_path(payload, ["providers", 0, "credentials", "api_key"], "new")

    assert payload["providers"][0]["credentials"]["api_key"] == "new"
    assert payload["providers"][1]["credentials"]["api_key"] == "stay"


def test_set_value_at_path_rejects_root_replacement() -> None:
    with pytest.raises(ValueError, match="根级配置对象"):
        set_value_at_path({"api_key": "old"}, [], "new")


def test_set_value_at_path_rejects_structure_mismatch() -> None:
    with pytest.raises(ValueError, match="路径段不是数组"):
        set_value_at_path({"auth": {}}, ["auth", 0, "api_key"], "new")
