"""Research article metadata, images and attachments in the existing private bucket."""
import hmac
import json
import logging
import os
import re
import uuid
from datetime import date
from pathlib import PurePosixPath
from urllib.parse import quote

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
import research_storage as storage

router = APIRouter(prefix='/research/articles', tags=['Research Articles'])
SUFFIX = '.lfarticle.json'
ASSETS = '.lf-assets'
MAX_CONTENT = 250_000
IMAGE_TYPES = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'}

class ArticleInput(BaseModel):
    folder: str = ''
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default='', max_length=3000)
    date: date
    content: str = Field(min_length=1, max_length=MAX_CONTENT)
    attachments: list[dict] = Field(default_factory=list, max_length=100)

def auth(password):
    expected = os.getenv('RESEARCH_ADMIN_PASSWORD', '')
    if not expected:
        raise HTTPException(503, 'Research admin password not configured')
    if not password or not hmac.compare_digest(password, expected):
        raise HTTPException(401, 'Invalid Research Library password')

def checked_path(path):
    try:
        return storage.clean_path(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

def article_path(folder, slug):
    return f'{folder}/{slug}{SUFFIX}' if folder else f'{slug}{SUFFIX}'

def read_article(path):
    path = checked_path(path)
    if not path.endswith(SUFFIX):
        raise HTTPException(400, 'Not an article')
    try:
        article = json.loads(storage.download_file(path).decode('utf-8'))
        return {**article, 'path': path}
    except Exception as exc:
        logging.warning('Article read failed: %s', path, exc_info=True)
        raise HTTPException(404, 'Article not found') from exc

def validate_attachments(attachments):
    output = []
    for item in attachments:
        if not isinstance(item, dict):
            raise HTTPException(400, 'Invalid attachment')
        path = checked_path(item.get('path', ''))
        name = str(item.get('name', '')).strip()[:250]
        if not path or not name:
            raise HTTPException(400, 'Attachment path and name required')
        output.append({'path': path, 'name': name})
    return output

@router.get('')
def list_articles(folder: str = ''):
    folder = checked_path(folder)
    articles = []
    for item in storage.list_items(folder):
        name = item.get('name', '')
        if name.endswith(SUFFIX) and item.get('id') is not None:
            try:
                article = read_article(article_path(folder, name[:-len(SUFFIX)]))
                articles.append({k: article.get(k) for k in ('path','slug','title','summary','date','folder','attachments')})
            except HTTPException:
                continue
    return {'articles': sorted(articles, key=lambda a: str(a.get('date') or ''), reverse=True)}

@router.get('/item')
def get_article(path: str):
    return read_article(path)

@router.post('')
def create_article(body: ArticleInput, x_research_password: str | None = Header(default=None)):
    auth(x_research_password)
    folder = checked_path(body.folder)
    # Random IDs avoid Unicode title collisions and accidental overwrite.
    slug = 'article-' + uuid.uuid4().hex[:20]
    path = article_path(folder, slug)
    article = {'slug': slug, 'folder': folder, 'title': body.title.strip(),
               'summary': body.summary, 'date': body.date.isoformat(),
               'content': body.content, 'attachments': validate_attachments(body.attachments)}
    storage.upload_file(path, json.dumps(article, ensure_ascii=False).encode('utf-8'), 'application/json')
    return {'ok': True, 'path': path}

@router.put('/item')
def update_article(path: str, body: ArticleInput, x_research_password: str | None = Header(default=None)):
    auth(x_research_password)
    old = read_article(path)
    article = {**old, 'folder': '' if str(PurePosixPath(old['path']).parent) == '.' else str(PurePosixPath(old['path']).parent),
               'title': body.title.strip(), 'summary': body.summary,
               'date': body.date.isoformat(), 'content': body.content,
               'attachments': validate_attachments(body.attachments)}
    article.pop('path', None)
    storage.upload_file(old['path'], json.dumps(article, ensure_ascii=False).encode('utf-8'), 'application/json')
    return {'ok': True, 'path': old['path']}

@router.post('/upload')
async def upload_asset(file: UploadFile = File(...), folder: str = Form(''),
                       kind: str = Form('attachment'),
                       x_research_password: str | None = Header(default=None)):
    auth(x_research_password)
    folder = checked_path(folder)
    name = PurePosixPath(file.filename or '').name
    if not name or name in ('.', '..') or '\\' in name:
        raise HTTPException(400, 'Invalid filename')
    if kind not in ('image', 'attachment'):
        raise HTTPException(400, 'Invalid asset kind')
    mime = (file.content_type or '').lower()
    if kind == 'image' and mime not in IMAGE_TYPES:
        raise HTTPException(400, 'Only PNG, JPEG, WebP and GIF images are supported')
    data = await file.read(storage.MAX_FILE_BYTES + 1)
    if len(data) > storage.MAX_FILE_BYTES:
        raise HTTPException(413, 'File exceeds 25 MB')
    if kind == 'image':
        valid = (mime == 'image/png' and data.startswith(b'\x89PNG\r\n\x1a\n')) or (mime == 'image/jpeg' and data.startswith(b'\xff\xd8\xff')) or (mime == 'image/gif' and data[:6] in (b'GIF87a',b'GIF89a')) or (mime == 'image/webp' and data[:4] == b'RIFF' and data[8:12] == b'WEBP')
        if not valid:
            raise HTTPException(400, 'Image content does not match file type')
        extension = IMAGE_TYPES[mime]
    else:
        extension = PurePosixPath(name).suffix.lower()[:12]
        if not re.fullmatch(r'\.[a-z0-9]{1,10}', extension):
            extension = '.bin'
    path = '/'.join(x for x in (folder, ASSETS, uuid.uuid4().hex + extension) if x)
    storage.upload_file(path, data, mime or 'application/octet-stream')
    return {'path': path, 'name': name, 'url': f'/research/articles/media?path={quote(path, safe="")}' if kind == 'image' else None}

@router.get('/media')
def media(path: str):
    path = checked_path(path)
    parts = path.split('/')
    if ASSETS not in parts:
        raise HTTPException(400, 'Not an article image')
    suffix = PurePosixPath(path).suffix.lower()
    mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}.get(suffix)
    if not mime:
        raise HTTPException(415, 'Unsupported image format')
    try:
        content = storage.download_file(path)
    except Exception as exc:
        raise HTTPException(404, 'Image not found') from exc
    return Response(content, media_type=mime, headers={'Cache-Control':'public, max-age=300', 'X-Content-Type-Options':'nosniff'})
