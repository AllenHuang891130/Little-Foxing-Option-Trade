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
type LegacyRow={x:string|number;series:string;value:number};
type LegacyChart={title:string;kind:string;rows:LegacyRow[]};
type ProfileRow={price:number;volume:number;in_value_area:boolean;is_poc:boolean};
type ExpiryChart={expiry:string;image:string;meta:Record<string,unknown>;activity?:Record<string,unknown>[];interactive_charts?:LegacyChart[]};
type Result={interactive_charts?:LegacyChart[];interactive_profile?:ProfileRow[];image:string;gamma_groups?:GammaGroup[];images?:ExpiryChart[];meta:Record<string,unknown>;note:string;csv?:string;activity?:Record<string,unknown>[]};
type Settings={date1:string;date2:string;expiry:string;expiryOptions:string[];selectedExpiries:string[];atmRange:string;lookback:string;force:boolean;pocSession:string;pocValueArea:string;pocStep:string;pocTopN:string;gammaSession:string;gammaPosition:string;gammaIv:string;gammaRange:string;gamma0Dte:string};
type Workspace={settings:Settings;busy:boolean;message:string;result:Result|null;resultSignature:string|null};
type Workspaces=Record<Mode,Workspace>;

function initialWorkspace():Workspace{
 return {settings:{date1:'2026-10-16',date2:'2026-10-19',expiry:'202610',expiryOptions:[],selectedExpiries:[],atmRange:'6',lookback:'20',force:false,pocSession:'ALL',pocValueArea:'70',pocStep:'1',pocTopN:'10',gammaSession:'day',gammaPosition:'call_positive',gammaIv:'individual',gammaRange:'10',gamma0Dte:'auto'},busy:false,message:'Load available expiries to begin.',result:null,resultSignature:null};
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
 if(mode==='gamma')return {date1:s.date1,date2:s.gammaSession==='day'?null:s.date2,session:s.gammaSession,expiry:s.expiry,position_mode:s.gammaPosition,iv_mode:s.gammaIv,profile_range_pct:Number(s.gammaRange),include_0dte:s.gamma0Dte==='auto'?null:s.gamma0Dte==='yes',force:s.force};
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
 const pointerFrame=useRef<number|null>(null);
 const hoveredRef=useRef<number|null>(null);
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
 const chosen=selected??hovered;
 const rowFor=(s:GammaSession,k:number)=>s.strikes.find(r=>r.strike===k);
 // Stacked day/night bars: positive and negative contributions stack independently.
 const stackedBounds=shown.flatMap(strike=>{
  const d=entries.find(([key])=>key==='day')?.[1];
  const n=entries.find(([key])=>key==='night')?.[1];
  const dr=d?rowFor(d,strike):undefined;
  const nr=n?rowFor(n,strike):undefined;
  const parts=[
   [dr?.call_gex??0,nr?.call_gex??0],
   [-(dr?.put_gex??0),-(nr?.put_gex??0)],
   [dr?.net_gex??0,nr?.net_gex??0],
  ];
  return parts.flatMap(([day,night])=>[
   (Math.max(0,day)+Math.max(0,night))/1e6,
   (Math.min(0,day)+Math.min(0,night))/1e6,
  ]);
 });
 const maxAbs=Math.max(1,...stackedBounds.map(Math.abs));
 const y=(v:number)=>scaleY(v,-maxAbs*1.13,maxAbs*1.13);
 const barWidth=Math.max(2,Math.min(22,(w-left-right)/Math.max(1,shown.length)*.72));
 const movePointer=(e:React.PointerEvent<SVGSVGElement>)=>{
  if(selected!==null||!shown.length)return;
  const bounds=e.currentTarget.getBoundingClientRect();
  const sx=(e.clientX-bounds.left)*w/(bounds.width||1);
  const ratio=Math.max(0,Math.min(1,(sx-left)/(w-left-right)));
  const target=min+ratio*(max-min);
  let lo=0,hi=shown.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(shown[mid]<target)lo=mid+1;else hi=mid;}
  const candidate=lo>0&&Math.abs(shown[lo-1]-target)<Math.abs(shown[lo]-target)?shown[lo-1]:shown[lo];
  if(hoveredRef.current===candidate)return;
  hoveredRef.current=candidate;
  if(pointerFrame.current!==null)cancelAnimationFrame(pointerFrame.current);
  pointerFrame.current=requestAnimationFrame(()=>{setHovered(candidate);pointerFrame.current=null;});
 };
 const leavePointer=()=>{if(selected===null){hoveredRef.current=null;setHovered(null);}};
 const pinStrike=()=>{const next=selected===null?(hoveredRef.current??hovered):null;setSelected(next);};
 const keyDown=(e:React.KeyboardEvent<SVGSVGElement>)=>{
  if(!shown.length)return;
  if(e.key==='Escape'){setSelected(null);setHovered(null);return;}
  if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
  e.preventDefault();
  const index=shown.indexOf(chosen??shown[0]);
  const next=shown[Math.max(0,Math.min(shown.length-1,index+(e.key==='ArrowRight'?1:-1)))];
  setSelected(next);setHovered(next);
 };
 const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4);
 const colors={day:{call:'#d45b3d',put:'#397ac0',net:'#d45b3d'},night:{call:'#efa787',put:'#8cb9e8',net:'#7c59ae'}};
 const legend=(<div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12,margin:'8px 0 12px'}}>
  {allSessions.map(([key,s])=><label key={key} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}><input type="checkbox" checked={key==='day'?showDay:showNight} onChange={e=>key==='day'?setShowDay(e.target.checked):setShowNight(e.target.checked)}/><span style={{width:12,height:12,background:key==='day'?'#d45b3d':'#7c59ae',display:'inline-block'}}/>{key==='day'?'DAY · Official OI GEX':'NIGHT · Volume-weighted Gamma'} · Futures {fmt(num(s.meta.reference_forward)??0)} · Call Wall {fmt(num(s.meta.call_wall)??0)} · Put Wall {fmt(num(s.meta.put_wall)??0)}</label>)}
 </div>);
 function axis(maxY:number){return <>
  {[0,1,2,3,4].map(i=>{const v=(i-2)*maxY/2;return <g key={i}><line x1={left} x2={w-right} y1={y(v)} y2={y(v)} stroke={i===2?'#777':'#e5e7eb'} strokeWidth={i===2?1.3:1}/><text x={left-8} y={y(v)+4} textAnchor="end" fontSize="11" fill="#667085">{fmt(v,0)}</text></g>})}
  {ticks.map((v,i)=><g key={i}><line x1={x(v)} x2={x(v)} y1={h-bottom} y2={h-bottom+5} stroke="#667085"/><text x={x(v)} y={h-bottom+19} textAnchor="middle" fontSize="11" fill="#667085">{fmt(v)}</text></g>)}
  <text x={left+4} y={13} fontSize="11" fill="#667085">TWD millions / 1% move</text>
 </>}
 const renderBars=(kind:'gross'|'net')=><svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:'auto',display:'block',cursor:'crosshair',touchAction:'pan-y',outline:'none'}} role="img" tabIndex={0} aria-label={kind==='gross'?'Call Put GEX chart, arrow keys move between strikes':'Net GEX chart, arrow keys move between strikes'} onPointerMove={movePointer} onPointerLeave={leavePointer} onClick={pinStrike} onKeyDown={keyDown}>
  {axis(maxAbs*1.13)}
  {shown.flatMap((strike,i)=>{
   const day=entries.find(([k])=>k==='day')?.[1];
   const night=entries.find(([k])=>k==='night')?.[1];
   const dr=day?rowFor(day,strike):undefined;
   const nr=night?rowFor(night,strike):undefined;
   const components=kind==='gross' ? [
    {id:'call',dv:(dr?.call_gex??0)/1e6,nv:(nr?.call_gex??0)/1e6,dx:-barWidth*.30,dayColor:colors.day.call,nightColor:colors.night.call},
    {id:'put',dv:-(dr?.put_gex??0)/1e6,nv:-(nr?.put_gex??0)/1e6,dx:barWidth*.30,dayColor:colors.day.put,nightColor:colors.night.put},
   ] : [
    {id:'net',dv:(dr?.net_gex??0)/1e6,nv:(nr?.net_gex??0)/1e6,dx:0,
     dayColor:(dr?.net_gex??0)>=0?'#d45b3d':'#397ac0',
     nightColor:(nr?.net_gex??0)>=0?'#efa787':'#8cb9e8'},
   ];
   return components.flatMap(({id,dv,nv,dx,dayColor,nightColor})=>{
    const bw=barWidth*(kind==='gross'?.60:.82);
    const xx=x(strike)+dx-bw/2;
    // A negative contribution starts at the negative stack base; positive at positive base.
    const dayStart=0;
    const nightStart=nv>=0?Math.max(0,dv):Math.min(0,dv);
    const rect=(value:number,start:number,color:string,key:string)=>{
     if(!Number.isFinite(value)||value===0)return null;
     const y1=y(start),y2=y(start+value);
     return <rect key={`${i}-${id}-${key}`} x={xx} y={Math.min(y1,y2)} width={bw} height={Math.max(0.5,Math.abs(y2-y1))} fill={color} opacity={key==='day'?.94:.76} stroke={key==='night'?color:'none'} strokeWidth={key==='night'?.6:0} pointerEvents="none"/>;
    };
    return [rect(dv,dayStart,dayColor,'day'),rect(nv,nightStart,nightColor,'night')];
   });
  })}
  {chosen!==null&&shown.includes(chosen)&&<g pointerEvents="none"><line x1={x(chosen)} x2={x(chosen)} y1={top} y2={h-bottom} stroke="#475467" strokeWidth="1.2" strokeDasharray="3 4"/><rect x={Math.min(w-right-84,Math.max(left,x(chosen)-40))} y={h-bottom+25} width="80" height="19" rx="3" fill="#1f2937"/><text x={Math.min(w-right-44,Math.max(left+40,x(chosen)))} y={h-bottom+38} fontSize="11" fill="white" textAnchor="middle">{fmt(chosen)}</text></g>}
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
   <h4>① Call / Put Gamma by Strike — Stacked Day + Night</h4><div style={{fontSize:12,opacity:.75,marginBottom:6}}>Day: dark base segment · Night: light extension (stacked) · hover anywhere to snap to nearest strike</div>{renderBars('gross')}
   <h4>② Net Gamma by Strike — Independently Calculated, Then Stacked</h4>{renderBars('net')}
   {chosen!==null&&<div aria-live="off" style={{padding:12,background:'rgba(128,128,128,.08)',borderRadius:8,marginBottom:14,position:'sticky',bottom:8,zIndex:3,backdropFilter:'blur(8px)',border:'1px solid rgba(128,128,128,.20)'}}><strong>Strike {fmt(chosen)}</strong> <span style={{fontSize:12}}>· {selected!==null?'PINNED · click chart / Esc to unlock':'move cursor to inspect · click to pin · ← → to step'}</span><div style={{display:'flex',gap:22,flexWrap:'wrap',marginTop:8}}>{entries.map(([key,s])=>{const r=rowFor(s,chosen);return <div key={key} style={{fontSize:13}}><strong>{key.toUpperCase()}</strong><div>Call: {r?million(r.call_gex):'—'}</div><div>Put: {r?million(-r.put_gex):'—'}</div><div>Net: {r?million(r.net_gex):'—'}</div></div>})}{entries.length===2&&<div style={{fontSize:13,fontWeight:600}}>Day + Night Net (arithmetic): {million((rowFor(entries[0][1],chosen)?.net_gex??0)+(rowFor(entries[1][1],chosen)?.net_gex??0))}</div>}</div></div>}
  </>}
  <h4>③ Repriced Gamma Profile / Gamma Flip (different weighting bases)</h4>
  <label style={{fontSize:12}}>Profile<select value={profileMode} onChange={e=>setProfileMode(e.target.value as typeof profileMode)}><option value="all">All</option><option value="ex_nearest">Excluding nearest</option><option value="ex_monthly">Excluding nearest monthly</option></select></label>
  {profileChart}
  <div style={{fontSize:12,marginTop:8}}>{allSessions.map(([key,s])=><div key={key}>{key.toUpperCase()} · Gamma Flip: {(Array.isArray(s.meta.gamma_flips)?s.meta.gamma_flips:[]).map(v=>fmt(Number(v))).join(', ')||'None'} · Net GEX: {million(num(s.meta.net_gex_twd_per_1pct)??0)} · Weight: {String(s.meta.oi_source??'—')}</div>)}</div>
  <details style={{marginTop:12}}><summary>Raw Gamma Data / Static PNG</summary>{allSessions.map(([key,s])=><div key={key}><h4>{key.toUpperCase()}</h4><img className="analysis-image" src={s.image} alt={`${key} static Gamma Wall`}/><pre className="result-meta">{JSON.stringify(s.meta,null,2)}</pre></div>)}</details>
 </section>;
}


