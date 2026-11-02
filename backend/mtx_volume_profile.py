"""Little Foxing MTX tick-volume profile. Isolated private Supabase cache."""
import io
import os
import re
import zipfile
from datetime import date
from urllib.parse import quote

import numpy as np
import pandas as pd
import requests

BUCKET = 'mtx-volume-profile'
VERSION = 'v1'
BASE = 'https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/'
REQUIRED = {'成交日期','商品代號','到期月份(週別)','成交時間','成交價格','成交數量(B+S)'}
MAX_ZIP = 120 * 1024 * 1024
MAX_CSV = 500 * 1024 * 1024


def _config():
    url = os.getenv('SUPABASE_URL', '').rstrip('/')
    key = os.getenv('SUPABASE_SECRET_KEY', '')
    if not url.startswith('https://') or not key:
        raise RuntimeError('SUPABASE_URL / SUPABASE_SECRET_KEY not configured')
    return url, key


def _headers():
    _, key = _config()
    return {'apikey': key, 'Authorization': 'Bearer ' + key}


def _get(key):
    url, _ = _config()
    endpoint = f'{url}/storage/v1/object/authenticated/{BUCKET}/{quote(key, safe="/")}'
    r = requests.get(endpoint, headers=_headers(), timeout=(10, 120))
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content


def _put(key, data, content_type):
    url, _ = _config()
    endpoint = f'{url}/storage/v1/object/{BUCKET}/{quote(key, safe="/")}'
    r = requests.post(endpoint, headers={**_headers(), 'Content-Type': content_type, 'x-upsert': 'true'}, data=data, timeout=(10, 180))
    r.raise_for_status()


