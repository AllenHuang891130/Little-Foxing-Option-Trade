import os
"""V4 calculation code extracted from the frozen Jupyter notebook (unmodified formulas)."""
import io, re, warnings, calendar
from pathlib import Path
from datetime import date, timedelta
import numpy as np, pandas as pd, requests
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from bs4 import BeautifulSoup
from scipy.optimize import brentq
from scipy.stats import norm
plt.rcParams.update({'font.family':'DejaVu Sans','axes.unicode_minus':False,'figure.dpi':110})
ROOT=Path(os.environ.get('TAIFEX_DATA_DIR',str(Path(__file__).resolve().parent/'taifex_data'))); ROOT.mkdir(parents=True,exist_ok=True)

# ============================================================
# Supabase persistent cache - V4
# ============================================================
import logging

try:
    from cloud_cache import download_cache, upload_cache
    CLOUD_CACHE_AVAILABLE = True
except ImportError as exc:
    CLOUD_CACHE_AVAILABLE = False
    logging.warning("Cloud cache module unavailable: %s", exc)


def restore_cloud_cache(path, force=False):
    """Restore a CSV from Supabase when local cache is absent."""
    path = Path(path)

    if force or path.exists() or not CLOUD_CACHE_AVAILABLE:
        return False

    try:
        return download_cache(path)
    except Exception:
        logging.exception("Supabase cache download failed: %s", path.name)
        return False


def save_cloud_cache(path):
    """Upload a completed local CSV to Supabase."""
    path = Path(path)

    if not CLOUD_CACHE_AVAILABLE:
        logging.warning("Cloud cache unavailable: %s", path.name)
        return False

    if not path.is_file():
        logging.warning("Cache file does not exist: %s", path)
        return False

    try:
        upload_cache(path)
        return True
    except Exception:
        logging.exception("Supabase cache upload failed: %s", path.name)
        return False

RF=0.015
API='https://openapi.taifex.com.tw/v1/'
HIST='https://www.taifex.com.tw/cht/3/'
SESSION=requests.Session(); SESSION.headers.update({'User-Agent':'Mozilla/5.0','Accept':'*/*'})
def display(*args,**kwargs):
    pass


# From V4 notebook cell 3
def read_csv_bytes(content):
    """Parse TAIFEX CSV without silently shifting a surplus field into the index."""
    errors=[]
    for enc in ['utf-8-sig','cp950','big5','utf-8']:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', pd.errors.ParserWarning)
                d=pd.read_csv(io.BytesIO(content),encoding=enc,dtype=str,index_col=False)
            if len(d.columns)>1:
                d.columns=d.columns.astype(str).str.strip()
                return d
        except Exception as e:errors.append(str(e)[:100])
    raise ValueError('Unrecognized CSV: '+str(errors[:2]))

def clean_num(s):
    x=s.astype('string').str.replace(',','',regex=False).str.strip()
    x=x.mask(x.isin(['--','-','','nan','None','null']))
    return pd.to_numeric(x,errors='coerce')

def repair_shifted_futures(raw):
    """Repair already parsed historical MTX CSV with trade date incorrectly in index."""
    d=raw.copy()
    if ('交易日期' in d and '契約' in d and
        d['交易日期'].astype(str).str.strip().eq('MTX').any() and
        not isinstance(d.index,pd.RangeIndex)):
        names=list(d.columns)
        d=d.reset_index().iloc[:,:len(names)].copy()
        d.columns=names
    return d

def pick(df,*names):
    norm=lambda s: re.sub(r'\s+','',str(s)).lower()
    cols={norm(c):c for c in df.columns}
    for name in names:
        if norm(name) in cols: return df[cols[norm(name)]]
    return pd.Series(np.nan,index=df.index)

def openapi_csv(name):
    r=SESSION.get(API+name,timeout=35);r.raise_for_status()
    try:
        j=r.json()
        return pd.DataFrame(j if isinstance(j,list) else next(v for v in j.values() if isinstance(v,list)))
    except Exception: return read_csv_bytes(r.content)

def expiry_date(code):
    code=str(code).strip().upper()
    m=re.fullmatch(r'(\d{4})(\d{2})(?:([WF])(\d))?',code)
    if not m: return pd.NaT
    yr,mo=int(m.group(1)),int(m.group(2))
    if not 1<=mo<=12: return pd.NaT
    weekday=2 if m.group(3)!='F' else 4
    nth=int(m.group(4)) if m.group(4) else 3
    first=date(yr,mo,1); delta=(weekday-first.weekday())%7
    day=1+delta+7*(nth-1)
    if day>calendar.monthrange(yr,mo)[1]: return pd.NaT
    return pd.Timestamp(date(yr,mo,day))

