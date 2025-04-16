# 🛒 Unity Publisher Sales Watcher (Chrome Extension)

A lightweight Manifest V3 extension that

* polls the **Unity Publisher v2 API** every 10 minutes,
* pops desktop notifications  
  * **“New Sales!”** – when your monthly‑sales list grows,  
  * **“Session Expired”** – when your CSRF/session cookies go stale,
* opens **`publisher.unity.com/sales`** on notification click so you can re‑auth or review sales,
* shows an in‑popup **sales table** with **Gross Σ** & **Revenue Σ** totals,
* stores **no credentials** – it re‑uses the cookies already set by Unity when you’re logged in.

---

## ✨ Features

| Feature                    | Details                                                                    |
|----------------------------|----------------------------------------------------------------------------|
| Background polling         | `chrome.alarms` every 10 min → fetch *monthly‑sales* for the current month |
| CSRF handling              | Reads the `_csrf` cookie → sets `X‑CSRF‑Token` automatically               |
| New‑sales detection        | Compares record count with previous check; diff ⇒ “New Sales” notification |
| Session‑expiry detection   | 401 / 403 or missing `_csrf` → “Session Expired” notification              |
| Popup UI                   | Table: Name / Price / Gross / Revenue / Sales / Refunds / Chargebacks / First / Last |
| Totals                     | Gross Σ and Revenue Σ displayed above the table                            |
| Manual refresh             | **Refresh Sales** button for on‑demand fetch                               |
| Notification click‑through | Opens `https://publisher.unity.com/sales` in a new tab                     |

---

## 🚀 Install locally

1. **Clone** or download this repo.  
2. Go to `chrome://extensions`, enable **Developer mode**.  
3. Click **Load unpacked** and choose the `unity-sales-extension` folder.  
4. Log in to <https://publisher.unity.com> in a normal tab.  
5. That’s it!  
   * The popup immediately shows cached data (if any).  
   * Background job checks every 10 minutes and fires notifications.

---

## 🧪 Testing notifications

Open the Service‑Worker console:

1. `chrome://extensions` → *Unity Publisher Sales Watcher* → **Service Worker** (Inspect).  
2. In the console run:

```js
// Test “session expired”
showSessionExpiredNotification();

// Test “new sales” – pretend 3 new items
showNewSalesNotification(3);
```
Each command fires the corresponding notification so you can verify layout and click‑through behaviour.

🔧 Tweaks

Poll interval (minutes)	CHECK_INTERVAL_MINUTES in background.js

🛡️ Privacy
All API calls go only to Unity’s own domain.
No analytics, no third‑party requests, no data leaves your machine.

📜 License
MIT – free to use, modify, share. No warranty.

