
'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  CalendarDays,
  FileText,
  Upload,
  ArrowLeft,
  Search,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import './markdown.css';

// ============================================================
// Little Foxing | Markets
// Compact English UI + Responsive Layout
// ============================================================

type Category = 'daily' | 'bonds' | 'research';
type Tab = Category | 'all';

type Article = {
  slug: string;
  title: string;
  date: string;
  category: Category;
  summary: string;
  content?: string;
  file_name?: string;
  file_url?: string;
};

const API = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://little-foxing-option-trade.onrender.com'
).replace(/\/$/, '');

const tabs: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All Insights' },
  { key: 'daily', label: 'Daily Brief' },
  { key: 'bonds', label: 'Bond Weekly' },
  { key: 'research', label: 'My Research' },
];

const panel: React.CSSProperties = {
  border: '1px solid var(--border, #d7d0c3)',
  borderRadius: 8,
  background: 'var(--card, transparent)',
};

const field: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  padding: '10px 12px',
  border: '1px solid var(--border, #d7d0c3)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  boxSizing: 'border-box',
};

const btn: React.CSSProperties = {
  padding: '9px 13px',
  border: '1px solid var(--border, #d7d0c3)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function readJson(
  url: string,
  init?: RequestInit
): Promise<any> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof data.detail === 'string'
        ? data.detail
        : `Request failed (HTTP ${response.status})`
    );
  }

  return data;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(
        String(reader.result).split(',')[1] || ''
      );
    };

    reader.onerror = () => {
      reject(new Error('Unable to read the selected file.'));
    };

    reader.readAsDataURL(file);
  });
}

function categoryLabel(category: Category): string {
  if (category === 'daily') return 'DAILY BRIEF';
  if (category === 'bonds') return 'BOND WEEKLY';
  return 'RESEARCH';
}

