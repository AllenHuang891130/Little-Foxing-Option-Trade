"""Local FastAPI adapter around frozen V4 calculation functions."""
import base64
import io
import logging
import os
import threading
from datetime import date
from typing import Literal
from urllib.parse import quote
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Header, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import hmac
from pathlib import PurePosixPath
import strategy_storage as strategy
import research_storage as research
import v4_engine as v4

app = FastAPI(title="Quant Research Lab V4 API", version="0.3")
# Local-network development only. Restrict origins before public deployment.
origins = [x.strip().rstrip("/") for x in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "X-Research-Password"],
)
plot_lock = threading.Lock()

class Query(BaseModel):
    mode: Literal['single','compare','cross','inst','daynight']
    date1: date
    date2: date | None = None
    expiry: str = '202610'
    expiries: list[str] = Field(default_factory=list)
    range_pct: float = Field(default=6, ge=1, le=30)
    lookback: int = Field(default=20, ge=1, le=90)
    force: bool = False

def fmt(dt: date) -> str:
    return dt.strftime('%Y%m%d')

def daynight_updated(day, night, exp, rng=.06):
    """V4 IV methodology, user-approved top row: night volume and day OI."""
    a = v4.tidy(day); b = v4.tidy(night)
    a = a[a.expiry.eq(exp)].copy(); b = b[b.expiry.eq(exp)].copy()
    if a.empty or b.empty:
        raise ValueError('Expiry unavailable in one of the selected sessions')
    f1, f2 = a.F.median(), b.F.median()
    if not np.isfinite(f1) or not np.isfinite(f2):
        raise ValueError('Missing day/night MTX forward')
    low, high = f1 * (1-rng), f1 * (1+rng)
    a0 = a[a.strike.between(low, high)]
    b0 = b[b.strike.between(low, high)]
    strikes = sorted(set(a0.strike.dropna()).union(b0.strike.dropna()))
    if not strikes:
        raise ValueError('No strikes within the selected range')
    x=np.arange(len(strikes)); w=.38
    fig, ax=plt.subplots(2,2,figsize=(16,10),constrained_layout=True)
    for axis,dd,field,title in [
        (ax[0,0],b0,'volume','Night Volume by Strike'),
        (ax[0,1],a0,'oi','Day Open Interest by Strike')]:
        for j,cp in enumerate(['Call','Put']):
            y=dd[dd.cp.eq(cp)].groupby('strike')[field].sum(min_count=1).reindex(strikes)
            axis.bar(x+(j-.5)*w,y,width=w,color=v4.COLORS[cp],label=cp,alpha=.85)
        skip=max(1,int(np.ceil(len(strikes)/13)))
        axis.set_xticks(x[::skip]);axis.set_xticklabels([f'{v:,.0f}' for v in strikes[::skip]],rotation=45,ha='right',fontsize=8)
        axis.set_xlim(-.7,len(strikes)-.3)
        axis.set_title(title);axis.set_xlabel('Strike');axis.set_ylabel('Contracts');axis.legend();axis.grid(axis='y',alpha=.2)
    grid=np.linspace(-rng,rng,201)
    for cp in ['Call','Put']:
        for tag,dd,ls in [('Day',a,'--'),('Night',b,'-')]:
            ax[1,0].plot(grid*100,v4.smile_curve(dd,cp,grid),ls=ls,color=v4.COLORS[cp],label=f'{tag} {cp}')
            ax[1,1].plot(grid*100,v4.smile_curve(dd,cp,grid,True),ls=ls,color=v4.COLORS[cp],label=f'{tag} {cp}')
    for axis,title,ylabel in [
        (ax[1,0],'Fixed-Moneyness IV Smile','IV (%)'),
        (ax[1,1],'ATM-Normalized IV Smile','IV Difference (pp)')]:
        axis.set_title(title);axis.set_xlabel('Moneyness K/F - 1 (%)');axis.set_ylabel(ylabel)
        axis.axvline(0,color='gray',ls=':');axis.legend(fontsize=8);axis.grid(alpha=.2)
    return {'day_forward':float(f1),'night_forward':float(f2)}

@app.get('/health')
def health():
    return {'status':'ok','engine':'V4','data':'TAIFEX on demand'}

