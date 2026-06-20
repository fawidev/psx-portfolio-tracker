# PSX Portfolio Tracker

A single-page web app to track your **Pakistan Stock Exchange (PSX)** portfolios — across
multiple indexes (KSE-100, KMI-30, KSE-30, PSX All Share, or custom). It uses **Google login**,
stores all data in **your own Google Sheet** through a **Google Apps Script** backend, and is
hosted for free on **GitHub Pages**.

- 📊 Multiple isolated portfolios, each with its own holdings, investments, and metrics
- 💹 Live P&L, sector allocation, cumulative-investment charts (pure SVG, no chart library)
- 💸 SIP allocation planner based on KSE-100 style sector weights
- 🔒 Each user sees only their own data
- 🌙 Light + dark mode, fully responsive, PKR formatting (₨1,00,000)
- 🧩 No frameworks, no build step, no server — just one `index.html`

---

## What you'll deliver

```
psx-tracker/
  index.html        ← the entire app (HTML + CSS + JS)
  appsscript.gs     ← Google Apps Script backend code
  README.md         ← this file
```

You only ever deploy `index.html`. The `appsscript.gs` code is pasted into Google Apps Script.

---

## Setup — one-time, ~15 minutes

You do **not** need to be a programmer. Follow each step in order.

### Part A — The database (Google Sheet + Apps Script)

#### 1. Create the Google Sheet
1. Go to <https://sheets.google.com> and create a **Blank** spreadsheet.
2. Rename it to **`PSX Tracker Data`** (click the title at the top-left).

> You don't need to add any columns or tabs — the script creates them automatically.

#### 2. Open the Apps Script editor
1. In the sheet, click **Extensions → Apps Script**.
2. A new editor tab opens with a file called `Code.gs` containing an empty `myFunction`.
3. Delete everything in that file.
4. Open the `appsscript.gs` file from this project, copy **all** of it, and paste it in.
5. Click the **💾 Save** icon (or press Ctrl/Cmd + S).

#### 3. Deploy as a Web App
1. Click **Deploy → New deployment**.
2. Click the gear ⚙️ next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** `PSX Tracker API` (anything)
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
4. Click **Deploy**.
5. Google will ask you to **Authorize access** — click through, choose your account,
   click **Advanced → Go to (your project) (unsafe)**, then **Allow**.
   (This is normal — it's *your own* script accessing *your own* sheet.)
6. Copy the **Web app URL**. It looks like:
   `https://script.google.com/macros/s/AKfycb...../exec`

> 📌 **Keep this URL** — you'll paste it into `index.html` in step 7.

> ℹ️ Whenever you change `appsscript.gs` later, you must **Deploy → Manage deployments →
> ✏️ Edit → Version: New version → Deploy** for changes to take effect.

---

### Part B — Google login (OAuth Client ID)

#### 4. Create a Google Cloud project
1. Go to <https://console.cloud.google.com>.
2. At the top, click the project dropdown → **New Project** → name it `PSX Tracker` → **Create**.
3. Make sure the new project is selected.

#### 5. Configure the OAuth consent screen
1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** → **Create**.
3. Fill in the required fields:
   - **App name:** `PSX Tracker`
   - **User support email:** your email
   - **Developer contact email:** your email
4. **Save and Continue** through the Scopes and Test users pages (no changes needed).
5. Back on the consent screen, under **Test users**, add your own Google email
   (and any friends you want to let in) — or click **Publish App** to allow anyone.

#### 6. Create the OAuth Client ID
1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. **Application type:** **Web application**.
4. Under **Authorized JavaScript origins**, click **+ Add URI** and add:
   - `http://localhost:8000` (optional — for local testing)
   - You'll add your GitHub Pages URL here in step 11.
5. Click **Create**.
6. Copy the **Client ID** — it looks like `1234567890-abc123.apps.googleusercontent.com`.

> 📌 **Keep this Client ID** — you'll paste it into `index.html` next.

---

### Part C — Configure and publish the app

#### 7. Fill in the two placeholders in `index.html`
Open `index.html` in any text editor and find this block near the top of the `<script>`:

```js
const APPS_SCRIPT_URL  = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
const GOOGLE_CLIENT_ID = 'PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE';
```

- Replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the **Web app URL** from step 3.
- Replace `PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE` with the **Client ID** from step 6.

Save the file. (Keep the quotes!)

#### 8. Create a GitHub repository
1. Create a free account at <https://github.com> if you don't have one.
2. Click **+ → New repository**.
3. **Repository name:** `psx-tracker`, set it to **Public**, click **Create repository**.

#### 9. Upload `index.html`
1. On the repo page, click **Add file → Upload files**.
2. Drag in your edited `index.html`.
3. Click **Commit changes**.

#### 10. Turn on GitHub Pages
1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. **Branch:** `main`, folder `/ (root)` → **Save**.
4. Wait ~1 minute. GitHub shows your live URL, e.g.
   `https://YOUR-USERNAME.github.io/psx-tracker/`

#### 11. Authorize your GitHub Pages URL for login
1. Back in **Google Cloud Console → APIs & Services → Credentials**, open your OAuth client.
2. Under **Authorized JavaScript origins**, click **+ Add URI** and add your Pages origin
   **without** a trailing slash or path:
   - `https://YOUR-USERNAME.github.io`
3. Click **Save**. (Changes can take a few minutes to propagate.)

#### 12. Done 🎉
Open your GitHub Pages URL, click **Sign in with Google**, and start tracking.

---

## Using the app

- **New Portfolio** — click the chip at the top, give it a name, pick an index, set a monthly target.
- **Overview** — total invested, current value, P&L (green/red), SIP months, and charts.
- **Holdings** — add stocks; editing the *Current Price* inline auto-saves and recalculates P&L.
  Adding a symbol you already own automatically blends (averages down) the cost.
- **Add Investment** — log a contribution; see a suggested sector split from your monthly target.
- **History** — every logged investment with a running total; delete any record.
- Switch portfolios anytime with the chips at the top. Each portfolio is fully isolated.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **"GOOGLE_CLIENT_ID not configured"** on login screen | You didn't replace the placeholder in step 7. |
| Sign-in popup says **"origin not allowed"** / `redirect_uri_mismatch` | Add your exact Pages origin (e.g. `https://you.github.io`, no trailing slash) in step 11, then wait a few minutes. |
| **Login works but data won't load** | Re-check `APPS_SCRIPT_URL` (must end in `/exec`). Make sure the deployment access is **Anyone**. |
| **"Authorization required"** errors from the API | Re-run the deployment authorization (step 3.5). |
| Changed `appsscript.gs` but nothing changed | You must deploy a **New version** (see note under step 3). |
| Sign-in blocked / "access denied" | Add your email under **Test users**, or **Publish** the consent screen (step 5). |

---

## Privacy & data

All data lives in **your** `PSX Tracker Data` Google Sheet. The Apps Script runs as **you**, and
every read is filtered by the signed-in user's email, so each person only sees their own
portfolios. Nothing is sent to any third-party server — only to Google's own services.

## Tech notes

- Frontend: a single `index.html` — vanilla HTML/CSS/JS, no frameworks, no build step.
- Auth: Google Identity Services (the JWT is decoded client-side for the user's email + name).
- Backend: Google Apps Script web app exposing `doGet`/`doPost` with an `action` parameter.
- Storage: Google Sheets, one tab per data type (`Portfolios`, `Holdings`, `Investments`).
- Charts: hand-rolled inline SVG (no external chart libraries).
- Icons: [Tabler Icons](https://tabler.io/icons) via CDN.
