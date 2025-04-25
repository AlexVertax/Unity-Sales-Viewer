/* ────────────────────────────────────────────────────────────
 *  Unity Sales Viewer – Chrome Extension
 *  © 2025  Limitless Unity Development
 *  Licensed under the MIT License
 *  https://opensource.org/licenses/MIT
 *
 *  This extension is in no way affiliated with, authorized,
 *  maintained, sponsored or endorsed by Unity Technologies
 *  or any of its affiliates or subsidiaries.
 ──────────────────────────────────────────────────────────── */

/* ---------- CONSTANTS ---------- */
const CHECK_INTERVAL_MINUTES = 3;
const NOTIF_EXPIRED = "unitySales-sessionExpired";
const NOTIF_NEW_SALES = "unitySales-newSales";
const NOTIF_NEW_REVIEWS = "unitySales-newReviews";

const ICON_SALE = chrome.runtime.getURL("icons/iconSale.png");
const ICON_REVIEW = chrome.runtime.getURL("icons/iconReview.png");
const ICON_EXPIRED = chrome.runtime.getURL("icons/iconSessionExpired.png");

async function ensureCsrfCookie() {
    const cookie = await new Promise(r =>
        chrome.cookies.get(
            {url: "https://publisher.unity.com", name: "_csrf"},
            c => r(c)
        )
    );
    if (cookie) return;
    // need to login again in a hidden tab
    chrome.tabs.create(
        {url: "https://publisher.unity.com/sales", active: false},
        tab => {
            setTimeout(() => chrome.tabs.remove(tab.id), 4000);
        }
    );
    // give it a few seconds:
    await new Promise(r => setTimeout(r, 4500));
}

/* ---------- INSTALL/UPDATE EVENT ---------- */
chrome.runtime.onInstalled.addListener(async (details) => {
    // 1. Always schedule the periodic check alarm on install/update
    chrome.alarms.create("checkSales", {periodInMinutes: CHECK_INTERVAL_MINUTES});

    if (details.reason === "install") {
        // On first install, perform an immediate baseline fetch (no notifications)
        const firstDay = new Date().toISOString().slice(0, 7) + "-01";
        let salesList = [];
        try {
            salesList = await fetchSalesData(firstDay);  // fetch current month sales
        } catch (err) {
            console.error("Initial sales fetch failed:", err);
            if (err.message === "No CSRF token") {
                // User not logged in – prompt login
                showSessionExpiredNotification();
            }
            salesList = [];  // proceed with empty data if fetch failed
        }
        // Build baseline snapshot of sales and store it without triggering notifications
        const snapshot = buildSnapshot(salesList);
        const newestTs = salesList.reduce((m, r) => Math.max(m, Date.parse(r.last) || 0), 0);
        await chrome.storage.local.set({
            salesSnapshot: snapshot,
            lastNotifiedSaleTs: newestTs,   // mark all current sales as already handled
            lastReviewCount: 0              // initialize review count baseline
        });
        // Fetch and store current reviews count as baseline (no notifications for old reviews)
        try {
            const res = await fetch("https://publisher.unity.com/publisher-v2-api/review/list", {
                method: "POST",
                credentials: "include",
                headers: {
                    "X-CSRF-Token": await getCsrfCookie(),
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({page: 1, perPage: 100})
            });
            if (res.ok) {
                const data = await res.json();
                const reviewsList = Array.isArray(data.results) ? data.results : [];
                await chrome.storage.local.set({
                    lastReviewsData: reviewsList,
                    lastReviewCount: reviewsList.length  // baseline review count
                });
            } else if ([401, 403].includes(res.status)) {
                showSessionExpiredNotification();  // prompt login if session invalid
            }
        } catch (err) {
            console.error("Initial reviews fetch failed:", err);
            // If this fails (e.g., not logged in), lastReviewCount stays at 0
        }

    } else if (details.reason === "update") {
        // On update, ensure new features' data is initialized
        const {lastReviewCount} = await chrome.storage.local.get("lastReviewCount");
        if (lastReviewCount === undefined) {
            // Baseline reviews if updating from a version that didn’t track reviews
            try {
                const res = await fetch("https://publisher.unity.com/publisher-v2-api/review/list", {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "X-CSRF-Token": await getCsrfCookie(),
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({page: 1, perPage: 100})
                });
                if (res.ok) {
                    const data = await res.json();
                    const reviewsList = Array.isArray(data.results) ? data.results : [];
                    await chrome.storage.local.set({
                        lastReviewsData: reviewsList,
                        lastReviewCount: reviewsList.length
                    });
                } else if ([401, 403].includes(res.status)) {
                    showSessionExpiredNotification();
                }
            } catch (err) {
                console.error("Baseline reviews fetch on update failed:", err);
            }
        }
        // (No baseline fetch for sales on update to avoid missing a just-occurring sale;
        // existing salesSnapshot is retained from previous version.)
    }
});

/* ---------- BROWSER STARTUP EVENT ---------- */
chrome.runtime.onStartup.addListener(async () => {
    // Re-create the alarm on browser launch (alarms may not persist across restarts)
    chrome.alarms.create("checkSales", {periodInMinutes: CHECK_INTERVAL_MINUTES});
    // Immediately check for any new sales or reviews at startup
    try {
        await checkForNewSales();
        await checkForNewReviews();
    } catch (err) {
        console.warn("Startup check error:", err);
    }
});

/* ---------- ALARM EVENT (Periodic Checks) ---------- */
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "checkSales") {
        try {
            await checkForNewSales();
            await checkForNewReviews();
        } catch (err) {
            console.warn("Periodic check error:", err);
        }
    }
});

