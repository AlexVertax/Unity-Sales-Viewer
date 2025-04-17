const CHECK_INTERVAL_MINUTES = 10;
const NOTIFICATION_ID_EXPIRED = "unitySales-sessionExpired";
const NOTIFICATION_ID_NEW_SALES = "unitySales-newSales";
const NOTIFICATION_ID_NEW_REVIEWS = "unitySales-newReviews";

let lastFetchedData = null;  // We'll keep the most recent sales data here
let lastFetchedReviews = null;  // reviews array

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clear("checkSales", () => {
    chrome.alarms.create("checkSales", {
      periodInMinutes: CHECK_INTERVAL_MINUTES
    });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkSales") {
    
    checkForNewSales();
    checkForNewReviews();
  }
});
/* restore badge on browser restart */
chrome.storage.local.get("unread", ({ unread = 0 }) => {
  if (unread > 0) setBadge(String(unread));
});
/* ─── badge helpers ───────────────────────────── */
function setBadge(text, color = "#d93025") {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
function clearBadge() { chrome.action.setBadgeText({ text: "" }); }

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  /* ---------- SALES ---------- */
  if (message.type === "FETCH_SALES") {
    checkForNewSales()
      .then(d => sendResponse({ success:true, data:d }))
      .catch(e => sendResponse({ success:false, error:e.message }));
    return true;               // async
  }

  if (message.type === "GET_CACHED_SALES") {
    chrome.storage.local.get("lastSalesData", r => {
      if (Array.isArray(r.lastSalesData))
        sendResponse({ success:true, data:r.lastSalesData });
      else
        sendResponse({ success:false, error:"No cached sales yet." });
    });
    return true;
  }

  /* ---------- REVIEWS ---------- */
  if (message.type === "FETCH_REVIEWS") {
    checkForNewReviews()
      .then(d => sendResponse({ success:true, data:d }))
      .catch(e => sendResponse({ success:false, error:e.message }));
    return true;
  }

  if (message.type === "GET_CACHED_REVIEWS") {
    chrome.storage.local.get("lastReviewsData", r => {
      if (Array.isArray(r.lastReviewsData))
        sendResponse({ success:true, data:r.lastReviewsData });
      else
        sendResponse({ success:false, error:"No cached reviews yet." });
    });
    return true;
  }
  if (message.type === "CLEAR_BADGE") {
    chrome.storage.local.set({ unread: 0 }, clearBadge);
    // reply immediately; no async
    return;
  }
});


async function checkForNewSales() {
  try {
    const csrfToken = await getCsrfCookie();
    if (!csrfToken) {
      showSessionExpiredNotification();
      throw new Error("No _csrf cookie found. Possibly logged out or session expired.");
    }

    const now       = new Date();                  // local time 
    const yyyy      = now.getFullYear();
    const mm        = String(now.getMonth() + 1).padStart(2, "0");
    const firstDay  = `${yyyy}-${mm}-01`;          

    const url = `https://publisher.unity.com/publisher-v2-api/monthly-sales?date=${firstDay}`;
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        showSessionExpiredNotification();
        throw new Error(`Session expired: HTTP ${response.status}`);
      }
      throw new Error(`Fetch failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      console.warn("Unexpected data format:", data);
      lastFetchedData = data; // We'll still store it
      // NEW  ➜  persist it
      chrome.storage.local.set({ lastSalesData: data });
      return data;
    }

    // Compare counts for "new sales" detection
    const newCount = data.length;
    const { lastSalesCount } = await chrome.storage.local.get("lastSalesCount") || {};

    if (typeof lastSalesCount === "number" && newCount > lastSalesCount) {
      const diff = newCount - lastSalesCount;
      showNewSalesNotification(diff);
      const { unread = 0 } = await chrome.storage.local.get("unread");
const newTotal = unread + diff;
await chrome.storage.local.set({ unread: newTotal });
setBadge(String(newTotal));
    }

    // Update stored count & stored data
    await chrome.storage.local.set({ lastSalesCount: newCount });
    lastFetchedData = data;
    // NEW  ➜  persist it
    chrome.storage.local.set({ lastSalesData: data });
    return data;
  } catch (err) {
    console.error("checkForNewSales error:", err);
    throw err;
  }
}

async function checkForNewReviews() {
  const csrfToken = await getCsrfCookie();
  if (!csrfToken) { showSessionExpiredNotification(); return []; }

  const url  = "https://publisher.unity.com/publisher-v2-api/review/list";
  const body = { page: 1, perPage: 100 };        // tweak as you like

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) showSessionExpiredNotification();
    throw new Error(`Review fetch failed ${res.status}`);
  }

  const json = await res.json();
  const list = Array.isArray(json.results) ? json.results : [];

  /* ---------- new‑review detection ---------- */
  const newCount = list.length;
  const { lastReviewCount = 0 } = await chrome.storage.local.get("lastReviewCount");

  if (newCount > lastReviewCount) {
    const diff = newCount - lastReviewCount;
    chrome.notifications.create(NOTIFICATION_ID_NEW_REVIEWS, {
      type: "basic",
      iconUrl: "iconReview.png",
      title: "New Review!",
      message: `You have ${diff} new review(s) on the Asset Store.`
    });
    const { unread = 0 } = await chrome.storage.local.get("unread");
    const newTotal = unread + diff;
    await chrome.storage.local.set({ unread: newTotal });
    setBadge(String(newTotal));
  }

  await chrome.storage.local.set({ lastReviewCount: newCount, lastReviewsData: list });
  lastFetchedReviews = list;
  return list;
}

function showSessionExpiredNotification() {
  chrome.notifications.create(NOTIFICATION_ID_EXPIRED, {
    type: "basic",
    iconUrl: "iconSessionExpired.png",
    title: "Unity Session Expired",
    message: "Click here to re-auth at publisher.unity.com."
  });
}

function showNewSalesNotification(newSalesCount) {
  chrome.notifications.create(NOTIFICATION_ID_NEW_SALES, {
    type: "basic",
    iconUrl: "iconSale.png",
    title: "New Unity Sale!",
    message: `You have ${newSalesCount} new sale(s). Click to open publisher.unity.com.`
  });
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (
    notificationId === NOTIFICATION_ID_EXPIRED ||
    notificationId === NOTIFICATION_ID_NEW_SALES
    || id === NOTIFICATION_ID_NEW_REVIEWS
  ) {
        const url =
      id === NOTIFICATION_ID_NEW_REVIEWS
        ? "https://publisher.unity.com/reviews"
        : "https://publisher.unity.com/sales";
    chrome.tabs.create({ url });
    chrome.notifications.clear(notificationId);
  }
});

function getCsrfCookie() {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: "https://publisher.unity.com", name: "_csrf" }, (cookie) => {
      resolve(cookie ? cookie.value : null);
    });
  });
}
