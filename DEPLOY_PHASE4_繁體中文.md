# Phase 4：手機離開電腦仍可使用的雲端測試版

這是 Phase 3 的部署調整版，仍使用原本 V4 計算。尚未部署到任何帳號，需由你登入 GitHub、Render、Vercel 完成設定。

## A. GitHub
1. 建立私人 GitHub repository（請先確認期交所資料再利用規範）。
2. 上傳本專案原始碼，**不要上傳** `node_modules`、`.next`、`backend/taifex_data` 或 `.env.local`。

## B. Render Python 後端
1. Render → New → Blueprint，連接 GitHub repo，使用專案根目錄的 `render.yaml`。
2. 在 `ALLOWED_ORIGINS` 設定 Vercel 網址（例如 `https://your-app.vercel.app`），不能包含結尾 `/`。
3. 部署完成後，測試 `https://你的後端.onrender.com/health`，應返回 `status: ok`。
4. 免費方案可能休眠、下載較慢、檔案在重新部署/重啟後不保證保留；若使用付費方案可另外設定持久化磁碟並將 `TAIFEX_DATA_DIR` 指向掛載路徑。

## C. Vercel Next.js 前端
1. Vercel → Add New → Project，連接同一 GitHub repo。
2. Framework Preset 選 Next.js，Root Directory 為專案根目錄。
3. Environment Variables 新增：`NEXT_PUBLIC_API_URL` = `https://你的後端.onrender.com`（**不要**加 `/docs` 或最後的 `/`）。
4. Deploy。若更改環境變數，需重新部署前端。
5. 回 Render 設定 `ALLOWED_ORIGINS` 為 Vercel 真正的 https 網址，再部署/重啟 Render。

## D. 手機使用
用 Safari/Chrome 打開 Vercel 的 HTTPS 網址；iPhone Safari 分享 → 加入主畫面；Android Chrome 選單 → 加入主畫面。電腦可關機。

## 注意事項
- Phase 4 是雲端測試版，不保證 Render 免費資源能完成所有 TAIFEX 下載或長時間運算；大查詢可能超時。
- 本版本未加入登入、配額、速率限制與持久化雲端快取。**不建議直接公開大量使用者使用**。可先把前端網址僅分享給自己測試，但網址不構成真正的存取控制。
- 若 TAIFEX 封鎖雲端 IP 或變更下載介面，必須另行處理。
- 請先確認期交所資料使用及再散布條款，尤其是公開展示行情的情況。
- 本機執行仍可用 `start_frontend.bat` 與 `backend/start_backend.bat`，沒有設定 `NEXT_PUBLIC_API_URL` 時會使用同主機的 8000 port。
