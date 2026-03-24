from __future__ import annotations

from cryptography.fernet import Fernet
import pytest

from app.secrets.store import (
    EncryptedFileSecretValueProvider,
    KeyringSecretValueProvider,
    SECRET_MASTER_KEY_ENV,
    SECRET_PROVIDER_ENV,
    SecretProviderUnavailableError,
    UnavailableSecretValueProvider,
    build_default_secret_value_provider,
)


def test_auto_provider_without_keyring_returns_unavailable_provider(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv(SECRET_PROVIDER_ENV, 'auto')
    monkeypatch.delenv(SECRET_MASTER_KEY_ENV, raising=False)
    monkeypatch.setattr(KeyringSecretValueProvider, 'is_available', staticmethod(lambda: False))

    provider = build_default_secret_value_provider(tmp_path)

    assert isinstance(provider, UnavailableSecretValueProvider)
    with pytest.raises(SecretProviderUnavailableError):
        provider.set_value('secret-a', 'value-a')


def test_encrypted_file_provider_requires_external_master_key(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv(SECRET_PROVIDER_ENV, 'encrypted_file')
    monkeypatch.delenv(SECRET_MASTER_KEY_ENV, raising=False)

    with pytest.raises(SecretProviderUnavailableError, match=SECRET_MASTER_KEY_ENV):
        build_default_secret_value_provider(tmp_path)


def test_encrypted_file_provider_uses_env_master_key_without_writing_local_key(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv(SECRET_PROVIDER_ENV, 'encrypted_file')
    monkeypatch.setenv(SECRET_MASTER_KEY_ENV, Fernet.generate_key().decode('utf-8'))

    provider = EncryptedFileSecretValueProvider(tmp_path)
    provider.set_value('secret-a', 'value-a')

    assert provider.get_value('secret-a') == 'value-a'
    assert not (tmp_path / 'master.key').exists()
