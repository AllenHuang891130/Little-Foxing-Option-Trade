'use client';
import {useRef, useState} from 'react';
import {RefreshCcw, Play, Info} from 'lucide-react';

type Mode='single'|'compare'|'cross'|'inst'|'daynight'|'poc'|'gamma';
const ALL='__ALL__';
const COMBINED='__COMBINED__';
const modes:{id:Mode;label:string}[]=[
 {id:'single',label:'Single Day'}, {id:'compare',label:'Two Days'},
 {id:'cross',label:'Cross Expiry'}, {id:'inst',label:'Institutions'},
 {id:'daynight',label:'Day vs Night'}, {id:'poc',label:'MTX Volume Profile'}, {id:'gamma',label:'Gamma Wall'}
];
type ExpiryChart={expiry:string;image:string;meta:Record<string,unknown>;activity?:Record<string,unknown>[]};
type Result={image:string;gamma_groups?:GammaGroup[];images?:ExpiryChart[];meta:Record<string,unknown>;note:string;csv?:string;activity?:Record<string,unknown>[]};
type Settings={date1:string;date2:string;expiry:string;expiryOptions:string[];selectedExpiries:string[];atmRange:string;lookback:string;force:boolean;pocSession:string;pocValueArea:string;pocStep:string;pocTopN:string;gammaSession:string;gammaOiDay:string;gammaPosition:string;gammaIv:string;gammaRange:string;gamma0Dte:string};
type Workspace={settings:Settings;busy:boolean;message:string;result:Result|null;resultSignature:string|null};
type Workspaces=Record<Mode,Workspace>;

function initialWorkspace():Workspace{
 return {settings:{date1:'2026-10-16',date2:'2026-10-19',expiry:'202610',expiryOptions:[],selectedExpiries:[],atmRange:'6',lookback:'20',force:false,pocSession:'ALL',pocValueArea:'70',pocStep:'1',pocTopN:'10',gammaSession:'day',gammaOiDay:'2026-10-16',gammaPosition:'call_positive',gammaIv:'individual',gammaRange:'10',gamma0Dte:'auto'},busy:false,message:'Load available expiries to begin.',result:null,resultSignature:null};
}
function initialWorkspaces():Workspaces{
 const poc=initialWorkspace();poc.settings.expiry='AUTO';
 return {single:initialWorkspace(),compare:initialWorkspace(),cross:initialWorkspace(),inst:initialWorkspace(),daynight:initialWorkspace(),poc,gamma:initialWorkspace()};
}
function apiBase(){
 const configured=process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/,'');
 return configured||'http://localhost:8000';
}
function payload(mode:Mode,s:Settings){
 if(mode==='gamma')return {date1:s.date1,date2:s.gammaSession==='day'?null:s.date2,session:s.gammaSession,expiry:s.expiry,oi_day:s.gammaSession==='day'?null:s.gammaOiDay,position_mode:s.gammaPosition,iv_mode:s.gammaIv,profile_range_pct:Number(s.gammaRange),include_0dte:s.gamma0Dte==='auto'?null:s.gamma0Dte==='yes',force:s.force};
  if(mode==='poc')return {date1:s.date1,session:s.pocSession,expiry:s.expiry,
  value_area_pct:Number(s.pocValueArea),price_step:Number(s.pocStep),top_n:Number(s.pocTopN),force:s.force};
 return {mode,date1:s.date1,date2:mode==='compare'||mode==='daynight'?s.date2:null,expiry:s.expiry,
  expiries:s.selectedExpiries,range_pct:Number(s.atmRange),lookback:Number(s.lookback),force:s.force};
}
function signature(mode:Mode,s:Settings){
 const p=payload(mode,s);
 if(mode==='poc'){
  return JSON.stringify({...p,force:undefined});
 }
 const expiries = 'expiries' in p && Array.isArray(p.expiries) ? p.expiries : [];
 return JSON.stringify({...p,force:undefined,expiries:mode==='cross'?[...expiries].sort():[]});
}
async function request(path:string,body:ReturnType<typeof payload>){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),300000);
 try{
  const response=await fetch(apiBase()+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
  const json=await response.json();
  if(!response.ok)throw new Error(typeof json.detail==='string'?json.detail:`HTTP ${response.status}`);
  return json;
 }finally{clearTimeout(timer);}
}
type GammaRow = {strike:number;call_gex:number;put_gex:number;net_gex:number};
type GammaProfileRow = {futures_price:number;all:number;ex_nearest?:number|null;ex_monthly?:number|null};
type GammaSession = {image:string;meta:Record<string,unknown>;strikes:GammaRow[];profile:GammaProfileRow[];activity?:Record<string,unknown>[]};
type GammaGroup = {expiry:string;sessions:Partial<Record<'day'|'night',GammaSession>>};
const fmt = (n:number, decimals=0) => Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:decimals,minimumFractionDigits:decimals}):'—';
const num = (x:unknown):number|null => typeof x==='number'&&Number.isFinite(x)?x:null;
const million = (n:number)=>fmt(n/1e6,2)+' M';

