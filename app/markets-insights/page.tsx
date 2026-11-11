'use client';
import {useEffect,useMemo,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown.css';
import {BookOpen,CalendarDays,FileText,Upload,ArrowLeft,Search,RefreshCw,ExternalLink,ChevronDown,Trash2} from 'lucide-react';

type Category='daily'|'bonds'|'research';
type Article={slug:string;title:string;date:string;category:Category;summary:string;content?:string;file_name?:string;file_url?:string};
const API=(process.env.NEXT_PUBLIC_API_BASE_URL||'https://little-foxing-option-trade.onrender.com').replace(/\/$/,'');
const tabs:{key:Category|'all';label:string;sub:string}[]=[{key:'all',label:'All Insights',sub:'所有內容'},{key:'daily',label:'Daily Brief',sub:'每日國際金融早報'},{key:'bonds',label:'Bond Weekly',sub:'全球債市週報'},{key:'research',label:'My Research',sub:'個人研究與觀點'}];
const panel:React.CSSProperties={border:'1px solid var(--border,#8884)',borderRadius:14,padding:18,background:'var(--card,transparent)'};
const field:React.CSSProperties={width:'100%',padding:'11px 12px',border:'1px solid var(--border,#8885)',borderRadius:9,background:'transparent',color:'inherit'};
const btn:React.CSSProperties={padding:'10px 15px',border:'1px solid var(--border,#8885)',borderRadius:9,background:'transparent',color:'inherit',cursor:'pointer'};
function errorMessage(e:unknown){return e instanceof Error?e.message:String(e)}
async function readJson(url:string,init?:RequestInit){const r=await fetch(url,{cache:'no-store',...init});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:`HTTP ${r.status}`);return j;}
function toBase64(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('無法讀取檔案'));reader.readAsDataURL(file);});}
export default function MarketsInsightsPage(){
 const [tab,setTab]=useState<Category|'all'>('all');const [articles,setArticles]=useState<Article[]>([]);const [selected,setSelected]=useState<Article|null>(null);
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [search,setSearch]=useState('');const [showPublish,setShowPublish]=useState(false);
 const [key,setKey]=useState('');const [category,setCategory]=useState<Category>('research');const [title,setTitle]=useState('');const [date,setDate]=useState(new Date().toLocaleDateString('en-CA'));
 const [deleteKey,setDeleteKey]=useState('');const [deleting,setDeleting]=useState(false);const [deleteNotice,setDeleteNotice]=useState('');
 const [summary,setSummary]=useState('');const [content,setContent]=useState('');const [file,setFile]=useState<File|null>(null);const [saving,setSaving]=useState(false);
 async function reload(){setLoading(true);setError('');try{const data=await readJson(`${API}/api/insights/articles`);setArticles(data.articles||[]);}catch(e){setError(errorMessage(e));}finally{setLoading(false);}}
 useEffect(()=>{void reload();},[]);
 const shown=useMemo(()=>articles.filter(a=>(tab==='all'||a.category===tab)&&`${a.title} ${a.summary} ${a.date}`.toLowerCase().includes(search.toLowerCase())),[articles,tab,search]);
 async function openArticle(a:Article){setError('');try{const full=await readJson(`${API}/api/insights/articles/${a.category}/${encodeURIComponent(a.slug)}`);setSelected(full);}catch(e){setError(errorMessage(e));}}
 async function deleteArticle(){
  if(!selected)return;
  if(!deleteKey.trim()){setError('請先輸入管理密鑰才能刪除文章');return;}
  if(!window.confirm(`確定要永久刪除「${selected.title}」嗎？\n此操作會刪除 GitHub 上的文章與附件（如有），且無法從網站復原。`))return;
  setDeleting(true);setError('');setDeleteNotice('');
  try{
   const result=await readJson(`${API}/api/insights/articles/${selected.category}/${encodeURIComponent(selected.slug)}`,{
    method:'DELETE',headers:{'X-Insights-Admin-Key':deleteKey}
   });
   setDeleteKey('');setSelected(null);
   setDeleteNotice(result.warning||'文章已刪除。');
   await reload();
  }catch(e){setError(errorMessage(e));}
  finally{setDeleting(false);}
 }
 async function publish(e:React.FormEvent){e.preventDefault();if(!key.trim()){setError('請輸入管理密鑰');return;}setSaving(true);setError('');try{if(file&&file.size>8*1024*1024)throw new Error('附件不可超過 8 MB');const file_base64=file?await toBase64(file):'';
 await readJson(`${API}/api/insights/articles`,{method:'POST',headers:{'Content-Type':'application/json','X-Insights-Admin-Key':key},body:JSON.stringify({category,title,date,summary,content,filename:file?.name||'',file_base64})});
 setTitle('');setSummary('');setContent('');setFile(null);setShowPublish(false);await reload();}catch(e){setError(errorMessage(e));}finally{setSaving(false);}}
 return <main style={{maxWidth:1240,margin:'0 auto',padding:'32px 24px 80px',color:'inherit'}}>
 <header style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'start',flexWrap:'wrap',marginBottom:28}}>
 <div><div style={{fontSize:12,letterSpacing:2,opacity:.55,marginBottom:7}}>LITTLE FOXING / RESEARCH CENTER</div><h1 style={{fontSize:32,fontWeight:700,margin:0}}>Markets Insights</h1><p style={{opacity:.65,marginTop:8}}>Daily intelligence · Fixed income · Independent research</p></div>
 <div style={{display:'flex',gap:8}}><button style={btn} onClick={()=>void reload()} aria-label="重新整理"><RefreshCw size={17}/></button><button style={btn} onClick={()=>setShowPublish(v=>!v)}><Upload size={15} style={{display:'inline',verticalAlign:'middle',marginRight:7}}/>Publish / Upload</button></div></header>
 {deleteNotice&&<div role="status" style={{...panel,marginBottom:18}}>{deleteNotice}</div>}
 {error&&<div role="alert" style={{...panel,borderColor:'#d97777',marginBottom:18,color:'#dc6868'}}>{error}</div>}
 {showPublish&&<form onSubmit={publish} style={{...panel,marginBottom:26,display:'grid',gap:12}}><h2 style={{fontSize:18,margin:0}}>發布研究內容</h2><p style={{fontSize:13,opacity:.65,margin:0}}>公開閱讀，只有持有管理密鑰者可以發布。附件限制 8 MB（PDF、DOCX、MD、TXT）。</p>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}><label>分類<select style={field} value={category} onChange={e=>setCategory(e.target.value as Category)}><option value="research">My Research</option><option value="daily">Daily Brief</option><option value="bonds">Bond Weekly</option></select></label><label>日期<input style={field} type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label></div>
 <label>標題<input style={field} required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="輸入文章標題"/></label>
 <label>摘要<textarea style={field} rows={2} value={summary} onChange={e=>setSummary(e.target.value)} placeholder="簡短摘要"/></label>
 <label>內文（純文字或 Markdown）<textarea style={field} rows={9} value={content} onChange={e=>setContent(e.target.value)} placeholder="在此撰寫研究觀點，也可以只附上檔案"/></label>
 <label>附件<input style={{...field,padding:8}} type="file" accept=".pdf,.docx,.md,.txt" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
 <label>管理密鑰<input style={field} type="password" required autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="只用於本次發布，不儲存在瀏覽器"/></label>
 <div><button style={{...btn,background:'var(--foreground,#222)',color:'var(--background,#fff)'}} type="submit" disabled={saving}>{saving?'正在發布…':'Publish Article'}</button></div></form>}
 {selected?<section><button style={{...btn,marginBottom:22}} onClick={()=>setSelected(null)}><ArrowLeft size={16} style={{display:'inline',verticalAlign:'middle',marginRight:7}}/>返回文章列表</button><article style={{...panel,padding:'clamp(20px,4vw,50px)'}}><div style={{fontSize:12,letterSpacing:1.4,opacity:.55}}>{selected.category.toUpperCase()} · {selected.date}</div><h2 style={{fontSize:30,margin:'14px 0'}}>{selected.title}</h2>{selected.summary&&<p style={{opacity:.7,fontSize:17,lineHeight:1.8}}>{selected.summary}</p>}<hr style={{border:0,borderTop:'1px solid var(--border,#8884)',margin:'24px 0'}}/><div className="insights-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{table:({children})=><div className="table-scroll"><table>{children}</table></div>}}>{selected.content||'本文附於下方檔案。'}</ReactMarkdown></div>{selected.file_url&&<div style={{marginTop:28}}><a href={selected.file_url} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',gap:7,textDecoration:'underline'}}><FileText size={17}/>查看／下載附件：{selected.file_name}<ExternalLink size={14}/></a>{selected.file_name?.toLowerCase().endsWith('.pdf')&&<iframe title="PDF 附件預覽" src={selected.file_url} style={{width:'100%',height:650,marginTop:16,border:'1px solid var(--border,#8885)',borderRadius:8}}/>}</div>}</article><div style={{...panel,marginTop:18,display:'grid',gap:10}}><h3 style={{fontSize:16,margin:0}}>文章管理</h3><p style={{fontSize:13,opacity:.65,margin:0}}>刪除需要管理密鑰，並會再次要求確認。一般讀者無法在沒有密鑰的情況下刪除。</p><label>管理密鑰<input style={field} type="password" autoComplete="off" value={deleteKey} onChange={e=>setDeleteKey(e.target.value)} placeholder="輸入管理密鑰以刪除這篇文章"/></label><div><button type="button" style={{...btn,borderColor:'#b94b4b',color:'#d65c5c'}} disabled={deleting} onClick={()=>void deleteArticle()}><Trash2 size={15} style={{display:'inline',verticalAlign:'middle',marginRight:7}}/>{deleting?'正在刪除…':'刪除這篇文章'}</button></div></div></section>:
 <><nav style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginBottom:24}}>{tabs.map(t=><button key={t.key} onClick={()=>setTab(t.key)} style={{...panel,textAlign:'left',cursor:'pointer',borderColor:tab===t.key?'var(--foreground,#aaa)':'var(--border,#8884)',background:tab===t.key?'var(--muted,#8881)':'transparent'}}><div style={{fontSize:14,fontWeight:650}}>{t.label}</div><div style={{fontSize:12,opacity:.55,marginTop:5}}>{t.sub}</div></button>)}</nav>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:14,marginBottom:20,flexWrap:'wrap'}}><h2 style={{fontSize:19,margin:0}}>Recent Publications <span style={{fontSize:13,opacity:.5}}>({shown.length})</span></h2><div style={{position:'relative',minWidth:230}}><Search size={15} style={{position:'absolute',left:11,top:12,opacity:.5}}/><input style={{...field,paddingLeft:35}} placeholder="搜尋標題、摘要、日期" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
 {loading?<p style={{opacity:.65}}>正在載入文章…</p>:shown.length===0?<div style={{...panel,textAlign:'center',padding:50}}><BookOpen size={32} style={{margin:'auto',opacity:.4}}/><h3>目前沒有符合條件的文章</h3><p style={{opacity:.6}}>可以使用 Publish / Upload 發布第一篇內容。</p></div>:
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(100%,320px),1fr))',gap:15}}>{shown.map(a=><button key={`${a.category}-${a.slug}`} onClick={()=>void openArticle(a)} style={{...panel,textAlign:'left',cursor:'pointer',minHeight:195,display:'flex',flexDirection:'column',gap:10}}><div style={{fontSize:11,letterSpacing:1.2,opacity:.55,display:'flex',alignItems:'center',gap:6}}><CalendarDays size={13}/>{a.date} · {a.category==='daily'?'DAILY BRIEF':a.category==='bonds'?'BOND WEEKLY':'RESEARCH'}</div><h3 style={{fontSize:19,lineHeight:1.45,margin:0}}>{a.title}</h3><p style={{fontSize:13,opacity:.65,lineHeight:1.7,margin:0,flex:1}}>{a.summary||'開啟閱讀完整內容'}</p><div style={{fontSize:12,opacity:.65,display:'flex',gap:6,alignItems:'center'}}>Read Insight <ChevronDown size={13} style={{transform:'rotate(-90deg)'}}/></div></button>)}</div>}</>}
 </main>;
}
