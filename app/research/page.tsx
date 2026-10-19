
'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import type {
  CSSProperties,
  FormEvent
} from 'react';

import {
  ArrowLeft,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Home,
  LockKeyhole,
  LogOut,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from 'lucide-react';

const API =
  'https://little-foxing-option-trade.onrender.com';

type StorageItem = {
  name: string;
  id?: string | null;
  metadata?: {
    size?: number;
    mimetype?: string;
  } | null;
};

function joinPath(
  folder: string,
  name: string
): string {
  return folder ? `${folder}/${name}` : name;
}

function getError(
  data: unknown,
  status: number
): string {
  if (
    data &&
    typeof data === 'object' &&
    'detail' in data
  ) {
    return String(
      (data as { detail: unknown }).detail
    );
  }

  return `Request failed (${status})`;
}

function validName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '9px 12px',
  border: '1px solid var(--border, #8885)',
  borderRadius: 9,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13
};

const iconButton: CSSProperties = {
  ...buttonStyle,
  padding: 8
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: 12,
  borderRadius: 9,
  border: '1px solid var(--border, #8885)',
  background: 'transparent',
  color: 'inherit'
};

export default function Research() {
  const [passwordInput, setPasswordInput] =
    useState('');

  const [adminPassword, setAdminPassword] =
    useState('');

  const [showAdminLogin, setShowAdminLogin] =
    useState(false);

  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<StorageItem[]>([]);
  const [search, setSearch] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  const admin = adminPassword.length > 0;

  // Shared API request helper.
  // Public requests do not send a password.
  const request = useCallback(
    async (
      path: string,
      init: RequestInit = {},
      credential?: string
    ): Promise<Response> => {
      const headers = new Headers(init.headers);

      if (credential) {
        headers.set(
          'X-Research-Password',
          credential
        );
      }

      const response = await fetch(
        `${API}${path}`,
        {
          ...init,
          headers,
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        let data: unknown = null;

        try {
          data = await response.json();
        } catch {
          // Response may not contain JSON.
        }

        throw new Error(
          getError(data, response.status)
        );
      }

      return response;
    },
    []
  );

  // Public folder listing.
  const load = useCallback(
    async (target: string) => {
      setBusy(true);
      setError('');

      try {
        const response = await request(
          `/research/files?folder=${encodeURIComponent(target)}`
        );

        const data: {
          items?: StorageItem[];
        } = await response.json();

        const result = Array.isArray(data.items)
          ? data.items
          : [];

        setItems(
          result.filter(
            item =>
              item.name !== '.folder' &&
              item.name !== '.emptyFolderPlaceholder'
          )
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load files'
        );
      } finally {
        setBusy(false);
      }
    },
    [request]
  );

  // Load automatically, without asking for a password.
  useEffect(() => {
    void load(folder);
  }, [folder, load]);

  // Verify password without changing any file.
  async function enterAdmin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const candidate = passwordInput;

    if (!candidate.trim()) {
      setError('Please enter your administrator password.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      // The backend checks the password before handling
      // this no-op move.
      await request(
        '/research/move',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source: '.admin-password-check',
            destination: '.admin-password-check'
          })
        },
        candidate
      );

      setAdminPassword(candidate);
      setPasswordInput('');
      setShowAdminLogin(false);
      setMessage('Admin Mode enabled.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Invalid administrator password'
      );
    } finally {
      setBusy(false);
    }
  }

  function exitAdmin() {
    setAdminPassword('');
    setPasswordInput('');
    setShowAdminLogin(false);
    setMessage('Admin Mode disabled.');
    setError('');
  }

  // Perform a password-protected write operation.
  async function perform(
    action: () => Promise<void>,
    successMessage: string
  ) {
    if (!adminPassword) {
      setError('Admin Mode is required.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      await action();
      setMessage(successMessage);
      await load(folder);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Operation failed'
      );
    } finally {
      setBusy(false);
    }
  }

  function createFolder() {
    if (!admin) return;

    const name = window.prompt(
      'New folder name:'
    )?.trim();

    if (!name) return;

    if (!validName(name)) {
      setError('Invalid folder name.');
      return;
    }

    void perform(
      async () => {
        await request(
          '/research/folder',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              path: joinPath(folder, name)
            })
          },
          adminPassword
        );
      },
      'Folder created successfully.'
    );
  }

  async function uploadFiles(files: File[]) {
    if (!admin || files.length === 0) return;

    await perform(
      async () => {
        for (const file of files) {
          if (file.size > 25 * 1024 * 1024) {
            throw new Error(
              `${file.name} exceeds the 25 MB file limit.`
            );
          }

          const body = new FormData();

          body.append('file', file);
          body.append('folder', folder);

          await request(
            '/research/upload',
            {
              method: 'POST',
              body
            },
            adminPassword
          );
        }
      },
      'Files uploaded successfully.'
    );
  }

  // Public file download.
  async function downloadFile(
    item: StorageItem
  ) {
    setBusy(true);
    setError('');

    try {
      const path = joinPath(
        folder,
        item.name
      );

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

      window.setTimeout(
        () => URL.revokeObjectURL(url),
        1000
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Download failed'
      );
    } finally {
      setBusy(false);
    }
  }

  function renameFile(item: StorageItem) {
    if (!admin || item.id == null) return;

    const name = window.prompt(
      'New file name:',
      item.name
    )?.trim();

    if (!name || name === item.name) {
      return;
    }

    if (!validName(name)) {
      setError('Invalid file name.');
      return;
    }

    void perform(
      async () => {
        await request(
          '/research/move',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              source: joinPath(
                folder,
                item.name
              ),
              destination: joinPath(
                folder,
                name
              )
            })
          },
          adminPassword
        );
      },
      'File renamed successfully.'
    );
  }

  function deleteFile(item: StorageItem) {
    if (!admin || item.id == null) return;

    const confirmed = window.confirm(
      `Delete "${item.name}" permanently?`
    );

    if (!confirmed) return;

    void perform(
      async () => {
        await request(
          '/research/files',
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              paths: [
                joinPath(folder, item.name)
              ]
            })
          },
          adminPassword
        );
      },
      'File deleted successfully.'
    );
  }

  function navigateTo(target: string) {
    setSearch('');
    setMessage('');
    setFolder(target);
  }

  const visible = [...items]
    .filter(item =>
      item.name
        .toLowerCase()
        .includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aFolder = a.id == null;
      const bFolder = b.id == null;

      if (aFolder !== bFolder) {
        return aFolder ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });

  return (
    <>
      <div className="eyebrow">
        KNOWLEDGE / LITERATURE
      </div>

      <h1 className="pagetitle">
        Research Library
      </h1>

      <p className="subtitle">
        Browse academic papers, trading strategies,
        research reports, and notes.
      </p>

      {/* Top toolbar */}
      <div
        className="panel"
        style={{
          padding: 16,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
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

          <div>
            <strong>Research Files</strong>

            <div className="muted small">
              {admin
                ? 'Administrator Access'
                : 'Public Access'}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          {admin && (
            <>
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
                onClick={() =>
                  inputRef.current?.click()
                }
                disabled={busy}
                style={buttonStyle}
              >
                <Upload size={16} />
                Upload Files
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void load(folder)}
            disabled={busy}
            title="Refresh"
            style={iconButton}
          >
            <RefreshCw size={17} />
          </button>

          {admin ? (
            <button
              type="button"
              onClick={exitAdmin}
              style={buttonStyle}
            >
              <LogOut size={16} />
              Exit Admin Mode
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowAdminLogin(value => !value);
                setError('');
                setMessage('');
              }}
              style={buttonStyle}
            >
              <LockKeyhole size={16} />
              Admin Mode
            </button>
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={event => {
              const selected = Array.from(
                event.target.files || []
              );

              event.target.value = '';

              void uploadFiles(selected);
            }}
          />
        </div>
      </div>

      {/* Administrator login */}
      {!admin && showAdminLogin && (
        <div
          className="panel"
          style={{
            padding: 20,
            marginBottom: 16,
            maxWidth: 460
          }}
        >
          <h2 style={{ marginBottom: 10 }}>
            Administrator Login
          </h2>

          <p className="muted small">
            Enter your password to manage files.
            Browsing and downloading are available
            without a password.
          </p>

          <form
            onSubmit={enterAdmin}
            style={{
              display: 'grid',
              gap: 12,
              marginTop: 16
            }}
          >
            <input
              type="password"
              value={passwordInput}
              onChange={event =>
                setPasswordInput(event.target.value)
              }
              placeholder="Administrator password"
              autoComplete="off"
              required
              style={inputStyle}
            />

            <button
              type="submit"
              disabled={busy}
              style={buttonStyle}
            >
              <LockKeyhole size={16} />
              {busy
                ? 'Verifying...'
                : 'Enable Admin Mode'}
            </button>
          </form>
        </div>
      )}

      {/* File browser */}
      <div
        className="panel"
        style={{ padding: 16 }}
      >
        {/* Navigation */}
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
            onClick={() => navigateTo('')}
            style={buttonStyle}
          >
            <Home size={16} />
            Home
          </button>

          {folder && (
            <button
              type="button"
              onClick={() => {
                const parts = folder.split('/');
                parts.pop();

                navigateTo(
                  parts.join('/')
                );
              }}
              style={buttonStyle}
            >
              <ArrowLeft size={16} />
              Back
            </button>
          )}

          <span className="muted small">
            / {folder || 'All Research Files'}
          </span>
        </div>

        {/* Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            border:
              '1px solid var(--border, #8885)',
            borderRadius: 9,
            marginBottom: 16
          }}
        >
          <Search size={18} />

          <input
            value={search}
            onChange={event =>
              setSearch(event.target.value)
            }
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

        {/* Messages */}
        {error && (
          <p
            style={{
              color: '#dc5252',
              marginBottom: 12,
              overflowWrap: 'anywhere'
            }}
          >
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

        {/* Empty folder */}
        {!busy && visible.length === 0 && (
          <div
            style={{
              padding: '50px 12px',
              textAlign: 'center'
            }}
          >
            <Folder
              size={36}
              style={{ opacity: 0.5 }}
            />

            <p>
              {search
                ? 'No matching results'
                : 'This folder is empty'}
            </p>

            <p className="muted small">
              {admin
                ? 'Create a folder or upload your research files.'
                : 'No files are available in this folder.'}
            </p>
          </div>
        )}

        {/* File and folder list */}
        <div
          style={{
            display: 'grid',
            gap: 8
          }}
        >
          {visible.map(item => {
            const isFolder =
              item.id == null;

            return (
              <div
                key={item.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  padding: 12,
                  border:
                    '1px solid var(--border, #8885)',
                  borderRadius: 10
                }}
              >
                {isFolder ? (
                  <Folder size={22} />
                ) : (
                  <FileText size={22} />
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (isFolder) {
                      navigateTo(
                        joinPath(
                          folder,
                          item.name
                        )
                      );
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
                  <strong>
                    {item.name}
                  </strong>

                  <div className="muted small">
                    {isFolder
                      ? 'Folder'
                      : `${(
                          (item.metadata?.size ?? 0) /
                          1024
                        ).toFixed(1)} KB`}
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
                      onClick={() =>
                        void downloadFile(item)
                      }
                      style={iconButton}
                    >
                      <Download size={17} />
                    </button>

                    {admin && (
                      <>
                        <button
                          type="button"
                          title="Rename"
                          disabled={busy}
                          onClick={() =>
                            renameFile(item)
                          }
                          style={iconButton}
                        >
                          <Pencil size={17} />
                        </button>

                        <button
                          type="button"
                          title="Delete"
                          disabled={busy}
                          onClick={() =>
                            deleteFile(item)
                          }
                          style={iconButton}
                        >
                          <Trash2 size={17} />
                        </button>
                      </>
                    )}
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
        Files are stored in Supabase Storage.
        Public browsing and downloading are enabled.
        File management requires administrator access.
        Maximum upload size: 25 MB per file.
      </p>
    </>
  );
}
