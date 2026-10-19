
'use client';

import { useMemo, useRef, useState } from 'react';
import {
  BookOpen, Search, Folder, FolderPlus, Upload,
  FileText, Download, Trash2, Pencil, ArrowLeft,
  Home, FolderOpen, MoveRight
} from 'lucide-react';

type Item = {
  id: string;
  name: string;
  parentId: string | null;
  type: 'folder' | 'file';
  file?: File;
};

export default function Research() {
  const [items, setItems] = useState<Item[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const makeId = () =>
    crypto.randomUUID();

  const folder = items.find(
    x => x.id === currentFolder && x.type === 'folder'
  );

  const visible = useMemo(() => {
    if (search.trim()) {
      return items.filter(x =>
        x.name.toLowerCase().includes(search.toLowerCase())
      );
    }

    return items.filter(x => x.parentId === currentFolder);
  }, [items, currentFolder, search]);

  const folders = items.filter(x => x.type === 'folder');

  function addFolder() {
    const name = window.prompt('請輸入資料夾名稱');
    if (!name?.trim()) return;

    setItems(prev => [...prev, {
      id: makeId(),
      name: name.trim(),
      parentId: currentFolder,
      type: 'folder'
    }]);
  }

  function uploadFiles(files: FileList | null) {
    if (!files) return;

    const added: Item[] = Array.from(files).map(file => ({
      id: makeId(),
      name: file.name,
      parentId: currentFolder,
      type: 'file',
      file
    }));

    setItems(prev => [...prev, ...added]);
  }

  function renameItem(item: Item) {
    const name = window.prompt('重新命名', item.name);
    if (!name?.trim()) return;

    setItems(prev => prev.map(x =>
      x.id === item.id ? { ...x, name: name.trim() } : x
    ));
  }

  function deleteItem(item: Item) {
    if (!window.confirm(`確定刪除「${item.name}」？`)) return;

    setItems(prev => {
      const removed = new Set([item.id]);

      if (item.type === 'folder') {
        let changed = true;

        while (changed) {
          changed = false;

          for (const x of prev) {
            if (
              x.parentId &&
              removed.has(x.parentId) &&
              !removed.has(x.id)
            ) {
              removed.add(x.id);
              changed = true;
            }
          }
        }
      }

      return prev.filter(x => !removed.has(x.id));
    });
  }

  function downloadItem(item: Item) {
    if (!item.file) return;

    const url = URL.createObjectURL(item.file);
    const a = document.createElement('a');

    a.href = url;
    a.download = item.name;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openItem(item: Item) {
    if (item.type === 'folder') {
      setCurrentFolder(item.id);
      setSearch('');
      return;
    }

    if (!item.file) return;

    const url = URL.createObjectURL(item.file);
    window.open(url, '_blank', 'noopener,noreferrer');

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function moveItem(item: Item) {
    const choices = [
      'ROOT：根目錄',
      ...folders
        .filter(x => x.id !== item.id)
        .map(x => `${x.id}：${x.name}`)
    ];

    const choice = window.prompt(
      '輸入目標資料夾 ID，或輸入 ROOT 移至根目錄：\n\n' +
      choices.join('\n')
    );

    if (choice === null) return;

    const target = choice.trim();
    const parentId = target.toUpperCase() === 'ROOT'
      ? null
      : target;

    if (
      parentId !== null &&
      !folders.some(x => x.id === parentId)
    ) {
      alert('找不到目標資料夾');
      return;
    }

    if (item.type === 'folder' && parentId) {
      let ancestor: string | null = parentId;

      while (ancestor) {
        if (ancestor === item.id) {
          alert('不能把資料夾移到自己的子資料夾');
          return;
        }

        ancestor = items.find(x => x.id === ancestor)?.parentId ?? null;
      }
    }

    setItems(prev => prev.map(x =>
      x.id === item.id ? { ...x, parentId } : x
    ));
  }

  const countFiles = items.filter(x => x.type === 'file').length;

  return (
    <>
      <div className="eyebrow">KNOWLEDGE / LITERATURE</div>
      <h1 className="pagetitle">Research Library</h1>
      <p className="subtitle">
        管理研究論文、交易策略、回測報告與個人筆記。
      </p>

      <div
        className="panel"
        style={{
          padding: 16,
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen size={19} />
          <strong>我的研究資料</strong>
          <span className="muted small">
            {folders.length} 個資料夾 · {countFiles} 個檔案
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={addFolder}
            style={buttonStyle}
          >
            <FolderPlus size={16} />
            新增資料夾
          </button>

          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            style={buttonStyle}
          >
            <Upload size={16} />
            上傳檔案
          </button>

          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={e => {
              uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 16
        }}
      >
        <div className="panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              marginBottom: 16,
              flexWrap: 'wrap'
            }}
          >
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setCurrentFolder(null);
                setSearch('');
              }}
            >
              <Home size={16} />
              根目錄
            </button>

            {currentFolder && (
              <button
                type="button"
                style={buttonStyle}
                onClick={() => {
                  setCurrentFolder(folder?.parentId ?? null);
                  setSearch('');
                }}
              >
                <ArrowLeft size={16} />
                返回上層
              </button>
            )}

            <strong style={{ marginLeft: 4 }}>
              {folder ? folder.name : '所有研究資料'}
            </strong>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              border: '1px solid var(--border, #4444)',
              borderRadius: 10,
              marginBottom: 16
            }}
          >
            <Search size={18} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋資料夾或檔案..."
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'inherit',
                width: '100%',
                fontSize: 14
              }}
            />
          </div>

          {visible.length === 0 ? (
            <div
              style={{
                padding: '56px 12px',
                textAlign: 'center'
              }}
            >
              <FolderOpen size={38} style={{ opacity: 0.5 }} />
              <p style={{ marginTop: 12 }}>
                {search ? '沒有符合的搜尋結果' : '這個資料夾目前是空的'}
              </p>
              <p className="muted small">
                可以新增資料夾或上傳研究檔案。
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {[...visible]
                .sort((a, b) =>
                  Number(b.type === 'folder') -
                  Number(a.type === 'folder') ||
                  a.name.localeCompare(b.name)
                )
                .map(item => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      border: '1px solid var(--border, #4444)',
                      borderRadius: 10,
                      flexWrap: 'wrap'
                    }}
                  >
                    {item.type === 'folder'
                      ? <Folder size={22} />
                      : <FileText size={22} />
                    }

                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        flex: '1 1 180px',
                        minWidth: 0,
                        overflowWrap: 'anywhere'
                      }}
                    >
                      <strong>{item.name}</strong>
                      <div className="muted small">
                        {item.type === 'folder'
                          ? '資料夾'
                          : `${((item.file?.size ?? 0) / 1024).toFixed(1)} KB`
                        }
                      </div>
                    </button>

                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap'
                      }}
                    >
                      {item.type === 'file' && (
                        <button
                          type="button"
                          title="下載"
                          style={iconButton}
                          onClick={() => downloadItem(item)}
                        >
                          <Download size={17} />
                        </button>
                      )}

                      <button
                        type="button"
                        title="重新命名"
                        style={iconButton}
                        onClick={() => renameItem(item)}
                      >
                        <Pencil size={17} />
                      </button>

                      <button
                        type="button"
                        title="移動"
                        style={iconButton}
                        onClick={() => moveItem(item)}
                      >
                        <MoveRight size={17} />
                      </button>

                      <button
                        type="button"
                        title="刪除"
                        style={iconButton}
                        onClick={() => deleteItem(item)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 16 }}>
        目前為前端功能測試版，檔案尚未上傳至 Supabase。
        重新整理頁面後，測試資料會消失。
      </p>
    </>
  );
}

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 12px',
  border: '1px solid var(--border, #4444)',
  borderRadius: 9,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13
};

const iconButton = {
  ...buttonStyle,
  padding: 8
};