def normalize_opt(raw,ds):
    d=raw.copy();d.columns=d.columns.astype(str).str.strip();o=pd.DataFrame(index=d.index)
    o['date']=pd.to_datetime(pick(d,'交易日期','日期','Date').astype(str).str.replace('/','',regex=False).str.replace('-','',regex=False),format='%Y%m%d',errors='coerce')
    o['product']=pick(d,'契約','Contract').astype(str).str.strip()
    o['expiry']=pick(d,'到期月份(週別)','ContractMonth(Week)').astype(str).str.strip()
    o['strike']=clean_num(pick(d,'履約價','StrikePrice'))
    cp=pick(d,'買賣權','CallPut').astype(str).str.strip().str.upper()
    o['cp']=cp.replace({'買權':'Call','賣權':'Put','CALL':'Call','PUT':'Put','C':'Call','P':'Put'})
    fields={'last':['收盤價','最後成交價','Last'], 'settle':['結算價','SettlementPrice'],
            'volume':['成交量','Volume'], 'oi':['未沖銷契約數','未沖銷契約量','OpenInterest'],
            'bid':['最後最佳買價','BestBid'], 'ask':['最後最佳賣價','BestAsk']}
    for dst,names in fields.items():o[dst]=clean_num(pick(d,*names))
    o['session']=pick(d,'交易時段','TradingSession').astype(str).str.strip()
    official=pick(d,'契約到期日','official_expiry_date')
    o['official_expiry_date']=pd.to_datetime(official.astype(str).str.replace('/','',regex=False).str.replace('-','',regex=False),format='%Y%m%d',errors='coerce')
    o=o[(o['product'].str.upper().isin(['TXO','臺指選擇權','台指選擇權'])) & (o['cp'].isin(['Call','Put'])) & (o['strike']>0)].copy()
    o=o[o['session'].isin(['一般','一般交易時段','Regular','0','nan'])]
    o=o[o['date'].dt.strftime('%Y%m%d').eq(ds)]
    if o.empty:raise ValueError('No matching TXO regular-session rows for '+ds)
    return o.reset_index(drop=True)

def normalize_fut(raw,ds):
    d=repair_shifted_futures(raw);d.columns=d.columns.astype(str).str.strip();f=pd.DataFrame(index=d.index)
    f['date']=pd.to_datetime(pick(d,'交易日期','日期','Date').astype(str).str.replace('/','',regex=False).str.replace('-','',regex=False),format='%Y%m%d',errors='coerce')
    f['product']=pick(d,'契約','Contract').astype(str).str.strip()
    f['expiry']=pick(d,'到期月份(週別)','ContractMonth(Week)').astype(str).str.strip()
    f['settle']=clean_num(pick(d,'結算價','SettlementPrice'))
    f['last']=clean_num(pick(d,'收盤價','最後成交價','Last'))
    f['session']=pick(d,'交易時段','TradingSession').astype(str).str.strip()
    f=f[f['product'].str.upper().isin(['MTX','小型臺指','小型台指']) & f['date'].dt.strftime('%Y%m%d').eq(ds)]
    f=f[f['session'].isin(['一般','一般交易時段','Regular','0','nan'])]
    f['F']=f['settle'].where(f['settle']>0,f['last'])
    f=f[f.F>0].drop_duplicates('expiry')
    if f.empty:raise ValueError('No matching MTX regular-session rows for '+ds)
    return f[['expiry','F']].reset_index(drop=True)


def historical_csv(kind, ds):
    import logging
    import time
    from requests.exceptions import RequestException

    if kind not in ("opt", "fut"):
        raise ValueError(f"Unsupported data kind: {kind}")

    ds = pd.Timestamp(ds).strftime("%Y%m%d")
    endpoint = "optDataDown" if kind == "opt" else "futDataDown"
    url = HIST + endpoint
    dt = pd.Timestamp(ds).strftime("%Y/%m/%d")

    payload = {
        "down_type": "1",
        "commodity_id": "TXO" if kind == "opt" else "MTX",
        "queryStartDate": dt,
        "queryEndDate": dt,
        "MarketCode": "0",
    }

    last_error = None

    for attempt in range(1, 4):
        try:
            with requests.Session() as s:
                s.headers.update({
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "text/csv,text/html,*/*",
                })

                logging.info(
                    "TAIFEX %s %s attempt %d/3: GET form",
                    kind, ds, attempt
                )

                # Preserve the original GET -> POST session flow.
                form = s.get(url, timeout=(10, 45))
                form.raise_for_status()

                logging.info(
                    "TAIFEX %s %s attempt %d/3: POST CSV",
                    kind, ds, attempt
                )

                response = s.post(
                    url,
                    data=payload,
                    headers={"Referer": url},
                    timeout=(10, 90),
                )
                response.raise_for_status()

                raw = read_csv_bytes(response.content)

                if raw.empty:
                    raise ValueError("TAIFEX returned an empty CSV")

                columns = {
                    str(c).strip().replace(" ", "")
                    for c in raw.columns
                }

                expected = {"交易日期", "契約"}

                if not expected.issubset(columns):
                    raise ValueError(
                        "Unexpected TAIFEX response columns: "
                        + str(list(raw.columns)[:12])
                    )

                logging.info(
                    "TAIFEX %s %s downloaded: %d rows",
                    kind, ds, len(raw)
                )

                return raw

        except (RequestException, ValueError) as exc:
            last_error = exc
            logging.warning(
                "TAIFEX download failed: kind=%s date=%s "
                "attempt=%d/3 error=%s",
                kind, ds, attempt, exc
            )

            if attempt < 3:
                time.sleep(attempt * 2)

    raise RuntimeError(
        f"TAIFEX historical {kind} download failed "
        f"for {ds} after 3 attempts. "
        f"Last error: {last_error}"
    )