def _zip_bytes(day, force=False):
    name = f'Daily_{day:%Y_%m_%d}.zip'
    key = f'raw/{name}'
    content = None if force else _get(key)
    if content is not None and not zipfile.is_zipfile(io.BytesIO(content)):
        content = None
    if content is None:
        url = BASE + name
        with requests.get(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.taifex.com.tw/'}, timeout=(15, 180), stream=True) as r:
            r.raise_for_status()
            parts, total = [], 0
            for part in r.iter_content(1024 * 1024):
                total += len(part)
                if total > MAX_ZIP:
                    raise ValueError('TAIFEX ZIP exceeds size limit')
                parts.append(part)
            content = b''.join(parts)
        if not zipfile.is_zipfile(io.BytesIO(content)):
            raise ValueError('TAIFEX response is not a ZIP. Check trading date / publication status.')
        _put(key, content, 'application/zip')
    return content


def _csv_from_zip(content):
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        for info in z.infolist():
            if not info.filename.lower().endswith('.csv') or info.file_size > MAX_CSV:
                continue
            raw = z.read(info)
            for encoding in ('cp950', 'big5', 'utf-8-sig', 'utf-8'):
                try:
                    header = pd.read_csv(io.BytesIO(raw), encoding=encoding, nrows=1)
                    if REQUIRED.issubset(set(header.columns.str.strip())):
                        return raw, encoding
                except (UnicodeError, ValueError, pd.errors.ParserError):
                    pass
    raise ValueError('No valid TAIFEX tick CSV in ZIP')


def _tick_rows(day, force=False):
    raw, encoding = _csv_from_zip(_zip_bytes(day, force))
    pieces = []
    use = list(REQUIRED)
    for chunk in pd.read_csv(io.BytesIO(raw), encoding=encoding, usecols=lambda c: c.strip() in REQUIRED,
                             dtype={'商品代號': 'string', '到期月份(週別)': 'string'}, chunksize=150000, low_memory=False):
        chunk.columns = chunk.columns.str.strip()
        chunk = chunk[chunk['商品代號'].astype('string').str.strip().eq('MTX').fillna(False)].copy()
        if chunk.empty:
            continue
        chunk['expiry'] = chunk['到期月份(週別)'].astype('string').str.strip()
        chunk = chunk[chunk['expiry'].str.fullmatch(r'\d{6}').fillna(False)]
        if chunk.empty:
            continue
        chunk['price'] = pd.to_numeric(chunk['成交價格'], errors='coerce')
        chunk['volume'] = pd.to_numeric(chunk['成交數量(B+S)'], errors='coerce') / 2
        chunk['time'] = pd.to_numeric(chunk['成交時間'], errors='coerce')
        chunk = chunk[(chunk.price > 0) & (chunk.volume > 0) & chunk.time.notna()]
        chunk['session'] = np.select([
            chunk.time.between(84500, 134500),
            (chunk.time >= 150000) | (chunk.time <= 50000)
        ], ['DAY', 'NIGHT'], default='OTHER')
        chunk = chunk[chunk.session != 'OTHER']
        if not chunk.empty:
            pieces.append(chunk[['expiry', 'price', 'volume', 'session']])
    if not pieces:
        raise ValueError('No MTX outright tick trades for this trading date')
    return pd.concat(pieces, ignore_index=True)


def available(day, force=False):
    df = _tick_rows(day, force)
    ym = day.strftime('%Y%m')
    return sorted(e for e in df.expiry.unique().tolist() if e >= ym)


def calculate(day: date, session='ALL', expiry='AUTO', value_area_pct=.70, price_step=1, top_n=10, force=False):
    if session not in ('ALL', 'DAY', 'NIGHT'):
        raise ValueError('Invalid session')
    if not 0 < value_area_pct <= 1 or not 0 < price_step <= 100 or not 1 <= top_n <= 50:
        raise ValueError('Invalid volume-profile parameters')
    if expiry != 'AUTO' and not re.fullmatch(r'\d{6}', expiry):
        raise ValueError('Invalid expiry')
    df = _tick_rows(day, force)
    if session != 'ALL':
        df = df[df.session == session]
    candidates = sorted(e for e in df.expiry.unique() if e >= day.strftime('%Y%m'))
    selected = candidates[0] if expiry == 'AUTO' and candidates else expiry
    df = df[df.expiry == selected].copy()
    if df.empty:
        raise ValueError(f'No MTX {selected} trades in {session} session')
    # Group directly; avoid allocating an enormous price grid on malformed ticks.
    df['level'] = np.floor(df.price / price_step) * price_step
    series = df.groupby('level', sort=True).volume.sum()
    min_level, max_level = float(series.index.min()), float(series.index.max())
    count = round((max_level - min_level) / price_step) + 1
    if count > 20000:
        raise ValueError('Price range exceeds 20,000 levels; increase price step')
    levels = min_level + np.arange(count) * price_step
    volumes = series.reindex(levels, fill_value=0).to_numpy(dtype=float)
    idx = int(np.argmax(volumes))
    total = float(volumes.sum())
    left = right = idx
    accum = float(volumes[idx])
    while accum < total * value_area_pct:
        lv = volumes[left-1] if left > 0 else -1
        rv = volumes[right+1] if right < len(volumes)-1 else -1
        if lv < 0 and rv < 0:
            break
        if rv >= lv and rv >= 0:
            right += 1
            accum += volumes[right]
        else:
            left -= 1
            accum += volumes[left]
    profile = pd.DataFrame({'price': levels, 'volume': volumes})
    profile['in_value_area'] = profile.price.between(levels[left], levels[right])
    profile['is_poc'] = False
    profile.loc[idx, 'is_poc'] = True
    top = profile.nlargest(top_n, 'volume')[['price', 'volume']].to_dict('records')
    summary = {'date': day.isoformat(), 'session': session, 'expiry': selected,
               'trades': int(len(df)), 'total_volume': total, 'poc': float(levels[idx]),
               'poc_volume': float(volumes[idx]), 'vah': float(levels[right]),
               'val': float(levels[left]), 'actual_value_area_pct': accum / total * 100,
               'price_min': min_level, 'price_max': max_level, 'price_step': price_step,
               'top_levels': top}
    return summary, profile


def cache_profile(summary, profile):
    """Persist computed profile for inspection/export; failure should be surfaced."""
    name = f"{summary['date']}_{summary['expiry']}_{summary['session']}_step{summary['price_step']}.csv"
    key = f'profiles/{VERSION}/{name}'
    _put(key, profile.to_csv(index=False).encode('utf-8-sig'), 'text/csv; charset=utf-8')
    return key


def draw(summary, profile):
    import matplotlib.pyplot as plt
    p = profile.price.to_numpy(dtype=float)
    v = profile.volume.to_numpy(dtype=float)
    colors = np.where(profile.in_value_area.to_numpy(), '#6699CC', '#C6CDD5')
    colors[profile.is_poc.to_numpy()] = '#E74C3C'
    fig, ax = plt.subplots(figsize=(12, 12))
    ax.barh(p, v, height=summary['price_step'] * .95, color=colors, edgecolor='none')
    for key, color in [('poc', '#C0392B'), ('vah', '#E39B28'), ('val', '#218C74')]:
        ax.axhline(summary[key], color=color, ls='-' if key == 'poc' else '--',
                   lw=2, label=f'{key.upper()}: {summary[key]:,.0f}')
    ax.set_title(f"Little Foxing | MTX Volume Profile\n{summary['date']} | MTX {summary['expiry']} | {summary['session']}")
    ax.set_xlabel('Traded Volume (Contracts)')
    ax.set_ylabel('MTX Price')
    ax.grid(axis='x', alpha=.2)
    ax.legend()
    fig.tight_layout()
    return fig
