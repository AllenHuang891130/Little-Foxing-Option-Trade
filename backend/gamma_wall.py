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
    gamma = gamma76(F, d.strike.to_numpy(), d.T.to_numpy(), d.iv.to_numpy())
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