def b76(F,K,T,v,cp):
    if min(F,K,T,v)<=0:return np.nan
    z=(np.log(F/K)+0.5*v*v*T)/(v*np.sqrt(T));disc=np.exp(-RF*T)
    return disc*(F*norm.cdf(z)-K*norm.cdf(z-v*np.sqrt(T))) if cp=='Call' else disc*(K*norm.cdf(-z+v*np.sqrt(T))-F*norm.cdf(-z))

def implied_iv(px,F,K,T,cp):
    if not all(np.isfinite([px,F,K,T])) or min(px,F,K,T)<=0:return np.nan
    intrinsic=np.exp(-RF*T)*max((F-K) if cp=='Call' else (K-F),0)
    if px<=intrinsic+1e-5:return np.nan
    try:
        lo=b76(F,K,T,.005,cp)-px;hi=b76(F,K,T,4.,cp)-px
        if lo*hi>=0:return np.nan
        return 100*brentq(lambda v:b76(F,K,T,v,cp)-px,.005,4.,xtol=1e-7)
    except Exception:return np.nan

def recalculate_iv(d):
    """Always recompute IV from validated numeric values; IV stored as percent."""
    d=d.copy()
    d['date']=pd.to_datetime(d['date'],errors='coerce')
    derived=d['expiry'].map(expiry_date)
    official=pd.to_datetime(d['official_expiry_date'],errors='coerce') if 'official_expiry_date' in d else pd.Series(pd.NaT,index=d.index)
    d['expiry_date']=official.combine_first(pd.to_datetime(derived,errors='coerce'))
    d['expiry_source']=np.where(official.notna(),'TAIFEX official','Code estimate')
    d['DTE']=(d['expiry_date']-d['date']).dt.days
    d['T']=d['DTE']/365.0
    for col in ['price','F','strike','T']:
        d[col]=pd.to_numeric(d[col],errors='coerce')
    d['cp']=d['cp'].astype(str).str.strip().replace({'CALL':'Call','PUT':'Put','買權':'Call','賣權':'Put'})
    d['IV']=[implied_iv(float(px),float(f),float(k),float(t),str(cp)) if
             all(pd.notna(v) for v in [px,f,k,t]) and 1<=dte<=180 and cp in ('Call','Put')
             else np.nan for px,f,k,t,cp,dte in zip(d['price'],d['F'],d['strike'],d['T'],d['cp'],d['DTE'])]
    return d

def build_day(ds):
    ds=pd.Timestamp(ds).strftime('%Y%m%d')
    if ds==pd.Timestamp.today().strftime('%Y%m%d'):
        ro,rf=openapi_csv('DailyMarketReportOpt'),openapi_csv('DailyMarketReportFut')
    else:
        ro,rf=historical_csv('opt',ds),historical_csv('fut',ds)
    o,f=normalize_opt(ro,ds),normalize_fut(rf,ds)
    fm=f.set_index('expiry')['F'].to_dict()
    monthly={str(k)[:6]:v for k,v in fm.items() if re.fullmatch(r'\d{6}',str(k))}
    o['F']=o['expiry'].map(fm)
    o['forward_source']=np.where(o['F'].notna(),'Exact MTX','Monthly MTX proxy')
    o['F']=o['F'].fillna(o['expiry'].str[:6].map(monthly))
    o['moneyness']=o['strike']/o['F']-1
    o['price']=o['settle'].where(o['settle']>0,o['last'])
    o=recalculate_iv(o)
    o['OTM']=np.where(o.cp.eq('Call'),o.strike>=o.F,o.strike<=o.F)
    if o['F'].notna().sum()==0:raise ValueError('No valid futures forward; IV cannot be computed')
    return o

def load_day(ds,force=False):
    ds=pd.Timestamp(ds).strftime('%Y%m%d');path=ROOT/f'TXO_MTX_{ds}.csv'
    if path.exists() and not force:
        d=pd.read_csv(path,dtype={'expiry':str})
        for c in ['date','expiry_date','official_expiry_date']:
            if c in d:d[c]=pd.to_datetime(d[c],errors='coerce')
        for c in ['strike','oi','volume','IV','F','DTE','moneyness','bid','ask','price','T']:
            if c in d:d[c]=pd.to_numeric(d[c],errors='coerce')
        if 'OTM' in d:d['OTM']=d['OTM'].astype(str).str.lower().eq('true')
        needed={'expiry','strike','cp','oi','volume','F','moneyness','price','date'}
        if not needed.issubset(d.columns):raise ValueError(f'Cached file {path} missing: {needed-set(d.columns)}')
        # Recompute IV for all cached days, including old caches with invalid IV.
        d=recalculate_iv(d)
        return d
    d=build_day(ds)
    d.to_csv(path,index=False,encoding='utf-8-sig');print('Saved',path)
    return d
print('Market data functions loaded.')

