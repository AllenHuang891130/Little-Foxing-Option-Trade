
'use client';

import { useState } from 'react';
import { RefreshCcw, Play, Info } from 'lucide-react';

type Mode = 'single' | 'compare' | 'cross' | 'inst' | 'daynight';

const ALL = '__ALL__';
const COMBINED = '__COMBINED__';

const modes: { id: Mode; label: string }[] = [
  { id: 'single', label: 'Single Day' },
  { id: 'compare', label: 'Two Days' },
  { id: 'cross', label: 'Cross Expiry' },
  { id: 'inst', label: 'Institutions' },
  { id: 'daynight', label: 'Day vs Night' },
];

type ExpiryChart = {
  expiry: string;
  image: string;
  meta: Record<string, unknown>;
};

type Result = {
  image: string;
  images?: ExpiryChart[];
  meta: Record<string, unknown>;
  note: string;
};

type ModeState = {
  date1: string;
  date2: string;
  expiry: string;
  expiryOptions: string[];
  selectedExpiries: string[];
  atmRange: string;
  lookback: string;
  force: boolean;
  busy: boolean;
  message: string;
  result: Result | null;
  resultSignature: string | null;
};

type ModeStates = Record<Mode, ModeState>;

function initialModeState(): ModeState {
  return {
    date1: '2026-10-16',
    date2: '2026-10-19',
    expiry: '202610',
    expiryOptions: [],
    selectedExpiries: [],
    atmRange: '6',
    lookback: '20',
    force: false,
    busy: false,
    message: 'Load available expiries to begin.',
    result: null,
    resultSignature: null,
  };
}

function initialStates(): ModeStates {
  return {
    single: initialModeState(),
    compare: initialModeState(),
    cross: initialModeState(),
    inst: initialModeState(),
    daynight: initialModeState(),
  };
}

function apiBase() {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL
    ?.trim()
    .replace(/\/$/, '');

  return configured || 'http://localhost:8000';
}

function hasSecondDate(mode: Mode) {
  return mode === 'compare' || mode === 'daynight';
}

function requestBody(mode: Mode, state: ModeState) {
  return {
    mode,
    date1: state.date1,
    date2: hasSecondDate(mode) ? state.date2 : null,
    expiry: state.expiry,
    expiries: state.selectedExpiries,
    range_pct: Number(state.atmRange),
    lookback: Number(state.lookback),
    force: state.force,
  };
}

// Signature includes analysis parameters, not the force-refresh flag.
// Refreshing identical inputs does not make the displayed result stale.
function analysisSignature(mode: Mode, state: ModeState) {
  const body = requestBody(mode, state);

  return JSON.stringify({
    mode: body.mode,
    date1: body.date1,
    date2: body.date2,
    expiry: mode === 'inst' || mode === 'cross' ? null : body.expiry,
    expiries:
      mode === 'cross'
        ? [...body.expiries].sort()
        : null,
    range_pct: mode === 'inst' ? null : body.range_pct,
    lookback: mode === 'inst' ? body.lookback : null,
  });
}

async function postRequest(
  path: string,
  mode: Mode,
  state: ModeState
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(apiBase() + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody(mode, state)),
      signal: controller.signal,
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof json.detail === 'string'
          ? json.detail
          : `HTTP ${response.status}`
      );
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

