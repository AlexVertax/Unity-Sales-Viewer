document.addEventListener("DOMContentLoaded", () => {

  /* ---------- ELEMENTS ---------- */
  const refreshBtn      = document.getElementById("refreshBtn");
  const totalGrossEl    = document.getElementById("totalGross");
  const totalRevenueEl  = document.getElementById("totalRevenue");
  const salesTBody      = document.querySelector("#salesTable tbody");
  const reviewsTBody    = document.querySelector("#reviewsTable tbody");
  const tabs   = [...document.querySelectorAll(".tab")];
  const panels = [...document.querySelectorAll("[data-panel]")];

  /* ---------- TAB HANDLING ---------- */
  function switchTo(name){
    tabs.forEach(b => b.classList.toggle("active", b.dataset.tab===name));
    panels.forEach(p => p.style.display = (p.dataset.panel===name) ? "" : "none");
  }
  tabs.forEach(btn => btn.onclick = () => switchTo(btn.dataset.tab));

  /* ---------- INITIAL DATA (cached) ---------- */
  chrome.runtime.sendMessage({ type:"GET_CACHED_SALES" }, r=>{
    if(r?.success) renderSales(r.data);
  });
  chrome.runtime.sendMessage({ type:"GET_CACHED_REVIEWS" }, r=>{
    if(r?.success) renderReviews(r.data);
  });

  /* ---------- REFRESH ---------- */
  refreshBtn.onclick = () => {
    const active = document.querySelector(".tab.active")?.dataset.tab || "sales";
    active === "sales" ? fetchSales() : fetchReviews();
  };
/* prettify "YYYY‑MM‑DDTHH:mm:ssZ" → "YYYY‑MM‑DD | HH:mm:ss" */
function isoToPretty(str){
  if(!str) return "";
  const d = new Date(str);
  if(isNaN(d)) return str;                       // fallback
  return `${d.toISOString().slice(0,10)} | ${d.toISOString().slice(11,19)}`;
}
  /* ---------- FETCH FUNCTIONS ---------- */
  function fetchSales(){
    blankSales();   // quick visual reset
    chrome.runtime.sendMessage({ type:"FETCH_SALES" }, res=>{
      if(res?.success) renderSales(res.data);
      else alert("Sales fetch failed (see console).");
    });
  }
  function fetchReviews(){
    blankReviews();
    chrome.runtime.sendMessage({ type:"FETCH_REVIEWS" }, res=>{
      if(res?.success) renderReviews(res.data);
      else alert("Review fetch failed (see console).");
    });
  }
  chrome.runtime.sendMessage({ type: "CLEAR_BADGE" });

  /* ---------- RENDER SALES ---------- */
  function renderSales(list){
    blankSales();
    /* sort by `last` date descending (most‑recent first) */
    list = [...list].sort((a, b) => new Date(b.last) - new Date(a.last));
    let grossSum=0, revSum=0;
    list.forEach(it=>{
      const tr = document.createElement("tr");
      addCell(tr,it.name);
      addCell(tr,it.price);
      addCell(tr,it.gross);
      addCell(tr,it.revenue);
      addCell(tr,it.sales);
      addCell(tr,it.refunds);
      addCell(tr,it.chargebacks);
      addCell(tr, isoToPretty(it.first));
      addCell(tr, isoToPretty(it.last));
      salesTBody.appendChild(tr);
      grossSum += toNum(it.gross);
      revSum   += toNum(it.revenue);
    });
    totalGrossEl.textContent   = grossSum.toFixed(2);
    totalRevenueEl.textContent = revSum.toFixed(2);
  }

  /* ---------- RENDER REVIEWS ---------- */
  function renderReviews(list){
    blankReviews();
    list.forEach(rv=>{
      const tr = document.createElement("tr");
      addCell(tr, rv.createdTime?.slice(0,10));
      addCell(tr, rv.packageName);
      addCell(tr, rv.rating);
      addCell(tr, rv.subject);
      addCell(tr, shorten(rv.body,80));
      reviewsTBody.appendChild(tr);
    });
  }

  /* ---------- HELPERS ---------- */
  function addCell(row,text){
    const td=document.createElement("td");
    td.textContent = text ?? "";
    row.appendChild(td);
  }
  const toNum = s => parseFloat((s??"").replace(/[^0-9.\-]/g,""))||0;
  const shorten = (t,max)=> (t||"").length>max ? (t.slice(0,max)+"…") : (t||"");
  function blankSales(){ salesTBody.innerHTML=""; totalGrossEl.textContent=totalRevenueEl.textContent="–"; }
  function blankReviews(){ reviewsTBody.innerHTML=""; }

});