/* ---------- BADGE HELPERS ---------- */
function setBadge(text, color = "#d93025") {
    chrome.action.setBadgeText({text});
    chrome.action.setBadgeBackgroundColor({color});
}

function clearBadge() {
    chrome.action.setBadgeText({text: ""});
}

async function pushUnread(delta = 1) {
    const {unread = 0} = await chrome.storage.local.get("unread");
    const total = unread + delta;
    await chrome.storage.local.set({unread: total});
    setBadge(String(total));
}

/* Restore badge text after restart (e.g. keep unread count) */
chrome.storage.local.get("unread", ({unread = 0}) => {
    if (unread) setBadge(String(unread));
});

/* ---------- POPUP ↔ BACKGROUND MESSAGE HANDLER ---------- */
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "FETCH_SALES") {
        checkForNewSales()
            .then(data => reply({success: true, data}))
            .catch(err => reply({success: false, error: err.message}));
        return true; // keep message channel open for async response
    }
    if (msg.type === "FETCH_REVIEWS") {
        checkForNewReviews()
            .then(data => reply({success: true, data}))
            .catch(err => reply({success: false, error: err.message}));
        return true;
    }
    if (msg.type === "FETCH_DAILY_SALES") {
        fetchDailySales()
            .then(data => reply({success: true, data}))
            .catch(err => reply({success: false, error: err.message}));
        return true;
    }
    if (msg.type === "GET_CACHED_SALES") {
        chrome.storage.local.get("lastSalesData", data => {
            reply({success: !!data.lastSalesData, data: data.lastSalesData || []});
        });
        return true;
    }
    if (msg.type === "GET_CACHED_REVIEWS") {
        chrome.storage.local.get("lastReviewsData", data => {
            reply({success: !!data.lastReviewsData, data: data.lastReviewsData || []});
        });
        return true;
    }
    if (msg.type === "CLEAR_BADGE") {
        // Clear any new sales/reviews notifications and reset badge (Fix #5)
        chrome.notifications.getAll(notifs => {
            for (let id in notifs) {
                if (id.startsWith(NOTIF_NEW_SALES) || id.startsWith(NOTIF_NEW_REVIEWS)) {
                    chrome.notifications.clear(id);
                }
            }
        });
        chrome.storage.local.set({unread: 0}, clearBadge);
        reply({ok: true});
        return;
    }
});

/* ---------- HELPER: FETCH SALES DATA ---------- */
async function fetchSalesData(firstDay) {
    const csrf = await getCsrfCookie();
    if (!csrf) throw new Error("No CSRF token");  // not logged in
    const url = `https://publisher.unity.com/publisher-v2-api/monthly-sales?date=${firstDay}`;
    const res = await fetch(url, {
        credentials: "include",
        headers: {"X-CSRF-Token": csrf}
    });
    if (!res.ok) {
        if ([401, 403].includes(res.status)) showSessionExpiredNotification();
        throw new Error("sales fetch " + res.status);
    }
    return res.json();  // returns Promise that resolves to sales list array
}