# From V4 notebook cell 5
INST_FIELDS=['Date','ContractCode','CallPut','Item','TradingVolume(Long)','TradingValue(Long)(Thousands)','TradingVolume(Short)','TradingValue(Short)(Thousands)','TradingVolume(Net)','TradingValue(Net)(Thousands)','OpenInterest(Long)','ContractValueofOpenInterest(Long)(Thousands)','OpenInterest(Short)','ContractValueofOpenInterest(Short)(Thousands)','OpenInterest(Net)','ContractValueofOpenInterest(Net)(Thousands)']
INST_NUM=INST_FIELDS[4:]
PLAYERS=['Foreign Investors','Investment Trusts','Dealers','Other Participants (Est.)']
ITEM_EN={'外資及陸資':'Foreign Investors','外資':'Foreign Investors','投信':'Investment Trusts','自營商':'Dealers'}

def get_institutional_history(day,force=False):
    ds=pd.Timestamp(day).strftime('%Y%m%d');path=ROOT/f'TXO_INSTITUTIONAL_{ds}.csv'
    if path.exists() and not force:
        d=pd.read_csv(path,dtype={'Date':str});
        for c in INST_NUM:d[c]=pd.to_numeric(d[c],errors='coerce')
        return d
    url=HIST+'callsAndPutsDate';s=requests.Session();s.headers.update({'User-Agent':'Mozilla/5.0'})
    s.get(url,timeout=30).raise_for_status()
    dt=pd.Timestamp(ds).strftime('%Y/%m/%d')
    payload={'queryType':'','goDay':'','doQuery':'','dateaddcnt':'','queryDate':dt,'commodityId':'TXO','button':'送出查詢'}
    r=s.post(url,data=payload,headers={'Referer':url},timeout=40);r.raise_for_status()
    soup=BeautifulSoup(r.content,'html.parser')
    field=soup.find('input',{'name':'queryDate'})
    if field is None or field.get('value','').strip()!=dt:raise ValueError('Historical institutional date validation failed: '+ds)
    selected=None
    for t in pd.read_html(io.StringIO(str(soup))):
        if t.shape[1]==16 and '自營商' in t.astype(str).to_string() and '臺指選擇權' in t.astype(str).to_string():selected=t.copy();break
    if selected is None:raise ValueError('Institutional TXO table unavailable: '+ds)
    selected.columns=INST_FIELDS;d=selected
    d['Date']=ds;d['ContractCode']='臺指選擇權'
    d['CallPut']=d['CallPut'].astype(str).str.strip().replace({'買權':'CALL','賣權':'PUT'})
    d['Item']=d['Item'].astype(str).str.strip().replace({'外資':'外資及陸資'})
    for c in INST_NUM:d[c]=clean_num(d[c])
    expected={(cp,item) for cp in ['CALL','PUT'] for item in ['外資及陸資','投信','自營商']}
    if len(d)!=6 or set(zip(d.CallPut,d.Item))!=expected or d[INST_NUM].isna().any().any():raise ValueError('Institutional rows invalid: '+ds)
    for c in ['TradingVolume','OpenInterest']:
        if not (d[c+'(Long)']-d[c+'(Short)']==d[c+'(Net)']).all():raise ValueError('Net validation failed: '+c)
    d.to_csv(path,index=False,encoding='utf-8-sig');print('Saved',path)
    return d

def institution_series(end_date,calendar_days=14):
    end=pd.Timestamp(end_date).normalize();start=end-pd.Timedelta(days=calendar_days)
    # Collect 7 extra days for the first day's delta; holidays may need more.
    frames=[];errors=[]
    for dt in pd.date_range(start-pd.Timedelta(days=10),end):
        if dt.weekday()>4:continue
        try:
            d=get_institutional_history(dt).copy();d['date']=dt;frames.append(d)
        except Exception as e:errors.append((dt.strftime('%Y-%m-%d'),str(e)[:100]))
    if not frames:raise ValueError('No institutional history available')
    d=pd.concat(frames,ignore_index=True)
    d['ItemEnglish']=d.Item.map(ITEM_EN)
    d=d.sort_values(['CallPut','ItemEnglish','date'])
    for oi,delta in [('OpenInterest(Net)','Delta_OI'),('ContractValueofOpenInterest(Net)(Thousands)','Delta_OI_Value')]:
        d[delta]=d.groupby(['CallPut','ItemEnglish'])[oi].diff()
    # Difference versus the previous *available trading date*; holidays are permitted.
    # Missing source dates are listed in 'errors' and should be reviewed.
    others=[]
    fields=['OpenInterest(Net)','TradingVolume(Net)','ContractValueofOpenInterest(Net)(Thousands)','TradingValue(Net)(Thousands)','Delta_OI','Delta_OI_Value']
    for (dt,cp),g in d.groupby(['date','CallPut']):
        r={'date':dt,'CallPut':cp,'ItemEnglish':'Other Participants (Est.)'}
        for f in fields:r[f]=-g[f].sum() if g[f].notna().all() else np.nan
        others.append(r)
    d=pd.concat([d,pd.DataFrame(others)],ignore_index=True)
    return d[(d.date>=start)&(d.date<=end)].copy(),errors
