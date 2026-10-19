# Quant Research App — Phase 3 (Local Real-Data Integration)

## What this version does
- Connects the **frozen V4 Jupyter calculation functions** to a local FastAPI backend.
- Preserves the five modes: Single Day, Two Days, Cross Expiry, Institutions, Day vs Night.
- Day vs Night top row follows the latest user decision: **Night Volume by Strike** and **Day Open Interest by Strike**.
- Renders genuine V4 Matplotlib figures as PNGs (not yet interactive Plotly charts).
- Keeps English UI and Times New Roman font.
- Saves original V4 CSV caches under `backend/taifex_data/`.

## Windows start
1. Install Node.js LTS and Python 3.11+ (ensure `py` launcher works).
2. Unzip the package into a new folder.
3. Double-click `backend/start_backend.bat`. Wait until Uvicorn says it is running.
4. Double-click `start_frontend.bat`. Wait until Next.js says it is ready.
5. On the computer open `http://localhost:3000/analytics/options`.
6. Load Dates / Expiries, select expiry, Run Analysis.

## Phone on same Wi-Fi
1. Keep **both** CMD windows open and the PC awake.
2. Find your PC's IPv4 address: open CMD and type `ipconfig` (look for e.g. `192.168.1.23`).
3. On the phone (same Wi-Fi), open `http://192.168.1.23:3000/analytics/options` (replace example with your PC IP).
4. Allow Windows Firewall access to Node.js and Python on **Private networks only** if prompted.
5. The frontend automatically calls `http://192.168.1.23:8000` for the backend.
6. If inaccessible, check Wi-Fi client isolation and Windows firewall inbound TCP 3000/8000 on Private network; do **not** open ports on the internet.

## Notes / limitations
- This package has been syntax-checked, but **live TAIFEX downloads have not been verified in this environment**.
- Day vs Night uses independent TAIFEX CSV label dates. V4 uses Black-76 and its existing expiry/time assumptions.
- API allows local-network CORS for development. **Do not expose port 8000 publicly** without authentication, rate limits and tighter CORS.
- Chart images may be zoomed by the browser but are not yet Plotly interactive.
- Institutional mode can take longer due to multiple TAIFEX requests. The frontend currently has a 180-second request timeout.
- The backend retains original V4 source functions, except the user-approved Day vs Night upper chart arrangement.
- Frontend `Load Dates / Expiries` loads real data and can take time. `Force refresh` bypasses caches.
- This is **not** remote/mobile-data access outside the local network. That can be added later using an authenticated private tunnel.
