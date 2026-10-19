
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Download, FileText, Folder, FolderPlus,
  Home, LockKeyhole, LogOut, Pencil, RefreshCw,
  Search, Trash2, Upload
} from 'lucide-react';

const API = 'https://little-foxing-option-trade.onrender.com';

type StorageItem = {
  name: string;
  id?: string | null;
  metadata?: {
    size?: number;
    mimetype?: string;
  } | null;
};

function joinPath(folder: string, name: string) {
  return folder ? `${folder}/${name}` : name;
}

function getError(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    return String((data as { detail: unknown }).detail);
  }
  return `Request failed (${status})`;
}

export default function Research() {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<StorageItem[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          'X-Research-Password': password,
          ...(init.headers || {})
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        let data: unknown = null;
        try {
          data = await response.json();
        } catch {
          // Keep the HTTP status if the response is not JSON.
        }

        throw new Error(getError(data, response.status));
      }

      return response;
    },
    [password]
  );

  const load = useCallback(
    async (target = folder) => {
      setBusy(true);
      setError('');

      try {
        const response = await request(
          `/research/files?folder=${encodeURIComponent(target)}`
        );
        const data = await response.json();

        const result: StorageItem[] = Array.isArray(data.items)
          ? data.items
          : [];

        setItems(
          result.filter(item =>
            item.name !== '.folder' &&
            item.name !== '.emptyFolderPlaceholder'
          )
        );
        setFolder(target);
        setUnlocked(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to load files'
        );
      } finally {
        setBusy(false);
      }
    },
    [folder, request]
  );

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim()) return;
    await load('');
  }

  useEffect(() => {
    if (!unlocked) return;

    // Reload when navigating to a new folder.
    void load(folder);
    // Folder navigation is initiated by the UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  function logout() {
    setPassword('');
    setUnlocked(false);
    setFolder('');
    setItems([]);
    setSearch('');
    setError('');
    setMessage('');
  }

  async function perform(
    action: () => Promise<void>,
    successMessage: string
  ) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await action();
      setMessage(successMessage);
      await load(folder);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Operation failed'
      );
    } finally {
      setBusy(false);
    }
  }

  function createFolder() {
    const name = window.prompt('New folder name:')?.trim();

    if (!name) return;

    if (
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      name.includes('\\')
    ) {
      setError('Invalid folder name');
      return;
    }

    void perform(
      async () => {
        await request('/research/folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: joinPath(folder, name)
          })
        });
      },
      'Folder created successfully'
    );
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;

    await perform(
      async () => {
        for (const file of Array.from(files)) {
          if (file.size > 25 * 1024 * 1024) {
            throw new Error(
              `${file.name} exceeds the 25 MB file limit`
            );
          }

          const body = new FormData();
          body.append('file', file);
          body.append('folder', folder);

          await request('/research/upload', {
            method: 'POST',
            body
          });
        }
      },
      'Files uploaded successfully'
    );
  }

  async function downloadFile(item: StorageItem) {
    setBusy(true);
    setError('');

    try {
      const path = joinPath(folder, item.name);

      const response = await request(
        `/research/download?path=${encodeURIComponent(path)}`
      );

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Download failed'
      );
    } finally {
      setBusy(false);
    }
  }

  function renameFile(item: StorageItem) {
    const name = window.prompt('New file name:', item.name)?.trim();

    if (!name || name === item.name) return;

    if (
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      name.includes('\\')
    ) {
      setError('Invalid file name');
      return;
    }

    void perform(
      async () => {
        await request('/research/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: joinPath(folder, item.name),
            destination: joinPath(folder, name)
          })
        });
      },
      'File renamed successfully'
    );
  }

  function deleteFile(item: StorageItem) {
    if (!window.confirm(`Delete "${item.name}" permanently?`)) {
      return;
    }

    void perform(
      async () => {
        await request('/research/files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paths: [joinPath(folder, item.name)]
          })
        });
      },
      'File deleted successfully'
    );
  }

  const visible = items
    .filter(item =>
      item.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aFolder = a.id == null;
      const bFolder = b.id == null;

      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '9px 12px',
    border: '1px solid var(--border, #8885)',
    borderRadius: 9,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 13
  };

  const iconButton: React.CSSProperties = {
    ...buttonStyle,
    padding: 8
  };

  return (
    <>
      <div className="eyebrow">KNOWLEDGE / LITERATURE</div>
      <h1 className="pagetitle">Research Library</h1>
      <p className="subtitle">
        Your private workspace for academic papers, trading
        strategies, research reports, and notes.
      </p>

      {!unlocked ? (
        <div
          className="panel"
          style={{
            padding: 28,
            maxWidth: 460,
            margin: '30px auto'
          }}
        >
          <LockKeyhole size={30} />

          <h2 style={{ marginTop: 14 }}>
            Unlock Research Library
          </h2>

          <p className="muted small">
            Enter your administrator password to access
            your private cloud files.
          </p>

          <form
            onSubmit={unlock}
            style={{
              display: 'grid',
              gap: 12,
              marginTop: 20
            }}
          >
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Administrator password"
              autoComplete="off"
              required
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 9,
                border: '1px solid var(--border, #8885)',
                background: 'transparent',
                color: 'inherit'
              }}
            />

            <button
              type="submit"
              disabled={busy}
              style={{
                ...buttonStyle,
                justifyContent: 'center',
                padding: 12
              }}
            >
              {busy ? 'Connecting...' : 'Unlock Library'}
            </button>
          </form>

          {error && (
            <p style={{ color: '#dc5252', marginTop: 12 }}>
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <div
            className="panel"
            style={{
              padding: 16,
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10
              }}
            >
              <Folder size={21} />
              <strong>My Research Files</strong>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8
              }}
            >
              <button
                type="button"
                onClick={createFolder}
                disabled={busy}
                style={buttonStyle}
              >
                <FolderPlus size={16} />
                New Folder
              </button>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                style={buttonStyle}
              >
                <Upload size={16} />
                Upload Files
              </button>

              <button
                type="button"
                onClick={() => void load(folder)}
                disabled={busy}
                title="Refresh"
                style={iconButton}
              >
                <RefreshCw size={17} />
              </button>

              <button
                type="button"
                onClick={logout}
                title="Lock Library"
                style={iconButton}
              >
                <LogOut size={17} />
              </button>

              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                onChange={e => {
                  void uploadFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 16
              }}
            >
              <button
                type="button"
                style={buttonStyle}
                onClick={() => {
                  setSearch('');
                  setFolder('');
                }}
              >
                <Home size={16} />
                Home
              </button>

              {folder && (
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => {
                    const parts = folder.split('/');
                    parts.pop();
                    setSearch('');
                    setFolder(parts.join('/'));
                  }}
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
              )}

              <span className="muted small">
                / {folder || 'All Research Files'}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: '1px solid var(--border, #8885)',
                borderRadius: 9,
                marginBottom: 16
              }}
            >
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search files and folders..."
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  width: '100%'
                }}
              />
            </div>

            {error && (
              <p style={{ color: '#dc5252', marginBottom: 12 }}>
                {error}
              </p>
            )}

            {message && (
              <p style={{ marginBottom: 12 }}>
                {message}
              </p>
            )}

            {busy && (
              <p className="muted small">
                Loading...
              </p>
            )}

            {!busy && visible.length === 0 && (
              <div
                style={{
                  padding: '50px 12px',
                  textAlign: 'center'
                }}
              >
                <Folder size={36} style={{ opacity: 0.5 }} />
                <p>
                  {search
                    ? 'No matching results'
                    : 'This folder is empty'}
                </p>
                <p className="muted small">
                  Create a folder or upload your research files.
                </p>
              </div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
              {visible.map(item => {
                const isFolder = item.id == null;

                return (
                  <div
                    key={item.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12,
                      padding: 12,
                      border: '1px solid var(--border, #8885)',
                      borderRadius: 10
                    }}
                  >
                    {isFolder
                      ? <Folder size={22} />
                      : <FileText size={22} />
                    }

                    <button
                      type="button"
                      onClick={() => {
                        if (isFolder) {
                          setSearch('');
                          setFolder(joinPath(folder, item.name));
                        } else {
                          void downloadFile(item);
                        }
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer',
                        flex: '1 1 180px',
                        minWidth: 0,
                        overflowWrap: 'anywhere'
                      }}
                    >
                      <strong>{item.name}</strong>
                      <div className="muted small">
                        {isFolder
                          ? 'Folder'
                          : `${(
                              (item.metadata?.size ?? 0) / 1024
                            ).toFixed(1)} KB`
                        }
                      </div>
                    </button>

                    {!isFolder && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 6
                        }}
                      >
                        <button
                          type="button"
                          title="Download"
                          disabled={busy}
                          style={iconButton}
                          onClick={() => void downloadFile(item)}
                        >
                          <Download size={17} />
                        </button>

                        <button
                          type="button"
                          title="Rename"
                          disabled={busy}
                          style={iconButton}
                          onClick={() => renameFile(item)}
                        >
                          <Pencil size={17} />
                        </button>

                        <button
                          type="button"
                          title="Delete"
                          disabled={busy}
                          style={iconButton}
                          onClick={() => deleteFile(item)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <p
            className="muted small"
            style={{ marginTop: 16 }}
          >
            Files are stored in private Supabase Storage.
            Maximum upload size: 25 MB per file.
          </p>
        </>
      )}
    </>
  );
}