/* ---------- SALES CHECK (Manual or Alarm) ---------- */
async function checkForNewSales() {
    await ensureCsrfCookie();
    const csrf = await getCsrfCookie();
    if (!csrf) {
        showSessionExpiredNotification();
        return [];  // not logged in
    }
    const firstDay = new Date().toISOString().slice(0, 7) + "-01";
    const url = `https://publisher.unity.com/publisher-v2-api/monthly-sales?date=${firstDay}`;
    const res = await fetch(url, {
        credentials: "include",
        headers: {"X-CSRF-Token": csrf}
    });
    if (!res.ok) {
        if ([401, 403].includes(res.status)) showSessionExpiredNotification();
        throw new Error("sales fetch " + res.status);
    }
    const salesList = await res.json();
    await chrome.storage.local.set({lastSalesData: salesList});
    await detectSalesDelta(salesList);  // compare with last snapshot and notify if new sales
    return salesList;
}

/* ---- Compare sales data to detect new sales ---- */
async function detectSalesDelta(currentRows) {
    const {salesSnapshot: prevSnap = {}, lastNotifiedSaleTs = 0} =
        await chrome.storage.local.get(["salesSnapshot", "lastNotifiedSaleTs"]);
    const currSnap = buildSnapshot(currentRows);
    const newestTs = currentRows.reduce((m, r) => Math.max(m, Date.parse(r.last) || 0), 0);

    if (newestTs > lastNotifiedSaleTs) {
        const events = [];
        for (const [pkgId, currData] of Object.entries(currSnap)) {
            const before = prevSnap[pkgId] || {sales: 0};
            const diff = (currData.sales || 0) - (before.sales || 0);
            if (diff > 0) {
                events.push({name: currData.name, price: currData.price, sales: currData.sales, qty: diff});
            }
        }
        if (events.length > 0) {
            sendSalesNotification(events, newestTs);
            await pushUnread(events.reduce((sum, e) => sum + e.qty, 0));
            await chrome.storage.local.set({lastNotifiedSaleTs: newestTs});
        }
    }
    // Update stored snapshot for next check
    await chrome.storage.local.set({salesSnapshot: currSnap});
}

/* ---- Build a snapshot (id→sales count) from sales list ---- */
function buildSnapshot(rows) {
    const snapshot = {};
    rows.forEach(r => {
        // use both id and price to distinguish entries
        const key = `${r.package_id}|${r.price}`;
        snapshot[key] = {
            name: r.name,
            price: r.price,
            sales: Number(r.sales) || 0
        };
    });
    return snapshot;
}

/* ---- Send notification for new sales ---- */
function sendSalesNotification(events, timestamp) {
    // Use unique notification ID (include timestamp) so each notification is distinct
    const notifId = `${NOTIF_NEW_SALES}-${timestamp || Date.now()}`;
    const iconUrl = ICON_SALE;
    if (events.length === 1) {
        const e = events[0];
        if (e.qty > 1) {

            for (let i = 0; i < e.qty; i++) {
                chrome.notifications.create(`${notifId}-${i}`, {
                    type: "basic",
                    title: "New Unity Sale!",
                    iconUrl,
                    message: `${e.name} — 1 × $${e.price}`
                });
            }
        } else {
            chrome.notifications.create(notifId, {
                type: "basic",
                title: "New Unity Sale!",
                iconUrl,
                message: `${e.name} — 1 × $${e.price}`
            });
        }
    } else {
        const totalQty = events.reduce((sum, e) => sum + e.qty, 0);
        const title = `${events.length} new sales • ${totalQty} assets sold`;
        const lines = events.slice(0, 5).map(e => `${e.name} — ${e.qty} × $${e.price}`);
        if (events.length > 5) {
            lines.push(`…and ${events.length - 5} more`);
        }
        chrome.notifications.create(notifId, {
            type: "basic",
            title: title,
            iconUrl,
            message: lines.join("\n")
        });
    }
}