export default function Options() {
  const [mode, setMode] = useState<Mode>('daynight');

  const [states, setStates] = useState<ModeStates>(initialStates);

  const current = states[mode];
  const second = hasSecondDate(mode);

  function updateMode(
    target: Mode,
    patch: Partial<ModeState>
  ) {
    setStates(previous => ({
      ...previous,
      [target]: {
        ...previous[target],
        ...patch,
      },
    }));
  }

  function updateCurrent(patch: Partial<ModeState>) {
    updateMode(mode, patch);
  }

  async function load() {
    const target = mode;
    const snapshot = { ...states[target] };

    if (snapshot.busy) return;

    updateMode(target, {
      busy: true,
      message: 'Loading TAIFEX contract data...',
    });

    try {
      const data = await postRequest(
        '/expiries',
        target,
        snapshot
      );

      const values: string[] = Array.isArray(data.expiries)
        ? data.expiries
        : [];

      setStates(previous => {
        const latest = previous[target];

        const nextExpiry =
          latest.expiry === ALL ||
          latest.expiry === COMBINED ||
          values.includes(latest.expiry)
            ? latest.expiry
            : values.length > 0
              ? values[0]
              : latest.expiry;

        const retained = latest.selectedExpiries.filter(
          value => values.includes(value)
        );

        return {
          ...previous,
          [target]: {
            ...latest,
            expiryOptions: values,
            expiry: nextExpiry,
            selectedExpiries:
              retained.length > 0
                ? retained
                : values.slice(0, 3),
            message: `Loaded ${values.length} expiry choices. Select an expiry or All Expiries and run analysis.`,
          },
        };
      });
    } catch (error) {
      updateMode(target, {
        message:
          'Load failed: ' +
          (error instanceof Error
            ? error.message
            : String(error)) +
          '. Check the API and data availability.',
      });
    } finally {
      updateMode(target, { busy: false });
    }
  }

  async function run() {
    const target = mode;
    const snapshot = { ...states[target] };

    if (snapshot.busy) return;

    if (
      target !== 'inst' &&
      snapshot.expiryOptions.length === 0
    ) {
      updateMode(target, {
        message:
          'Load Dates / Expiries before running analysis.',
      });
      return;
    }

    const signature = analysisSignature(
      target,
      snapshot
    );

    updateMode(target, {
      busy: true,
      message:
        'Running V4 calculations. All Expiries may take longer...',
    });

    try {
      const data = (await postRequest(
        '/analyze',
        target,
        snapshot
      )) as Result;

      const count = data.images?.length;

      updateMode(target, {
        result: data,
        resultSignature: signature,
        message: count
          ? `Analysis completed: ${count} expiry charts.`
          : 'Analysis completed using V4 calculation functions.',
      });
    } catch (error) {
      updateMode(target, {
        message:
          'Analysis failed: ' +
          (error instanceof Error
            ? error.message
            : String(error)) +
          '. Previous results are preserved.',
      });
    } finally {
      updateMode(target, { busy: false });
    }
  }

  const isPreviousResult =
    current.result !== null &&
    current.resultSignature !==
      analysisSignature(mode, current);

  return (
    <>
      <div className="eyebrow">
        MARKET ANALYTICS / OPTIONS
      </div>

      <h1 className="pagetitle">
        TXO / MTX Options Dashboard
      </h1>

      <p className="subtitle">
        V4 calculation engine · Official TAIFEX data ·
        Black-76 IV
      </p>

      <div className="panel">
        <h2>Analysis Settings</h2>

        <div
          className="mode-tabs"
          role="group"
          aria-label="Analysis Mode"
        >
          {modes.map(item => (
            <button
              type="button"
              key={item.id}
              className={
                'mode-tab ' +
                (mode === item.id ? 'selected' : '')
              }
              aria-pressed={mode === item.id}
              onClick={() => setMode(item.id)}
            >
              {item.label}

              {states[item.id].busy && ' ⏳'}
            </button>
          ))}
        </div>

        <div className="fields">
          <label>
            {mode === 'inst'
              ? 'Analysis Date'
              : 'Date 1 / Day Date'}

            <input
              type="date"
              value={current.date1}
              onChange={event =>
                updateCurrent({
                  date1: event.target.value,
                  expiryOptions: [],
                })
              }
            />
          </label>

          {second && (
            <label>
              {mode === 'daynight'
                ? 'Night Data Label Date'
                : 'Date 2'}

              <input
                type="date"
                value={current.date2}
                onChange={event =>
                  updateCurrent({
                    date2: event.target.value,
                    expiryOptions: [],
                  })
                }
              />
            </label>
          )}

          {mode !== 'inst' &&
            (mode === 'cross' ? (
              <label>
                Expiries (multiple)

                <select
                  multiple
                  size={4}
                  value={current.selectedExpiries}
                  onChange={event =>
                    updateCurrent({
                      selectedExpiries: Array.from(
                        event.target.selectedOptions
                      ).map(option => option.value),
                    })
                  }
                >
                  {current.expiryOptions.map(value => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Expiry

                <select
                  value={current.expiry}
                  onChange={event =>
                    updateCurrent({
                      expiry: event.target.value,
                    })
                  }
                >
                  <option value={ALL}>
                    All Expiries — Separate
                  </option>

                  <option value={COMBINED}>
                    All Expiries — Combined
                  </option>

                  {current.expiry !== ALL &&
                    current.expiry !== COMBINED &&
                    !current.expiryOptions.includes(
                      current.expiry
                    ) && (
                      <option value={current.expiry}>
                        {current.expiry}
                      </option>
                    )}

                  {current.expiryOptions.map(value => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ))}

          {mode === 'inst' ? (
            <label>
              Lookback (Calendar Days)

              <input
                type="number"
                min="1"
                max="90"
                value={current.lookback}
                onChange={event =>
                  updateCurrent({
                    lookback: event.target.value,
                  })
                }
              />
            </label>
          ) : (
            <label>
              Moneyness Range (%)

              <input
                type="number"
                min="1"
                max="30"
                value={current.atmRange}
                onChange={event =>
                  updateCurrent({
                    atmRange: event.target.value,
                  })
                }
              />
            </label>
          )}
        </div>

        <label className="cache-toggle">
          <input
            type="checkbox"
            checked={current.force}
            onChange={event =>
              updateCurrent({
                force: event.target.checked,
              })
            }
          />

          Force refresh cached data
        </label>

        <div className="analysis-toolbar">
          <button
            disabled={current.busy}
            className="analysis-button"
            onClick={load}
          >
            <RefreshCcw
              size={15}
              style={{
                verticalAlign: 'middle',
                marginRight: 7,
              }}
            />

            Load Dates / Expiries
          </button>

          <button
            disabled={current.busy}
            className="analysis-button primary-action"
            onClick={run}
          >
            <Play
              size={15}
              style={{
                verticalAlign: 'middle',
                marginRight: 7,
              }}
            />

            {current.busy
              ? 'Working...'
              : 'Run Analysis'}
          </button>
        </div>

        <div className="notice" role="status">
          <Info
            size={15}
            style={{
              verticalAlign: 'middle',
              marginRight: 7,
            }}
          />

          {current.message}
        </div>
      </div>

      <div className="panel">
        <div className="sectiontitle">
          <h2>
            {modes.find(item => item.id === mode)
              ?.label}{' '}
            Analysis
          </h2>

          <span>
            {current.busy
              ? 'Processing...'
              : isPreviousResult
                ? 'Previous Result'
                : current.result
                  ? 'V4 results'
                  : 'Waiting for analysis'}
          </span>
        </div>

        {isPreviousResult && (
          <div className="notice" role="status">
            <Info
              size={15}
              style={{
                verticalAlign: 'middle',
                marginRight: 7,
              }}
            />

            Previous Result — Settings have changed
            since this chart was generated. Run Analysis
            to update it.
          </div>
        )}

        {current.result ? (
          <>
            {current.result.images?.length ? (
              current.result.images.map(chart => (
                <section
                  key={chart.expiry}
                  style={{ marginBottom: 32 }}
                >
                  <h3 style={{ marginBottom: 12 }}>
                    Expiry: {chart.expiry}
                  </h3>

                  <img
                    className="analysis-image"
                    src={chart.image}
                    alt={`TAIFEX V4 analytics for ${chart.expiry}`}
                  />

                  {Object.keys(
                    chart.meta || {}
                  ).length > 0 && (
                    <pre className="result-meta">
                      {JSON.stringify(
                        chart.meta,
                        null,
                        2
                      )}
                    </pre>
                  )}
                </section>
              ))
            ) : (
              <img
                className="analysis-image"
                src={current.result.image}
                alt="TAIFEX V4 option analytics charts"
              />
            )}

            {Object.keys(
              current.result.meta || {}
            ).length > 0 && (
              <pre className="result-meta">
                {JSON.stringify(
                  current.result.meta,
                  null,
                  2
                )}
              </pre>
            )}

            <p className="analysis-note">
              {current.result.note}
            </p>
          </>
        ) : (
          <div className="plot-empty">
            No results yet. Load available expiries and
            click Run Analysis.
          </div>
        )}

        <p className="analysis-note">
          Day vs Night dates are independent. Night
          Volume / Day OI are shown in the top row.
          Institutional charts use the original V4 daily
          data logic.
        </p>
      </div>
    </>
  );
}
