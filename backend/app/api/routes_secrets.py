from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.schemas.secrets import (
    CreateSecretRequest,
    RotateSecretRequest,
    SecretListResponse,
    SecretUsageResponse,
    UpdateSecretRequest,
)
from app.secrets.models import SecretCreateInput, SecretMetadataPatch
from app.secrets.service import (
    SecretAlreadyExistsError,
    SecretInUseError,
    SecretNotFoundError,
    SecretStoreError,
    get_secret_service,
)
from app.services.graph_repository import get_graph_repository

router = APIRouter(prefix='/api/v1/secrets', tags=['secrets'])


@router.get('')
async def list_secrets() -> dict[str, object]:
    service = get_secret_service()
    repository = get_graph_repository()
    items = service.list_secret_entries(repository=repository)
    return SecretListResponse(count=len(items), items=items).model_dump(mode='json')


@router.post('', status_code=status.HTTP_201_CREATED)
async def create_secret(req: CreateSecretRequest) -> dict[str, object]:
    service = get_secret_service()
    try:
        metadata = service.create_secret(SecretCreateInput.model_validate(req.model_dump(mode='json')))
    except SecretAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={'message': str(exc)}) from exc
    except (SecretStoreError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={'message': str(exc)}) from exc
    return metadata.model_dump(mode='json')


@router.patch('/{secret_id}')
async def update_secret(secret_id: str, req: UpdateSecretRequest) -> dict[str, object]:
    service = get_secret_service()
    try:
        metadata = service.update_metadata(secret_id, SecretMetadataPatch.model_validate(req.model_dump(mode='json')))
    except SecretNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={'message': str(exc)}) from exc
    except (SecretStoreError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={'message': str(exc)}) from exc
    return metadata.model_dump(mode='json')


@router.post('/{secret_id}/rotate')
async def rotate_secret(secret_id: str, req: RotateSecretRequest) -> dict[str, object]:
    service = get_secret_service()
    try:
        metadata = service.rotate_secret(secret_id, req.value)
    except SecretNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={'message': str(exc)}) from exc
    except (SecretStoreError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={'message': str(exc)}) from exc
    return metadata.model_dump(mode='json')


@router.get('/{secret_id}/usage')
async def get_secret_usage(secret_id: str) -> dict[str, object]:
    service = get_secret_service()
    repository = get_graph_repository()
    try:
        usage = service.get_usage(secret_id, repository=repository)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={'message': str(exc)}) from exc
    return SecretUsageResponse(**usage.model_dump(mode='json')).model_dump(mode='json')


@router.delete('/{secret_id}')
async def delete_secret(secret_id: str) -> dict[str, object]:
    service = get_secret_service()
    repository = get_graph_repository()
    try:
        service.delete_secret(secret_id, repository=repository)
    except SecretNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={'message': str(exc)}) from exc
    except SecretInUseError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={'message': str(exc)}) from exc
    except (SecretStoreError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={'message': str(exc)}) from exc
    return {'secret_id': secret_id, 'deleted': True}
