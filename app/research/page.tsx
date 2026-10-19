'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import {
  ArrowLeft, Download, FileText, Folder, FolderPlus, Home,
  LockKeyhole, LogOut, Pencil, RefreshCw, Search, Trash2, Upload
} from 'lucide-react';

const API = 'https://little-foxing-option-trade.onrender.com';

type StorageItem = {
  name: string;
  id?: string | null;
  metadata?: { size?: number; mimetype?: string } | null;
};

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

function getError(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    return String((data as { detail: unknown }).detail);
  }
  return `Request failed (${status})`;
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: 7, padding: '9px 12px', border: '1px solid var(--border, #8885)',
  borderRadius: 9, background: 'transparent', color: 'inherit',
  cursor: 'pointer', fontSize: 13
};
const iconButton: CSSProperties = { ...buttonStyle, padding: 8 };
const inputStyle: CSSProperties = {
  width: '100%', padding: 12, borderRadius: 9,
  border: '1px solid var(--border, #8885)',
  background: 'transparent', color: 'inherit'
};

export default function Research() {
  const [passwordInput, setPasswordInput] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<StorageItem[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const admin = adminPassword.length > 0;

  const request = useCallback(async (
    path: string,
    init: RequestInit = {},
    credential?: string
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (credential) headers.set('X-Research-Password', credential);
    const response = await fetch(`${API}${path}`, {
      ...init, headers, cache: 'no-store'
    });
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
      const response = await request(
        `/research/files?folder=${encodeURIComponent(target)}`
      );
      const data: { items?: StorageItem[] } = await response.json();
      const result = Array.isArray(data.items) ? data.items : [];
      setItems(result.filter(item =>
        item.name !== '.folder' && item.name !== '.emptyFolderPlaceholder'
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load files');
    } finally {
      setBusy(false);
    }
  }, [request]);

  useEffect(() => {
    void load(folder);
  }, [folder, load]);

  async function enterAdmin(event: FormEvent<HTMLFormElement>) {
