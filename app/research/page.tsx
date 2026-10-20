'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import {
  ArrowLeft, Download, ExternalLink, FileText, Folder, FolderPlus,
  Home, LockKeyhole, LogOut, MoveRight, Pencil, RefreshCw,
  Search, Trash2, Upload, X
} from 'lucide-react';

const API = 'https://little-foxing-option-trade.onrender.com';

type StorageItem = {
  name: string;
  id?: string | null;
  path?: string;
  is_folder?: boolean;
  metadata?: { size?: number; mimetype?: string } | null;
};

const buttonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, padding: '9px 12px', border: '1px solid var(--border, #8885)',
  borderRadius: 9, background: 'transparent', color: 'inherit',
  cursor: 'pointer', fontSize: 13
};
const iconButton: CSSProperties = { ...buttonStyle, padding: 8 };
const inputStyle: CSSProperties = {
  width: '100%', padding: 12, borderRadius: 9,
  border: '1px solid var(--border, #8885)', background: 'transparent', color: 'inherit'
};

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}
function parentPath(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}
function basename(path: string): string {
  return path.split('/').at(-1) || '';
}
function validName(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' &&
    !name.includes('/') && !name.includes('\\') && name !== '.folder';
}
function validFolder(path: string): boolean {
  return !path || path.split('/').every(validName);
}
function isFolder(item: StorageItem): boolean {
  return item.is_folder === true || item.id == null;
}
function isPdf(item: StorageItem): boolean {
  return item.name.toLowerCase().endsWith('.pdf');
}
function getError(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    return String((data as { detail: unknown }).detail);
  }
  return `Request failed (${status})`;
}

