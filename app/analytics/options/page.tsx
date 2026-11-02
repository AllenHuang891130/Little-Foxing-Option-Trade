'use client';
import {useRef, useState} from 'react';
import {RefreshCcw, Play, Info} from 'lucide-react';

type Mode='single'|'compare'|'cross'|'inst'|'daynight'|'poc';
const ALL='__ALL__';
const COMBINED='__COMBINED__';
const modes:{id:Mode;label:string}[]=[
 {id:'single',label:'Single Day'}, {id:'compare',label:'Two Days'},
 {id:'cross',label:'Cross Expiry'}, {id:'inst',label:'Institutions'},
 {id:'daynight',label:'Day vs Night'}, {id:'poc',label:'MTX Volume Profile'}
];
type ExpiryChart={expiry:string;image:string;meta:Record<string,unknown>};
type Result={image:string;images?:ExpiryChart[];meta:Record<string,unknown>;note:string;csv?:string};
type Settings={date1:string;date2:string;expiry:string;expiryOptions:string[];selectedExpiries:string[];atmRange:string;lookback:string;force:boolean;pocSession:string;pocValueArea:string;pocStep:string;pocTopN:string};
type Workspace={settings:Settings;busy:boolean;message:string;result:Result|null;resultSignature:string|null};
type Workspaces=Record<Mode,Workspace>;