@app.post('/expiries')
def expiries(q:Query):
    try:
        if q.mode=='inst':
            return {'expiries':[]}
        ds=fmt(q.date1)
        a=v4.load_market_session(ds,'day',q.force) if q.mode=='daynight' else v4.load_day(ds,q.force)
        options=set(a.expiry.dropna().astype(str))
        if q.mode in ('compare','daynight'):
            if q.date2 is None: raise ValueError('Date 2 is required')
            b=v4.load_market_session(fmt(q.date2),'night',q.force) if q.mode=='daynight' else v4.load_day(fmt(q.date2),q.force)
            options &= set(b.expiry.dropna().astype(str))
        return {'expiries':sorted(options),'rows':len(a)}
    except Exception as e:
        logging.exception('Expiry load failed')
        raise HTTPException(422,str(e)) from e

# Paste this block ABOVE @app.post('/analyze') in backend/server.py.
# Requires existing imports: numpy as np, matplotlib.pyplot as plt, v4_engine as v4.

def _all_weighted_smile(data, cp, grid, normalized=False):
    """Per-expiry fixed-moneyness smile, volume-weighted across expiries.

    Only valid IV and positive-volume quotes contribute. No extrapolation.
    The normalized variant subtracts each expiry's own ATM IV first.
    """
    d = v4.tidy(data)
    numerator = np.zeros(len(grid), dtype=float)
    denominator = np.zeros(len(grid), dtype=float)
    for _, group in d[d.cp.eq(cp)].groupby('expiry'):
        g = group.loc[
            group.IV.between(1, 250)
            & group.moneyness.notna()
            & np.isfinite(group.moneyness)
            & group.volume.gt(0)
        ].copy()
        if g.empty:
            continue
        # Multiple records at one moneyness: first aggregate with volume weights.
        g['weighted_iv'] = g.IV * g.volume
        curve = g.groupby('moneyness', as_index=False).agg(
            weighted_iv=('weighted_iv', 'sum'),
            volume=('volume', 'sum'),
        ).sort_values('moneyness')
        if len(curve) < 2:
            continue
        x = curve.moneyness.to_numpy(dtype=float)
        iv = curve.weighted_iv.to_numpy(dtype=float) / curve.volume.to_numpy(dtype=float)
        vol = curve.volume.to_numpy(dtype=float)
        if normalized:
            if not (x[0] <= 0 <= x[-1]):
                continue
            iv = iv - np.interp(0, x, iv)
        values = np.interp(grid, x, iv, left=np.nan, right=np.nan)
        weights = np.interp(grid, x, vol, left=0, right=0)
        ok = np.isfinite(values) & (weights > 0)
        numerator[ok] += values[ok] * weights[ok]
        denominator[ok] += weights[ok]
    return np.divide(numerator, denominator,
                     out=np.full(len(grid), np.nan), where=denominator > 0)


