"""Local FastAPI adapter around frozen V4 calculation functions."""
import base64
import io
import logging
import os
import threading
from datetime import date
from typing import Literal

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import v4_engine as v4

app = FastAPI(title="Quant Research Lab V4 API", version="0.3")
# Local-network development only. Restrict origins before public deployment.
origins = [x.strip().rstrip("/") for x in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])
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

@app.post('/analyze')
def analyze(q:Query):
    with plot_lock:
        plt.close('all')
        previous_show=plt.show
        plt.show=lambda *args,**kwargs: None
        try:
            rng=q.range_pct/100
            meta={}
            if q.mode=='inst':
                df, errors=v4.institution_series(q.date1,calendar_days=q.lookback)
                v4.institutional_charts(df)
                meta={'source_errors':errors,'rows':len(df)}
            elif q.mode=='daynight':
                if q.date2 is None: raise ValueError('Night Data Label Date is required')
                a=v4.load_market_session(fmt(q.date1),'day',q.force)
                b=v4.load_market_session(fmt(q.date2),'night',q.force)
                meta=daynight_updated(a,b,q.expiry,rng)
            elif q.mode=='compare':
                if q.date2 is None: raise ValueError('Date 2 is required')
                a=v4.load_day(fmt(q.date1),q.force); b=v4.load_day(fmt(q.date2),q.force)
                v4.two_days(a,b,q.expiry,rng)
            elif q.mode=='cross':
                a=v4.load_day(fmt(q.date1),q.force)
                chosen=q.expiries or [q.expiry]
                v4.cross_expiry(a,chosen,rng)
            else:
                a=v4.load_day(fmt(q.date1),q.force)
                v4.single_day(a,q.expiry,rng)
            nums=plt.get_fignums()
            if not nums: raise ValueError('Analysis returned no charts')
            fig=plt.figure(nums[-1]); out=io.BytesIO()
            fig.savefig(out,format='png',dpi=130,bbox_inches='tight',facecolor='white')
            img=base64.b64encode(out.getvalue()).decode('ascii')
            return {'image':'data:image/png;base64,'+img,'meta':meta,'mode':q.mode,
                    'note':'V4 Black-76 / TAIFEX. Charts are rendered from retrieved data, not demo values.'}
        except Exception as e:
            logging.exception('Analysis failed')
            raise HTTPException(422,str(e)) from e
        finally:
            plt.show=previous_show
            plt.close('all')