function GammaInteractive({group}:{group:GammaGroup}) {
 const [selected,setSelected]=useState<number|null>(null);
 const [hovered,setHovered]=useState<number|null>(null);
 const [showDay,setShowDay]=useState(true);
 const [showNight,setShowNight]=useState(true);
 const [minStrike,setMinStrike]=useState('');
 const [maxStrike,setMaxStrike]=useState('');
 const [profileMode,setProfileMode]=useState<'all'|'ex_nearest'|'ex_monthly'>('all');
 const entries=([['day',group.sessions.day],['night',group.sessions.night]] as const)
   .filter(([key,session])=>Boolean(session)&&(key==='day'?showDay:showNight)) as Array<['day'|'night',GammaSession]>;
 const allSessions=([['day',group.sessions.day],['night',group.sessions.night]] as const)
   .filter(([,s])=>Boolean(s)) as Array<['day'|'night',GammaSession]>;
 const strikes=Array.from(new Set(allSessions.flatMap(([,s])=>s.strikes.map(r=>r.strike)))).sort((a,b)=>a-b);
 const low=minStrike.trim()===''?-Infinity:Number(minStrike);
 const high=maxStrike.trim()===''?Infinity:Number(maxStrike);
 const shown=strikes.filter(k=>k>=low&&k<=high);
 const min=shown[0]??0,max=shown[shown.length-1]??1;
 const w=940,h=280,left=78,right=24,top=22,bottom=46;
 const x=(strike:number)=>left+(strike-min)/(max-min||1)*(w-left-right);
 const scaleY=(v:number,lo:number,hi:number)=>top+(hi-v)/(hi-lo||1)*(h-top-bottom);
 const chosen=hovered??selected;
 const rowFor=(s:GammaSession,k:number)=>s.strikes.find(r=>r.strike===k);
 const maxAbs=Math.max(1,...entries.flatMap(([,s])=>s.strikes.filter(r=>r.strike>=min&&r.strike<=max).flatMap(r=>[r.call_gex,r.put_gex,Math.abs(r.net_gex)])))/1e6;
 const y=(v:number)=>scaleY(v,-maxAbs*1.13,maxAbs*1.13);
 const barWidth=Math.max(1.2,Math.min(13,(w-left-right)/Math.max(1,shown.length)/4));
 const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4);
 const colors={day:{call:'#d45b3d',put:'#397ac0',net:'#d45b3d'},night:{call:'#efa787',put:'#8cb9e8',net:'#7c59ae'}};
 const legend=(<div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12,margin:'8px 0 12px'}}>
  {allSessions.map(([key,s])=><label key={key} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}><input type="checkbox" checked={key==='day'?showDay:showNight} onChange={e=>key==='day'?setShowDay(e.target.checked):setShowNight(e.target.checked)}/><span style={{width:12,height:12,background:key==='day'?'#d45b3d':'#7c59ae',display:'inline-block'}}/>{key.toUpperCase()} · Futures {fmt(num(s.meta.reference_forward)??0)} · Call Wall {fmt(num(s.meta.call_wall)??0)} · Put Wall {fmt(num(s.meta.put_wall)??0)}</label>)}
 </div>);
 function axis(maxY:number){return <>
  {[0,1,2,3,4].map(i=>{const v=(i-2)*maxY/2;return <g key={i}><line x1={left} x2={w-right} y1={y(v)} y2={y(v)} stroke={i===2?'#777':'#e5e7eb'} strokeWidth={i===2?1.3:1}/><text x={left-8} y={y(v)+4} textAnchor="end" fontSize="11" fill="#667085">{fmt(v,0)}</text></g>})}
  {ticks.map((v,i)=><g key={i}><line x1={x(v)} x2={x(v)} y1={h-bottom} y2={h-bottom+5} stroke="#667085"/><text x={x(v)} y={h-bottom+19} textAnchor="middle" fontSize="11" fill="#667085">{fmt(v)}</text></g>)}
  <text x={left+4} y={13} fontSize="11" fill="#667085">TWD millions / 1% move</text>
 </>}
 const renderBars=(kind:'gross'|'net')=><svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:'auto',display:'block'}} role="img" aria-label={kind==='gross'?'Call Put GEX interactive chart':'Net GEX interactive chart'}>
  {axis(maxAbs*1.13)}
  {shown.flatMap((strike,i)=>entries.flatMap(([key,s],j)=>{
   const r=rowFor(s,strike);if(!r)return [];
   const offset=(j-(entries.length-1)/2)*barWidth*2.5;
   const values=kind==='gross'?[{v:r.call_gex/1e6,c:colors[key].call,dx:-barWidth*.55},{v:-r.put_gex/1e6,c:colors[key].put,dx:barWidth*.55}]:[{v:r.net_gex/1e6,c:key==='night'?colors.night.net:r.net_gex>=0?'#d45b3d':'#397ac0',dx:0}];
   return values.map(({v,c,dx},idx)=>{
    const xx=x(strike)+offset+dx-barWidth/2;
    return <rect key={`${i}-${key}-${idx}`} x={xx} y={Math.min(y(v),y(0))} width={barWidth} height={Math.max(1,Math.abs(y(v)-y(0)))} fill={c} opacity={chosen===strike?1:.83} stroke={chosen===strike?'#111827':'none'} strokeWidth="1" style={{cursor:'crosshair'}} onMouseEnter={()=>setHovered(strike)} onMouseLeave={()=>setHovered(null)} onClick={()=>setSelected(selected===strike?null:strike)}><title>{`${key.toUpperCase()} | Strike ${fmt(strike)} | ${kind==='net'?'Net':idx===0?'Call':'Put'} GEX: ${million(v*1e6)}`}</title></rect>;
   });
  }))}
  {chosen!==null&&shown.includes(chosen)&&<line x1={x(chosen)} x2={x(chosen)} y1={top} y2={h-bottom} stroke="#475467" strokeDasharray="3 4" pointerEvents="none"/>}
 </svg>;
 const profileData=entries.flatMap(([,s])=>s.profile.map(p=>({x:p.futures_price,y:num(p[profileMode])??0})));
 const pxMin=profileData.length?Math.min(...profileData.map(p=>p.x)):0,pxMax=profileData.length?Math.max(...profileData.map(p=>p.x)):1;
 const pyMax=Math.max(1,...profileData.map(p=>Math.abs(p.y/1e6)))*1.12;
 const px=(v:number)=>left+(v-pxMin)/(pxMax-pxMin||1)*(w-left-right);
 const py=(v:number)=>scaleY(v,-pyMax,pyMax);
 const profileChart=<svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:'auto',display:'block'}} role="img" aria-label="Day and Night repriced gamma profile">
  {[-1,-.5,0,.5,1].map(v=><g key={v}><line x1={left} x2={w-right} y1={py(v*pyMax)} y2={py(v*pyMax)} stroke={v===0?'#777':'#e5e7eb'}/><text x={left-8} y={py(v*pyMax)+4} textAnchor="end" fontSize="11" fill="#667085">{fmt(v*pyMax,0)}</text></g>)}
  {Array.from({length:5},(_,i)=>pxMin+(pxMax-pxMin)*i/4).map(v=><text key={v} x={px(v)} y={h-bottom+19} textAnchor="middle" fontSize="11" fill="#667085">{fmt(v)}</text>)}
  {entries.map(([key,s])=>{
   const points=s.profile.filter(p=>num(p[profileMode])!==null).map(p=>`${px(p.futures_price)},${py((p[profileMode]??0)/1e6)}`).join(' ');
   return <polyline key={key} points={points} fill="none" stroke={key==='day'?'#d45b3d':'#7c59ae'} strokeWidth="2.5" strokeDasharray={key==='night'?'8 5':undefined}/>;
  })}
  {entries.flatMap(([key,s])=>(Array.isArray(s.meta.gamma_flips)?s.meta.gamma_flips:[]).filter((v):v is number=>typeof v==='number').map((flip,i)=><line key={`${key}-flip-${i}`} x1={px(flip)} x2={px(flip)} y1={top} y2={h-bottom} stroke={key==='day'?'#d45b3d':'#7c59ae'} strokeDasharray="3 5" opacity=".65"/>))}
  <text x={left+4} y={13} fontSize="11" fill="#667085">TWD millions / 1% move</text>
 </svg>;
 return <section style={{marginBottom:34}}>
  <h3 style={{margin:'0 0 8px'}}>{group.expiry} · Interactive Gamma Wall</h3>
  {legend}
  <div style={{display:'flex',alignItems:'end',gap:12,flexWrap:'wrap',margin:'10px 0 16px'}}>
   <label style={{fontSize:12}}>Min Strike<input style={{display:'block',width:115}} type="number" placeholder={fmt(strikes[0]??0)} value={minStrike} onChange={e=>setMinStrike(e.target.value)}/></label>
   <label style={{fontSize:12}}>Max Strike<input style={{display:'block',width:115}} type="number" placeholder={fmt(strikes[strikes.length-1]??0)} value={maxStrike} onChange={e=>setMaxStrike(e.target.value)}/></label>
   <button type="button" className="analysis-button" onClick={()=>{setMinStrike('');setMaxStrike('');setSelected(null);}}>Reset Range</button>
  </div>
  {shown.length===0?<p>No strikes within the selected range.</p>:<>
   <h4>① Call / Put GEX by Strike</h4>{renderBars('gross')}
   <h4>② Net GEX by Strike</h4>{renderBars('net')}
   {chosen!==null&&<div style={{padding:12,background:'rgba(128,128,128,.08)',borderRadius:8,marginBottom:14}}><strong>Strike {fmt(chosen)}</strong> <span style={{fontSize:12}}>· hover to inspect, click to pin</span><div style={{display:'flex',gap:22,flexWrap:'wrap',marginTop:8}}>{entries.map(([key,s])=>{const r=rowFor(s,chosen);return <div key={key} style={{fontSize:13}}><strong>{key.toUpperCase()}</strong><div>Call: {r?million(r.call_gex):'—'}</div><div>Put: {r?million(-r.put_gex):'—'}</div><div>Net: {r?million(r.net_gex):'—'}</div></div>})}</div></div>}
  </>}
  <h4>③ Repriced Gamma Profile / Gamma Flip</h4>
  <label style={{fontSize:12}}>Profile<select value={profileMode} onChange={e=>setProfileMode(e.target.value as typeof profileMode)}><option value="all">All</option><option value="ex_nearest">Excluding nearest</option><option value="ex_monthly">Excluding nearest monthly</option></select></label>
  {profileChart}
  <div style={{fontSize:12,marginTop:8}}>{allSessions.map(([key,s])=><div key={key}>{key.toUpperCase()} · Gamma Flip: {(Array.isArray(s.meta.gamma_flips)?s.meta.gamma_flips:[]).map(v=>fmt(Number(v))).join(', ')||'None'} · Net GEX: {million(num(s.meta.net_gex_twd_per_1pct)??0)} · OI: {String(s.meta.oi_source??'—')}</div>)}</div>
  <details style={{marginTop:12}}><summary>Raw Gamma Data / Static PNG</summary>{allSessions.map(([key,s])=><div key={key}><h4>{key.toUpperCase()}</h4><img className="analysis-image" src={s.image} alt={`${key} static Gamma Wall`}/><pre className="result-meta">{JSON.stringify(s.meta,null,2)}</pre></div>)}</details>
 </section>;
}