// Shared SVG terminal interaction for OI, institutional series and MTX profile.
const palette=['#c65a3a','#3274b8','#40966a','#a66bc5','#d6a54b','#6c8eaa','#ba6684','#808080'];
function TerminalChart({chart}:{chart:LegacyChart}){
 const [hover,setHover]=useState<string|null>(null);
 const [locked,setLocked]=useState<string|null>(null);
 const [start,setStart]=useState(0);
 const [windowSize,setWindowSize]=useState(60);
 const [hidden,setHidden]=useState<string[]>([]);
 const labels=Array.from(new Set(chart.rows.map(r=>String(r.x)))).sort((a,b)=>chart.kind==='time'?a.localeCompare(b):Number(a)-Number(b));
 const series=Array.from(new Set(chart.rows.map(r=>r.series)));
 const visible=labels.slice(start,start+windowSize);
 const active=locked??hover;
 const rows=chart.rows.filter(r=>visible.includes(String(r.x))&&!hidden.includes(r.series));
 const maxValue=Math.max(1,...rows.map(r=>Math.abs(Number(r.value)||0)));
 const minValue=chart.kind==='line'?Math.min(0,...rows.map(r=>Number(r.value)||0)):-maxValue;
 const maxY=chart.kind==='line'?Math.max(1,...rows.map(r=>Number(r.value)||0)):maxValue;
 const w=980,h=330,l=76,t=24,r=22,b=56;
 const px=(idx:number)=>l+(idx+.5)*(w-l-r)/Math.max(visible.length,1);
 const py=(v:number)=>t+(maxY-v)/(maxY-minValue||1)*(h-t-b);
 const y0=py(0);
 const activeIdx=visible.indexOf(active??'');
 const grouped=new Map<string,Map<string,number>>();
 for(const row of rows){const k=String(row.x);if(!grouped.has(k))grouped.set(k,new Map());grouped.get(k)!.set(row.series,Number(row.value)||0);}
 const values=active?series.map(s=>({name:s,value:grouped.get(active)?.get(s)})).filter(v=>v.value!==undefined):[];
 const move=(event:React.MouseEvent<SVGSVGElement>)=>{
  if(locked||!visible.length)return;
  const rect=event.currentTarget.getBoundingClientRect();
  const svgX=(event.clientX-rect.left)/rect.width*w;
  const i=Math.max(0,Math.min(visible.length-1,Math.floor((svgX-l)/(w-l-r)*visible.length)));
  setHover(visible[i]);
 };
 const width=Math.min(22,Math.max(1.4,(w-l-r)/Math.max(visible.length,1)/Math.max(1,series.length+0.4)));
 const visibleSeries=series.filter(s=>!hidden.includes(s));
 return <section style={{marginBottom:28,border:'1px solid var(--border, #dddddd44)',borderRadius:12,padding:12}}>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
   <strong>{chart.title}</strong>
   <div style={{display:'flex',gap:6}}><button type="button" onClick={()=>{setStart(0);setWindowSize(60);setLocked(null);}}>Reset</button><button type="button" onClick={()=>setWindowSize(v=>Math.max(8,Math.floor(v/1.5)))}>Zoom +</button><button type="button" onClick={()=>setWindowSize(v=>Math.min(labels.length,Math.ceil(v*1.5)))}>Zoom −</button></div>
  </div>
  <div style={{display:'flex',flexWrap:'wrap',gap:10,margin:'8px 0'}}>{series.map((s,i)=><label key={s} style={{fontSize:12,cursor:'pointer',opacity:hidden.includes(s)?.4:1}}><input type="checkbox" checked={!hidden.includes(s)} onChange={()=>setHidden(v=>v.includes(s)?v.filter(x=>x!==s):[...v,s])}/><span style={{color:palette[i%palette.length]}}>■</span> {s}</label>)}</div>
  <div tabIndex={0} onKeyDown={e=>{if(e.key==='Escape')setLocked(null);if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const i=visible.indexOf(active??'');setLocked(visible[Math.max(0,Math.min(visible.length-1,(i<0?0:i)+(e.key==='ArrowRight'?1:-1)))])}}} style={{outline:'none'}}>
   <svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',display:'block',touchAction:'pan-y'}} onMouseMove={move} onMouseLeave={()=>setHover(null)} onClick={()=>setLocked(locked?null:hover)} role="img" aria-label={chart.title}>
    {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={l} x2={w-r} y1={t+f*(h-t-b)} y2={t+f*(h-t-b)} stroke="currentColor" opacity=".12"/><text x={l-8} y={t+f*(h-t-b)+4} textAnchor="end" fontSize="11" fill="currentColor">{fmt(maxY-f*(maxY-minValue),1)}</text></g>)}
    <line x1={l} x2={w-r} y1={y0} y2={y0} stroke="currentColor" opacity=".5"/>
    {chart.kind==='line'?visibleSeries.map((s,i)=>{const pts=visible.map((x,j)=>{const v=grouped.get(x)?.get(s);return v===undefined?null:`${px(j)},${py(v)}`}).filter(Boolean).join(' ');return <polyline key={s} points={pts} fill="none" stroke={palette[series.indexOf(s)%palette.length]} strokeWidth="2"/>}):visible.flatMap((x,i)=>visibleSeries.map((s,j)=>{const v=grouped.get(x)?.get(s);if(v===undefined)return null;const xPos=px(i)+(j-(visibleSeries.length-1)/2)*width;return <rect key={`${x}-${s}`} x={xPos-width*.45} y={Math.min(py(v),y0)} width={width*.9} height={Math.max(1,Math.abs(py(v)-y0))} fill={palette[series.indexOf(s)%palette.length]} opacity=".88"/>}))}
    {visible.map((x,i)=>i%Math.max(1,Math.ceil(visible.length/14))===0?<text key={x} x={px(i)} y={h-25} fontSize="10" fill="currentColor" textAnchor="middle">{x}</text>:null)}
    {activeIdx>=0&&<><line x1={px(activeIdx)} x2={px(activeIdx)} y1={t} y2={h-b} stroke="currentColor" strokeDasharray="4 4" opacity=".65"/><text x={px(activeIdx)} y={h-7} fontSize="12" textAnchor="middle" fill="currentColor">{active}</text></>}
   </svg>
  </div>
  {active&&<div style={{padding:'8px 12px',background:'var(--surface-secondary, #88888814)',borderRadius:8,fontSize:12,display:'flex',gap:14,flexWrap:'wrap'}}><strong>{active}{locked?' · Locked':''}</strong>{values.map(v=><span key={v.name}>{v.name}: <b>{fmt(v.value!,2)}</b></span>)}<span style={{opacity:.6}}>Click to lock · ← → to step · Esc to unlock</span></div>}
  <div style={{display:'flex',gap:10,alignItems:'center',fontSize:12}}><span>Range</span><input aria-label="Scroll chart" type="range" min={0} max={Math.max(0,labels.length-windowSize)} value={Math.min(start,Math.max(0,labels.length-windowSize))} onChange={e=>setStart(Number(e.target.value))} style={{flex:1}}/><span>{Math.min(start+1,labels.length)}–{Math.min(start+windowSize,labels.length)} / {labels.length}</span></div>
 </section>;
}
function ProfileInteractive({rows,meta}:{rows:ProfileRow[];meta:Record<string,unknown>}){
 const [hover,setHover]=useState<number|null>(null);
 const [locked,setLocked]=useState<number|null>(null);
 const [range,setRange]=useState(90);
 const [offset,setOffset]=useState(0);
 const data=rows.filter(r=>r.volume>0||r.in_value_area);
 const visible=data.slice(offset,offset+range);
 const w=980,h=420,l=90,r=100,t=18,b=38;
 const vmax=Math.max(1,...visible.map(r=>r.volume));
 const step=(h-t-b)/Math.max(1,visible.length);
 const selected=locked??hover;
 const active=data.find(r=>r.price===selected);
 return <section style={{border:'1px solid var(--border, #dddddd44)',borderRadius:12,padding:12}}>
  <strong>MTX Horizontal Volume Profile</strong><div style={{fontSize:12,marginTop:5}}>POC {fmt(Number(meta.poc))} · VAH {fmt(Number(meta.vah))} · VAL {fmt(Number(meta.val))} · Tick Volume (B+S / 2)</div>
  <svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',display:'block'}} onMouseLeave={()=>setHover(null)} onClick={()=>setLocked(locked?null:hover)} role="img" aria-label="Interactive MTX volume profile">
   {visible.map((v,i)=>{const y=t+(visible.length-i-1)*step;return <g key={v.price} onMouseEnter={()=>setHover(v.price)}><rect x={l} y={y} height={Math.max(1,step*.92)} width={Math.max(1,v.volume/vmax*(w-l-r))} fill={v.is_poc?'#c65a3a':v.in_value_area?'#3274b8':'#9da3ad'} opacity={selected===v.price?1:.82}/>{(i%Math.max(1,Math.ceil(visible.length/15))===0||v.is_poc)&&<text x={l-6} y={y+step*.7} fontSize="10" textAnchor="end" fill="currentColor">{fmt(v.price)}</text>}</g>})}
  </svg>
  {active&&<div style={{fontSize:12,padding:10,background:'var(--surface-secondary, #88888814)'}}>Price <b>{fmt(active.price)}</b> · Volume <b>{fmt(active.volume)}</b> · {active.is_poc?'POC':active.in_value_area?'Inside Value Area':'Outside Value Area'} {locked?'· Locked':''}</div>}
  <div style={{display:'flex',gap:8,alignItems:'center'}}><button type="button" onClick={()=>setRange(v=>Math.max(15,Math.floor(v/1.5)))}>Zoom +</button><button type="button" onClick={()=>setRange(v=>Math.min(data.length,Math.ceil(v*1.5)))}>Zoom −</button><button type="button" onClick={()=>{setRange(90);setOffset(0);setLocked(null)}}>Reset</button><input aria-label="Scroll price levels" type="range" style={{flex:1}} min={0} max={Math.max(0,data.length-range)} value={Math.min(offset,Math.max(0,data.length-range))} onChange={e=>setOffset(Number(e.target.value))}/></div>
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
  update(target,w=>({...w,busy:true,message:target==='poc'?'Calculating MTX tick volume profile...':target==='gamma'?'Calculating Day official-OI GEX / Night volume-weighted Gamma activity...':'Running V4 calculations. All Expiries may take longer...'}));
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
    {mode==='gamma'&&<><label>Gamma Session<select value={s.gammaSession} onChange={e=>setSetting('gammaSession',e.target.value)}><option value="day">Day</option><option value="night">Night</option><option value="daynight">Day vs Night</option></select></label><label>Dealer Position Assumption<select value={s.gammaPosition} onChange={e=>setSetting('gammaPosition',e.target.value)}><option value="call_positive">Call + / Put − (heuristic)</option><option value="call_negative">Call − / Put +</option><option value="all_long">All Long</option><option value="all_short">All Short</option></select></label><label>IV Method<select value={s.gammaIv} onChange={e=>setSetting('gammaIv',e.target.value)}><option value="individual">Individual IV</option><option value="atm">ATM IV by Expiry</option></select></label><label>Gamma Profile Range (%)<input type="number" min="1" max="30" value={s.gammaRange} onChange={e=>setSetting('gammaRange',e.target.value)}/></label><label>0DTE Policy<select value={s.gamma0Dte} onChange={e=>setSetting('gamma0Dte',e.target.value)}><option value="auto">Auto — Day exclude / Night include</option><option value="no">Exclude</option><option value="yes">Include unexpired</option></select></label></>}
     {mode==='poc'?<><label>Session<select value={s.pocSession} onChange={e=>setSetting('pocSession',e.target.value)}><option value="ALL">ALL</option><option value="DAY">DAY</option><option value="NIGHT">NIGHT</option></select></label><label>MTX Contract<select value={s.expiry} onChange={e=>setSetting('expiry',e.target.value)}><option value="AUTO">AUTO — Front Month</option>{s.expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label><label>Value Area (%)<input type="number" min="1" max="100" value={s.pocValueArea} onChange={e=>setSetting('pocValueArea',e.target.value)}/></label><label>Price Step<input type="number" min="1" max="100" value={s.pocStep} onChange={e=>setSetting('pocStep',e.target.value)}/></label><label>Top N<input type="number" min="1" max="50" value={s.pocTopN} onChange={e=>setSetting('pocTopN',e.target.value)}/></label></>:mode==='inst'?<label>Lookback (Calendar Days)<input type="number" min="1" max="90" value={s.lookback} onChange={e=>setSetting('lookback',e.target.value)}/></label>:mode==='gamma'?null:<label>Moneyness Range (%)<input type="number" min="1" max="30" value={s.atmRange} onChange={e=>setSetting('atmRange',e.target.value)}/></label>}
   </div>
   <label className="cache-toggle"><input type="checkbox" checked={s.force} onChange={e=>setSetting('force',e.target.checked)}/> Force refresh cached data</label>
   <div className="analysis-toolbar"><button disabled={busy} className="analysis-button" onClick={load}><RefreshCcw size={15} style={{verticalAlign:'middle',marginRight:7}}/>Load Dates / Expiries</button><button disabled={busy} className="analysis-button primary-action" onClick={run}><Play size={15} style={{verticalAlign:'middle',marginRight:7}}/>{busy?'Working...':'Run Analysis'}</button></div>
   <div className="notice" role="status"><Info size={15} style={{verticalAlign:'middle',marginRight:7}}/>{message}</div>
  </div>
  <div className="panel"><div className="sectiontitle"><h2>{modes.find(m=>m.id===mode)?.label} Analysis</h2><span>{busy?'Working...':stale?'Previous Result':result?'V4 results':'Waiting for analysis'}</span></div>
   {stale&&<div className="notice" role="status"><Info size={15} style={{verticalAlign:'middle',marginRight:7}}/>Settings have changed. The chart below is from the previous successful analysis. Run Analysis to update it.</div>}
   {result?<>
    {mode==='gamma'&&result.gamma_groups?.length?result.gamma_groups.map(group=><GammaInteractive key={group.expiry} group={group}/>):mode==='poc'&&result.interactive_profile?.length?<ProfileInteractive rows={result.interactive_profile} meta={result.meta}/>:result.images?.length?result.images.map(chart=><section key={chart.expiry} style={{marginBottom:32}}><h3>Expiry: {chart.expiry}</h3>{chart.interactive_charts?.length?chart.interactive_charts.map((c,i)=><TerminalChart key={`${chart.expiry}-${i}`} chart={c}/>):<img className="analysis-image" src={chart.image} alt={`V4 ${chart.expiry}`}/>}</section>):result.interactive_charts?.length?result.interactive_charts.map((c,i)=><TerminalChart key={i} chart={c}/>):<img className="analysis-image" src={result.image} alt="TAIFEX V4 analytics charts"/>}
    {mode!=='gamma'&&(result.interactive_charts?.length||result.interactive_profile?.length||result.images?.some(c=>c.interactive_charts?.length))?<details style={{marginTop:12}}><summary>Original V4 static charts (reference)</summary>{result.images?.length?result.images.map(c=><img key={c.expiry} className="analysis-image" src={c.image} alt={c.expiry}/>):<img className="analysis-image" src={result.image} alt="Original V4 chart"/>}</details>:null}
    {mode==='gamma'&&result.activity&&<details><summary>Gamma-weighted Volume Activity (not dealer GEX)</summary><pre className="result-meta">{JSON.stringify(result.activity,null,2)}</pre></details>}
     {mode==='poc'&&result.csv&&<p><a className="analysis-button" href={result.csv} download={`LF_MTX_VP_${s.date1}_${String(result.meta?.expiry||'AUTO')}_${s.pocSession}.csv`}>Download Profile CSV</a></p>}
    {Object.keys(result.meta||{}).length>0&&<pre className="result-meta">{JSON.stringify(result.meta,null,2)}</pre>}
    <p className="analysis-note">{result.note}</p>
   </>:<div className="plot-empty">No results yet. Load available expiries and click Run Analysis.</div>}
   <p className="analysis-note">MTX Volume Profile uses tick-by-tick traded volume (B+S / 2). Day vs Night dates are independent. Gamma Wall: Day uses official OI; Night uses traded volume as a weighting proxy, not OI. Night Volume / Day OI are shown in the top row. Institutional charts use the original V4 daily data logic.</p>
  </div>
 </>;
}