print('Institutional functions loaded.')

# From V4 notebook cell 7
COLORS={'Call':'#c65a3a','Put':'#3274b8'}
def tidy(d):
    d=d.copy();d['cp']=d['cp'].astype(str).str.strip().replace({'CALL':'Call','PUT':'Put'})
    for c in ['strike','oi','volume','IV','F','moneyness','DTE']:
        if c in d:d[c]=pd.to_numeric(d[c],errors='coerce')
    return d

def contract_info(d):
    return (d.groupby('expiry').agg(DTE=('DTE','median'),OI=('oi','sum'),Volume=('volume','sum'),F=('F','median')).sort_values('DTE'))

def plot_strike(ax,d,field,title):
    d=d.dropna(subset=['strike',field]);strikes=sorted(d.strike.unique())
    if not strikes:return
    x=np.arange(len(strikes));w=.43
    for j,cp in enumerate(['Call','Put']):
        g=d[d.cp.eq(cp)].groupby('strike')[field].sum().reindex(strikes).fillna(0)
        ax.bar(x+(j-.5)*w,g.values,width=w,color=COLORS[cp],label=cp,alpha=.85)
    # Show manageable strike labels
    skip=max(1,int(np.ceil(len(strikes)/15)))
    ax.set_xticks(x[::skip]);ax.set_xticklabels([f'{v:,.0f}' for v in strikes[::skip]],rotation=45,ha='right',fontsize=8)
    ax.set_title(title);ax.grid(axis='y',alpha=.2);ax.legend(fontsize=8)

def smile_curve(d,cp,grid,normalized=False):
    a=d[(d.cp==cp)&d.IV.between(1,250)&d.moneyness.notna()].copy()
    a=a[np.isfinite(a.moneyness)];a=a.groupby('moneyness',as_index=False).IV.median().sort_values('moneyness')
    if len(a)<2:return np.full_like(grid,np.nan,dtype=float)
    x=a.moneyness.to_numpy(dtype=float);y=a.IV.to_numpy(dtype=float)
    vals=np.interp(grid,x,y,left=np.nan,right=np.nan)
    if normalized:
        atm=np.interp(0,x,y) if x.min()<=0<=x.max() else np.nan
        vals=vals-atm
    return vals

def single_day(d,expiry,rng=.05):
    d=tidy(d);a=d[d.expiry.eq(expiry)];a=a[a.moneyness.abs()<=rng]
    if a.empty:raise ValueError('No data within chosen ATM range')
    fig,ax=plt.subplots(2,2,figsize=(15,9),constrained_layout=True)
    plot_strike(ax[0,0],a,'oi','Open Interest by Strike')
    plot_strike(ax[0,1],a,'volume','Volume by Strike')
    grid=np.linspace(-rng,rng,201)*100
    for cp in ['Call','Put']:
        y=smile_curve(a,cp,grid/100)
        ax[1,0].plot(grid,y,label=cp,color=COLORS[cp]);ax[1,1].plot(grid,smile_curve(a,cp,grid/100,True),label=cp,color=COLORS[cp])
    for axis,title in zip(ax[1],['IV Smile (Fixed Moneyness)','ATM-Normalized IV Smile']):
        axis.set_title(title);axis.set_xlabel('Moneyness K/F - 1 (%)');axis.set_ylabel('IV (pp)' if axis is ax[1,1] else 'IV (%)');axis.axvline(0,color='gray',ls='--');axis.grid(alpha=.2);axis.legend()
    plt.show()

