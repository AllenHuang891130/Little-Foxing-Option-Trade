"""Private Supabase Storage cache for the Render backend.

Environment: SUPABASE_URL, SUPABASE_SECRET_KEY
Bucket: taifex-cache (private)
Only call this module on the backend. Never expose the secret key to Next.js.
"""
import logging
import os
from pathlib import Path
from urllib.parse import quote

import requests

BUCKET = "taifex-cache"
PREFIX = "processed/v4"


def _config():
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SECRET_KEY is missing")
    if not url.startswith("https://"):
        raise RuntimeError("SUPABASE_URL must start with https://")
    return url, key


def _object_key(filename):
    name = Path(filename).name
    if not name.startswith(("TXO_MTX_", "TXO_INSTITUTIONAL_")) or not name.endswith(".csv"):
        raise ValueError("Unsupported cache filename")
    return f"{PREFIX}/{name}"


def _headers(key):
    return {"apikey": key, "Authorization": f"Bearer {key}"}



def download_cache(local_path):
    """Download a cached CSV from private Supabase Storage."""
    url, key = _config()
    local_path = Path(local_path)
    object_key = quote(_object_key(local_path.name), safe="/")

    endpoint = (
        f"{url}/storage/v1/object/authenticated/"
        f"{BUCKET}/{object_key}"
    )

    response = requests.get(
        endpoint,
        headers=_headers(key),
        timeout=(10, 45),
    )

    # Show the actual Supabase error, without printing credentials.
    if response.status_code >= 400:
        logging.warning(
            "Supabase download response: status=%s file=%s body=%s",
            response.status_code,
            local_path.name,
            response.text[:500],
        )

    if response.status_code == 404:
        return False

    # Supabase Storage may report a missing object as HTTP 400.
    if response.status_code == 400:
        try:
            error = response.json()
        except ValueError:
            error = {}

        code = str(error.get("error", "")).lower()
        message = str(error.get("message", "")).lower()

        if (
            "not_found" in code
            or "nosuchkey" in code
            or "object not found" in message
            or "not found" in message
        ):
            logging.info("Supabase cache MISS: %s", object_key)
            return False

    response.raise_for_status()

    if not response.content:
        raise ValueError("Empty cloud cache response")

    local_path.parent.mkdir(parents=True, exist_ok=True)

    temporary = local_path.with_name(
        local_path.name + ".download"
    )

    temporary.write_bytes(response.content)
    temporary.replace(local_path)

    logging.info("Supabase cache HIT: %s", object_key)
    return True


def upload_cache(local_path):
    """Upload a CSV cache; upsert so force-refresh replaces prior data."""
    url, key = _config()
    local_path = Path(local_path)
    object_key = quote(_object_key(local_path.name), safe="/")
    endpoint = f"{url}/storage/v1/object/{BUCKET}/{object_key}"
    headers = {
        **_headers(key),
        "Content-Type": "text/csv; charset=utf-8",
        "x-upsert": "true",
    }
    with local_path.open("rb") as fh:
        response = requests.post(endpoint, headers=headers, data=fh, timeout=(10, 90))
    response.raise_for_status()
    logging.info("Supabase cache UPLOADED: %s", object_key)
    return True
