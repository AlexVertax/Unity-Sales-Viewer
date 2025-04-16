const CHECK_INTERVAL_MINUTES = 10;
const NOTIFICATION_ID_EXPIRED = "unitySales-sessionExpired";
const NOTIFICATION_ID_NEW_SALES = "unitySales-newSales";

let lastFetchedData = null;  // We'll keep the most recent sales data here

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
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_SALES") {
    checkForNewSales()
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Indicates async response
  }

  else if (message.type === "GET_CACHED_SALES") {
    // Return whatever we have, or null if we haven't fetched anything yet
    if (lastFetchedData) {
      sendResponse({ success: true, data: lastFetchedData });
    } else {
      sendResponse({ success: false, error: "No data cached yet." });
    }
    // No async needed here, so no return needed
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
      return data;
    }

    // Compare counts for "new sales" detection
    const newCount = data.length;
    const { lastSalesCount } = await chrome.storage.local.get("lastSalesCount") || {};

    if (typeof lastSalesCount === "number" && newCount > lastSalesCount) {
      const diff = newCount - lastSalesCount;
      showNewSalesNotification(diff);
    }

    // Update stored count & stored data
    await chrome.storage.local.set({ lastSalesCount: newCount });
    lastFetchedData = data;

    return data;
  } catch (err) {
    console.error("checkForNewSales error:", err);
    throw err;
  }
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
  ) {
    chrome.tabs.create({ url: "https://publisher.unity.com/sales" });
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
