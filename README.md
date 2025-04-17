# 🛒 Unity Publisher Dashboard – Chrome Extension

Modern Manifest V3 helper for Unity Asset‑Store publishers:

| What it does | How |
|--------------|------|
| **Sales & Reviews tabs** in a polished popup | reads the same endpoints the portal uses |
| **Gross Σ / Revenue Σ** at a glance | sums the monthly‑sales JSON |
| **Desktop notifications every 10 min** | new sales, new reviews, session‑expired |
| **Click a notification →** opens the relevant portal page | no credentials stored |


---

## 🔧 Installation (local)

1. **Clone / download** this repo.  
2. In Chrome/Edge open `chrome://extensions` and enable **Developer mode**.  
3. Click **Load unpacked** → select the `unity-sales-extension` folder.  
4. Log in to <https://publisher.unity.com> in a normal tab (sets the `_csrf` cookie).  
5. You’re done:
   * Popup instantly shows cached sales + reviews.  
   * Background worker polls every 10 minutes.  

---


🔧 Tweaks

Poll interval (minutes)	CHECK_INTERVAL_MINUTES in background.js

🛡️ Privacy
All API calls go only to Unity’s own domain.
No analytics, no third‑party requests, no data leaves your machine.

📜 License
MIT – free to use, modify, share. No warranty.