async function fetchDailySales() {
    await ensureCsrfCookie();
    const csrf = await getCsrfCookie();
    if (!csrf) {
        showSessionExpiredNotification();
        return [];
    }
    const now = new Date();
    const start_date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end_date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const res = await fetch("https://publisher.unity.com/publisher-v2-api/dashboard/daily", {
        method: "POST", credentials: "include",
        headers: {"X-CSRF-Token": csrf, "Content-Type": "application/json"},
        body: JSON.stringify(
            {
                start_date: toShortISOString(start_date),
                end_date: toShortISOString(end_date),
                package_ids: []
            })
    });
    if (!res.ok) {
        if ([401, 403].includes(res.status)) showSessionExpiredNotification();
        throw new Error("daily sales fetch " + res.status);
    }
    return await res.json();
}

const toShortISOString = (date) => date.toISOString().split('.')[0] + 'Z';

/* ---------- REVIEWS CHECK (Manual or Alarm) ---------- */
async function checkForNewReviews() {
    await ensureCsrfCookie();
    const csrf = await getCsrfCookie();
    if (!csrf) {
        showSessionExpiredNotification();
        return [];
    }
    const res = await fetch("https://publisher.unity.com/publisher-v2-api/review/list", {
        method: "POST", credentials: "include",
        headers: {"X-CSRF-Token": csrf, "Content-Type": "application/json"},
        body: JSON.stringify({page: 1, perPage: 100})
    });
    if (!res.ok) {
        if ([401, 403].includes(res.status)) showSessionExpiredNotification();
        throw new Error("review fetch " + res.status);
    }
    const data = await res.json();
    const reviewsList = Array.isArray(data.results) ? data.results : [];
    await chrome.storage.local.set({lastReviewsData: reviewsList});

    const prevCount = (await chrome.storage.local.get("lastReviewCount")).lastReviewCount || 0;
    const diff = reviewsList.length - prevCount;
    if (diff > 0) {
        const newReviews = reviewsList.slice(prevCount);
        for (const rv of newReviews) {
            const rating = Number(rv.rating);
            const stars = "★".repeat(rating + "✰".repeat(5 - rating) || 0) || "–";
            const title = `${stars}  ${rv.subject}`;
            const body = rv.body.length > 2000 ? rv.body.slice(0, 2000) + "…" : rv.body;
            // give each review its own unique ID so it never collides
            const notifId = `${NOTIF_NEW_REVIEWS}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            chrome.notifications.create(notifId, {
                type: "basic",
                iconUrl: ICON_REVIEW,
                title: title,
                message: body
            });
            await pushUnread(1);
        }
    }
    await chrome.storage.local.set({lastReviewCount: reviewsList.length});
    return reviewsList;
}

/* ---------- NOTIFICATION CLICK HANDLERS ---------- */
chrome.notifications.onClicked.addListener(notificationId => {
    // Open the appropriate page when a notification is clicked
    const url = notificationId.startsWith(NOTIF_NEW_REVIEWS)
        ? "https://publisher.unity.com/reviews"
        : "https://publisher.unity.com/sales";
    chrome.tabs.create({url});
    chrome.notifications.clear(notificationId);
    // Clear badge count when sales/reviews notification is opened
    if (notificationId.startsWith(NOTIF_NEW_SALES) || notificationId.startsWith(NOTIF_NEW_REVIEWS)) {
        chrome.storage.local.set({unread: 0}, clearBadge);
    }
});
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
    if (byUser && (notificationId.startsWith(NOTIF_NEW_SALES) || notificationId.startsWith(NOTIF_NEW_REVIEWS))) {
        chrome.storage.local.set({unread: 0}, clearBadge);
    }
});

/* ---------- CSRF COOKIE HELPER ---------- */
function getCsrfCookie() {
    return new Promise(resolve => {
        chrome.cookies.get({url: "https://publisher.unity.com", name: "_csrf"}, cookie => {
            resolve(cookie ? cookie.value : null);
        });
    });
}

/* ---------- SESSION EXPIRED NOTIFICATION ---------- */
function showSessionExpiredNotification() {
    chrome.notifications.create(NOTIF_EXPIRED, {
        type: "basic",
        title: "Unity Session Expired",
        iconUrl: ICON_EXPIRED,
        message: "Click to log in again."
    });
}