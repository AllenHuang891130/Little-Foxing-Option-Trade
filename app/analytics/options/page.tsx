'use client';
import {useState} from 'react';
import {RefreshCcw, Play, Info} from 'lucide-react';

type Mode='single'|'compare'|'cross'|'inst'|'daynight';
const modes:{id:Mode;label:string}[]=[
 {id:'single',label:'Single Day'}, {id:'compare',label:'Two Days'},
 {id:'cross',label:'Cross Expiry'}, {id:'inst',label:'Institutions'},
 {id:'daynight',label:'Day vs Night'}
];
type Result={image:string;meta:Record<string,unknown>;note:string};
function apiBase(){
 const configured=process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/,'');
 if(configured)return configured;
 if(typeof window==='undefined')return 'http://127.0.0.1:8000';
 // Connect to the Python server on the SAME machine as the Next.js frontend.
 return `${window.location.protocol}//${window.location.hostname}:8000`;
}
export default function Options(){
 const [mode,setMode]=useState<Mode>('daynight');
 const [date1,setDate1]=useState('2026-10-16');
 const [date2,setDate2]=useState('2026-10-19');
 const [expiry,setExpiry]=useState('202610');
 const [expiryOptions,setExpiryOptions]=useState<string[]>([]);
 const [selectedExpiries,setSelectedExpiries]=useState<string[]>([]);
 const [atmRange,setAtmRange]=useState('6');
 const [lookback,setLookback]=useState('20');
 const [force,setForce]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('Start the local Python API, then load available expiries.');
 const [result,setResult]=useState<Result|null>(null);
 const second=mode==='compare'||mode==='daynight';
 const body=()=>({mode,date1,date2:second?date2:null,expiry,expiries:selectedExpiries,
   range_pct:Number(atmRange),lookback:Number(lookback),force});
 async function request(path:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),180000);
  try{
   const response=await fetch(apiBase()+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body()),signal:controller.signal});
   const json=await response.json();
   if(!response.ok)throw new Error(typeof json.detail==='string'?json.detail:`HTTP ${response.status}`);
   return json;
  }finally{clearTimeout(timer)}
 }
 async function load(){
  setBusy(true);setMessage('Loading TAIFEX contract data...');setResult(null);
  try{
   const data=await request('/expiries');
   const values=data.expiries as string[];
   setExpiryOptions(values);
   if(values.length&&!values.includes(expiry))setExpiry(values[0]);
   setSelectedExpiries(old=>old.filter(v=>values.includes(v)).length?old.filter(v=>values.includes(v)):values.slice(0,3));
   setMessage(`Loaded ${values.length} expiry choices from TAIFEX/cache. Select an expiry and run analysis.`);
  }catch(e){setMessage(`Load failed: ${e instanceof Error?e.message:String(e)}. Check the Python server and data availability.`)}
  finally{setBusy(false)}
 }
 async function run(){
  setBusy(true);setResult(null);setMessage('Running V4 calculations. First-time TAIFEX downloads may take a while...');
  try{
   const data=await request('/analyze') as Result;
   setResult(data);setMessage('Analysis completed using V4 calculation functions.');
  }catch(e){setMessage(`Analysis failed: ${e instanceof Error?e.message:String(e)}`)}
  finally{setBusy(false)}
 }
 return <>
  <div className="eyebrow">MARKET ANALYTICS / OPTIONS</div>
  <h1 className="pagetitle">TXO / MTX Options Dashboard</h1>
  <p className="subtitle">V4 calculation engine · Official TAIFEX data · Black-76 IV</p>
  <div className="panel">
   <h2>Analysis Settings</h2>
   <div className="mode-tabs" role="group" aria-label="Analysis Mode">{modes.map(m=><button type="button" key={m.id} className={'mode-tab '+(mode===m.id?'selected':'')} aria-pressed={mode===m.id} onClick={()=>{setMode(m.id);setResult(null);setExpiryOptions([]);setMessage('Mode changed. Load available expiries before analysis.')}}>{m.label}</button>)}</div>
   <div className="fields">
    <label>{mode==='inst'?'Analysis Date':'Date 1 / Day Date'}<input type="date" value={date1} onChange={e=>setDate1(e.target.value)}/></label>
    {second&&<label>{mode==='daynight'?'Night Data Label Date':'Date 2'}<input type="date" value={date2} onChange={e=>setDate2(e.target.value)}/></label>}
    {mode!=='inst'&&(mode==='cross'?<label>Expiries (multiple)<select multiple size={4} value={selectedExpiries} onChange={e=>setSelectedExpiries(Array.from(e.target.selectedOptions).map(o=>o.value))}>{expiryOptions.map(x=><option key={x}>{x}</option>)}</select></label>:<label>Expiry<select value={expiry} onChange={e=>setExpiry(e.target.value)}>{!expiryOptions.includes(expiry)&&<option value={expiry}>{expiry}</option>}{expiryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></label>)}
    {mode==='inst'?<label>Lookback (Calendar Days)<input type="number" min="1" max="90" value={lookback} onChange={e=>setLookback(e.target.value)}/></label>:<label>Moneyness Range (%)<input type="number" min="1" max="30" value={atmRange} onChange={e=>setAtmRange(e.target.value)}/></label>}
   </div>
   <label className="cache-toggle"><input type="checkbox" checked={force} onChange={e=>setForce(e.target.checked)}/> Force refresh cached data</label>
   <div className="analysis-toolbar"><button disabled={busy} className="analysis-button" onClick={load}><RefreshCcw size={15} style={{verticalAlign:'middle',marginRight:7}}/>Load Dates / Expiries</button><button disabled={busy} className="analysis-button primary-action" onClick={run}><Play size={15} style={{verticalAlign:'middle',marginRight:7}}/>{busy?'Working...':'Run Analysis'}</button></div>
   <div className="notice" role="status"><Info size={15} style={{verticalAlign:'middle',marginRight:7}}/>{message}</div>
  </div>
  <div className="panel"><div className="sectiontitle"><h2>{modes.find(m=>m.id===mode)?.label} Analysis</h2><span>{result?'V4 results':'Waiting for analysis'}</span></div>
   {result?<><img className="analysis-image" src={result.image} alt="TAIFEX V4 option analytics charts"/>
    {Object.keys(result.meta).length>0&&<pre className="result-meta">{JSON.stringify(result.meta,null,2)}</pre>}
    <p className="analysis-note">{result.note}</p></>:<div className="plot-empty">No results yet. Start the local Python API and click Run Analysis.</div>}
   <p className="analysis-note">Day vs Night dates are independent. Night Volume / Day OI are shown in the top row. Institutional charts use the original V4 daily data logic.</p>
  </div>
 </>;
}