def two_days(a,b,expiry,rng=.05):
    a=tidy(a);b=tidy(b);a=a[a.expiry.eq(expiry)];b=b[b.expiry.eq(expiry)]
    if a.empty or b.empty:raise ValueError('Expiry not available on both days')
    F1=a.F.median();F2=b.F.median()
    if not np.isfinite(F1) or not np.isfinite(F2):raise ValueError('Forward missing')
    # Same-strike OI change; use baseline forward for strike window.
    a0=a[a.strike.between(F1*(1-rng),F1*(1+rng))];b0=b[b.strike.between(F1*(1-rng),F1*(1+rng))]
    fig,ax=plt.subplots(2,2,figsize=(16,10),constrained_layout=True)
    delta=a0.groupby(['strike','cp']).oi.sum().rename('oi1').to_frame().join(b0.groupby(['strike','cp']).oi.sum().rename('oi2'),how='inner')
    delta['delta']=delta.oi2-delta.oi1
    plot_strike(ax[0,0],delta.reset_index().rename(columns={'delta':'oi'}),'oi','Change in OI (D2 - D1)')
    strikes=sorted(set(a0.strike).union(b0.strike));x=np.arange(len(strikes));width=.22
    for j,(day,cp,dd) in enumerate([('D1','Call',a0),('D1','Put',a0),('D2','Call',b0),('D2','Put',b0)]):
        y=dd[dd.cp.eq(cp)].groupby('strike').volume.sum().reindex(strikes).fillna(0)
        ax[0,1].bar(x+(j-1.5)*width,y,width=width,label=f'{day} {cp}',alpha=.8)
    skip=max(1,int(np.ceil(len(strikes)/13)))
    ax[0,1].set_xticks(x[::skip]);ax[0,1].set_xticklabels([f'{v:,.0f}' for v in strikes[::skip]],rotation=45,ha='right',fontsize=8)
    ax[0,1].set_title('Daily Volume by Strike (Both Dates)');ax[0,1].legend(fontsize=8);ax[0,1].grid(axis='y',alpha=.2)
    grid=np.linspace(-rng,rng,201)
    rows=[]
    for cp in ['Call','Put']:
        for day,dd,style in [('D1',a,'--'),('D2',b,'-')]:
            yy=smile_curve(dd,cp,grid);yn=smile_curve(dd,cp,grid,True)
            ax[1,0].plot(grid*100,yy,ls=style,color=COLORS[cp],label=f'{day} {cp}')
            ax[1,1].plot(grid*100,yn,ls=style,color=COLORS[cp],label=f'{day} {cp}')
            at=smile_curve(dd,cp,np.array([0.]))[0]
            skew=smile_curve(dd,cp,np.array([-.03,.03]))
            slope=(skew[1]-skew[0])/6 if np.isfinite(skew).all() else np.nan
            rows.append({'Side':cp,'Day':day,'ATM_IV_%':at,'Skew_pp_per_1pct_m':slope})
    for axis,title in zip(ax[1],['Fixed-Moneyness IV Smile','ATM-Normalized IV Smile']):
        axis.set_title(title);axis.set_xlabel('Moneyness K/F - 1 (%)');axis.set_ylabel('IV (%)' if axis is ax[1,0] else 'IV difference (pp)');axis.axvline(0,color='gray',ls=':');axis.legend(fontsize=8);axis.grid(alpha=.2)
    plt.show()
    print('Forward D1 / D2:',round(F1,2),round(F2,2));display(pd.DataFrame(rows))

def cross_expiry(d,expiries,rng=.05):
    d=tidy(d);fig,ax=plt.subplots(1,2,figsize=(15,5),constrained_layout=True);grid=np.linspace(-rng,rng,201)
    term=[]
    for exp in expiries:
        sub=d[d.expiry.eq(exp)];
        if sub.empty:continue
        for cp in ['Call','Put']:
            y=smile_curve(sub,cp,grid);ax[0].plot(grid*100,y,label=f'{exp} {cp}',ls='-' if cp=='Call' else '--')
            atm=smile_curve(sub,cp,np.array([0.]))[0]
            term.append({'Expiry':exp,'DTE':sub.DTE.median(),'Side':cp,'ATM_IV':atm,'OI':sub.oi.sum(),'Volume':sub.volume.sum()})
    ax[0].set_title('IV Smiles by Expiry');ax[0].set_xlabel('Moneyness (%)');ax[0].set_ylabel('IV (%)');ax[0].legend(fontsize=8);ax[0].grid(alpha=.2)
    t=pd.DataFrame(term)
    if not t.empty:
        for cp in ['Call','Put']:
            z=t[t.Side==cp].sort_values('DTE');ax[1].plot(z.DTE,z.ATM_IV,'o-',label=cp,color=COLORS[cp])
    ax[1].set_title('ATM IV Term Structure');ax[1].set_xlabel('Days to Expiry');ax[1].set_ylabel('ATM IV (%)');ax[1].grid(alpha=.2);ax[1].legend()
    plt.show();display(t)

def institutional_charts(data,unit='Contracts'):
    fields=[('Net Open Interest','OpenInterest(Net)','ContractValueofOpenInterest(Net)(Thousands)'),('Change in Net OI','Delta_OI','Delta_OI_Value'),('Net Trading','TradingVolume(Net)','TradingValue(Net)(Thousands)')]
    dates=sorted(data.date.unique());x=np.arange(len(dates));width=.19
    colors=['#3274B8','#E49A36','#40966A','#9A69B5']
    fig,axes=plt.subplots(2,3,figsize=(18,9),constrained_layout=True)
    for i,cp in enumerate(['CALL','PUT']):
        dd=data[data.CallPut.eq(cp)]
        for j,(title,qty,val) in enumerate(fields):
            ax=axes[i,j];field=qty if unit=='Contracts' else val
            for k,player in enumerate(PLAYERS):
                series=dd[dd.ItemEnglish.eq(player)].set_index('date')[field].reindex(dates)
                ax.bar(x+(k-1.5)*width,series.values.astype(float),width,color=colors[k],label=player)
            ax.axhline(0,color='gray',lw=.8);ax.set_title(f'{cp} | {title}');ax.set_ylabel('Contracts' if unit=='Contracts' else 'NTD thousands');ax.set_xticks(x);ax.set_xticklabels([pd.Timestamp(v).strftime('%m/%d') for v in dates],rotation=45,ha='right',fontsize=8);ax.grid(axis='y',alpha=.2)
    handles,labels=axes[0,0].get_legend_handles_labels();fig.legend(handles,labels,loc='outside upper center',ncol=4,frameon=False);plt.show()
print('Chart functions loaded.')

# From V4 notebook cell 9

