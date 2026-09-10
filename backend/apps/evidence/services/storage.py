"""MinIO (S3-compatible) evidence store behind a tiny boto3 wrapper.

Demo-grade contract: every op raises on failure; callers (views/tasks) decide
whether to fail hard or record `processing_error` and continue the pipeline.
Import this module as `from apps.evidence.services import storage` and call
`storage.upload_bytes(...)` so tests can patch `apps.evidence.services.storage.*`.
"""
from __future__ import annotations

import logging

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

log = logging.getLogger(__name__)

# Fail fast when the object store is down: the API must degrade to
# metadata-only mode in seconds, not hang through boto's default retries.
CLIENT_CONFIG = Config(connect_timeout=3, read_timeout=15, retries={"max_attempts": 2})


def endpoint_url() -> str:
    scheme = "https" if settings.MINIO_SECURE else "http"
    return f"{scheme}://{settings.MINIO_ENDPOINT}"


def get_client():
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url(),
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        region_name="us-east-1",
        config=CLIENT_CONFIG,
    )


def ensure_bucket() -> str:
    """Create the evidence bucket if missing. Returns bucket name."""
    bucket = settings.MINIO_BUCKET
    client = get_client()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in ("404", "NoSuchBucket", "NotFound"):
            client.create_bucket(Bucket=bucket)
            log.info("created MinIO bucket %s", bucket)
        else:
            raise
    return bucket


def upload_bytes(storage_key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    bucket = ensure_bucket()
    get_client().put_object(Bucket=bucket, Key=storage_key, Body=data, ContentType=content_type or "application/octet-stream")
    return storage_key


def object_exists(storage_key: str) -> bool:
    try:
        get_client().head_object(Bucket=settings.MINIO_BUCKET, Key=storage_key)
        return True
    except ClientError as exc:
        if str(exc.response.get("Error", {}).get("Code", "")) in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def download_bytes(storage_key: str) -> bytes:
    resp = get_client().get_object(Bucket=settings.MINIO_BUCKET, Key=storage_key)
    return resp["Body"].read()


def delete_object(storage_key: str) -> None:
    try:
        get_client().delete_object(Bucket=settings.MINIO_BUCKET, Key=storage_key)
    except (BotoCoreError, ClientError) as exc:  # best-effort: metadata delete must not fail on storage errors
        log.warning("MinIO delete failed for %s: %s", storage_key, exc)


def presigned_get_url(storage_key: str, expires: int = 3600) -> str:
    return get_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.MINIO_BUCKET, "Key": storage_key},
        ExpiresIn=expires,
    )
