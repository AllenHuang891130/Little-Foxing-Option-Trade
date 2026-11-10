"""Little Foxing Markets Insights API. Mount in backend/server.py with:
from markets_insights_api import router as markets_insights_router
app.include_router(markets_insights_router)

Environment: LF_GITHUB_TOKEN (repo Contents read/write), LF_INSIGHTS_ADMIN_KEY,
optional LF_GITHUB_REPO (default AllenHuang891130/Little-Foxing-Option-Trade),
LF_INSIGHTS_BRANCH (default main).
All articles public. Writes require admin key; no public write endpoints.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix='/api/insights', tags=['Markets Insights'])
REPO = os.getenv('LF_GITHUB_REPO', 'AllenHuang891130/Little-Foxing-Option-Trade')
BRANCH = os.getenv('LF_INSIGHTS_BRANCH', 'main')
ROOT = 'content/markets-insights'
CATEGORIES = {'daily', 'bonds', 'research'}
MAX_BYTES = 8 * 1024 * 1024


def _gh(method: str, path: str, data=None):
    token = os.getenv('LF_GITHUB_TOKEN', '')
    url = f'https://api.github.com/repos/{REPO}/contents/{urllib.parse.quote(path, safe="/")}'
    if method == 'GET':
        url += '?ref=' + urllib.parse.quote(BRANCH)
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'Little-Foxing-Insights', 'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    payload = json.dumps(data).encode() if data is not None else None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        if exc.code in (401, 403):
            raise HTTPException(502, 'GitHub access denied or rate limit exceeded')
        raise HTTPException(502, f'GitHub API returned {exc.code}')
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(502, 'GitHub temporarily unavailable')


def _require_admin(key: str | None):
    expected = os.getenv('LF_INSIGHTS_ADMIN_KEY', '')
    if not expected:
        raise HTTPException(503, 'Admin publishing is not configured')
    import hmac
    if not key or not hmac.compare_digest(key, expected):
        raise HTTPException(403, 'Invalid publishing key')
    if not os.getenv('LF_GITHUB_TOKEN'):
        raise HTTPException(503, 'GitHub publishing token is not configured')


def _safe_slug(value: str):
    value = re.sub(r'[^a-z0-9-]', '-', value.lower().strip())
    value = re.sub(r'-+', '-', value).strip('-')
    if not value or len(value) > 100:
        raise HTTPException(422, 'Invalid slug')
    return value


class PublishRequest(BaseModel):
    category: str
    title: str = Field(min_length=1, max_length=200)
    date: str  # YYYY-MM-DD
    summary: str = Field(default='', max_length=1200)
    content: str = Field(default='', max_length=600000)
    slug: str = ''
    filename: str = ''
    file_base64: str = ''


@router.get('/articles')
def list_articles(category: str = '', limit: int = 200):
    if category and category not in CATEGORIES:
        raise HTTPException(422, 'Invalid category')
    limit = max(1, min(limit, 500))
    categories = [category] if category else ['daily', 'bonds', 'research']
    articles = []
    for cat in categories:
        folder = _gh('GET', f'{ROOT}/{cat}')
        if not isinstance(folder, list):
            continue
        for item in folder:
            if item.get('type') != 'file' or not item.get('name', '').endswith('.json'):
                continue
            record = _gh('GET', item['path'])
            if not record or not record.get('content'):
                continue
            try:
                body = json.loads(base64.b64decode(record['content']).decode('utf-8'))
                articles.append({k: body.get(k, '') for k in ('slug', 'title', 'date', 'category', 'summary', 'file_name')})
            except (ValueError, UnicodeError):
                continue
    articles.sort(key=lambda a: (a.get('date', ''), a.get('slug', '')), reverse=True)
    return {'articles': articles[:limit]}


@router.get('/articles/{category}/{slug}')
def get_article(category: str, slug: str):
    if category not in CATEGORIES:
        raise HTTPException(404, 'Unknown category')
    slug = _safe_slug(slug)
    record = _gh('GET', f'{ROOT}/{category}/{slug}.json')
    if not record:
        raise HTTPException(404, 'Article not found')
    try:
        article = json.loads(base64.b64decode(record['content']).decode('utf-8'))
    except (ValueError, UnicodeError, KeyError):
        raise HTTPException(502, 'Corrupt article metadata')
    if article.get('file_name'):
        path = f'{ROOT}/{category}/attachments/{slug}/{article["file_name"]}'
        article['file_url'] = f'https://raw.githubusercontent.com/{REPO}/{BRANCH}/{path}'
    return article


@router.post('/articles')
def publish_article(payload: PublishRequest, x_insights_admin_key: str | None = Header(default=None)):
    _require_admin(x_insights_admin_key)
    if payload.category not in CATEGORIES:
        raise HTTPException(422, 'Invalid category')
    try:
        datetime.strptime(payload.date, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(422, 'Date must be YYYY-MM-DD')
    slug = _safe_slug(payload.slug or f'{payload.date}-{hashlib.sha256(payload.title.encode("utf-8")).hexdigest()[:12]}')
    file_name = ''
    if payload.file_base64:
        file_name = os.path.basename(payload.filename)
        if not re.fullmatch(r'[a-zA-Z0-9._-]{1,120}', file_name):
            raise HTTPException(422, 'Use an ASCII filename with letters, digits, dot, underscore or hyphen')
        if not file_name.lower().endswith(('.pdf', '.docx', '.md', '.txt')):
            raise HTTPException(422, 'Only PDF, DOCX, MD and TXT files are allowed')
        try:
            blob = base64.b64decode(payload.file_base64, validate=True)
        except ValueError:
            raise HTTPException(422, 'Invalid file encoding')
        if len(blob) > MAX_BYTES:
            raise HTTPException(413, 'File exceeds 8 MB limit')
        file_path = f'{ROOT}/{payload.category}/attachments/{slug}/{file_name}'
        existing_file = _gh('GET', file_path)
        _gh('PUT', file_path, {
            'message': f'insights: upload {payload.category}/{slug}/{file_name}',
            'content': base64.b64encode(blob).decode(), 'branch': BRANCH,
            **({'sha': existing_file['sha']} if existing_file else {})
        })
    article = {'category': payload.category, 'title': payload.title, 'date': payload.date,
               'summary': payload.summary, 'content': payload.content, 'slug': slug,
               'file_name': file_name, 'published_at': datetime.now(timezone.utc).isoformat()}
    path = f'{ROOT}/{payload.category}/{slug}.json'
    existing = _gh('GET', path)
    _gh('PUT', path, {'message': f'insights: publish {payload.category}/{slug}',
                     'content': base64.b64encode(json.dumps(article, ensure_ascii=False, indent=2).encode()).decode(),
                     'branch': BRANCH, **({'sha': existing['sha']} if existing else {})})
    return {'ok': True, 'slug': slug, 'category': payload.category}