# Day vs Night: separate TAIFEX session records, no settlement-price carryover.
def normalize_session_opt(raw,ds,session):
    d=raw.copy();d.columns=d.columns.astype(str).str.strip();o=pd.DataFrame(index=d.index)
    o['date']=pd.to_datetime(pick(d,'交易日期','日期','Date').astype(str).str.replace('/','',regex=False).str.replace('-','',regex=False),format='%Y%m%d',errors='coerce')
    o['product']=pick(d,'契約','Contract').astype(str).str.strip()
    o['expiry']=pick(d,'到期月份(週別)','ContractMonth(Week)').astype(str).str.strip()
    o['strike']=clean_num(pick(d,'履約價','StrikePrice'))
    o['cp']=pick(d,'買賣權','CallPut').astype(str).str.strip().str.upper().replace({'買權':'Call','賣權':'Put','CALL':'Call','PUT':'Put','C':'Call','P':'Put'})
    for col,aliases in {'last':['收盤價','最後成交價','Last'],'settle':['結算價','SettlementPrice'],'volume':['成交量','Volume'],'oi':['未沖銷契約數','未沖銷契約量','OpenInterest'],'bid':['最後最佳買價','BestBid'],'ask':['最後最佳賣價','BestAsk']}.items():
        o[col]=clean_num(pick(d,*aliases))
    o['session']=pick(d,'交易時段','TradingSession').astype(str).str.strip()
    official=pick(d,'契約到期日','official_expiry_date')
    o['official_expiry_date']=pd.to_datetime(official.astype(str).str.replace('/','',regex=False).str.replace('-','',regex=False),format='%Y%m%d',errors='coerce')
    allowed=['一般','一般交易時段'] if session=='day' else ['盤後','盤後交易時段']
    o=o[o['date'].dt.strftime('%Y%m%d').eq(ds)&o['product'].str.upper().eq('TXO')&o['session'].isin(allowed)&o['cp'].isin(['Call','Put'])&(o['strike']>0)].copy()
    if o.empty:raise ValueError(f'No TXO {session} rows tagged {ds}; verify TAIFEX trading-date convention')
    return o.reset_index(drop=True)

def normalize_session_fut(raw,ds,session):
    d=repair_shifted_futures(raw);d.columns=d.columns.astype(str).str.strip();f=pd.DataFrame(index=d.index)
    f['date']=pd.to_datetime(pick(d,'交易日期','日期','Date').astype(str).str.replace('/','',regex=False).str.replace('-','',regex=False),format='%Y%m%d',errors='coerce')
    f['product']=pick(d,'契約','Contract').astype(str).str.strip()
    f['expiry']=pick(d,'到期月份(週別)','ContractMonth(Week)').astype(str).str.strip()
    f['last']=clean_num(pick(d,'收盤價','最後成交價','Last'))
    f['settle']=clean_num(pick(d,'結算價','SettlementPrice'))
    f['session']=pick(d,'交易時段','TradingSession').astype(str).str.strip()
    allowed=['一般','一般交易時段'] if session=='day' else ['盤後','盤後交易時段']
    f=f[f['date'].dt.strftime('%Y%m%d').eq(ds)&f['product'].str.upper().eq('MTX')&f['session'].isin(allowed)].copy()
    # Night has no official settlement; use night close, not daytime settlement.
    f['F']=f['last'] if session=='night' else f['settle'].where(f['settle']>0,f['last'])
    f=f[f.F>0].drop_duplicates('expiry')
    if f.empty:raise ValueError(f'No valid MTX {session} prices tagged {ds}')
    return f[['expiry','F']].reset_index(drop=True)

def load_market_session(ds,session='day',force=False):
    ds=pd.Timestamp(ds).strftime('%Y%m%d')
    if session not in ('day','night'):raise ValueError('session must be day or night')
    path=ROOT/f'TXO_MTX_{ds}_{session.upper()}.csv'
    restore_cloud_cache(path, force=force)
    if path.exists() and not force:
        d=pd.read_csv(path,dtype={'expiry':str})
        for col in ['date','expiry_date','official_expiry_date']:
            if col in d:d[col]=pd.to_datetime(d[col],errors='coerce')
        return recalculate_iv(d)
    # Historical CSV includes both 一般 and 盤後 rows for a trading date.
    ro,rf=historical_csv('opt',ds),historical_csv('fut',ds)
    o=normalize_session_opt(ro,ds,session)
    f=normalize_session_fut(rf,ds,session)
    fm=f.set_index('expiry')['F'].to_dict()
    monthly={str(k)[:6]:v for k,v in fm.items() if re.fullmatch(r'\d{6}',str(k))}
    o['F']=o['expiry'].map(fm)
    o['forward_source']=np.where(o['F'].notna(),'Exact MTX','Monthly MTX proxy')
    o['F']=o['F'].fillna(o['expiry'].str[:6].map(monthly))
    o['moneyness']=o['strike']/o['F']-1
    if session=='night':
        # Use actual traded closing price; fall back to valid bid/ask midpoint only.
        mid=(o['bid']+o['ask'])/2
        o['price']=o['last'].where(o['last']>0,mid.where((o['bid']>0)&(o['ask']>0)&(o['ask']>=o['bid'])))
        # Official night OI may not be comparable to day OI; intentionally mask.
        o['oi']=np.nan
    else:o['price']=o['settle'].where(o['settle']>0,o['last'])
    o=recalculate_iv(o)
    o['OTM']=np.where(o.cp.eq('Call'),o.strike>=o.F,o.strike<=o.F)
    o.to_csv(path,index=False,encoding='utf-8-sig')
    save_cloud_cache(path)
    print(f'Saved {path} | valid IV {o.IV.notna().sum():,}/{len(o):,}')
    return o

