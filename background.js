/* ────────────────────────────────────────────────────────────
 *  Unity Sales Viewer – Chrome Extension
 *  © 2025  Limitless Unity Development
 *  Licensed under the MIT License
 *  https://opensource.org/licenses/MIT
 *
 *  This extension is in no way affiliated with, authorized,
 *  maintained, sponsored or endorsed by Unity Technologies
 *  or any of its affiliates or subsidiaries.
 ──────────────────────────────────────────────────────────── */
/* ---------- CONSTANTS ---------- */
const CHECK_INTERVAL_MINUTES = 10;

const NOTIF_EXPIRED     = "unitySales-sessionExpired";
const NOTIF_NEW_SALES   = "unitySales-newSales";
const NOTIF_NEW_REVIEWS = "unitySales-newReviews";

const ICON_SALE    = chrome.runtime.getURL("icons/iconSale.png");
const ICON_REVIEW  = chrome.runtime.getURL("icons/iconReview.png");
const ICON_EXPIRED = chrome.runtime.getURL("icons/iconSessionExpired.png");

/* ---------- ON INSTALL ---------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("checkSales", { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

/* ---------- ALARM HANDLER ---------- */
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "checkSales") {
    checkForNewSales();
    checkForNewReviews();
  }
});

/* ---------- BADGE HELPERS ---------- */
function setBadge(text, color = "#d93025") {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

async function pushUnread(delta = 1) {
  const { unread = 0 } = await chrome.storage.local.get("unread");
  const total = unread + delta;
  await chrome.storage.local.set({ unread: total });
  setBadge(String(total));
}

/* Restore badge text after browser restart */
chrome.storage.local.get("unread", ({ unread = 0 }) => {
  if (unread) setBadge(String(unread));
});

/* ---------- POPUP ↔ BACKGROUND MESSAGE HANDLER ---------- */
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  /* Live fetch requests from popup (trigger immediate fetch) */
  if (msg.type === "FETCH_SALES") {
    checkForNewSales()
      .then(data => reply({ success: true, data }))
      .catch(err => reply({ success: false, error: err.message }));
    return true; // keep message channel open for async response
  }
  if (msg.type === "FETCH_REVIEWS") {
    checkForNewReviews()
      .then(data => reply({ success: true, data }))
      .catch(err => reply({ success: false, error: err.message }));
    return true;
  }

  /* Cached data requests from popup (return last stored data) */
  if (msg.type === "GET_CACHED_SALES") {
    chrome.storage.local.get("lastSalesData", data => {
      reply({ success: !!data.lastSalesData, data: data.lastSalesData || [] });
    });
    return true;
  }
  if (msg.type === "GET_CACHED_REVIEWS") {
    chrome.storage.local.get("lastReviewsData", data => {
      reply({ success: !!data.lastReviewsData, data: data.lastReviewsData || [] });
    });
    return true;
  }

  /* Clear badge request from popup */
  if (msg.type === "CLEAR_BADGE") {
    chrome.storage.local.set({ unread: 0 }, clearBadge);
    reply({ ok: true });
    return;
  }
});

/* ---------- SALES CHECK (polling and manual) ---------- */
async function checkForNewSales() {
  const csrf = await getCsrfCookie();
  if (!csrf) { 
    showSessionExpiredNotification();
    return []; // not logged in, abort fetch
  }

  const firstDay = new Date().toISOString().slice(0, 7) + "-01";
  const url = `https://publisher.unity.com/publisher-v2-api/monthly-sales?date=${firstDay}`;

  const res = await fetch(url, {
    credentials: "include",
    headers: { "X-CSRF-Token": csrf }
  });
  if (!res.ok) {
    if ([401, 403].includes(res.status)) showSessionExpiredNotification();
    throw new Error("sales fetch " + res.status);
  }

  const salesList = await res.json();
  await chrome.storage.local.set({ lastSalesData: salesList });

  await detectSalesDelta(salesList);  // may trigger notification & badge
  return salesList;
}

/* ---- detect per-asset differences (new sales since last check) ---- */
async function detectSalesDelta(list) {
  const { salesSnapshot: prevSnap = {}, lastNotifiedSaleTs = 0 } =
    await chrome.storage.local.get(["salesSnapshot", "lastNotifiedSaleTs"]);
  const currSnap = buildSnapshot(list);

  /* Find the latest sale timestamp in current data */
  const newestTs = list.reduce((max, item) => {
    const t = Date.parse(item.last) || 0;
    return t > max ? t : max;
  }, 0);

  /* If no new sale since last notification, update snapshot and abort */
  if (newestTs <= lastNotifiedSaleTs) {
    await chrome.storage.local.set({ salesSnapshot: currSnap });
    return;
  }

  const events = [];
  for (const [pkgId, now] of Object.entries(currSnap)) {
    const before = prevSnap[pkgId] || { sales: 0 };
    const diff = (now.sales || 0) - (before.sales || 0);
    if (diff > 0) {
      events.push({ name: now.name, qty: diff, price: now.price });
    }
  }

  if (events.length) {
    sendSalesNotification(events);
    await pushUnread(events.length);
    await chrome.storage.local.set({ lastNotifiedSaleTs: newestTs });
  }
  await chrome.storage.local.set({ salesSnapshot: currSnap });
}