function initialWorkspace():Workspace{
 return {settings:{date1:'2026-10-16',date2:'2026-10-19',expiry:'202610',expiryOptions:[],selectedExpiries:[],atmRange:'6',lookback:'20',force:false,pocSession:'ALL',pocValueArea:'70',pocStep:'1',pocTopN:'10'},busy:false,message:'Load available expiries to begin.',result:null,resultSignature:null};
}
function initialWorkspaces():Workspaces{
 const poc=initialWorkspace();poc.settings.expiry='AUTO';
 return {single:initialWorkspace(),compare:initialWorkspace(),cross:initialWorkspace(),inst:initialWorkspace(),daynight:initialWorkspace(),poc};
}
function apiBase(){
 const configured=process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/,'');
 return configured||'http://localhost:8000';
}
function payload(mode:Mode,s:Settings){
 if(mode==='poc')return {date1:s.date1,session:s.pocSession,expiry:s.expiry,
  value_area_pct:Number(s.pocValueArea),price_step:Number(s.pocStep),top_n:Number(s.pocTopN),force:s.force};
 return {mode,date1:s.date1,date2:mode==='compare'||mode==='daynight'?s.date2:null,expiry:s.expiry,
  expiries:s.selectedExpiries,range_pct:Number(s.atmRange),lookback:Number(s.lookback),force:s.force};
}
function signature(mode:Mode,s:Settings){
 const p=payload(mode,s);
 // Force refresh changes the fetch behavior, not the meaning of the plotted result.
 return JSON.stringify(mode==='poc'?{...p,force:undefined}:{...p,force:undefined,expiries:mode==='cross'?[...('expiries' in p?p.expiries:[])].sort():[]});
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
 const second=mode==='compare'||mode==='daynight';
 const stale=Boolean(result&&resultSignature!==signature(mode,s));
 async function load(){
  const target=mode;
  const snapshot=workspacesRef.current[target].settings;
  if(workspacesRef.current[target].busy)return;
  update(target,w=>({...w,busy:true,message:'Loading TAIFEX contract data...'}));
  try{
   const data=await request(target==='poc'?'/poc/expiries':'/expiries',payload(target,snapshot));
   const values=Array.isArray(data.expiries)?(data.expiries as string[]):[];
   update(target,w=>{
    // If the user changed the date while loading, avoid attaching old expiries to a new date.
    if(w.settings.date1!==snapshot.date1||w.settings.date2!==snapshot.date2){
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
  update(target,w=>({...w,busy:true,message:target==='poc'?'Calculating MTX tick volume profile...':'Running V4 calculations. All Expiries may take longer...'}));
  try{
   const data=await request(target==='poc'?'/poc/analyze':'/analyze',payload(target,snapshot)) as Result;
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
    {second&&<label>{mode==='daynight'?'Night Data Label Date':'Date 2'}<input type="date" value={s.date2} onChange={e=>setSetting('date2',e.target.value)}/></label>}
    {mode!=='inst'&&mode!=='poc'&&(mode==='cross'?<label>Expiries (multiple)<select multiple size={4} value={s.selectedExpiries} onChange={e=>setSetting('selectedExpiries',Array.from(e.target.selectedOptions).map(o=>o.value))}>{s.expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>:<label>Expiry<select value={s.expiry} onChange={e=>setSetting('expiry',e.target.value)}><option value={ALL}>All Expiries — Separate</option><option value={COMBINED}>All Expiries — Combined</option>{s.expiry!==ALL&&s.expiry!==COMBINED&&!s.expiryOptions.includes(s.expiry)&&<option value={s.expiry}>{s.expiry}</option>}{s.expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>)}
    {mode==='poc'?<><label>Session<select value={s.pocSession} onChange={e=>setSetting('pocSession',e.target.value)}><option value="ALL">ALL</option><option value="DAY">DAY</option><option value="NIGHT">NIGHT</option></select></label><label>MTX Contract<select value={s.expiry} onChange={e=>setSetting('expiry',e.target.value)}><option value="AUTO">AUTO — Front Month</option>{s.expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label><label>Value Area (%)<input type="number" min="1" max="100" value={s.pocValueArea} onChange={e=>setSetting('pocValueArea',e.target.value)}/></label><label>Price Step<input type="number" min="1" max="100" value={s.pocStep} onChange={e=>setSetting('pocStep',e.target.value)}/></label><label>Top N<input type="number" min="1" max="50" value={s.pocTopN} onChange={e=>setSetting('pocTopN',e.target.value)}/></label></>:mode==='inst'?<label>Lookback (Calendar Days)<input type="number" min="1" max="90" value={s.lookback} onChange={e=>setSetting('lookback',e.target.value)}/></label>:<label>Moneyness Range (%)<input type="number" min="1" max="30" value={s.atmRange} onChange={e=>setSetting('atmRange',e.target.value)}/></label>}
   </div>
   <label className="cache-toggle"><input type="checkbox" checked={s.force} onChange={e=>setSetting('force',e.target.checked)}/> Force refresh cached data</label>
   <div className="analysis-toolbar"><button disabled={busy} className="analysis-button" onClick={load}><RefreshCcw size={15} style={{verticalAlign:'middle',marginRight:7}}/>Load Dates / Expiries</button><button disabled={busy} className="analysis-button primary-action" onClick={run}><Play size={15} style={{verticalAlign:'middle',marginRight:7}}/>{busy?'Working...':'Run Analysis'}</button></div>
   <div className="notice" role="status"><Info size={15} style={{verticalAlign:'middle',marginRight:7}}/>{message}</div>
  </div>
  <div className="panel"><div className="sectiontitle"><h2>{modes.find(m=>m.id===mode)?.label} Analysis</h2><span>{busy?'Working...':stale?'Previous Result':result?'V4 results':'Waiting for analysis'}</span></div>
   {stale&&<div className="notice" role="status"><Info size={15} style={{verticalAlign:'middle',marginRight:7}}/>Settings have changed. The chart below is from the previous successful analysis. Run Analysis to update it.</div>}
   {result?<>
    {result.images?.length?result.images.map(chart=><section key={chart.expiry} style={{marginBottom:32}}><h3 style={{marginBottom:12}}>Expiry: {chart.expiry}</h3><img className="analysis-image" src={chart.image} alt={`TAIFEX V4 analytics for ${chart.expiry}`}/>{Object.keys(chart.meta||{}).length>0&&<pre className="result-meta">{JSON.stringify(chart.meta,null,2)}</pre>}</section>):<img className="analysis-image" src={result.image} alt="TAIFEX V4 option analytics charts"/>}
    {mode==='poc'&&result.csv&&<p><a className="analysis-button" href={result.csv} download={`LF_MTX_VP_${s.date1}_${String(result.meta?.expiry||'AUTO')}_${s.pocSession}.csv`}>Download Profile CSV</a></p>}
    {Object.keys(result.meta||{}).length>0&&<pre className="result-meta">{JSON.stringify(result.meta,null,2)}</pre>}
    <p className="analysis-note">{result.note}</p>
   </>:<div className="plot-empty">No results yet. Load available expiries and click Run Analysis.</div>}
   <p className="analysis-note">MTX Volume Profile uses tick-by-tick traded volume (B+S / 2). Day vs Night dates are independent. Night Volume / Day OI are shown in the top row. Institutional charts use the original V4 daily data logic.</p>
  </div>
 </>;
}