def day_night_comparison(day,night,exp,rng=.06):
    """Match Two Days layout: OI delta, combined volumes, IV smile, normalized IV smile."""
    a=tidy(day);b=tidy(night);a=a[a.expiry.eq(exp)];b=b[b.expiry.eq(exp)]
    if a.empty or b.empty:raise ValueError('Expiry not available in both selected sessions')
    F1=a.F.median();F2=b.F.median()
    if not np.isfinite(F1) or not np.isfinite(F2):raise ValueError('Forward missing')
    a0=a[a.strike.between(F1*(1-rng),F1*(1+rng))]
    b0=b[b.strike.between(F1*(1-rng),F1*(1+rng))]
    fig,ax=plt.subplots(2,2,figsize=(16,10),constrained_layout=True)
    # Match Two Days: strike-level OI delta panel. Do not manufacture a delta from
    # missing/non-comparable official night OI.
    ax[0,0].set_title('Change in OI (Night - Day)')
    ax[0,0].set_xlabel('Strike');ax[0,0].set_ylabel('Contracts')
    if a0.oi.notna().any() and b0.oi.notna().any():
        v1=a0.groupby(['strike','cp']).oi.sum(min_count=1).rename('oi1')
        v2=b0.groupby(['strike','cp']).oi.sum(min_count=1).rename('oi2')
        delta=v1.to_frame().join(v2,how='inner').dropna()
        delta['oi']=delta.oi2-delta.oi1
        if not delta.empty:plot_strike(ax[0,0],delta.reset_index(),'oi','Change in OI (Night - Day)')
        else:ax[0,0].text(.5,.5,'Night OI not comparable / unavailable',ha='center',va='center',transform=ax[0,0].transAxes)
    else:
        ax[0,0].text(.5,.5,'Night OI not comparable / unavailable',ha='center',va='center',transform=ax[0,0].transAxes)
    ax[0,0].grid(alpha=.2)
    # Same grouped 4-series volume plot as Two Days.
    strikes=sorted(set(a0.strike).union(b0.strike));x=np.arange(len(strikes));width=.22
    for j,(tag,cp,dd) in enumerate([('Day','Call',a0),('Day','Put',a0),('Night','Call',b0),('Night','Put',b0)]):
        y=dd[dd.cp.eq(cp)].groupby('strike').volume.sum().reindex(strikes).fillna(0)
        ax[0,1].bar(x+(j-1.5)*width,y,width=width,label=f'{tag} {cp}',alpha=.8)
    skip=max(1,int(np.ceil(len(strikes)/13)))
    ax[0,1].set_xticks(x[::skip]);ax[0,1].set_xticklabels([f'{v:,.0f}' for v in strikes[::skip]],rotation=45,ha='right',fontsize=8)
    ax[0,1].set_title('Volume by Strike (Day and Night)');ax[0,1].legend(fontsize=8);ax[0,1].grid(axis='y',alpha=.2)
    grid=np.linspace(-rng,rng,201);rows=[]
    for cp in ['Call','Put']:
        for tag,dd,ls in [('Day',a,'--'),('Night',b,'-')]:
            yy=smile_curve(dd,cp,grid);yn=smile_curve(dd,cp,grid,True)
            ax[1,0].plot(grid*100,yy,ls=ls,color=COLORS[cp],label=f'{tag} {cp}')
            ax[1,1].plot(grid*100,yn,ls=ls,color=COLORS[cp],label=f'{tag} {cp}')
            atmiv=smile_curve(dd,cp,np.array([0.]))[0]
            z=smile_curve(dd,cp,np.array([-.03,.03]))
            skew=(z[1]-z[0])/6 if np.isfinite(z).all() else np.nan
            rows.append({'Side':cp,'Session':tag,'ATM_IV_%':atmiv,'Skew_pp_per_1pct_m':skew})
    for axis,title in zip(ax[1],['Fixed-Moneyness IV Smile','ATM-Normalized IV Smile']):
        axis.set_title(title);axis.set_xlabel('Moneyness K/F - 1 (%)');axis.set_ylabel('IV (%)' if axis is ax[1,0] else 'IV difference (pp)');axis.axvline(0,color='gray',ls=':');axis.legend(fontsize=8);axis.grid(alpha=.2)
    plt.show()
    print('Forward Day / Night:',round(F1,2),round(F2,2));display(pd.DataFrame(rows))
    print('Night IV: closing price or valid bid/ask midpoint. Night OI delta only if valid and comparable.')
    print('DTE uses calendar days, not intraday time-to-expiry precision.')

