
"""Private Supabase Storage operations for Research Library.

Bucket: research-library (private)

Server-side only. Never expose SUPABASE_SECRET_KEY
to browsers or public unauthenticated endpoints.
"""

import mimetypes
from pathlib import PurePosixPath
from urllib.parse import quote

import requests

from cloud_cache import _config, _headers


BUCKET = "research-library"
MAX_FILE_BYTES = 25 * 1024 * 1024


def clean_path(path):
    """Validate a relative storage path."""
    path = str(path or "").strip().strip("/")

    if not path:
        return ""

    parts = path.split("/")

    if any(
        p in ("", ".", "..") or "\\" in p
        for p in parts
    ):
        raise ValueError("Invalid storage path")

    return "/".join(parts)


def _endpoint(path):
    url, key = _config()
    object_path = quote(clean_path(path), safe="/")

    return (
        f"{url}/storage/v1/object/"
        f"{BUCKET}/{object_path}"
    ), key


def list_items(folder=""):
    """List files and folders in a Supabase Storage prefix."""
    folder = clean_path(folder)
    url, key = _config()

    endpoint = (
        f"{url}/storage/v1/object/list/{BUCKET}"
    )

    response = requests.post(
        endpoint,
        headers={
            **_headers(key),
            "Content-Type": "application/json",
        },
        json={
            "prefix": folder,
            "limit": 1000,
            "offset": 0,
            "sortBy": {
                "column": "name",
                "order": "asc",
            },
        },
        timeout=(10, 45),
    )

    if response.status_code >= 400:
    raise RuntimeError(
        f"Supabase upload failed: "
        f"HTTP {response.status_code} | "
        f"{response.text[:1000]}"
    )
    return response.json()



def upload_file(path, content, content_type=None):
    """Upload or overwrite one research file."""
    path = clean_path(path)

    if not path:
        raise ValueError("File path is required")

    if len(content) > MAX_FILE_BYTES:
        raise ValueError("File exceeds 25 MB limit")

    endpoint, key = _endpoint(path)

    mime = (
        content_type
        or mimetypes.guess_type(path)[0]
        or "application/octet-stream"
    )

    response = requests.post(
        endpoint,
        headers={
            **_headers(key),
            "Content-Type": mime,
            "x-upsert": "true",
        },
        data=content,
        timeout=(10, 90),
    )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Supabase upload failed: "
            f"HTTP {response.status_code} | "
            f"{response.text[:1000]}"
        )

    return {
        "path": path,
        "size": len(content),
        "content_type": mime,
    }



def download_file(path):
    """Download a private file as bytes."""
    path = clean_path(path)

    if not path:
        raise ValueError("File path is required")

    url, key = _config()

    endpoint = (
        f"{url}/storage/v1/object/authenticated/"
        f"{BUCKET}/{quote(path, safe='/')}"
    )

    response = requests.get(
        endpoint,
        headers=_headers(key),
        timeout=(10, 90),
    )

    response.raise_for_status()

    return response.content


def delete_files(paths):
    """Delete files from the private bucket."""
    cleaned = [clean_path(p) for p in paths]

    if not cleaned or any(not p for p in cleaned):
        raise ValueError("Valid file paths are required")

    url, key = _config()

    endpoint = (
        f"{url}/storage/v1/object/{BUCKET}"
    )

    response = requests.delete(
        endpoint,
        headers={
            **_headers(key),
            "Content-Type": "application/json",
        },
        json={"prefixes": cleaned},
        timeout=(10, 60),
    )

    response.raise_for_status()
    return response.json()


def move_file(source, destination):
    """Move or rename a file within Research Library."""
    source = clean_path(source)
    destination = clean_path(destination)

    if not source or not destination:
        raise ValueError("Source and destination are required")

    if source == destination:
        return {"source": source, "destination": destination}

    url, key = _config()

    endpoint = (
        f"{url}/storage/v1/object/move"
    )

    response = requests.post(
        endpoint,
        headers={
            **_headers(key),
            "Content-Type": "application/json",
        },
        json={
            "bucketId": BUCKET,
            "sourceKey": source,
            "destinationKey": destination,
        },
        timeout=(10, 60),
    )

    response.raise_for_status()

    return {
        "source": source,
        "destination": destination,
    }
