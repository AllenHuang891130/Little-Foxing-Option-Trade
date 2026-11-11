'use client';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './research-articles.css';

type Article = {path:string;slug:string;title:string;summary:string;date:string;folder:string;content?:string};
const API = (process.env.NEXT_PUBLIC_API_BASE_URL || 'https://little-foxing-option-trade.onrender.com').replace(/\/$/, '');
const style:React.CSSProperties = {width:'100%',padding:10,border:'1px solid var(--border,#8885)',borderRadius:8,background:'transparent',color:'inherit'};
const button:React.CSSProperties = {padding:'9px 13px',border:'1px solid var(--border,#8885)',borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'};
async function api(url:string, init?:RequestInit){
  const r=await fetch(`${API}${url}`,{cache:'no-store',...init});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:`HTTP ${r.status}`);
  return j;
}
export default function ResearchArticles({folder,adminPassword,onChanged}:{folder:string;adminPassword:string;onChanged?:()=>void}){
 const [articles,setArticles]=useState<Article[]>([]);
 const [current,setCurrent]=useState<Article|null>(null);
 const [editing,setEditing]=useState(false);
 const [preview,setPreview]=useState(false);
 const [title,setTitle]=useState('');const [summary,setSummary]=useState('');
 const [date,setDate]=useState(()=>new Date().toLocaleDateString('en-CA'));
 const [content,setContent]=useState('');
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
  try {const data=await api(`/research/articles?folder=${encodeURIComponent(folder)}`);setArticles(data.articles||[])}
  catch(e){setError(e instanceof Error?e.message:String(e))}
 },[folder]);
 useEffect(()=>{void refresh();setCurrent(null);setEditing(false)},[refresh]);
 const open=async (a:Article)=>{
  setError('');setBusy(true);
  try{setCurrent(await api(`/research/articles/item?path=${encodeURIComponent(a.path)}`));setEditing(false);setPreview(false)}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 const start=(a?:Article)=>{
  setCurrent(a||null);setTitle(a?.title||'');setSummary(a?.summary||'');
  setDate(a?.date||new Date().toLocaleDateString('en-CA'));setContent(a?.content||'');setPreview(false);setEditing(true);setError('');
 };
 const save=async()=>{
  if(!adminPassword){setError('請先啟用 Admin Mode');return}
  setBusy(true);setError('');
  try{
   const edit=!!current;
   const url=edit?`/research/articles/item?path=${encodeURIComponent(current!.path)}`:'/research/articles';
   const result=await api(url,{method:edit?'PUT':'POST',headers:{'Content-Type':'application/json','X-Research-Password':adminPassword},body:JSON.stringify({folder,title,summary,date,content})});
   await refresh();setEditing(false);await open({path:result.path||current!.path} as Article);onChanged?.();
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 const remove=async()=>{
  if(!current||!adminPassword||!window.confirm(`確定刪除「${current.title}」？`))return;
  setBusy(true);setError('');
  try{await api('/research/files',{method:'DELETE',headers:{'Content-Type':'application/json','X-Research-Password':adminPassword},body:JSON.stringify({paths:[current.path]})});setCurrent(null);setEditing(false);await refresh();onChanged?.()}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 return <section className="research-articles-panel">
  <div className="research-articles-toolbar"><strong>Research Articles · Markdown</strong>
   {adminPassword&&<button style={button} onClick={()=>start()} disabled={busy}>+ New Article</button>}
  </div>
  {error&&<p role="alert" style={{color:'#d65c5c'}}>{error}</p>}
  {editing?<div style={{display:'grid',gap:12}}>
   <label>標題<input style={style} value={title} onChange={e=>setTitle(e.target.value)} maxLength={200}/></label>
   <label>日期<input style={style} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label>摘要<textarea style={style} rows={2} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
   <label>Markdown 內文<textarea style={{...style,fontFamily:'monospace'}} rows={14} value={content} onChange={e=>setContent(e.target.value)}/></label>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    <button style={button} onClick={()=>setPreview(v=>!v)}>{preview?'隱藏預覽':'預覽 Markdown'}</button>
    <button style={button} disabled={busy||!title.trim()||!content.trim()} onClick={()=>void save()}>{busy?'儲存中…':'儲存文章'}</button>
    <button style={button} onClick={()=>setEditing(false)}>取消</button>
   </div>
   {preview&&<div className="research-article-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>}
  </div>:current?<div>
   <button style={button} onClick={()=>setCurrent(null)}>← 返回文章列表</button>
   <h2 style={{marginTop:20}}>{current.title}</h2><p style={{opacity:.65}}>{current.date} · {current.summary}</p>
   <div className="research-article-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{current.content||''}</ReactMarkdown></div>
   {adminPassword&&<div style={{display:'flex',gap:8,marginTop:16}}><button style={button} onClick={()=>start(current)}>編輯文章</button><button style={{...button,color:'#d65c5c'}} onClick={()=>void remove()}>刪除文章</button></div>}
  </div>:<div style={{display:'grid',gap:8}}>
   {articles.length===0?<p style={{opacity:.65}}>這個資料夾目前沒有 Markdown 文章。</p>:articles.map(a=><button key={a.path} style={{...button,textAlign:'left'}} onClick={()=>void open(a)}><strong>{a.title}</strong><div style={{fontSize:12,opacity:.65}}>{a.date} · {a.summary}</div></button>)}
  </div>}
 </section>
}
