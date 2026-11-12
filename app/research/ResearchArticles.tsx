'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ClipboardEvent, ChangeEvent } from 'react';
import { ImagePlus, Paperclip, Plus, Upload, ArrowLeft, Pencil, Trash2, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './research-articles.css';

type Attachment = {path:string;name:string};
type Article = {path:string;slug:string;title:string;summary:string;date:string;folder:string;content?:string;attachments?:Attachment[]};
type StorageItem = {name:string;path?:string;id?:string|null;is_folder?:boolean};
const API=(process.env.NEXT_PUBLIC_API_BASE_URL||'https://little-foxing-option-trade.onrender.com').replace(/\/$/,'');
const field:CSSProperties={width:'100%',padding:11,border:'1px solid var(--border,#8885)',borderRadius:9,background:'transparent',color:'inherit'};
const btn:CSSProperties={padding:'9px 12px',border:'1px solid var(--border,#8885)',borderRadius:9,background:'transparent',color:'inherit',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7};
async function api(url:string,init?:RequestInit){
 const r=await fetch(`${API}${url}`,{cache:'no-store',...init});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:`HTTP ${r.status}`);
 return j;
}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function Markdown({content}:{content:string}){
 return <div className="research-article-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
  img:({src,alt})=><img src={src||''} alt={alt||''} loading="lazy" style={{maxWidth:'100%',height:'auto',borderRadius:8}} />,
  a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
 }}>{content}</ReactMarkdown></div>;
}
export default function ResearchArticles({folder,adminPassword,onChanged,hasOtherItems=false}:{folder:string;adminPassword:string;onChanged?:()=>void;hasOtherItems?:boolean}){
 const [articles,setArticles]=useState<Article[]>([]);
 const [articleId,setArticleId]=useState('');
 const [current,setCurrent]=useState<Article|null>(null);
 const [editing,setEditing]=useState(false);
 const [preview,setPreview]=useState(false);
 const [title,setTitle]=useState('');const [summary,setSummary]=useState('');const [date,setDate]=useState(today);
 const [content,setContent]=useState('');const [attachments,setAttachments]=useState<Attachment[]>([]);
 const [available,setAvailable]=useState<StorageItem[]>([]);
 const [showPicker,setShowPicker]=useState(false);
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const editorRef=useRef<HTMLTextAreaElement>(null);
 const imageRef=useRef<HTMLInputElement>(null);const attachRef=useRef<HTMLInputElement>(null);
 const refresh=useCallback(async()=>{
  try{const data=await api(`/research/articles?folder=${encodeURIComponent(folder)}`);setArticles(data.articles||[])}
  catch(e){setError(e instanceof Error?e.message:String(e))}
 },[folder]);
 useEffect(()=>{void refresh();setCurrent(null);setEditing(false);setShowPicker(false)},[refresh]);
 async function open(a:Article){setBusy(true);setError('');try{setCurrent(await api(`/research/articles/item?path=${encodeURIComponent(a.path)}`));setEditing(false)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 function start(a?:Article){setArticleId(a?.slug||('article-'+Array.from(crypto.getRandomValues(new Uint8Array(12))).map(x=>x.toString(16).padStart(2,'0')).join('')));setCurrent(a||null);setTitle(a?.title||'');setSummary(a?.summary||'');setDate(a?.date||today());setContent(a?.content||'');setAttachments(a?.attachments||[]);setPreview(false);setEditing(true);setError('')}
 async function upload(file:File,kind:'image'|'attachment'){
  if(!adminPassword)throw new Error('請先啟用 Admin Mode');
  const body=new FormData();body.append('file',file);body.append('folder',folder);body.append('kind',kind);if(articleId&&(!current||current.path.includes('/.lf-articles/')))body.append('article_id',articleId);
  return api('/research/articles/upload',{method:'POST',headers:{'X-Research-Password':adminPassword},body});
 }
 function insertMarkdown(text:string){
  const el=editorRef.current;
  if(!el){setContent(v=>v+'\n'+text);return}
  const start=el.selectionStart,end=el.selectionEnd;
  setContent(v=>v.slice(0,start)+text+v.slice(end));
  requestAnimationFrame(()=>{el.focus();el.setSelectionRange(start+text.length,start+text.length)});
 }
 async function addImages(files:File[]){
  if(!files.length)return;
  setBusy(true);setError('');
  try{for(const file of files){const data=await upload(file,'image');const url=`${API}${data.url}`;insertMarkdown(`\n![${file.name.replace(/[\[\]]/g,'')}](${url})\n`);}}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 async function addAttachments(files:File[]){
  if(!files.length)return;
  setBusy(true);setError('');
  try{const added:Attachment[]=[];for(const file of files){const data=await upload(file,'attachment');added.push({path:data.path,name:data.name})}setAttachments(v=>[...v,...added]);}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 function onPaste(e:ClipboardEvent<HTMLTextAreaElement>){
  const images=Array.from(e.clipboardData.items).filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter((x):x is File=>x!==null);
  if(images.length){e.preventDefault();void addImages(images)}
 }
 async function pickExisting(){
  setError('');setShowPicker(v=>!v);
  try{const data=await api('/research/tree');setAvailable((data.items||[]).filter((x:StorageItem)=>x.id!=null&&!x.path?.includes('/.lf-assets/')&&!x.path?.includes('/.lf-articles/')&&!x.name.endsWith('.lfarticle.json')))}
  catch(e){setError(e instanceof Error?e.message:String(e))}
 }
 async function save(){
  if(!adminPassword){setError('請先啟用 Admin Mode');return}
  setBusy(true);setError('');
  try{
   const url=current?`/research/articles/item?path=${encodeURIComponent(current.path)}`:'/research/articles';
   const result=await api(url,{method:current?'PUT':'POST',headers:{'Content-Type':'application/json','X-Research-Password':adminPassword},body:JSON.stringify({folder,title,summary,date,content,attachments,slug:articleId})});
   await refresh();await open({path:result.path} as Article);onChanged?.();
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 async function remove(){
  if(!current||!adminPassword||!window.confirm(`確定刪除文章「${current.title}」？附件檔案不會自動刪除。`))return;
  setBusy(true);setError('');
  try{await api('/research/files',{method:'DELETE',headers:{'Content-Type':'application/json','X-Research-Password':adminPassword},body:JSON.stringify({paths:[current.path]})});setCurrent(null);await refresh();onChanged?.()}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 async function download(a:Attachment){
  setBusy(true);setError('');
  try{const r=await fetch(`${API}/research/download?path=${encodeURIComponent(a.path)}`);if(!r.ok)throw new Error(`下載失敗 HTTP ${r.status}`);const blob=await r.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=a.name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 return <div className="lf-article-list">
  <div className="lf-article-actions">
   <strong>{articles.length > 0 ? "Research Articles" : ""}</strong>
   {adminPassword&&<button type="button" style={btn} onClick={()=>start()} disabled={busy}><Plus size={16}/> New Article</button>}
  </div>
  {error&&<p role="alert" style={{color:'#d65c5c',overflowWrap:'anywhere'}}>{error}</p>}
  {editing?<div className="lf-article-editor">
   <h2>{current?'Edit Article':'New Research Article'}</h2>
   <label>Article Title<input style={field} value={title} onChange={e=>setTitle(e.target.value)} maxLength={200}/></label>
   <label>Date<input style={field} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label>Summary<textarea style={field} rows={2} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
   <label>Markdown Content<textarea ref={editorRef} style={{...field,fontFamily:'ui-monospace,monospace',minHeight:260}} value={content} onChange={e=>setContent(e.target.value)} onPaste={onPaste} placeholder="撰寫 Markdown；可直接 Ctrl+V 貼上截圖"/></label>
   <div className="lf-article-buttons">
    <button type="button" style={btn} disabled={busy} onClick={()=>imageRef.current?.click()}><ImagePlus size={16}/> 插入圖片</button>
    <button type="button" style={btn} disabled={busy} onClick={()=>attachRef.current?.click()}><Upload size={16}/> 上傳附件</button>
    <button type="button" style={btn} disabled={busy} onClick={()=>void pickExisting()}><Paperclip size={16}/> 選擇既有檔案</button>
    <input ref={imageRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>{void addImages(Array.from(e.target.files||[]));e.target.value=''}}/>
    <input ref={attachRef} hidden type="file" multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>{void addAttachments(Array.from(e.target.files||[]));e.target.value=''}}/>
   </div>
   {showPicker&&<div className="lf-article-picker"><strong>選擇已存在的檔案</strong>{available.map(a=><button type="button" key={a.path} style={btn} disabled={attachments.some(x=>x.path===a.path)} onClick={()=>setAttachments(v=>[...v,{path:a.path||a.name,name:a.name}])}>{a.path}</button>)}</div>}
   {attachments.length>0&&<div><strong>文章附件</strong>{attachments.map(a=><div className="lf-article-attachment" key={a.path}><Paperclip size={15}/><span>{a.name}</span><button type="button" style={btn} onClick={()=>setAttachments(v=>v.filter(x=>x.path!==a.path))}>移除關聯</button></div>)}</div>}
   <div className="lf-article-buttons">
    <button type="button" style={btn} onClick={()=>setPreview(v=>!v)}>{preview?'隱藏預覽':'預覽 Markdown'}</button>
    <button type="button" style={btn} disabled={busy||!title.trim()||!content.trim()} onClick={()=>void save()}>{busy?'處理中…':'儲存文章'}</button>
    <button type="button" style={btn} onClick={()=>{setEditing(false);setError('')}}>取消</button>
   </div>
   {preview&&<Markdown content={content}/>}
  </div>:current?<article className="lf-article-reader">
   <button type="button" style={btn} onClick={()=>setCurrent(null)}><ArrowLeft size={16}/> 返回資料夾文章</button>
   <h2>{current.title}</h2><p className="muted small">{current.date} · {current.summary}</p>
   <Markdown content={current.content||''}/>
   {!!current.attachments?.length&&<section className="lf-article-attachments"><h3>Attachments · 附件下載</h3>{current.attachments.map(a=><button type="button" style={btn} key={a.path} onClick={()=>void download(a)} disabled={busy}><Download size={16}/>{a.name}</button>)}</section>}
   {adminPassword&&<div className="lf-article-buttons"><button type="button" style={btn} onClick={()=>start(current)}><Pencil size={16}/> 編輯文章</button><button type="button" style={btn} onClick={()=>void remove()}><Trash2 size={16}/> 刪除文章</button></div>}
  </article>:<div className="lf-article-cards">{articles.map(a=><button type="button" className="lf-article-card" key={a.path} onClick={()=>void open(a)} disabled={busy}><span className="lf-card-date">{a.date} · RESEARCH</span><span><strong>{a.title}</strong><small>{a.summary||'Markdown 研究文章'}</small></span></button>)}{articles.length===0&&!hasOtherItems&&!adminPassword&&<p className="muted small">This folder is empty</p>}</div>}
 </div>
}