export default function MarketsInsightsPage() {
  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------

  const [tab, setTab] = useState<Tab>('all');
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showPublish, setShowPublish] = useState(false);

  const [key, setKey] = useState('');
  const [category, setCategory] =
    useState<Category>('research');

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(
    new Date().toLocaleDateString('en-CA')
  );

  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteKey, setDeleteKey] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState('');

  // ----------------------------------------------------------
  // Load articles
  // ----------------------------------------------------------

  async function reload() {
    setLoading(true);
    setError('');

    try {
      const data = await readJson(
        `${API}/api/insights/articles`
      );

      setArticles(
        Array.isArray(data.articles)
          ? data.articles
          : []
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // ----------------------------------------------------------
  // Filter
  // ----------------------------------------------------------

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();

    return articles.filter(article => {
      const categoryMatches =
        tab === 'all' || article.category === tab;

      const searchMatches =
        `${article.title} ${article.summary} ${article.date}`
          .toLowerCase()
          .includes(query);

      return categoryMatches && searchMatches;
    });
  }, [articles, tab, search]);

  // ----------------------------------------------------------
  // Read article
  // ----------------------------------------------------------

  async function openArticle(article: Article) {
    setError('');
    setOpening(true);

    try {
      const full = await readJson(
        `${API}/api/insights/articles/${
          article.category
        }/${encodeURIComponent(article.slug)}`
      );

      setSelected(full);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }

  // ----------------------------------------------------------
  // Publish
  // ----------------------------------------------------------

  async function publish(e: React.FormEvent) {
    e.preventDefault();

    if (!key.trim()) {
      setError('Please enter your admin key.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (file && file.size > 8 * 1024 * 1024) {
        throw new Error(
          'The attachment must not exceed 8 MB.'
        );
      }

      const file_base64 = file
        ? await toBase64(file)
        : '';

      await readJson(`${API}/api/insights/articles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Insights-Admin-Key': key,
        },
        body: JSON.stringify({
          category,
          title,
          date,
          summary,
          content,
          filename: file?.name || '',
          file_base64,
        }),
      });

      setTitle('');
      setSummary('');
      setContent('');
      setFile(null);
      setShowPublish(false);

      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // ----------------------------------------------------------
  // Delete
  // ----------------------------------------------------------

  async function deleteArticle() {
    if (!selected) return;

    if (!deleteKey.trim()) {
      setError('Please enter your admin key.');
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete "${selected.title}"?\n\n` +
      'The article and its attachment will be deleted ' +
      'from GitHub. This action cannot be undone from ' +
      'the website.'
    );

    if (!confirmed) return;

    setDeleting(true);
    setError('');
    setDeleteNotice('');

    try {
      const result = await readJson(
        `${API}/api/insights/articles/${
          selected.category
        }/${encodeURIComponent(selected.slug)}`,
        {
          method: 'DELETE',
          headers: {
            'X-Insights-Admin-Key': deleteKey,
          },
        }
      );

      setDeleteKey('');
      setSelected(null);

      setDeleteNotice(
        result.warning || 'Article deleted successfully.'
      );

      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <main className="lf-markets">
      <style>{`
        .lf-markets {
          width: 100%;
          max-width: 1240px;
          margin: 0 auto;
          padding: 24px 16px 72px;
          box-sizing: border-box;
          min-width: 0;
        }

        .lf-markets *,
        .lf-markets *::before,
        .lf-markets *::after {
          box-sizing: border-box;
        }

        .lf-markets-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 26px;
        }

        .lf-markets-eyebrow {
          font-size: 11px;
          letter-spacing: 1.8px;
          opacity: 0.6;
          margin-bottom: 6px;
        }

        .lf-markets-title {
          font-size: clamp(28px, 4vw, 36px);
          line-height: 1.2;
          margin: 0;
        }

        .lf-markets-subtitle {
          font-size: 13px;
          opacity: 0.65;
          margin: 7px 0 0;
          line-height: 1.6;
        }

        .lf-markets-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .lf-markets-tabs {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 24px;
        }

        .lf-markets-tab {
          width: 100%;
          min-width: 0;
          min-height: 44px;
          padding: 9px 12px;
          border: 1px solid var(--border, #d7d0c3);
          border-radius: 6px;
          background: transparent;
          color: inherit;
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          text-align: center;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }

        .lf-markets-tab:hover {
          background: rgba(110, 100, 85, 0.08);
        }

        .lf-markets-tab.active {
          background: #746e64;
          border-color: #746e64;
          color: #fffdf8;
        }

        .lf-markets-section-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 18px;
        }

        .lf-markets-search {
          width: min(100%, 280px);
          position: relative;
        }

        .lf-markets-search-icon {
          position: absolute;
          left: 11px;
          top: 50%;
          transform: translateY(-50%);
          opacity: 0.5;
          pointer-events: none;
        }

        .lf-markets-search input {
          padding-left: 35px !important;
        }

        .lf-markets-grid {
          display: grid;
          grid-template-columns:
            repeat(auto-fill, minmax(min(100%, 300px), 1fr));
          gap: 14px;
        }

        .lf-markets-article-card {
          width: 100%;
          min-width: 0;
          min-height: 190px;
          padding: 17px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          font-family: inherit;
          overflow-wrap: anywhere;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .lf-markets-article-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(0,0,0,0.06);
        }

        .lf-markets-article-card h3 {
          font-size: 18px;
          line-height: 1.45;
          margin: 0;
        }

        .lf-markets-article-card p {
          font-size: 13px;
          line-height: 1.7;
          opacity: 0.65;
          margin: 0;
          flex: 1;
          overflow-wrap: anywhere;
        }

        .lf-markets-editor {
          display: grid;
          gap: 13px;
          padding: 20px;
          margin-bottom: 24px;
        }

        .lf-markets-editor-columns {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .lf-markets-reader {
          padding: clamp(18px, 4vw, 45px);
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .lf-markets-reader h2 {
          font-size: clamp(24px, 4vw, 34px);
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .lf-markets-reader .insights-markdown {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .lf-markets-reader img {
          max-width: 100%;
          height: auto;
        }

        .lf-markets-reader pre {
          max-width: 100%;
          overflow-x: auto;
        }

        .lf-markets-reader .table-scroll {
          max-width: 100%;
          overflow-x: auto;
        }

        .lf-markets-reader iframe {
          max-width: 100%;
        }

        .lf-markets-status {
          font-size: 13px;
          line-height: 1.7;
          opacity: 0.7;
          padding: 12px 0;
        }

        .lf-markets button:focus-visible,
        .lf-markets input:focus-visible,
        .lf-markets textarea:focus-visible,
        .lf-markets select:focus-visible {
          outline: 2px solid #9a7048;
          outline-offset: 2px;
        }

        @media (max-width: 680px) {
          .lf-markets {
            padding: 18px 12px 90px;
          }

          .lf-markets-header {
            margin-bottom: 20px;
          }

          .lf-markets-tabs {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 7px;
          }

          .lf-markets-tab {
            min-height: 42px;
            padding: 8px 6px;
            font-size: 12px;
          }

          .lf-markets-section-heading {
            align-items: stretch;
          }

          .lf-markets-search {
            width: 100%;
          }

          .lf-markets-grid {
            grid-template-columns: 1fr;
          }

          .lf-markets-article-card {
            min-height: 0;
          }

          .lf-markets-editor-columns {
            grid-template-columns: 1fr;
          }

          .lf-markets-editor {
            padding: 14px;
          }

          .lf-markets-reader {
            padding: 16px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .lf-markets-tab,
          .lf-markets-article-card {
            transition: none;
          }
        }
      `}</style>

      {/* Header */}

      <header className="lf-markets-header">
        <div>
          <div className="lf-markets-eyebrow">
            LITTLE FOXING / RESEARCH CENTER
          </div>

          <h1 className="lf-markets-title">
            Markets
          </h1>

          <p className="lf-markets-subtitle">
            Daily intelligence · Fixed income · Independent research
          </p>
        </div>

        <div className="lf-markets-actions">
          <button
            type="button"
            style={btn}
            onClick={() => void reload()}
            aria-label="Refresh publications"
            title="Refresh publications"
          >
            <RefreshCw size={16} />
          </button>

          <button
            type="button"
            style={btn}
            onClick={() => setShowPublish(v => !v)}
            aria-expanded={showPublish}
          >
            <Upload size={15} />
            Publish / Upload
          </button>
        </div>
      </header>

      {/* Notifications */}

      {deleteNotice && (
        <div
          role="status"
          style={{
            ...panel,
            padding: 14,
            marginBottom: 18,
          }}
        >
          {deleteNotice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            ...panel,
            padding: 14,
            marginBottom: 18,
            borderColor: '#b94b4b',
            color: '#b94b4b',
            overflowWrap: 'anywhere',
          }}
        >
          {error}
        </div>
      )}

      {/* Publish form */}

      {showPublish && (
        <form
          className="lf-markets-editor"
          style={panel}
          onSubmit={publish}
        >
          <h2 style={{ fontSize: 19, margin: 0 }}>
            Publish Article
          </h2>

          <p
            style={{
              fontSize: 13,
              opacity: 0.65,
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            Articles are publicly accessible.
            Publishing requires an admin key.
            Attachments are limited to 8 MB
            (PDF, DOCX, MD, TXT).
          </p>

          <div className="lf-markets-editor-columns">
            <label style={labelStyle}>
              Category
              <select
                style={field}
                value={category}
                onChange={e =>
                  setCategory(e.target.value as Category)
                }
              >
                <option value="research">My Research</option>
                <option value="daily">Daily Brief</option>
                <option value="bonds">Bond Weekly</option>
              </select>
            </label>

            <label style={labelStyle}>
              Date
              <input
                style={field}
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </label>
          </div>

          <label style={labelStyle}>
            Title
            <input
              style={field}
              required
              maxLength={200}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Enter article title..."
            />
          </label>

          <label style={labelStyle}>
            Summary
            <textarea
              style={field}
              rows={2}
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Write a short summary..."
            />
          </label>

          <label style={labelStyle}>
            Content (Markdown supported)
            <textarea
              style={field}
              rows={9}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Write your article in Markdown..."
            />
          </label>

          <label style={labelStyle}>
            Attachment
            <input
              style={{ ...field, padding: 8 }}
              type="file"
              accept=".pdf,.docx,.md,.txt"
              onChange={e =>
                setFile(e.target.files?.[0] || null)
              }
            />
          </label>

          <label style={labelStyle}>
            Admin Key
            <input
              style={field}
              type="password"
              required
              autoComplete="off"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Enter your admin key..."
            />
          </label>

          <div>
            <button
              type="submit"
              disabled={saving}
              style={{
                ...btn,
                background: '#393126',
                color: '#fffdf8',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Publishing...' : 'Publish Article'}
            </button>
          </div>
        </form>
      )}

      {/* Article reader */}

      {selected ? (
        <section>
          <button
            type="button"
            style={{
              ...btn,
              marginBottom: 18,
            }}
            onClick={() => {
              setSelected(null);
              setError('');
            }}
          >
            <ArrowLeft size={15} />
            Back to Publications
          </button>

          <article
            className="lf-markets-reader"
            style={panel}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: 1.3,
                opacity: 0.6,
              }}
            >
              {categoryLabel(selected.category)} · {selected.date}
            </div>

            <h2 style={{ margin: '14px 0' }}>
              {selected.title}
            </h2>

            {selected.summary && (
              <p
                style={{
                  fontSize: 16,
                  lineHeight: 1.8,
                  opacity: 0.7,
                }}
              >
                {selected.summary}
              </p>
            )}

            <hr
              style={{
                border: 0,
                borderTop:
                  '1px solid var(--border, #d7d0c3)',
                margin: '24px 0',
              }}
            />

            <div className="insights-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => (
                    <div className="table-scroll">
                      <table>{children}</table>
                    </div>
                  ),
                }}
              >
                {selected.content ||
                  'The full content is available in the attachment below.'}
              </ReactMarkdown>
            </div>

            {selected.file_url && (
              <div style={{ marginTop: 28 }}>
                <a
                  href={selected.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 7,
                    textDecoration: 'underline',
                    overflowWrap: 'anywhere',
                  }}
                >
                  <FileText size={17} />
                  View / Download Attachment:
                  {' '}
                  {selected.file_name}
                  <ExternalLink size={14} />
                </a>

                {selected.file_name
                  ?.toLowerCase()
                  .endsWith('.pdf') && (
                  <iframe
                    title="PDF attachment preview"
                    src={selected.file_url}
                    style={{
                      width: '100%',
                      height: 'min(70vh, 650px)',
                      marginTop: 16,
                      border:
                        '1px solid var(--border, #d7d0c3)',
                      borderRadius: 6,
                    }}
                  />
                )}
              </div>
            )}
          </article>

          {/* Delete article */}

          <div
            style={{
              ...panel,
              marginTop: 18,
              padding: 18,
              display: 'grid',
              gap: 12,
            }}
          >
            <h3 style={{ fontSize: 16, margin: 0 }}>
              Article Management
            </h3>

            <p
              style={{
                fontSize: 13,
                opacity: 0.65,
                margin: 0,
                lineHeight: 1.7,
              }}
            >
              Deleting an article requires an admin key
              and confirmation. This action cannot be
              undone from the website.
            </p>

            <label style={labelStyle}>
              Admin Key
              <input
                style={field}
                type="password"
                autoComplete="off"
                value={deleteKey}
                onChange={e =>
                  setDeleteKey(e.target.value)
                }
                placeholder="Enter admin key to delete..."
              />
            </label>

            <div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void deleteArticle()}
                style={{
                  ...btn,
                  borderColor: '#b94b4b',
                  color: '#b94b4b',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                <Trash2 size={15} />
                {deleting
                  ? 'Deleting...'
                  : 'Delete Article'}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Compact category tabs */}

          <nav
            className="lf-markets-tabs"
            aria-label="Publication categories"
          >
            {tabs.map(item => (
              <button
                key={item.key}
                type="button"
                className={
                  'lf-markets-tab' +
                  (tab === item.key ? ' active' : '')
                }
                aria-pressed={tab === item.key}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Search and heading */}

          <div className="lf-markets-section-heading">
            <h2
              style={{
                fontSize: 20,
                margin: 0,
              }}
            >
              Recent Publications{' '}
              <span
                style={{
                  fontSize: 13,
                  opacity: 0.5,
                }}
              >
                ({shown.length})
              </span>
            </h2>

            <div className="lf-markets-search">
              <Search
                size={15}
                className="lf-markets-search-icon"
              />

              <input
                style={field}
                type="search"
                aria-label="Search publications"
                placeholder="Search titles, summaries, or dates..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Loading */}

          {loading ? (
            <p
              className="lf-markets-status"
              role="status"
            >
              Loading publications...
            </p>
          ) : opening ? (
            <p
              className="lf-markets-status"
              role="status"
            >
              Opening article...
            </p>
          ) : shown.length === 0 ? (
            <div
              style={{
                ...panel,
                padding: '35px 18px',
                textAlign: 'center',
              }}
            >
              <BookOpen
                size={29}
                style={{
                  margin: '0 auto 10px',
                  opacity: 0.4,
                }}
              />

              <h3
                style={{
                  fontSize: 17,
                  marginBottom: 8,
                }}
              >
                {search.trim()
                  ? 'No matching publications found.'
                  : 'No publications yet.'}
              </h3>

              <p
                style={{
                  fontSize: 13,
                  opacity: 0.6,
                  lineHeight: 1.7,
                }}
              >
                {search.trim()
                  ? 'Try another keyword or date.'
                  : 'Use Publish / Upload to add your first article.'}
              </p>
            </div>
          ) : (
            <div className="lf-markets-grid">
              {shown.map(article => (
                <button
                  key={`${article.category}-${article.slug}`}
                  type="button"
                  className="lf-markets-article-card"
                  style={panel}
                  onClick={() =>
                    void openArticle(article)
                  }
                >
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: 1.1,
                      opacity: 0.6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <CalendarDays size={13} />
                    {article.date}
                    {' · '}
                    {categoryLabel(article.category)}
                  </div>

                  <h3>{article.title}</h3>

                  <p>
                    {article.summary ||
                      'Open to read the full article.'}
                  </p>

                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      marginTop: 'auto',
                    }}
                  >
                    Read Insight
                    <ChevronRight size={14} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
