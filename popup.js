document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn      = document.getElementById("refreshBtn");
  const salesTableBody  = document.querySelector("#salesTable tbody");
  const totalGrossEl    = document.getElementById("totalGross");
  const totalRevenueEl  = document.getElementById("totalRevenue");

  /* ---------- INITIAL LOAD: show cached data if we have it ---------- */
  chrome.runtime.sendMessage({ type: "GET_CACHED_SALES" }, (res) => {
    if (res?.success && Array.isArray(res.data)) {
      renderTable(res.data);
    }
  });

  /* ---------- REFRESH BUTTON ---------- */
  refreshBtn.addEventListener("click", () => {
    // quick visual placeholder
    salesTableBody.innerHTML = "";
    totalGrossEl.textContent   = totalRevenueEl.textContent = "…";

    chrome.runtime.sendMessage({ type: "FETCH_SALES" }, (res) => {
      if (res?.success && Array.isArray(res.data)) {
        renderTable(res.data);
      } else {
        console.error(res?.error || "Unknown error");
        alert("Unable to fetch sales – see console for details.");
        totalGrossEl.textContent = totalRevenueEl.textContent = "–";
      }
    });
  });

  /* ---------- RENDER FUNCTION ---------- */
  function renderTable(data) {
    salesTableBody.innerHTML = "";
    let grossSum = 0;
    let revSum   = 0;

    data.forEach((item) => {
      // Build one row
      const tr = document.createElement("tr");
      appendCell(tr, item.name);
      appendCell(tr, item.price);
      appendCell(tr, item.gross);
      appendCell(tr, item.revenue);
      appendCell(tr, item.sales);
      appendCell(tr, item.refunds);
      appendCell(tr, item.chargebacks);
      appendCell(tr, item.first);
      appendCell(tr, item.last);
      salesTableBody.appendChild(tr);

      grossSum += parseNumber(item.gross);
      revSum   += parseNumber(item.revenue);
    });

    totalGrossEl.textContent   = grossSum.toFixed(2);
    totalRevenueEl.textContent = revSum.toFixed(2);
  }

  /* ---------- UTILITIES ---------- */
  function appendCell(row, text) {
    const td = document.createElement("td");
    td.textContent = text ?? "";
    row.appendChild(td);
  }

  function parseNumber(str) {
    // Converts "200.00", "$200", etc. -> 200
    const n = parseFloat((str ?? "").toString().replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
});