/* ---- build a snapshot object from sales list ---- */
function buildSnapshot(rows) {
  const snapshot = {};
  rows.forEach(r => {
    snapshot[r.package_id] = {
      name:  r.name,
      price: r.price,
      sales: Number(r.sales) || 0
    };
  });
  return snapshot;
}

/* ---- create notification message for new sales ---- */
function sendSalesNotification(events) {
  const first = events[0];
  const message = (events.length === 1)
    ? `${first.name} ×${first.qty} @ ${first.price} $`
    : `${events.reduce((sum, e) => sum + e.qty, 0)} new sales • ${events.length} assets`;

  chrome.notifications.create(NOTIF_NEW_SALES, {
    type: "basic",
    title: "New Unity Sale!",
    iconUrl: ICON_SALE,
    message: message
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("NOTIF_NEW_SALES:", chrome.runtime.lastError.message);
    }
  });
}

/* ---------- REVIEWS CHECK (polling and manual) ---------- */
async function checkForNewReviews() {
  const csrf = await getCsrfCookie();
  if (!csrf) {
    showSessionExpiredNotification();
    return [];
  }

  const res = await fetch("https://publisher.unity.com/publisher-v2-api/review/list", {
    method: "POST",
    credentials: "include",
    headers: {
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ page: 1, perPage: 100 })
  });
  if (!res.ok) {
    if ([401, 403].includes(res.status)) showSessionExpiredNotification();
    throw new Error("review fetch " + res.status);
  }

  const data = await res.json();
  const reviewsList = Array.isArray(data.results) ? data.results : [];
  await chrome.storage.local.set({ lastReviewsData: reviewsList });

  const prevCount = (await chrome.storage.local.get("lastReviewCount")).lastReviewCount || 0;
  const diff = reviewsList.length - prevCount;
  if (diff > 0) {
    // Grab just the newly added reviews
    const newReviews = reviewsList.slice(prevCount);
  
    for (const rv of newReviews) {
      const stars = "★".repeat(Number(rv.rating) || 0) || "–";
      const title = `${stars}  ${rv.subject}`;
      // Chrome notifications message can be up to ~4–6 lines;
      // truncate long bodies if you like:
      const body  = rv.body.length > 200
        ? rv.body.slice(0,200) + "…"
        : rv.body;
  
      chrome.notifications.create(`${NOTIF_NEW_REVIEWS}-${rv.id}`, {
        type:    "basic",
        iconUrl: ICON_REVIEW,
        title,
        message: body
      });
  
      await pushUnread(1);
    }
  }
  await chrome.storage.local.set({ lastReviewCount: reviewsList.length });
  return reviewsList;
}

/* ---------- NOTIFICATION CLICKS ---------- */
chrome.notifications.onClicked.addListener(notificationId => {
  const url = (notificationId === NOTIF_NEW_REVIEWS)
    ? "https://publisher.unity.com/reviews"
    : "https://publisher.unity.com/sales";
  chrome.tabs.create({ url });
  chrome.notifications.clear(notificationId);

  /* If notification was for sales or reviews, mark as read (clear badge) */
  if ([NOTIF_NEW_SALES, NOTIF_NEW_REVIEWS].includes(notificationId)) {
    chrome.storage.local.set({ unread: 0 }, clearBadge);
  }
});

/* ---------- NOTIFICATION CLOSED (dismissed by user) ---------- */
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  if (byUser && [NOTIF_NEW_SALES, NOTIF_NEW_REVIEWS].includes(notificationId)) {
    chrome.storage.local.set({ unread: 0 }, clearBadge);
  }
});

/* ---------- CSRF COOKIE HELPER ---------- */
function getCsrfCookie() {
  return new Promise(resolve => {
    chrome.cookies.get({ url: "https://publisher.unity.com", name: "_csrf" }, cookie => {
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

/* ---------- WARM-UP (initial fetch on startup) ---------- */
(async () => {
  try {
    await checkForNewSales();
    await checkForNewReviews();
  } catch (e) {
    console.warn("Warm-up failed:", e);
  }
})();