export default function Research() {
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<StorageItem[]>([]);
  const [tree, setTree] = useState<StorageItem[]>([]);
  const [search, setSearch] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const admin = adminPassword.length > 0;

  const request = useCallback(async (
    path: string, init: RequestInit = {}, credential?: string
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (credential) headers.set('X-Research-Password', credential);
    const response = await fetch(`${API}${path}`, { ...init, headers, cache: 'no-store' });
    if (!response.ok) {
      let data: unknown = null;
      try { data = await response.json(); } catch { /* Non-JSON response */ }
      throw new Error(getError(data, response.status));
    }
    return response;
  }, []);

  const load = useCallback(async (target: string) => {
    setBusy(true);
    setError('');
    try {
      const response = await request(`/research/files?folder=${encodeURIComponent(target)}`);
      const data: { items?: StorageItem[] } = await response.json();
      setItems((data.items || []).filter(item =>
        item.name !== '.folder' && item.name !== '.emptyFolderPlaceholder'
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load files');
    } finally { setBusy(false); }
  }, [request]);

  const loadTree = useCallback(async () => {
    const response = await request('/research/tree');
    const data: { items?: StorageItem[] } = await response.json();
    const result = (data.items || []).filter(item =>
      item.name !== '.folder' && item.name !== '.emptyFolderPlaceholder'
    );
    setTree(result);
    return result;
  }, [request]);

  useEffect(() => { void load(folder); }, [folder, load]);
  useEffect(() => {
    void loadTree().catch(() => { /* Folder browsing remains available */ });
  }, [loadTree]);
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview.url); };
  }, [preview]);

  async function enterAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordInput.trim()) return;
    setBusy(true);
    setError('');
    try {
      await request('/research/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: '.admin-password-check', destination: '.admin-password-check'
        })
      }, passwordInput);
      setAdminPassword(passwordInput);
      setPasswordInput('');
      setShowAdminLogin(false);
      setMessage('Admin Mode enabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid administrator password');
    } finally { setBusy(false); }
  }

  async function perform(action: () => Promise<void>, success: string) {
    if (!adminPassword) { setError('Admin Mode is required.'); return; }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      
      await loadTree();
      await load(folder);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally { setBusy(false); }
  }

  async function postJson(path: string, body: object, method = 'POST') {
    await request(path, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }, adminPassword);
  }

  async function checkDestination(destination: string, source: string, folderMove: boolean) {
    const all = await loadTree();
    if (destination === source) throw new Error('Source and destination are identical.');
    if (all.some(item => item.path === destination)) {
      throw new Error('Destination already exists. Choose a different name.');
    }
    if (folderMove) {
      if (destination.startsWith(source + '/')) {
        throw new Error('Cannot move a folder inside itself.');
      }
      const descendants = all.filter(item => item.path?.startsWith(source + '/'));
      for (const item of descendants) {
        const next = destination + item.path!.slice(source.length);
        if (all.some(other => other.path === next && !other.path.startsWith(source + '/'))) {
          throw new Error(`Destination conflict: ${next}`);
        }
      }
    }
  }

  function createFolder() {
    if (!admin) return;
    const name = window.prompt('New folder name:')?.trim();
    if (!name) return;
    if (!validName(name)) { setError('Invalid folder name.'); return; }
    const path = joinPath(folder, name);
    void perform(async () => {
      const all = await loadTree();
      if (all.some(item => item.path === path)) throw new Error('Folder already exists.');
      await postJson('/research/folder', { path });
    }, 'Folder created successfully.');
  }

  function uploadFiles(files: File[]) {
    if (!admin || !files.length) return;
    void perform(async () => {
      const all = await loadTree();
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} exceeds 25 MB.`);
        if (!validName(file.name)) throw new Error(`Invalid filename: ${file.name}`);
        if (all.some(item => item.path === joinPath(folder, file.name))) {
          throw new Error(`File already exists: ${file.name}`);
        }
      }
      for (const file of files) {
        const body = new FormData();
        body.append('file', file);
        body.append('folder', folder);
        await request('/research/upload', { method: 'POST', body }, adminPassword);
      }
    }, 'Files uploaded successfully.');
  }

  async function downloadFile(item: StorageItem, path: string) {
    setBusy(true);
    setError('');
    try {
      const response = await request(`/research/download?path=${encodeURIComponent(path)}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally { setBusy(false); }
  }

  async function openPdf(item: StorageItem, path: string) {
    setBusy(true);
    setError('');
    try {
      const response = await request(`/research/download?path=${encodeURIComponent(path)}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      setPreview({ name: item.name, url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview PDF');
    } finally { setBusy(false); }
  }

  function renameItem(item: StorageItem, source: string) {
    if (!admin) return;
    const nextName = window.prompt('New name:', item.name)?.trim();
    if (!nextName || nextName === item.name) return;
    if (!validName(nextName)) { setError('Invalid name.'); return; }
    const destination = joinPath(parentPath(source), nextName);
    const folderItem = isFolder(item);
    void perform(async () => {
      await checkDestination(destination, source, folderItem);
      if (folderItem) await postJson('/research/folder/move', { source, destination });
      else await postJson('/research/move', { source, destination });
    }, `${folderItem ? 'Folder' : 'File'} renamed successfully.`);
  }

  function moveItem(item: StorageItem, source: string) {
    if (!admin) return;
    const targetFolder = window.prompt(
      'Destination folder path (leave blank for root):', parentPath(source)
    );
    if (targetFolder === null) return;
    const target = targetFolder.trim().replace(/^\/+|\/+$/g, '');
    if (!validFolder(target)) { setError('Invalid destination folder path.'); return; }
    const destination = joinPath(target, item.name);
    const folderItem = isFolder(item);
    void perform(async () => {
      const all = await loadTree();
      if (target && !all.some(x => x.path === target && isFolder(x))) {
        throw new Error('Destination folder does not exist. Create it first.');
      }
      await checkDestination(destination, source, folderItem);
      if (folderItem) await postJson('/research/folder/move', { source, destination });
      else await postJson('/research/move', { source, destination });
    }, `${folderItem ? 'Folder' : 'File'} moved successfully.`);
  }

  function deleteItem(item: StorageItem, path: string) {
    if (!admin) return;
    const folderItem = isFolder(item);
    const question = folderItem
      ? `Permanently delete folder "${item.name}" and ALL files and subfolders inside it? This cannot be undone.`
      : `Permanently delete file "${item.name}"? This cannot be undone.`;
    if (!window.confirm(question)) return;
    if (folderItem && window.prompt(`Type DELETE to confirm deletion of "${item.name}":`) !== 'DELETE') return;
    void perform(async () => {
      if (folderItem) await postJson('/research/folder', { folder: path }, 'DELETE');
      else await postJson('/research/files', { paths: [path] }, 'DELETE');
    }, `${folderItem ? 'Folder' : 'File'} deleted successfully.`);
  }

  
  function navigateTo(path: string) {
    setSearch('');
    setMessage('');
    setError('');
    setFolder(path);
  
    // Always refresh, including when clicking Home at root.
    void load(path);
  }


  const query = search.trim().toLocaleLowerCase();
  const visible: StorageItem[] = (query ? tree : items)
    .filter(item => (query ? (item.path || item.name) : item.name)
      .toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (isFolder(a) !== isFolder(b)) return isFolder(a) ? -1 : 1;
      return (a.path || a.name).localeCompare(b.path || b.name);
    });

  return (
    <>
      <div className="eyebrow">KNOWLEDGE / LITERATURE</div>
      <h1 className="pagetitle">Research Library</h1>
      <p className="subtitle">Browse academic papers, trading strategies, research reports, and notes.</p>

      <div className="panel" style={{ padding: 16, marginBottom: 16, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Folder size={21} />
          <div><strong>Research Files</strong>
            <div className="muted small">{admin ? 'Administrator Access' : 'Public Access'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {admin && <>
            <button type="button" style={buttonStyle} disabled={busy} onClick={createFolder}>
              <FolderPlus size={16} /> New Folder
            </button>
            <button type="button" style={buttonStyle} disabled={busy}
              onClick={() => inputRef.current?.click()}><Upload size={16} /> Upload Files</button>
          </>}
          <button type="button" title="Refresh" style={iconButton} disabled={busy}
            onClick={() => { void load(folder); void loadTree().catch(() => {}); }}>
            <RefreshCw size={17} />
          </button>
          {admin ? <button type="button" style={buttonStyle} onClick={() => {
            setAdminPassword(''); setPasswordInput(''); setMessage('Admin Mode disabled.');
          }}><LogOut size={16} /> Exit Admin Mode</button> :
            <button type="button" style={buttonStyle} onClick={() => {
              setShowAdminLogin(value => !value); setError('');
            }}><LockKeyhole size={16} /> Admin Mode</button>}
          <input ref={inputRef} type="file" multiple hidden onChange={event => {
            const selected = Array.from(event.target.files || []);
            event.target.value = '';
            uploadFiles(selected);
          }} />
        </div>
      </div>

      {!admin && showAdminLogin && <div className="panel"
        style={{ padding: 20, marginBottom: 16, maxWidth: 460 }}>
        <h2>Administrator Login</h2>
        <p className="muted small">File management requires a password. Browsing is public.</p>
        <form onSubmit={enterAdmin} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <input type="password" value={passwordInput} style={inputStyle} required
            placeholder="Administrator password" autoComplete="off"
            onChange={event => setPasswordInput(event.target.value)} />
          <button type="submit" disabled={busy} style={buttonStyle}>
            <LockKeyhole size={16} /> {busy ? 'Verifying...' : 'Enable Admin Mode'}
          </button>
        </form>
      </div>}

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <button type="button" style={buttonStyle} onClick={() => navigateTo('')}>
            <Home size={16} /> Home
          </button>
          {folder && <button type="button" style={buttonStyle}
            onClick={() => navigateTo(parentPath(folder))}>
            <ArrowLeft size={16} /> Back
          </button>}
          <span className="muted small">/ {folder || 'All Research Files'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          border: '1px solid var(--border, #8885)', borderRadius: 9, marginBottom: 8 }}>
          <Search size={18} />
          <input value={search} onChange={event => setSearch(event.target.value)}
            placeholder="Search all files and folders..."
            style={{ border: 'none', outline: 'none', background: 'transparent',
              color: 'inherit', width: '100%' }} />
        </div>
        <p className="muted small" style={{ marginBottom: 16 }}>
          {query ? `Global search: ${visible.length} matching items` : 'Showing current folder'}
        </p>
        {error && <p style={{ color: '#dc5252', marginBottom: 12, overflowWrap: 'anywhere' }}>{error}</p>}
        {message && <p style={{ marginBottom: 12 }}>{message}</p>}
        {busy && <p className="muted small">Loading...</p>}
        {!busy && visible.length === 0 && <div style={{ textAlign: 'center', padding: 40 }}>
          <Folder size={32} style={{ opacity: .5 }} />
          <p>{query ? 'No matching results' : 'This folder is empty'}</p>
        </div>}
        <div style={{ display: 'grid', gap: 8 }}>
          {visible.map(item => {
            const path = item.path || joinPath(folder, item.name);
            const folderItem = isFolder(item);
            return <div key={path} style={{ display: 'flex', alignItems: 'center',
              gap: 12, padding: 12, flexWrap: 'wrap',
              border: '1px solid var(--border, #8885)', borderRadius: 10 }}>
              {folderItem ? <Folder size={22} /> : <FileText size={22} />}
              <button type="button" style={{ border: 'none', background: 'transparent',
                color: 'inherit', textAlign: 'left', cursor: 'pointer',
                flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}
                onClick={() => folderItem ? navigateTo(path) :
                  isPdf(item) ? void openPdf(item, path) : void downloadFile(item, path)}>
                <strong>{item.name}</strong>
                <div className="muted small">{query ? path : folderItem ? 'Folder' :
                  `${((item.metadata?.size || 0) / 1024).toFixed(1)} KB`}</div>
              </button>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!folderItem && <button type="button" title="Download" style={iconButton}
                  disabled={busy} onClick={() => void downloadFile(item, path)}>
                  <Download size={17} /></button>}
                {admin && <>
                  <button type="button" title="Rename" style={iconButton} disabled={busy}
                    onClick={() => renameItem(item, path)}><Pencil size={17} /></button>
                  <button type="button" title="Move" style={iconButton} disabled={busy}
                    onClick={() => moveItem(item, path)}><MoveRight size={17} /></button>
                  <button type="button" title="Delete" style={iconButton} disabled={busy}
                    onClick={() => deleteItem(item, path)}><Trash2 size={17} /></button>
                </>}
              </div>
            </div>;
          })}
        </div>
      </div>

      {preview && <div role="dialog" aria-modal="true" aria-label="PDF preview"
        style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.83)',
          display: 'flex', flexDirection: 'column', padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'white',
          marginBottom: 10, flexWrap: 'wrap' }}>
          <strong style={{ flex: 1, overflowWrap: 'anywhere' }}>{preview.name}</strong>
          <a href={preview.url} target="_blank" rel="noopener noreferrer"
            style={{ ...buttonStyle, color: 'white' }}><ExternalLink size={16} /> New Tab</a>
          <button type="button" style={{ ...buttonStyle, color: 'white' }}
            onClick={() => setPreview(null)}><X size={16} /> Close</button>
        </div>
        <iframe title={preview.name} src={preview.url}
          style={{ flex: 1, width: '100%', border: 'none', background: 'white', borderRadius: 8 }} />
      </div>}
      <p className="muted small" style={{ marginTop: 16 }}>
        Files are stored in Supabase Storage. Public browsing and downloading are enabled.
        Admin actions require a password. Maximum upload size: 25 MB per file.
      </p>
    </>
  );
}
