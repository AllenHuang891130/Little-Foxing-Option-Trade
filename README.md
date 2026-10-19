# Quant Research Lab — Phase 1

A mobile-first, English-language Next.js prototype for a public quantitative finance research website / future PWA.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000 on your computer.

## Current scope

- Responsive desktop sidebar and mobile bottom navigation
- Home, Options Analytics, Research Library, Strategy Lab
- Five V4 analysis-mode selectors, independent day/night date controls
- Illustrative IV smile chart clearly labeled as mock data
- PWA manifest scaffold (real installable PWA requires icons, service-worker/offline strategy and deployment testing)

## Not implemented yet

- TAIFEX downloads, Python FastAPI integration, V4 computations, real charts
- Actual literature content, authentication, database, public hosting

## Next integration step

Extract the existing V4 Notebook's pure Python data/analytics functions into a backend module, preserve V4 calculation conventions, and expose typed API endpoints. Validate representative dates and expiries against Notebook output before enabling public market-data queries.
