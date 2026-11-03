"""Little Foxing Gamma Wall, based on Perfiliev's public OI GEX methodology.
Uses existing v4_engine daily TXO/MTX data. Does not mutate source data/cache.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import norm
import v4_engine as v4

MULTIPLIER = 50.0
MODES = {'call_positive': (1., -1.), 'call_negative': (-1., 1.),
         'all_long': (1., 1.), 'all_short': (-1., -1.)}


def gamma76(F, K, T, iv, r=v4.RF):
    F, K, T, iv = np.broadcast_arrays(np.asarray(F, float), np.asarray(K, float),
                                      np.asarray(T, float), np.asarray(iv, float))
    out = np.zeros(F.shape, float)
    good = np.isfinite(F) & np.isfinite(K) & np.isfinite(T) & np.isfinite(iv) & (F>0) & (K>0) & (T>0) & (iv>0)
    if good.any():
        z = (np.log(F[good]/K[good]) + .5*iv[good]**2*T[good])/(iv[good]*np.sqrt(T[good]))
        out[good] = np.exp(-r*T[good])*norm.pdf(z)/(F[good]*iv[good]*np.sqrt(T[good]))
    return out


def prepare(day, expiry_scope='all', selected_expiries=None, include_0dte=False,
            iv_mode='individual', force=False):
    """Use daily OI only; IV stored by V4 in percent, convert to decimal."""
    if expiry_scope not in ('all','nearest','monthly','weekly','custom'):
        raise ValueError('Unknown expiry scope')
    if iv_mode not in ('individual','atm'):
        raise ValueError('Unknown IV mode')
    d = v4.load_day(pd.Timestamp(day).strftime('%Y%m%d'), force=force).copy()
    d['cp'] = d['cp'].astype(str).str.strip().replace({'C':'Call','P':'Put'})
    for col in ('strike','oi','IV','F','DTE'):
        d[col] = pd.to_numeric(d[col], errors='coerce')
    d['expiry'] = d['expiry'].astype(str).str.strip().str.upper()
    d = d[d.cp.isin(['Call','Put']) & d.strike.gt(0) & d.oi.gt(0) &
          d.IV.between(.5, 250) & d.F.gt(0) & d.DTE.ge(0)].copy()
    if not include_0dte:
        d = d[d.DTE.gt(0)]
    # Existing V4 IV solver excludes 0DTE, so such contracts cannot be included
    # without an additional intraday IV estimator. Never silently fabricate IV.
    d['expiry_type'] = np.where(d.expiry.str.fullmatch(r'\d{6}'), 'monthly', 'weekly')
    if expiry_scope == 'nearest' and not d.empty:
        d = d[d.DTE.eq(d.DTE.min())]
    elif expiry_scope in ('monthly','weekly'):
        d = d[d.expiry_type.eq(expiry_scope)]
    elif expiry_scope == 'custom':
        if not selected_expiries:
            raise ValueError('Select at least one expiry')
        d = d[d.expiry.isin([str(x).upper() for x in selected_expiries])]
    if d.empty:
        raise ValueError('No usable daily OI + IV contracts for this date and scope')
    d['T'] = np.maximum(d.DTE, 1)/365.
    d['iv'] = d.IV/100.
    if iv_mode == 'atm':
        d['atm_distance'] = abs(d.strike/d.F - 1)
        atm = (d.sort_values('atm_distance')
                 .groupby('expiry', sort=False).head(6)
                 .groupby('expiry')['iv'].median())
        d['iv'] = d.expiry.map(atm)
    return d.reset_index(drop=True)


def _gex(d, F, position_mode):
    if position_mode not in MODES:
        raise ValueError('Unknown dealer position assumption')
    gamma = gamma76(F, d.strike.to_numpy(), d['T'].to_numpy(), d.iv.to_numpy())
    # Per 1% futures move: Black-76 forward gamma * OI * contract multiplier * F^2 * 0.01
    absolute = gamma*d.oi.to_numpy()*MULTIPLIER*np.asarray(F)**2*.01
    call_sign, put_sign = MODES[position_mode]
    sign = np.where(d.cp.to_numpy()=='Call', call_sign, put_sign)
    return absolute, absolute*sign


def analyze(day, expiry_scope='all', selected_expiries=None,
            position_mode='call_positive', include_0dte=False,
            iv_mode='individual', profile_range_pct=10., profile_points=201,
            force=False):
    if not 1 <= profile_range_pct <= 30 or not 51 <= profile_points <= 501:
        raise ValueError('Invalid profile range or points')
    d = prepare(day, expiry_scope, selected_expiries, include_0dte, iv_mode, force)
    # All-expiry chart uses the front-month proxy median as a common reference price;
    # preserve per-row matched F for current gamma to avoid mismatching source IV.
    front = d.loc[d.DTE.eq(d.DTE.min()), 'F'].median()
    if not np.isfinite(front) or front <= 0:
        raise ValueError('Missing reference futures price')
    absolute, signed = _gex(d, d.F.to_numpy(), position_mode)
    d['absolute_gex'] = absolute
    d['signed_gex'] = signed
    grouped = d.pivot_table(index='strike', columns='cp', values='absolute_gex', aggfunc='sum', fill_value=0)
    grouped = grouped.reindex(columns=['Call','Put'], fill_value=0).rename(columns={'Call':'call_gex','Put':'put_gex'})
    grouped['net_gex'] = d.groupby('strike').signed_gex.sum()
    grouped = grouped.fillna(0).sort_index()
    call_wall = float(grouped.call_gex.idxmax()) if grouped.call_gex.max()>0 else None
    put_wall = float(grouped.put_gex.idxmax()) if grouped.put_gex.max()>0 else None
    nearest = d.groupby('expiry').DTE.min().idxmin()
    monthly = d[d.expiry_type.eq('monthly')]
    nearest_monthly = monthly.groupby('expiry').DTE.min().idxmin() if not monthly.empty else None
    xs = np.linspace(front*(1-profile_range_pct/100),front*(1+profile_range_pct/100),profile_points)
    profile = []
    for x in xs:
        # Profile is a conditional parallel shift of each contract's baseline forward.
        # This keeps differing MTX maturity forwards consistent with original IV calibration.
        shifted = d.F.to_numpy() + (x-front)
        _, y = _gex(d, shifted, position_mode)
        profile.append({'futures_price':float(x), 'all':float(y.sum()),
                        'ex_nearest':float(y[d.expiry.to_numpy()!=nearest].sum()),
                        'ex_monthly':float(y[d.expiry.to_numpy()!=nearest_monthly].sum()) if nearest_monthly is not None else None})
    p = pd.DataFrame(profile)
    flips = []
    a = p['all'].to_numpy()
    for i in range(len(a)-1):
        if a[i] == 0 and a[i+1] != 0:
            flips.append(float(xs[i]))
        elif a[i]*a[i+1] < 0:
            flips.append(float(xs[i] - a[i]*(xs[i+1]-xs[i])/(a[i+1]-a[i])))
    # An identically-zero curve is not a meaningful Gamma Flip.
    meta = {'date':str(pd.Timestamp(day).date()), 'reference_forward':float(front),
            'position_mode':position_mode,'expiry_scope':expiry_scope,
            'included_expiries':sorted(d.expiry.unique().tolist()),
            'contracts':int(len(d)), 'call_wall':call_wall,'put_wall':put_wall,
            'net_gex_twd_per_1pct':float(d.signed_gex.sum()),
            'gamma_flips':flips, 'iv_mode':iv_mode,
            'oi_source':'TAIFEX regular-session daily OI',
            'zero_dte_used':int((d.DTE==0).sum()),
            'note':'OI dealer ownership and long/short directions are assumptions, not observed dealer positions.'}
    return meta, grouped.reset_index(), p



# ================================================================
# Session-aware Gamma Wall (V2). Existing analyze()/draw() remain.
# ================================================================
from datetime import datetime, time, timedelta


def _observation_time(day, session):
    """Session representative timestamps, Asia/Taipei wall-clock time.

    TAIFEX night data are keyed by the *following trading date*. A night
    session's representative snapshot is the previous calendar day's 21:00;
    Monday night data therefore refer to Friday evening (holidays are not
    inferred). Use explicit observation_time for precise holiday handling.
    """
    dt = pd.Timestamp(day).normalize()
    if session == 'day':
        return dt + pd.Timedelta(hours=13)
    if session == 'night':
        prev = dt - pd.offsets.BDay(1)
        return pd.Timestamp(prev.date()) + pd.Timedelta(hours=21)
    raise ValueError('session must be day or night')


def _session_frame(day, session, observation_time=None, oi_day=None,
                   force=False, include_0dte=None):
    """Night OI is the *last available* official day snapshot.

    oi_day is an explicit as-of date, NOT automatically the target trading
    date (which would introduce look-ahead into the night session).
    """
    ds = pd.Timestamp(day).strftime('%Y%m%d')
    obs = (pd.Timestamp(observation_time) if observation_time is not None
           else _observation_time(day, session))
    if session == 'night' and oi_day is None:
        raise ValueError('Night analysis requires explicit oi_day (last published official OI date) to avoid look-ahead')
    if include_0dte is None:
        include_0dte = session == 'night'
    market = v4.load_market_session(ds, session=session, force=force).copy()
    market['expiry'] = market['expiry'].astype(str).str.strip().str.upper()
    market['cp'] = market['cp'].astype(str).str.strip().replace({'C':'Call','P':'Put','CALL':'Call','PUT':'Put'})
    for col in ('strike','F','IV','DTE','price','volume'):
        market[col] = pd.to_numeric(market[col], errors='coerce')
    market['expiry_date'] = pd.to_datetime(market['expiry_date'], errors='coerce')
    if session == 'night':
        # This is the sole OI source. No volume-to-OI substitution.
        oi_date = pd.Timestamp(oi_day).normalize()
        if oi_date > obs.normalize():
            raise ValueError('oi_day is later than the night observation date (look-ahead)')
        oi = v4.load_market_session(oi_date.strftime('%Y%m%d'),session='day',force=force).copy()
        oi['expiry'] = oi['expiry'].astype(str).str.strip().str.upper()
        oi['cp'] = oi['cp'].astype(str).str.strip().replace({'C':'Call','P':'Put','CALL':'Call','PUT':'Put'})
        oi['strike'] = pd.to_numeric(oi['strike'],errors='coerce')
        oi['oi'] = pd.to_numeric(oi['oi'],errors='coerce')
        oi = oi.groupby(['expiry','strike','cp'],as_index=False)['oi'].sum(min_count=1)
        market = market.drop(columns=['oi'],errors='ignore').merge(oi,on=['expiry','strike','cp'],how='left',validate='many_to_one')
        oi_source = f'TAIFEX official day OI: {oi_date.date()} (as-of snapshot)'
    else:
        market['oi'] = pd.to_numeric(market['oi'],errors='coerce')
        oi_source = f'TAIFEX official day OI: {pd.Timestamp(day).date()}'
    # TXO expiration normally 13:30 Taiwan time; override if a special
    # contract has different settlement hours. This is a model assumption.
    expiry_ts = market['expiry_date'] + pd.Timedelta(hours=13,minutes=30)
    market['T'] = (expiry_ts - obs).dt.total_seconds()/(365.0*24*3600)
    market['calendar_dte'] = (market['expiry_date']-obs.normalize()).dt.days
    market = market[market['T'].gt(0) & market['oi'].gt(0) &
                    market['F'].gt(0) & market['strike'].gt(0) &
                    market['cp'].isin(['Call','Put'])].copy()
    if not include_0dte:
        market = market[market['calendar_dte'].gt(0)].copy()
    market['iv'] = market['IV']/100.0
    # V4 skips calendar DTE=0 IV. Re-estimate with actual time to expiry.
    # Reprice IV using session-specific fractional T for every option;
    # V4's calendar-day IV is not consistent with this Gamma maturity.
    needs_iv = pd.Series(True, index=market.index)
    if needs_iv.any():
        market.loc[needs_iv,'iv'] = [
            v4.implied_iv(float(px),float(f),float(k),float(t),str(cp))/100.
            if all(np.isfinite([px,f,k,t])) else np.nan
            for px,f,k,t,cp in zip(market.loc[needs_iv,'price'],market.loc[needs_iv,'F'],
                                    market.loc[needs_iv,'strike'],market.loc[needs_iv,'T'],
                                    market.loc[needs_iv,'cp'])]
    market['iv_valid'] = market['iv'].between(.005,2.5)
    market['expiry_type'] = np.where(market.expiry.str.fullmatch(r'\d{6}'),'monthly','weekly')
    return market, obs, oi_source


def _select_expiries(d, expiry_scope, selected_expiries):
    if expiry_scope in ('all','combined','separate'):
        return d
    if expiry_scope in ('single','custom'):
        if not selected_expiries:
            raise ValueError('Select at least one expiry')
        return d[d.expiry.isin([str(x).strip().upper() for x in selected_expiries])]
    if expiry_scope in ('monthly','weekly'):
        return d[d.expiry_type.eq(expiry_scope)]
    if expiry_scope == 'nearest':
        return d[d.expiry_date.eq(d.expiry_date.min())]
    raise ValueError('Unknown expiry scope')


def _analyze_frame(d, day, session, obs, oi_source, position_mode,
                   iv_mode, profile_range_pct, profile_points):
    if d.empty:
        raise ValueError('No matched OI/price/IV contracts in selected session and expiry')
    missing = int((~d.iv_valid).sum())
    d = d[d.iv_valid].copy()
    if d.empty:
        raise ValueError('No valid IV contracts for Gamma. OI/volume remain available separately.')
    if iv_mode == 'atm':
        d['distance'] = abs(d.strike/d.F-1)
        atm = (d.sort_values('distance').groupby('expiry').head(6)
                 .groupby('expiry')['iv'].median())
        d['iv'] = d.expiry.map(atm)
    elif iv_mode != 'individual':
        raise ValueError('Unknown IV mode')
    front = float(d.loc[d.expiry_date.eq(d.expiry_date.min()),'F'].median())
    absolute,signed = _gex(d,d.F.to_numpy(),position_mode)
    d['absolute_gex']=absolute; d['signed_gex']=signed
    strike = (d.pivot_table(index='strike',columns='cp',values='absolute_gex',aggfunc='sum',fill_value=0)
              .reindex(columns=['Call','Put'],fill_value=0)
              .rename(columns={'Call':'call_gex','Put':'put_gex'}))
    strike['net_gex']=d.groupby('strike').signed_gex.sum()
    strike=strike.fillna(0).sort_index()
    call_wall=float(strike.call_gex.idxmax()) if strike.call_gex.max()>0 else None
    put_wall=float(strike.put_gex.idxmax()) if strike.put_gex.max()>0 else None
    nearest=d.groupby('expiry').expiry_date.min().idxmin()
    monthly=d[d.expiry_type.eq('monthly')]
    near_month=monthly.groupby('expiry').expiry_date.min().idxmin() if not monthly.empty else None
    xs=np.linspace(front*(1-profile_range_pct/100),front*(1+profile_range_pct/100),profile_points)
    profile=[]
    exp=d.expiry.to_numpy()
    for x in xs:
        shifted=d.F.to_numpy()+(x-front)
        _,sg=_gex(d,shifted,position_mode)
        profile.append({'futures_price':float(x),'all':float(sg.sum()),
                        'ex_nearest':float(sg[exp!=nearest].sum()),
                        'ex_monthly':float(sg[exp!=near_month].sum()) if near_month else None})
    p=pd.DataFrame(profile)
    a=p['all'].to_numpy(); flips=[]
    for i in range(len(a)-1):
        if a[i]==0 and a[i+1]!=0: flips.append(float(xs[i]))
        elif a[i]*a[i+1]<0:
            flips.append(float(xs[i]-a[i]*(xs[i+1]-xs[i])/(a[i+1]-a[i])))
    meta={'date':str(pd.Timestamp(day).date()),'session':session,
          'observation_time':str(obs),'oi_source':oi_source,
          'reference_forward':front,'position_mode':position_mode,
          'included_expiries':sorted(d.expiry.unique().tolist()),
          'contracts':int(len(d)),'missing_iv_contracts':missing,
          'call_wall':call_wall,'put_wall':put_wall,
          'net_gex_twd_per_1pct':float(d.signed_gex.sum()),
          'gamma_flips':flips,'iv_mode':iv_mode,
          'zero_dte_used':int(d.calendar_dte.eq(0).sum()),
          'note':'Dealer positioning signs are hypothetical. Night OI is an as-of daily snapshot; timestamps and expiry time are assumptions.'}
    return meta,strike.reset_index(),p


def analyze_session(day, session='day', expiry_scope='combined', selected_expiries=None,
                    oi_day=None, observation_time=None, include_0dte=None,
                    position_mode='call_positive', iv_mode='individual',
                    profile_range_pct=10.,profile_points=201,force=False):
    """Return (meta, GEX by strike, Gamma profile, activity by strike).

    Activity is Gamma-weighted volume, *not* dealer inventory/GEX.
    Night analysis requires oi_day (the last actually published OI date).
    """
    if position_mode not in MODES: raise ValueError('Unknown position mode')
    if not (1<=profile_range_pct<=30 and 51<=profile_points<=501):
        raise ValueError('Invalid profile grid')
    d,obs,oi_source=_session_frame(day,session,observation_time,oi_day,force,include_0dte)
    d=_select_expiries(d,expiry_scope,selected_expiries)
    result=_analyze_frame(d,day,session,obs,oi_source,position_mode,iv_mode,profile_range_pct,profile_points)
    valid=d[d.iv_valid].copy()
    g=gamma76(valid.F.to_numpy(),valid.strike.to_numpy(),valid['T'].to_numpy(),valid.iv.to_numpy())
    valid['gamma_volume_activity']=(g*valid.volume.fillna(0).clip(lower=0).to_numpy()*
                                    MULTIPLIER*valid.F.to_numpy()**2*.01)
    activity=(valid.groupby(['strike','cp'],as_index=False)
              .agg(volume=('volume','sum'),gamma_volume_activity=('gamma_volume_activity','sum')))
    return (*result,activity)


def analyze_day_night(day, oi_day, selected_expiries=None, expiry_scope='combined',
                      day_observation_time=None,night_observation_time=None,**kwargs):
    """Compare two snapshots of same trading date. Night must use as-of OI.

    For apples-to-apples price/IV attribution, pass the SAME OI snapshot
    explicitly to both sessions in a future dedicated attribution study;
    day mode here uses its own official daily OI.
    """
    day_result=analyze_session(day,'day',expiry_scope,selected_expiries,
                               observation_time=day_observation_time,**kwargs)
    night_result=analyze_session(day,'night',expiry_scope,selected_expiries,
                                 oi_day=oi_day,observation_time=night_observation_time,**kwargs)
    return {'day':day_result,'night':night_result,
            'comparability_note':'Day and night use different as-of OI dates; changes cannot be attributed solely to IV/price.'}

def draw(meta, strikes, profile):
    fig, axes = plt.subplots(2,1,figsize=(15,11),constrained_layout=True)
    ax=axes[0]
    x=strikes.strike.to_numpy()
    width=max(1.,np.median(np.diff(np.unique(x)))*.36) if len(np.unique(x))>1 else 25.
    ax.bar(x-width/2,strikes.call_gex/1e6,width=width,color='#c65a3a',label='Call absolute GEX')
    ax.bar(x+width/2,-strikes.put_gex/1e6,width=width,color='#3274b8',label='Put absolute GEX (displayed negative)')
    for key,color in [('call_wall','#c65a3a'),('put_wall','#3274b8'),('reference_forward','#222222')]:
        if meta[key] is not None:
            ax.axvline(meta[key],color=color,ls='--',lw=1.5,label=f'{key}: {meta[key]:,.0f}')
    ax.axhline(0,color='gray',lw=.8);ax.set_title('Gamma Exposure by Strike');ax.set_ylabel('TWD millions / 1% futures move');ax.grid(axis='y',alpha=.2);ax.legend(fontsize=8)
    ax=axes[1]
    for col,style in [('all','-'),('ex_nearest','--'),('ex_monthly',':')]:
        if profile[col].notna().any():
            ax.plot(profile.futures_price,profile[col]/1e6,ls=style,label=col)
    ax.axhline(0,color='gray',lw=.8)
    ax.axvline(meta['reference_forward'],color='black',ls='--',label='Reference futures')
    for i,flip in enumerate(meta['gamma_flips']):
        ax.axvline(flip,color='green',ls='-.',label='Gamma Flip' if i==0 else None)
    ax.set_title('Repriced Gamma Profile / Zero Gamma');ax.set_xlabel('Hypothetical futures price');ax.set_ylabel('Signed GEX (TWD millions / 1% move)');ax.grid(alpha=.2);ax.legend(fontsize=8)
    return fig
