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
    const refreshBtn = document.getElementById("refreshBtn");
    const totalGross = document.getElementById("totalGross");
    const totalRevenue = document.getElementById("totalRevenue");
    const salesTBody = document.querySelector("#salesTable tbody");
    const reviewsTBody = document.querySelector("#reviewsTable tbody");
    const tabs = [...document.querySelectorAll(".tab")];
    const panels = [...document.querySelectorAll("[data-panel]")];

    // Tab switching
    function switchTo(tabName) {
        tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
        panels.forEach(p => p.style.display = p.dataset.panel === tabName ? "" : "none");
    }

    tabs.forEach(t => t.addEventListener("click", () => switchTo(t.dataset.tab)));

    // Load cached or fetch fresh on open
    chrome.runtime.sendMessage({type: "GET_CACHED_SALES"}, r => {
        r.success ? renderSales(r.data) : fetchSales();
    });
    chrome.runtime.sendMessage({type: "GET_CACHED_REVIEWS"}, r => {
        r.success ? renderReviews(r.data) : fetchReviews();
    });

    // Refresh button
    refreshBtn.addEventListener("click", () => {
        const active = document.querySelector(".tab.active").dataset.tab;
        active === "reviews" ? fetchReviews() : fetchSales();
    });

    // Clear badge count and mark notifications read when popup opens (Fix #5)
    chrome.runtime.sendMessage({type: "CLEAR_BADGE"});

    function fetchSales() {
        clearSales();
        chrome.runtime.sendMessage({type: "FETCH_SALES"}, res => {
            res.success ? renderSales(res.data) : alert("Sales fetch failed");
        });
    }

    function fetchReviews() {
        clearReviews();
        chrome.runtime.sendMessage({type: "FETCH_REVIEWS"}, res => {
            res.success ? renderReviews(res.data) : alert("Reviews fetch failed");
        });
    }

    // Render sales table
    function renderSales(list) {
        clearSales();
        list.sort((a, b) => new Date(b.last) - new Date(a.last));
        let grossSum = 0, revSum = 0;
        list.forEach(r => {
            const tr = salesTBody.insertRow();
            [r.name,
                r.price,
                money(r.gross),
                money(r.revenue),
                Number(r.sales) - Number(r.refunds),
                pretty(r.last),
                pretty(r.first),
            ].forEach(txt => {
                const td = tr.insertCell();
                td.textContent = txt;
            });
            grossSum += num(r.gross);
            revSum += num(r.revenue);
        });
        totalGross.textContent = grossSum.toFixed(2);
        totalRevenue.textContent = revSum.toFixed(2);
    }

    // Render reviews table with ★, subject, full text
    function renderReviews(list) {
        clearReviews();
        list.forEach(r => {
            const tr = reviewsTBody.insertRow();
            const rating = Number(r.rating);
            const stars = "★".repeat(rating) + "✰".repeat(5 - rating) || "–";
            [r.createdTime?.slice(0, 10),
                r.packageName,
                stars,
                r.subject,
                r.body
            ].forEach(txt => {
                const td = tr.insertCell();
                td.textContent = txt;
            });
        });
    }

    // Helpers
    const num = s => parseFloat((s || "").replace(/[^\d.]/g, "")) || 0;
    const money = s => `${s || "0.00"} $`;
    const pretty = s => s ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : "";

    function clearSales() {
        salesTBody.innerHTML = "";
        totalGross.textContent = totalRevenue.textContent = "–";
    }

    function clearReviews() {
        reviewsTBody.innerHTML = "";
    }

    // Ensure CSRF: silently open/close a tab to refresh cookie if missing
    function ensureCsrf() {
        return new Promise(res => {
            chrome.cookies.get({url: "https://publisher.unity.com", name: "_csrf"}, c => {
                if (c) return res();
                chrome.tabs.create({url: "https://publisher.unity.com/sales", active: false}, tab => {
                    setTimeout(() => chrome.tabs.remove(tab.id, res), 2000);
                });
            });
        });
    }

    const themeToggle = document.getElementById("themeToggle");
    const htmlEl = document.documentElement;

    // apply saved theme on load
    const saved = localStorage.getItem("theme") || "light";
    htmlEl.setAttribute("data-theme", saved);

    // toggle on click
    themeToggle.addEventListener("click", () => {
        const next = htmlEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
        htmlEl.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
    });

});
document.getElementById('openPortalBtn').addEventListener('click', () => {
    const activeTab = document.querySelector('.tab.active').dataset.tab;
    const url = activeTab === 'reviews'
        ? 'https://publisher.unity.com/reviews'
        : 'https://publisher.unity.com/sales';

    chrome.tabs.create({url});
});