export default function Options(){
 const [mode,setMode]=useState<Mode>('daynight');
 const [workspaces,setWorkspaces]=useState<Workspaces>(initialWorkspaces);
 const workspacesRef=useRef(workspaces);
 const update=(target:Mode,change:(previous:Workspace)=>Workspace)=>{
  const next={...workspacesRef.current,[target]:change(workspacesRef.current[target])};
  workspacesRef.current=next;
  setWorkspaces(next);
 };
 const setSetting=<K extends keyof Settings>(key:K,value:Settings[K])=>{
  update(mode,w=>({...w,settings:{...w.settings,[key]:value}}));
 };
 const current=workspaces[mode];
 const {settings:s,busy,message,result,resultSignature}=current;
 const second=mode==='compare'||mode==='daynight'||(mode==='gamma'&&s.gammaSession!=='day');
 const stale=Boolean(result&&resultSignature!==signature(mode,s));
 async function load(){
  const target=mode;
  const snapshot=workspacesRef.current[target].settings;
  if(workspacesRef.current[target].busy)return;
  update(target,w=>({...w,busy:true,message:'Loading TAIFEX contract data...'}));
  try{
   const data=await request(target==='poc'?'/poc/expiries':target==='gamma'?'/gamma/expiries':'/expiries',payload(target,snapshot));
   const values=Array.isArray(data.expiries)?(data.expiries as string[]):[];
   update(target,w=>{
    // If the user changed the date while loading, avoid attaching old expiries to a new date.
    if(w.settings.date1!==snapshot.date1||w.settings.date2!==snapshot.date2||(target==='gamma'&&w.settings.gammaSession!==snapshot.gammaSession)){
     return {...w,message:'Dates changed during loading. Load expiries again.'};
    }
    const previous=w.settings;
    const retained=previous.selectedExpiries.filter(v=>values.includes(v));
    const nextExpiry=target==='poc'?'AUTO':(values.length&&previous.expiry!==ALL&&previous.expiry!==COMBINED&&!values.includes(previous.expiry)?values[0]:previous.expiry);
    return {...w,settings:{...previous,expiryOptions:values,expiry:nextExpiry,selectedExpiries:retained.length?retained:values.slice(0,3)},
     message:`Loaded ${values.length} expiry choices. Select an expiry or All Expiries and run analysis.`};
   });
  }catch(e){update(target,w=>({...w,message:`Load failed: ${e instanceof Error?e.message:String(e)}. Check the API and data availability.`}));}
  finally{update(target,w=>({...w,busy:false}));}
 }
 async function run(){
  const target=mode;
  const snapshot=workspacesRef.current[target].settings;
  if(workspacesRef.current[target].busy)return;
  if(target!=='inst'&&snapshot.expiryOptions.length===0){
   update(target,w=>({...w,message:'Load Dates / Expiries before running analysis.'}));
   return;
  }
  const runSignature=signature(target,snapshot);
  update(target,w=>({...w,busy:true,message:target==='poc'?'Calculating MTX tick volume profile...':target==='gamma'?'Calculating Gamma Wall from official OI and Black-76...':'Running V4 calculations. All Expiries may take longer...'}));
  try{
   const data=await request(target==='poc'?'/poc/analyze':target==='gamma'?'/gamma/analyze':'/analyze',payload(target,snapshot)) as Result;
   update(target,w=>({...w,result:data,resultSignature:runSignature,
    message:data.images?.length?`Analysis completed: ${data.images.length} expiry charts.`:target==='poc'?'MTX Volume Profile completed.':'Analysis completed using V4 calculation functions.'}));
  }catch(e){update(target,w=>({...w,message:`Analysis failed: ${e instanceof Error?e.message:String(e)}. Previous results have been preserved.`}));}
  finally{update(target,w=>({...w,busy:false}));}
 }
 return <>
  <div className="eyebrow">MARKET ANALYTICS / OPTIONS</div>
  <h1 className="pagetitle">TXO / MTX Options Dashboard</h1>
  <p className="subtitle">Official TAIFEX data · Black-76 IV · MTX Tick Volume Profile</p>
  <div className="panel">
   <h2>Analysis Settings</h2>
   <div className="mode-tabs" role="group" aria-label="Analysis Mode">{modes.map(m=><button type="button" key={m.id} className={'mode-tab '+(mode===m.id?'selected':'')} aria-pressed={mode===m.id} onClick={()=>setMode(m.id)}>{m.label}</button>)}</div>
   <div className="fields">
    <label>{mode==='inst'?'Analysis Date':'Date 1 / Day Date'}<input type="date" value={s.date1} onChange={e=>{setSetting('date1',e.target.value);}}/></label>
    {second&&<label>{mode==='daynight'||mode==='gamma'?'Night Data Label Date':'Date 2'}<input type="date" value={s.date2} onChange={e=>setSetting('date2',e.target.value)}/></label>}
    {mode!=='inst'&&mode!=='poc'&&(mode==='cross'?<label>Expiries (multiple)<select multiple size={4} value={s.selectedExpiries} onChange={e=>setSetting('selectedExpiries',Array.from(e.target.selectedOptions).map(o=>o.value))}>{s.expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>:<label>Expiry<select value={s.expiry} onChange={e=>setSetting('expiry',e.target.value)}><option value={ALL}>All Expiries — Separate</option><option value={COMBINED}>All Expiries — Combined</option>{s.expiry!==ALL&&s.expiry!==COMBINED&&!s.expiryOptions.includes(s.expiry)&&<option value={s.expiry}>{s.expiry}</option>}{s.expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>)}
    {mode==='gamma'&&<><label>Gamma Session<select value={s.gammaSession} onChange={e=>setSetting('gammaSession',e.target.value)}><option value="day">Day</option><option value="night">Night</option><option value="daynight">Day vs Night</option></select></label>{s.gammaSession!=='day'&&<label>Official OI Snapshot Date (already published)<input type="date" value={s.gammaOiDay} onChange={e=>setSetting('gammaOiDay',e.target.value)}/></label>}<label>Dealer Position Assumption<select value={s.gammaPosition} onChange={e=>setSetting('gammaPosition',e.target.value)}><option value="call_positive">Call + / Put − (heuristic)</option><option value="call_negative">Call − / Put +</option><option value="all_long">All Long</option><option value="all_short">All Short</option></select></label><label>IV Method<select value={s.gammaIv} onChange={e=>setSetting('gammaIv',e.target.value)}><option value="individual">Individual IV</option><option value="atm">ATM IV by Expiry</option></select></label><label>Gamma Profile Range (%)<input type="number" min="1" max="30" value={s.gammaRange} onChange={e=>setSetting('gammaRange',e.target.value)}/></label><label>0DTE Policy<select value={s.gamma0Dte} onChange={e=>setSetting('gamma0Dte',e.target.value)}><option value="auto">Auto — Day exclude / Night include</option><option value="no">Exclude</option><option value="yes">Include unexpired</option></select></label></>}
     {mode==='poc'?<><label>Session<select value={s.pocSession} onChange={e=>setSetting('pocSession',e.target.value)}><option value="ALL">ALL</option><option value="DAY">DAY</option><option value="NIGHT">NIGHT</option></select></label><label>MTX Contract<select value={s.expiry} onChange={e=>setSetting('expiry',e.target.value)}><option value="AUTO">AUTO — Front Month</option>{s.expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label><label>Value Area (%)<input type="number" min="1" max="100" value={s.pocValueArea} onChange={e=>setSetting('pocValueArea',e.target.value)}/></label><label>Price Step<input type="number" min="1" max="100" value={s.pocStep} onChange={e=>setSetting('pocStep',e.target.value)}/></label><label>Top N<input type="number" min="1" max="50" value={s.pocTopN} onChange={e=>setSetting('pocTopN',e.target.value)}/></label></>:mode==='inst'?<label>Lookback (Calendar Days)<input type="number" min="1" max="90" value={s.lookback} onChange={e=>setSetting('lookback',e.target.value)}/></label>:mode==='gamma'?null:<label>Moneyness Range (%)<input type="number" min="1" max="30" value={s.atmRange} onChange={e=>setSetting('atmRange',e.target.value)}/></label>}
   </div>
   <label className="cache-toggle"><input type="checkbox" checked={s.force} onChange={e=>setSetting('force',e.target.checked)}/> Force refresh cached data</label>
   <div className="analysis-toolbar"><button disabled={busy} className="analysis-button" onClick={load}><RefreshCcw size={15} style={{verticalAlign:'middle',marginRight:7}}/>Load Dates / Expiries</button><button disabled={busy} className="analysis-button primary-action" onClick={run}><Play size={15} style={{verticalAlign:'middle',marginRight:7}}/>{busy?'Working...':'Run Analysis'}</button></div>
   <div className="notice" role="status"><Info size={15} style={{verticalAlign:'middle',marginRight:7}}/>{message}</div>
  </div>
  <div className="panel"><div className="sectiontitle"><h2>{modes.find(m=>m.id===mode)?.label} Analysis</h2><span>{busy?'Working...':stale?'Previous Result':result?'V4 results':'Waiting for analysis'}</span></div>
   {stale&&<div className="notice" role="status"><Info size={15} style={{verticalAlign:'middle',marginRight:7}}/>Settings have changed. The chart below is from the previous successful analysis. Run Analysis to update it.</div>}
   {result?<>
    {mode==='gamma'&&result.gamma_groups?.length?result.gamma_groups.map(group=><GammaInteractive key={group.expiry} group={group}/>):result.images?.length?result.images.map(chart=><section key={chart.expiry} style={{marginBottom:32}}><h3 style={{marginBottom:12}}>Expiry: {chart.expiry}</h3><img className="analysis-image" src={chart.image} alt={`TAIFEX V4 analytics for ${chart.expiry}`}/>{mode==='gamma'&&chart.activity&&<details><summary>Gamma-weighted Volume Activity</summary><pre className="result-meta">{JSON.stringify(chart.activity,null,2)}</pre></details>}{Object.keys(chart.meta||{}).length>0&&<pre className="result-meta">{JSON.stringify(chart.meta,null,2)}</pre>}</section>):<img className="analysis-image" src={result.image} alt="TAIFEX V4 option analytics charts"/>}
    {mode==='gamma'&&result.activity&&<details><summary>Gamma-weighted Volume Activity (not dealer GEX)</summary><pre className="result-meta">{JSON.stringify(result.activity,null,2)}</pre></details>}
     {mode==='poc'&&result.csv&&<p><a className="analysis-button" href={result.csv} download={`LF_MTX_VP_${s.date1}_${String(result.meta?.expiry||'AUTO')}_${s.pocSession}.csv`}>Download Profile CSV</a></p>}
    {Object.keys(result.meta||{}).length>0&&<pre className="result-meta">{JSON.stringify(result.meta,null,2)}</pre>}
    <p className="analysis-note">{result.note}</p>
   </>:<div className="plot-empty">No results yet. Load available expiries and click Run Analysis.</div>}
   <p className="analysis-note">MTX Volume Profile uses tick-by-tick traded volume (B+S / 2). Day vs Night dates are independent. Night Volume / Day OI are shown in the top row. Institutional charts use the original V4 daily data logic.</p>
  </div>
 </>;
}