def _combined_plot(mode, a, b, rng):
    """Render exactly one 2x2 chart for all expiries combined."""
    a = v4.tidy(a)
    b = v4.tidy(b) if b is not None else None
    if a.empty or (b is not None and b.empty):
        raise ValueError('No data for combined analysis')
    fig, ax = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)
    f = a.F.median()
    if not np.isfinite(f):
        raise ValueError('Missing MTX forward reference')
    a0 = a[a.strike.between(f * (1-rng), f * (1+rng))]
    b0 = b[b.strike.between(f * (1-rng), f * (1+rng))] if b is not None else None
    if mode == 'single':
        v4.plot_strike(ax[0, 0], a0, 'oi', 'All Expiries — Open Interest by Strike')
        v4.plot_strike(ax[0, 1], a0, 'volume', 'All Expiries — Volume by Strike')
    elif mode == 'compare':
        # Retain original V4's same-strike intersection for OI change.
        delta = a0.groupby(['strike', 'cp']).oi.sum().rename('oi1').to_frame().join(
            b0.groupby(['strike', 'cp']).oi.sum().rename('oi2'), how='inner')
        delta['oi'] = delta.oi2 - delta.oi1
        v4.plot_strike(ax[0, 0], delta.reset_index(), 'oi', 'All Expiries — Change in OI (D2 - D1)')
        _combined_grouped_bars(ax[0, 1], a0, b0, 'volume', 'Daily Volume by Strike (Both Dates)', 'D1', 'D2')
    else:
        _combined_grouped_bars(ax[0, 0], b0, None, 'volume', 'All Expiries — Night Volume by Strike', 'Night')
        _combined_grouped_bars(ax[0, 1], a0, None, 'oi', 'All Expiries — Day Open Interest by Strike', 'Day')
    grid = np.linspace(-rng, rng, 201)
    datasets = [('Day', a, '-')] if mode == 'single' else (
        [('D1', a, '--'), ('D2', b, '-')] if mode == 'compare'
        else [('Day', a, '--'), ('Night', b, '-')]
    )
    for cp in ('Call', 'Put'):
        for label, data, style in datasets:
            name = cp if mode == 'single' else f'{label} {cp}'
            ax[1, 0].plot(grid*100, _all_weighted_smile(data, cp, grid),
                          ls=style, color=v4.COLORS[cp], label=name)
            ax[1, 1].plot(grid*100, _all_weighted_smile(data, cp, grid, True),
                          ls=style, color=v4.COLORS[cp], label=name)
    for axis, title, ylabel in [
        (ax[1, 0], 'All Expiries — Volume-Weighted IV Smile', 'IV (%)'),
        (ax[1, 1], 'All Expiries — Volume-Weighted ATM-Normalized IV', 'IV Difference (pp)'),
    ]:
        axis.set_title(title)
        axis.set_xlabel('Moneyness K/F - 1 (%)')
        axis.set_ylabel(ylabel)
        axis.axvline(0, color='gray', ls=':')
        axis.grid(alpha=.2)
        axis.legend(fontsize=8)
    return {'expiry_count_day1': int(a.expiry.nunique()),
            'expiry_count_day2': int(b.expiry.nunique()) if b is not None else None,
            'weighting': 'Positive contract volume, separately by expiry and Call/Put',
            'oi_volume': 'Sum across expiries at identical strike'}


def _combined_grouped_bars(axis, first, second, field, title, label1, label2=None):
    datasets = [(label1, first)] if second is None else [(label1, first), (label2, second)]
    strikes = sorted(set().union(*(set(d.strike.dropna()) for _, d in datasets)))
    if not strikes:
        axis.set_title(title + ' (no strikes)')
        return
    x = np.arange(len(strikes))
    width = .8 / (2 * len(datasets))
    for k, (label, d) in enumerate(datasets):
        for j, cp in enumerate(('Call', 'Put')):
            y = d[d.cp.eq(cp)].groupby('strike')[field].sum().reindex(strikes).fillna(0)
            offset = (k*2+j-(2*len(datasets)-1)/2)*width
            axis.bar(x+offset, y, width=width, label=f'{label} {cp}', alpha=.8,
                     color=v4.COLORS[cp] if second is None else None)
    skip = max(1, int(np.ceil(len(strikes)/13)))
    axis.set_xticks(x[::skip])
    axis.set_xticklabels([f'{v:,.0f}' for v in strikes[::skip]], rotation=45, ha='right', fontsize=8)
    axis.set_title(title)
    axis.legend(fontsize=8)
    axis.grid(axis='y', alpha=.2)


