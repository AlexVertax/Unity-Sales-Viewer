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
document.addEventListener("DOMContentLoaded", () => {

  /* ---------- ELEMENTS ---------- */
  const totalGrossEl   = document.getElementById("totalGross");
  const totalRevenueEl = document.getElementById("totalRevenue");
  const salesTBody     = document.querySelector("#salesTable tbody");
  const reviewsTBody   = document.querySelector("#reviewsTable tbody");
  const tabs   = [...document.querySelectorAll(".tab")];
  const panels = [...document.querySelectorAll("[data-panel]")];

  /* ---------- TAB SWITCHING ---------- */
  function switchTo(tabName) {
    tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabName));
    panels.forEach(panel => {
      panel.style.display = (panel.dataset.panel === tabName) ? "" : "none";
    });
  }
  tabs.forEach(btn => {
    btn.onclick = () => switchTo(btn.dataset.tab);
  });

  /* ---------- INITIAL DATA & AUTO-REFRESH ---------- */
  chrome.runtime.sendMessage({ type: "GET_CACHED_SALES" }, res => {
    if (res?.success) renderSales(res.data);
    fetchSales();  // always fetch latest sales data
  });
  chrome.runtime.sendMessage({ type: "GET_CACHED_REVIEWS" }, res => {
    if (res?.success) renderReviews(res.data);
    fetchReviews(); // always fetch latest reviews data
  });

  /* ---------- AUTO-CLEAR BADGE ---------- */
  chrome.runtime.sendMessage({ type: "CLEAR_BADGE" });

  /* ---------- FETCH FUNCTIONS ---------- */
  function fetchSales() {
    blankSales();  // show loading state
    chrome.runtime.sendMessage({ type: "FETCH_SALES" }, res => {
      if (res?.success) {
        renderSales(res.data);
      } else {
        alert("Sales fetch failed – session expired?");
      }
    });
  }
  function fetchReviews() {
    blankReviews();
    chrome.runtime.sendMessage({ type: "FETCH_REVIEWS" }, res => {
      if (res?.success) {
        renderReviews(res.data);
      } else {
        alert("Review fetch failed – session expired?");
      }
    });
  }

  /* ---------- RENDER SALES TABLE ---------- */
  function renderSales(list) {
    blankSales();
    // Sort sales by most recent "Last" date (descending)
    const sorted = [...list].sort((a, b) => new Date(b.last) - new Date(a.last));
    let grossSum = 0, revenueSum = 0;
    for (const item of sorted) {
      const tr = document.createElement("tr");
      addCell(tr, item.name);
      addCell(tr, item.price);
      addCell(tr, money(item.gross));
      addCell(tr, money(item.revenue));
      addCell(tr, item.sales);
      addCell(tr, item.refunds);
      addCell(tr, item.chargebacks);
      addCell(tr, isoToPretty(item.first));
      addCell(tr, isoToPretty(item.last));
      salesTBody.appendChild(tr);
      grossSum   += toNumber(item.gross);
      revenueSum += toNumber(item.revenue);
    }
    totalGrossEl.textContent   = grossSum.toFixed(2);
    totalRevenueEl.textContent = revenueSum.toFixed(2);
  }

  /* ---------- RENDER REVIEWS TABLE ---------- */
  function renderReviews(list) {
    blankReviews();
    for (const rv of list) {
      const tr = document.createElement("tr");
      addCell(tr, rv.createdTime ? rv.createdTime.slice(0, 10) : "");  // Date (YYYY-MM-DD)
      addCell(tr, rv.packageName);
      addCell(tr, rv.rating);
      addCell(tr, rv.subject);
      addCell(tr, truncate(rv.body, 80));
      reviewsTBody.appendChild(tr);
    }
  }

  /* ---------- HELPERS & FORMATTERS ---------- */
  function addCell(row, textContent) {
    const td = document.createElement("td");
    td.textContent = textContent ?? "";
    row.appendChild(td);
  }
  const toNumber = str => parseFloat(String(str || "").replace(/[^0-9.\-]/g, "")) || 0;
  const money    = str => `${str || "0.00"} $`;
  const isoToPretty = isoStr => {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d)) return isoStr;
    // Format as "YYYY-MM-DD | HH:MM:SS"
    return d.toISOString().slice(0, 10) + " | " + d.toISOString().slice(11, 19);
  };
  const truncate = (text, maxLen) => {
    if (!text) return "";
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  };

  function blankSales() {
    salesTBody.innerHTML = "";
    totalGrossEl.textContent = totalRevenueEl.textContent = "–";
  }
  function blankReviews() {
    reviewsTBody.innerHTML = "";
  }
});
