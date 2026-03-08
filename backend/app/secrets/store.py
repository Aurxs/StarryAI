from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Protocol

import keyring
from cryptography.fernet import Fernet, InvalidToken
from keyring.errors import KeyringError, NoKeyringError

SECRET_STORE_DIR_ENV = 'STARRYAI_SECRET_STORE_DIR'
SECRET_PROVIDER_ENV = 'STARRYAI_SECRET_PROVIDER'
SECRET_KEYRING_SERVICE_NAME = 'starryai'


class SecretStoreError(RuntimeError):
    """Base secret store error."""


class SecretNotFoundError(SecretStoreError, FileNotFoundError):
    """Secret metadata or value not found."""


class SecretAlreadyExistsError(SecretStoreError):
    """Secret id already exists."""


class SecretInUseError(SecretStoreError):
    """Secret is still referenced by graphs."""


class SecretProviderUnavailableError(SecretStoreError):
    """Requested provider is unavailable."""


class SecretValueProvider(Protocol):
    name: str

    def set_value(self, secret_id: str, value: str) -> None:
        ...

    def get_value(self, secret_id: str) -> str:
        ...

    def delete_value(self, secret_id: str) -> None:
        ...


class InMemorySecretValueProvider:
    name = 'memory'

    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def set_value(self, secret_id: str, value: str) -> None:
        self._values[secret_id] = value

    def get_value(self, secret_id: str) -> str:
        try:
            return self._values[secret_id]
        except KeyError as exc:
            raise SecretNotFoundError(f'secret value 不存在: {secret_id}') from exc

    def delete_value(self, secret_id: str) -> None:
        self._values.pop(secret_id, None)


class KeyringSecretValueProvider:
    name = 'keyring'

    def __init__(self, service_name: str = SECRET_KEYRING_SERVICE_NAME) -> None:
        self.service_name = service_name

    @staticmethod
    def is_available() -> bool:
        try:
            backend = keyring.get_keyring()
        except Exception:
            return False
        priority = getattr(backend, 'priority', 0)
        return bool(priority and priority > 0)

    def set_value(self, secret_id: str, value: str) -> None:
        try:
            keyring.set_password(self.service_name, secret_id, value)
        except (KeyringError, NoKeyringError) as exc:
            raise SecretStoreError(f'keyring 写入失败: {secret_id}') from exc

    def get_value(self, secret_id: str) -> str:
        try:
            value = keyring.get_password(self.service_name, secret_id)
        except (KeyringError, NoKeyringError) as exc:
            raise SecretStoreError(f'keyring 读取失败: {secret_id}') from exc
        if value is None:
            raise SecretNotFoundError(f'secret value 不存在: {secret_id}')
        return value

    def delete_value(self, secret_id: str) -> None:
        try:
            keyring.delete_password(self.service_name, secret_id)
        except SecretNotFoundError:
            return
        except (KeyringError, NoKeyringError, keyring.errors.PasswordDeleteError):
            return


class EncryptedFileSecretValueProvider:
    name = 'encrypted_file'

    def __init__(self, store_dir: Path) -> None:
        self.store_dir = store_dir
        self.values_dir = self.store_dir / 'values'
        self.key_path = self.store_dir / 'master.key'
        self.values_dir.mkdir(parents=True, exist_ok=True)
        self._fernet = Fernet(self._load_or_create_key())

    def _load_or_create_key(self) -> bytes:
        env_value = os.getenv('STARRYAI_SECRET_MASTER_KEY', '').strip()
        if env_value:
            return env_value.encode('utf-8')

        if self.key_path.exists():
            return self.key_path.read_bytes().strip()

        key = Fernet.generate_key()
        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        self.key_path.write_bytes(key + b'\n')
        try:
            os.chmod(self.key_path, 0o600)
        except OSError:
            pass
        return key

    def _value_path(self, secret_id: str) -> Path:
        return self.values_dir / f'{secret_id}.bin'

    def set_value(self, secret_id: str, value: str) -> None:
        token = self._fernet.encrypt(value.encode('utf-8'))
        path = self._value_path(secret_id)
        path.write_bytes(token)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass

    def get_value(self, secret_id: str) -> str:
        path = self._value_path(secret_id)
        if not path.exists():
            raise SecretNotFoundError(f'secret value 不存在: {secret_id}')
        try:
            return self._fernet.decrypt(path.read_bytes()).decode('utf-8')
        except InvalidToken as exc:
            raise SecretStoreError(f'secret value 无法解密: {secret_id}') from exc

    def delete_value(self, secret_id: str) -> None:
        path = self._value_path(secret_id)
        if path.exists():
            path.unlink()


class JsonSecretMetadataStore:
    """Metadata index persisted as JSON; raw values are delegated to a provider."""

    def __init__(self, store_dir: Path | None = None, provider: SecretValueProvider | None = None) -> None:
        self.store_dir = store_dir or resolve_default_secret_store_dir()
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.store_dir / 'metadata.json'
        self.provider = provider or build_default_secret_value_provider(self.store_dir)

    def load_index(self) -> dict[str, dict[str, object]]:
        if not self.index_path.exists():
            return {}
        try:
            payload = json.loads(self.index_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError as exc:
            raise SecretStoreError(f'secret metadata 文件损坏: {self.index_path}') from exc
        if not isinstance(payload, dict):
            raise SecretStoreError(f'secret metadata 文件格式非法: {self.index_path}')
        return payload

    def save_index(self, payload: dict[str, dict[str, object]]) -> None:
        tmp_path = self.index_path.with_suffix('.tmp')
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        os.replace(tmp_path, self.index_path)
        try:
            os.chmod(self.index_path, 0o600)
        except OSError:
            pass

    def timestamp(self) -> float:
        return time.time()


def resolve_default_secret_store_dir() -> Path:
    override = os.getenv(SECRET_STORE_DIR_ENV, '').strip()
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / '.starryai' / 'secrets'


def build_default_secret_value_provider(store_dir: Path) -> SecretValueProvider:
    provider_name = os.getenv(SECRET_PROVIDER_ENV, 'auto').strip().lower() or 'auto'

    if provider_name == 'memory':
        return InMemorySecretValueProvider()
    if provider_name == 'keyring':
        if not KeyringSecretValueProvider.is_available():
            raise SecretProviderUnavailableError('keyring provider 不可用')
        return KeyringSecretValueProvider()
    if provider_name in {'encrypted', 'encrypted_file', 'file'}:
        return EncryptedFileSecretValueProvider(store_dir)
    if provider_name != 'auto':
        raise SecretProviderUnavailableError(f'未知 secret provider: {provider_name}')

    if KeyringSecretValueProvider.is_available():
        return KeyringSecretValueProvider()
    return EncryptedFileSecretValueProvider(store_dir)


__all__ = [
    'EncryptedFileSecretValueProvider',
    'InMemorySecretValueProvider',
    'JsonSecretMetadataStore',
    'KeyringSecretValueProvider',
    'SECRET_PROVIDER_ENV',
    'SECRET_STORE_DIR_ENV',
    'SecretAlreadyExistsError',
    'SecretInUseError',
    'SecretNotFoundError',
    'SecretProviderUnavailableError',
    'SecretStoreError',
    'SecretValueProvider',
    'build_default_secret_value_provider',
    'resolve_default_secret_store_dir',
]