@app.post('/analyze')
def analyze(q: Query):
    with plot_lock:
        plt.close('all')
        previous_show = plt.show
        plt.show = lambda *args, **kwargs: None
        try:
            rng = q.range_pct / 100
            meta = {}
            all_mode = q.expiry == '__ALL__' and q.mode in ('single', 'compare', 'daynight')

            if q.mode == 'inst':
                df, errors = v4.institution_series(q.date1, calendar_days=q.lookback)
                v4.institutional_charts(df)
                meta = {'source_errors': errors, 'rows': len(df)}
            elif q.mode == 'daynight':
                if q.date2 is None:
                    raise ValueError('Night Data Label Date is required')
                a = v4.load_market_session(fmt(q.date1), 'day', q.force)
                b = v4.load_market_session(fmt(q.date2), 'night', q.force)
            elif q.mode == 'compare':
                if q.date2 is None:
                    raise ValueError('Date 2 is required')
                a = v4.load_day(fmt(q.date1), q.force)
                b = v4.load_day(fmt(q.date2), q.force)
            else:
                a = v4.load_day(fmt(q.date1), q.force)

            if q.expiry == '__COMBINED__' and q.mode in ('single', 'compare', 'daynight'):
                meta = _combined_plot(q.mode, a, b if q.mode != 'single' else None, rng)
                fig = plt.figure(plt.get_fignums()[-1])
                out = io.BytesIO()
                fig.savefig(out, format='png', dpi=130, bbox_inches='tight', facecolor='white')
                img = base64.b64encode(out.getvalue()).decode('ascii')
                return {'image': 'data:image/png;base64,' + img, 'meta': meta, 'mode': q.mode,
                        'note': 'All expiries combined: OI/volume summed by strike; per-expiry IV smiles volume-weighted at fixed moneyness.'}

            if all_mode:
                # Only contracts present in BOTH datasets are compared.
                common = set(a.expiry.dropna().astype(str))
                if q.mode != 'single':
                    common &= set(b.expiry.dropna().astype(str))
                expiries = sorted(common)
                if not expiries:
                    raise ValueError('No common expiries for the selected dates/sessions')
                results = []
                errors = []
                for exp in expiries:
                    plt.close('all')
                    try:
                        if q.mode == 'single':
                            v4.single_day(a, exp, rng)
                            exp_meta = {}
                        elif q.mode == 'compare':
                            v4.two_days(a, b, exp, rng)
                            exp_meta = {}
                        else:
                            exp_meta = daynight_updated(a, b, exp, rng)
                        nums = plt.get_fignums()
                        if not nums:
                            raise ValueError('No chart generated')
                        fig = plt.figure(nums[-1])
                        out = io.BytesIO()
                        fig.savefig(out, format='png', dpi=130, bbox_inches='tight', facecolor='white')
                        image = 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode('ascii')
                        results.append({'expiry': exp, 'image': image, 'meta': exp_meta})
                    except Exception as exc:
                        logging.exception('Expiry %s failed', exp)
                        errors.append({'expiry': exp, 'error': str(exc)})
                if not results:
                    raise ValueError('All expiry charts failed: ' + str(errors))
                return {
                    'images': results,
                    'image': results[0]['image'],
                    'meta': {'requested': len(expiries), 'completed': len(results), 'failed': errors},
                    'mode': q.mode,
                    'note': 'Each expiry is calculated separately using V4 / TAIFEX data.'
                }

            if q.mode == 'daynight':
                meta = daynight_updated(a, b, q.expiry, rng)
            elif q.mode == 'compare':
                v4.two_days(a, b, q.expiry, rng)
            elif q.mode == 'cross':
                chosen = q.expiries or [q.expiry]
                v4.cross_expiry(a, chosen, rng)
            elif q.mode == 'single':
                v4.single_day(a, q.expiry, rng)
            # inst already generated its chart

            nums = plt.get_fignums()
            if not nums:
                raise ValueError('Analysis returned no charts')
            fig = plt.figure(nums[-1])
            out = io.BytesIO()
            fig.savefig(out, format='png', dpi=130, bbox_inches='tight', facecolor='white')
            img = base64.b64encode(out.getvalue()).decode('ascii')
            return {
                'image': 'data:image/png;base64,' + img,
                'meta': meta, 'mode': q.mode,
                'note': 'V4 Black-76 / TAIFEX. Charts are rendered from retrieved data, not demo values.'
            }
        except Exception as e:
            logging.exception('Analysis failed')
            raise HTTPException(422, str(e)) from e
        finally:
            plt.show = previous_show
            plt.close('all')


# ============================================================
# RESEARCH LIBRARY API
# ============================================================

def verify_research_password(
    x_research_password: str | None = Header(default=None)
):
    expected = os.environ.get("RESEARCH_ADMIN_PASSWORD", "")

    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Research Library is not configured"
        )

    if not x_research_password or not hmac.compare_digest(
        x_research_password,
        expected
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid Research Library password"
        )


class ResearchPath(BaseModel):
    path: str


class ResearchMove(BaseModel):
    source: str
    destination: str


class ResearchDelete(BaseModel):
    paths: list[str]


@app.get("/research/files")
def research_list(folder: str = ""):
    try:
        return {
            "folder": folder,
            "items": research.list_items(folder),
        }
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception("Research list failed")
        raise HTTPException(
            500, "Unable to list research files"
        )


