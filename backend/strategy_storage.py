
"""Strategy Lab storage backed by a separate Supabase bucket.

This module has its own fixed bucket configuration.
It never modifies research_storage.BUCKET.
"""

import mimetypes
from urllib.parse import quote

import requests

from cloud_cache import _config, _headers
from research_storage import clean_path, MAX_FILE_BYTES


BUCKET = "strategy-lab"


def _storage_url(path):
    url, key = _config()
    encoded = quote(clean_path(path), safe="/")
    return f"{url}/storage/v1/object/{BUCKET}/{encoded}", key


def list_items(folder=""):
    folder = clean_path(folder)
    url, key = _config()

    response = requests.post(
        f"{url}/storage/v1/object/list/{BUCKET}",
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
    response.raise_for_status()
    return response.json()


def upload_file(path, content, content_type=None):
    path = clean_path(path)

    if not path:
        raise ValueError("File path is required")

    if len(content) > MAX_FILE_BYTES:
        raise ValueError("File exceeds 25 MB limit")

    endpoint, key = _storage_url(path)

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
    response.raise_for_status()

    return {
        "path": path,
        "size": len(content),
        "content_type": mime,
    }


def download_file(path):
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
    cleaned = [clean_path(p) for p in paths]

    if not cleaned or any(not p for p in cleaned):
        raise ValueError("Valid file paths are required")

    url, key = _config()

    response = requests.delete(
        f"{url}/storage/v1/object/{BUCKET}",
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
    source = clean_path(source)
    destination = clean_path(destination)

    if not source or not destination:
        raise ValueError(
            "Source and destination are required"
        )

    if source == destination:
        return {
            "source": source,
            "destination": destination,
        }

    url, key = _config()

    response = requests.post(
        f"{url}/storage/v1/object/move",
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
    results = []
    pending = [""]
    visited = set()

    while pending:
        folder = pending.pop()

        if folder in visited:
            continue

        visited.add(folder)
        items = list_items(folder)

        if len(items) >= 1000:
            raise ValueError(
                "Folder listing requires pagination"
            )

        for item in items:
            name = item.get("name", "")

            if not name or name in (
                ".folder",
                ".emptyFolderPlaceholder",
            ):
                continue

            path = (
                f"{folder}/{name}"
                if folder else name
            )
            is_folder = item.get("id") is None

            results.append({
                **item,
                "path": path,
                "is_folder": is_folder,
            })

            if len(results) > max_items:
                raise ValueError(
                    "Strategy Lab search limit exceeded"
                )

            if is_folder:
                pending.append(path)

    return results


def folder_contents(folder):
    folder = clean_path(folder)

    if not folder:
        raise ValueError(
            "Root folder cannot be managed"
        )

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
                "Folder listing requires pagination"
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
    source = clean_path(source)
    destination = clean_path(destination)

    if not source or not destination:
        raise ValueError(
            "Source and destination are required"
        )

    if destination == source:
        return {
            "source": source,
            "destination": destination,
            "moved": 0,
        }

    if destination.startswith(source + "/"):
        raise ValueError(
            "Cannot move a folder into itself"
        )

    paths = folder_contents(source)

    if not paths:
        raise ValueError(
            "Folder is empty or does not exist"
        )

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
    folder = clean_path(folder)

    if not folder:
        raise ValueError(
            "Root folder cannot be deleted"
        )

    paths = folder_contents(folder)

    if not paths:
        raise ValueError(
            "Folder is empty or does not exist"
        )

    deleted = 0

    for start in range(0, len(paths), 100):
        batch = paths[start:start + 100]
        delete_files(batch)
        deleted += len(batch)

    return {
        "folder": folder,
        "deleted": deleted,
    }
