"""Research Library Markdown articles stored in existing private Supabase bucket."""
import hmac
import json
import logging
import os
import re
import unicodedata
from datetime import date
from pathlib import PurePosixPath

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
import research_storage as storage

router = APIRouter(prefix='/research/articles', tags=['Research Articles'])
SUFFIX = '.lfarticle.json'
MAX_CONTENT = 250_000

class ArticleInput(BaseModel):
    folder: str = ''
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default='', max_length=3000)
    date: date
    content: str = Field(min_length=1, max_length=MAX_CONTENT)
    slug: str | None = None

def auth(password):
    expected = os.getenv('RESEARCH_ADMIN_PASSWORD', '')
    if not expected:
        raise HTTPException(503, 'Research admin password not configured')
    if not password or not hmac.compare_digest(password, expected):
        raise HTTPException(401, 'Invalid Research Library password')

def path_for(folder, slug):
    folder = storage.clean_path(folder)
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,99}', slug):
        raise HTTPException(400, 'Invalid article slug')
    return f'{folder}/{slug}{SUFFIX}' if folder else f'{slug}{SUFFIX}'

def make_slug(title):
    slug = unicodedata.normalize('NFKD', title).lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug).strip('-')[:75].strip('-')
    if not slug:
        import uuid
        slug = 'article-' + uuid.uuid4().hex[:12]
    return slug

def read_article(path):
    if not path.endswith(SUFFIX):
        raise HTTPException(400, 'Not an article')
    try:
        obj = json.loads(storage.download_file(path).decode('utf-8'))
        return {**obj, 'path': path}
    except HTTPException:
        raise
    except Exception:
        logging.exception('Research article read failed')
        raise HTTPException(404, 'Article not found or unreadable')

@router.get('')
def list_articles(folder: str = ''):
    try:
        folder = storage.clean_path(folder)
        files = storage.list_items(folder)
        results = []
        for f in files:
            name = f.get('name', '')
            if not name.endswith(SUFFIX):
                continue
            path = f'{folder}/{name}' if folder else name
            try:
                item = read_article(path)
                results.append({k: item.get(k) for k in ('path','slug','title','summary','date','folder')})
            except HTTPException:
                continue
        return {'articles': sorted(results, key=lambda x: str(x.get('date') or ''), reverse=True)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))

@router.get('/item')
def get_article(path: str):
    try:
        path = storage.clean_path(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return read_article(path)

@router.post('')
def create_article(body: ArticleInput, x_research_password: str | None = Header(default=None)):
    auth(x_research_password)
    try:
        folder = storage.clean_path(body.folder)
        slug = make_slug(body.title)
        path = path_for(folder, slug)
        # Never overwrite an existing file; choose a distinct slug.
        existing = {f.get('name') for f in storage.list_items(folder)}
        if PurePosixPath(path).name in existing:
            import uuid
            slug = f'{slug[:70]}-{uuid.uuid4().hex[:8]}'
            path = path_for(folder, slug)
        article = {'slug': slug, 'folder': folder, 'title': body.title.strip(),
                   'summary': body.summary, 'date': body.date.isoformat(), 'content': body.content}
        storage.upload_file(path, json.dumps(article, ensure_ascii=False).encode('utf-8'), 'application/json')
        return {'ok': True, 'path': path}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        logging.exception('Research article create failed')
        raise HTTPException(500, 'Unable to create article')

@router.put('/item')
def update_article(path: str, body: ArticleInput, x_research_password: str | None = Header(default=None)):
    auth(x_research_password)
    try:
        path = storage.clean_path(path)
        existing = read_article(path)
        # Keep location and slug stable; use existing file move APIs to move it.
        article = {'slug': existing['slug'], 'folder': str(PurePosixPath(path).parent).replace('.', ''),
                   'title': body.title.strip(), 'summary': body.summary,
                   'date': body.date.isoformat(), 'content': body.content}
        storage.upload_file(path, json.dumps(article, ensure_ascii=False).encode('utf-8'), 'application/json')
        return {'ok': True, 'path': path}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except HTTPException:
        raise
    except Exception:
        logging.exception('Research article update failed')
        raise HTTPException(500, 'Unable to update article')