@app.post("/research/upload")
async def research_upload(
    file: UploadFile = File(...),
    folder: str = Form(default=""),
    x_research_password: str | None = Header(default=None)
):
    verify_research_password(x_research_password)

    try:
        filename = PurePosixPath(file.filename or "").name

        if not filename or filename in (".", ".."):
            raise ValueError("Invalid filename")

        folder = research.clean_path(folder)

        path = f"{folder}/{filename}" if folder else filename

        # Read at most the configured limit plus one byte.
        content = await file.read(research.MAX_FILE_BYTES + 1)

        return research.upload_file(
            path,
            content,
            file.content_type
        )

    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception("Research upload failed")
        raise HTTPException(
            500,
            "Unable to upload research file"
        )


@app.post("/research/folder")
def research_create_folder(
    request: ResearchPath,
    x_research_password: str | None = Header(default=None)
):
    verify_research_password(x_research_password)

    try:
        folder = research.clean_path(request.path)

        if not folder:
            raise ValueError("Folder path is required")

        # Supabase Storage has no physical empty directories.
        # A marker object preserves an otherwise empty folder.
        marker = f"{folder}/.folder"

        return research.upload_file(
            marker,
            b"Research Library folder marker\n",
            "text/plain"
        )

    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception("Research folder creation failed")
        raise HTTPException(
            500,
            "Unable to create research folder"
        )


