
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

def list_all_items(max_items=3000):
    """Recursively list all research files and folders."""
    if max_items < 1:
        raise ValueError("max_items must be positive")

    results = []
    pending = [""]
    visited = set()

    while pending:
        folder = pending.pop()

        if folder in visited:
            continue

        visited.add(folder)

        # list_items currently returns up to 1000 entries.
        items = list_items(folder)

        if len(items) >= 1000:
            raise ValueError(
                f"Folder '{folder or '/'}' has at least "
                "1000 entries. Pagination is required."
            )

        for item in items:
            name = item.get("name", "")

            if name in (".folder", ".emptyFolderPlaceholder"):
                continue

            if not name:
                continue

            path = f"{folder}/{name}" if folder else name
            is_folder = item.get("id") is None

            results.append({
                **item,
                "path": path,
                "is_folder": is_folder,
            })

            if len(results) > max_items:
                raise ValueError(
                    "Research Library exceeds the "
                    f"{max_items} item search limit."
                )

            if is_folder:
                pending.append(path)

    return results

# ============================================================
# RESEARCH LIBRARY - FOLDER MANAGEMENT
# ============================================================

def folder_contents(folder):
    """Collect every stored object inside a folder."""
    folder = clean_path(folder)

    if not folder:
        raise ValueError("Root folder cannot be managed")

    pending = [folder]
    visited = set()
    paths = []

    while pending:
        current = pending.pop()

        if current in visited:
            continue

        visited.add(current)
        items = list_items(current)

        if len(items) >= 1000:
            raise ValueError(
                "Folder contains too many items; "
                "pagination is required"
            )

        for item in items:
            name = item.get("name")

            if not name:
                continue

            path = f"{current}/{name}"

            if item.get("id") is None:
                pending.append(path)
            else:
                paths.append(path)

    return paths


def move_folder(source, destination):
    """Move or rename a folder and its contents."""
    source = clean_path(source)
    destination = clean_path(destination)

    if not source or not destination:
        raise ValueError(
            "Source and destination folders are required"
        )

    if destination.startswith(source + "/"):
        raise ValueError(
            "Cannot move a folder into itself"
        )

    if source == destination:
        return {
            "source": source,
            "destination": destination,
            "moved": 0,
        }

    paths = folder_contents(source)

    if not paths:
        raise ValueError("Folder is empty or does not exist")

    moved = []

    for old_path in paths:
        relative = old_path[len(source) + 1:]
        new_path = f"{destination}/{relative}"

        move_file(old_path, new_path)
        moved.append({
            "source": old_path,
            "destination": new_path,
        })

    return {
        "source": source,
        "destination": destination,
        "moved": len(moved),
        "files": moved,
    }


def delete_folder(folder):
    """Delete a folder and every object inside it."""
    folder = clean_path(folder)

    if not folder:
        raise ValueError("Root folder cannot be deleted")

    paths = folder_contents(folder)

    if not paths:
        raise ValueError("Folder is empty or does not exist")

    # Delete in batches to avoid oversized requests.
    deleted = 0

    for start in range(0, len(paths), 100):
        batch = paths[start:start + 100]
        delete_files(batch)
        deleted += len(batch)

    return {
        "folder": folder,
        "deleted": deleted,
    }