@app.post("/research/move")
def research_move(
    request: ResearchMove,
    x_research_password: str | None = Header(default=None)
):
    verify_research_password(x_research_password)

    try:
        return research.move_file(
            request.source,
            request.destination
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception("Research move failed")
        raise HTTPException(
            500,
            "Unable to move research file"
        )


@app.delete("/research/files")
def research_delete(
    request: ResearchDelete,
    x_research_password: str | None = Header(default=None)
):
    verify_research_password(x_research_password)

    try:
        return research.delete_files(request.paths)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception("Research deletion failed")
        raise HTTPException(
            500,
            "Unable to delete research files"
        )



@app.get("/research/download")
def research_download(path: str):
    try:
        from fastapi.responses import Response

        path = research.clean_path(path)

        if not path:
            raise ValueError("File path is required")

        content = research.download_file(path)
        filename = PurePosixPath(path).name

        
        is_pdf = filename.lower().endswith(".pdf")

        return Response(
            content=content,
            media_type=(
                "application/pdf"
                if is_pdf
                else "application/octet-stream"
            ),
            headers={
                "Content-Disposition": (
                    f"inline; filename*=UTF-8''{quote(filename)}"
                    if is_pdf
                    else f"attachment; filename*=UTF-8''{quote(filename)}"
                ),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )


    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception("Research download failed")
        raise HTTPException(
            500, "Unable to download research file"
        )


# ============================================================
# RESEARCH LIBRARY - FULL TREE
# ============================================================

@app.get("/research/tree")
def research_tree():
    """Public read-only listing of all research files and folders."""
    try:
        items = research.list_all_items(max_items=3000)

        return {
            "items": items,
            "total": len(items),
        }

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception:
        logging.exception("Research tree listing failed")
        raise HTTPException(
            status_code=500,
            detail="Unable to list research tree",
        )


# ============================================================
# RESEARCH LIBRARY - FOLDER ADMIN API
# ============================================================

class ResearchFolderMove(BaseModel):
    source: str
    destination: str


class ResearchFolderDelete(BaseModel):
    folder: str


@app.post("/research/folder/move")
def research_folder_move(
    request: ResearchFolderMove,
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)

    try:
        return research.move_folder(
            request.source,
            request.destination,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except Exception:
        logging.exception("Research folder move failed")
        raise HTTPException(
            status_code=500,
            detail="Unable to move research folder",
        )


@app.delete("/research/folder")
def research_folder_delete(
    request: ResearchFolderDelete,
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)

    try:
        return research.delete_folder(request.folder)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except Exception:
        logging.exception("Research folder deletion failed")
        raise HTTPException(
            status_code=500,
            detail="Unable to delete research folder",
        )

# ============================================================
# STRATEGY LAB API - independent strategy-lab bucket
# Paste at the END of backend/server.py.
# Also add near the existing imports:
# import strategy_storage as strategy
# ============================================================


def _strategy_existing_paths():
    return {item['path'] for item in strategy.list_all_items(max_items=3000)}


def _strategy_ensure_destination_free(source: str, destination: str):
    source = strategy.clean_path(source)
    destination = strategy.clean_path(destination)
    if source != destination and destination in _strategy_existing_paths():
        raise ValueError('Destination already exists')


@app.get('/strategy/files')
def strategy_list(folder: str = ''):
    try:
        return {'folder': folder, 'items': strategy.list_items(folder)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy list failed')
        raise HTTPException(500, 'Unable to list strategy files')


@app.get('/strategy/tree')
def strategy_tree():
    try:
        items = strategy.list_all_items(max_items=3000)
        return {'items': items, 'total': len(items)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy tree failed')
        raise HTTPException(500, 'Unable to list strategy tree')


@app.get('/strategy/download')
def strategy_download(path: str):
    try:
        from fastapi.responses import Response
        path = strategy.clean_path(path)
        if not path:
            raise ValueError('File path is required')
        content = strategy.download_file(path)
        filename = PurePosixPath(path).name
        is_pdf = filename.lower().endswith('.pdf')
        return Response(
            content=content,
            media_type='application/pdf' if is_pdf else 'application/octet-stream',
            headers={
                'Content-Disposition': (
                    f"inline; filename*=UTF-8''{quote(filename)}" if is_pdf
                    else f"attachment; filename*=UTF-8''{quote(filename)}"
                ),
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy download failed')
        raise HTTPException(500, 'Unable to download strategy file')


@app.post('/strategy/upload')
async def strategy_upload(
    file: UploadFile = File(...),
    folder: str = Form(default=''),
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)
    try:
        filename = PurePosixPath(file.filename or '').name
        if not filename or filename in ('.', '..'):
            raise ValueError('Invalid filename')
        folder = strategy.clean_path(folder)
        path = f'{folder}/{filename}' if folder else filename
        if path in _strategy_existing_paths():
            raise ValueError('File already exists')
        content = await file.read(strategy.MAX_FILE_BYTES + 1)
        return strategy.upload_file(path, content, file.content_type)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy upload failed')
        raise HTTPException(500, 'Unable to upload strategy file')


@app.post('/strategy/folder')
def strategy_create_folder(
    request: ResearchPath,
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)
    try:
        folder = strategy.clean_path(request.path)
        if not folder:
            raise ValueError('Folder path is required')
        if folder in _strategy_existing_paths():
            raise ValueError('Folder already exists')
        return strategy.upload_file(
            f'{folder}/.folder', b'Strategy Lab folder marker\n', 'text/plain'
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy folder creation failed')
        raise HTTPException(500, 'Unable to create strategy folder')


@app.post('/strategy/move')
def strategy_move(
    request: ResearchMove,
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)
    try:
        _strategy_ensure_destination_free(request.source, request.destination)
        return strategy.move_file(request.source, request.destination)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy move failed')
        raise HTTPException(500, 'Unable to move strategy file')


@app.delete('/strategy/files')
def strategy_delete(
    request: ResearchDelete,
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)
    try:
        return strategy.delete_files(request.paths)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy deletion failed')
        raise HTTPException(500, 'Unable to delete strategy files')


@app.post('/strategy/folder/move')
def strategy_folder_move(
    request: ResearchFolderMove,
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)
    try:
        source = strategy.clean_path(request.source)
        destination = strategy.clean_path(request.destination)
        if not source or not destination:
            raise ValueError('Source and destination are required')
        if destination.startswith(source + '/'):
            raise ValueError('Cannot move a folder into itself')
        existing = _strategy_existing_paths()
        if source not in existing:
            raise ValueError('Source folder does not exist')
        if source != destination:
            targets = {
                destination + path[len(source):]
                for path in existing
                if path == source or path.startswith(source + '/')
            }
            if targets & existing:
                raise ValueError('Destination contains existing files or folders')
        return strategy.move_folder(source, destination)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy folder move failed')
        raise HTTPException(500, 'Unable to move strategy folder')


@app.delete('/strategy/folder')
def strategy_folder_delete(
    request: ResearchFolderDelete,
    x_research_password: str | None = Header(default=None),
):
    verify_research_password(x_research_password)
    try:
        return strategy.delete_folder(request.folder)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logging.exception('Strategy folder deletion failed')
        raise HTTPException(500, 'Unable to delete strategy folder')
