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
document.addEventListener("DOMContentLoaded", () => {
    const refreshBtn = document.getElementById("refreshBtn");
    const totalGross = document.getElementById("totalGross");
    const totalRevenue = document.getElementById("totalRevenue");
    const salesTBody = document.querySelector("#salesTable tbody");
    const reviewsList = document.querySelector(".reviews-list");
    const tabs = [...document.querySelectorAll(".tab")];
    const panels = [...document.querySelectorAll("[data-panel]")];
    const zones = document.querySelectorAll(".zone");
    const tooltip = document.getElementById('tooltip');
    let expectedGross = 0;
    let expectedNet = 0;

    // Tab switching
    function switchTo(tabName) {
        tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
        panels.forEach(p => p.style.display = p.dataset.panel === tabName ? "" : "none");
    }

    tabs.forEach(t => t.addEventListener("click", () => switchTo(t.dataset.tab)));

    setTooltip(zones[0], () => `Expected In Month: ${expectedGross}`);
    setTooltip(zones[1], () => `Expected In Month: ${expectedNet}`);

    // Load cached or fetch fresh on open
    chrome.runtime.sendMessage({type: "GET_CACHED_SALES"}, r => {
        r.success ? renderSales(r.data) : fetchSales();
    });
    chrome.runtime.sendMessage({type: "GET_CACHED_REVIEWS"}, r => {
        r.success ? renderReviews(r.data) : fetchReviews();
    });

    fetchDailySales();

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

    function fetchDailySales() {
        chrome.runtime.sendMessage({type: "GET_CACHED_DAILY_SALES"}, res => {
            if (res.success) {
                // Only render cached data if it has current-month entries
                const now = new Date();
                const anyCurrentMonth = Object.keys(res.data || {}).some(key => {
                    const d = new Date(key);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                });
                if (anyCurrentMonth) {
                    renderSalesChart(res.data);
                }
            }
            // Always fetch fresh data
            chrome.runtime.sendMessage({type: "FETCH_DAILY_SALES"}, res => {
                res.success ? renderSalesChart(res.data) 
                            : console.warn("Daily sales fetch failed");
            });
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
        const monthEl = document.querySelector(".sales-month");
        monthEl.textContent = new Date().toLocaleString("en-US", { month: 'long', year: 'numeric' });

        list.sort((a, b) => new Date(b.last) - new Date(a.last));
        let grossSum = 0, revSum = 0;
        list.forEach(r => {
            const tr = salesTBody.insertRow();
            [r.name,
                money(r.price),
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
        totalGross.textContent = money(grossSum.toFixed(2));
        totalRevenue.textContent = money(revSum.toFixed(2));
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const daysPassed = new Date().getDate();
        const grossPerDay = grossSum / daysPassed;
        const expected = grossPerDay * daysInMonth;
        expectedGross = money(Math.round(expected).toFixed(2));
        expectedNet = money(Math.round(expected * 0.7).toFixed(2));
        chrome.action.setTitle({
            title:  ` Unity Sales:  \n💰 Gross: ${totalGross.textContent}\n🏦 Net: ${totalRevenue.textContent}\n------\n📈 Expected: \nGross: ${expectedGross}\nNet: ${expectedNet}`
        });
    }

    function renderSalesChart(data) {
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    
        // Initialize array of objects for each day
        const salesByDay = Array.from({ length: daysInMonth }, () => ({
            gross: 0, sales: 0, refunds: 0, chargebacks: 0,
            downloads: 0, page_views: 0, quick_looks: 0,
            wishlisted: 0, carted: 0, free_obtained: 0, count_ratings: 0,
            height: 0
        }));
        let maxHeight = 0;
    
        // Fill in data from API (keys are date strings)
        for (let key in data) {
            const v = data[key];
            const day = new Date(key).getDate() - 1;  // zero-based index
            v.height = Math.max(v.gross || 0, 0);
            maxHeight = Math.max(maxHeight, v.height);
            salesByDay[day] = v;
        }
    
        const chart = document.getElementById('chart');
        chart.innerHTML = '';  // clear previous bars
    
        const chartWidth = chart.clientWidth;
        const chartHeight = chart.clientHeight;
        const barWidth = chartWidth / daysInMonth;
    
        for (let i = 0; i < daysInMonth; i++) {
            const v = salesByDay[i];
            const bar = document.createElement('div');
            bar.classList.add('bar');
            bar.style.left = `${i * barWidth}px`;
            bar.style.width = `${barWidth - 1}px`;
    
            // Top label (e.g. "1st:", "2nd:" is an improvement, though originally "1th:")
            let tooltip = `${i + 1}${["th","st","nd","rd"][((i+1)%10 > 3) ? 0 : ((i+1)%100 - (i+1)%10 != 10) * ( (i+1)%10 < 4 ? (i+1)%10 : 0 )]}:`; 
    
            // Add Gross/Net if any
            if (v.gross) {
                tooltip += `<br/>Gross: ${money(v.gross.toFixed(2))}`;
                tooltip += `<br/>Net: ${money((v.gross * 0.7).toFixed(2))}`;
            }
    
            // Always add Sales (0 if none)
            tooltip += `<br/>Sales: ${v.sales || 0}`;
    
            // Add other metrics only if present
            if (v.refunds) tooltip += `<br/>Refunds: ${v.refunds}`;
            if (v.chargebacks) tooltip += `<br/>Chargebacks: ${v.chargebacks}`;
            if (v.downloads) tooltip += `<br/>Downloads: ${v.downloads}`;
            if (v.page_views) tooltip += `<br/>Page Views: ${v.page_views}`;
            if (v.quick_looks) tooltip += `<br/>Quick Looks: ${v.quick_looks}`;
            if (v.wishlisted) tooltip += `<br/>Wishlisted: ${v.wishlisted}`;
            if (v.carted) tooltip += `<br/>Carted: ${v.carted}`;
            if (v.free_obtained) tooltip += `<br/>Free Obtained: ${v.free_obtained}`;
            if (v.count_ratings) tooltip += `<br/>Ratings: ${v.count_ratings}`;
    
            setTooltip(bar, () => tooltip);
    
            const barSegment = document.createElement('div');
            barSegment.classList.add('bar-segment');
            // Safe height calculation
            const heightPx = maxHeight > 0 ? (v.height / maxHeight) * chartHeight : 0;
            barSegment.style.height = `${heightPx}px`;
    
            bar.appendChild(barSegment);
            chart.appendChild(bar);
        }
    }

    function setTooltip(el, callback){
        el.addEventListener('mouseenter', (e) => {
            tooltip.innerHTML = callback();
            tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', (e) => {
            const px = Math.min(Math.max(e.pageX - tooltip.offsetWidth / 2, 0), window.innerWidth - tooltip.offsetWidth);
            tooltip.style.left = `${px}px`;
            tooltip.style.top = `${e.pageY + 30}px`;
        });
        el.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    }

    // Render reviews table with ★, subject, full text. now looks better)
    function renderReviews(list) {
        clearReviews();
        list.forEach(r => {
            const review = document.createElement("div");
            review.className = "review-card";
    
            const stars = "★".repeat(r.rating) + "✰".repeat(5 - r.rating);
    
            review.innerHTML = `
                <div class="review-header">
                    <a href="https://assetstore.unity.com/packages/slug/${r.packageId}#reviews" class="asset-name" target="_blank">${r.packageName}</a>
                    <span class="review-date">${(r.createdTime || "").slice(0,10)}</span>
                    <span class="review-rating">${stars}</span>
                </div>
                <div class="review-subject">${r.subject || "No Subject"}</div>
                <div class="review-text">${r.body || "No review text"}</div>
            `;
            reviewsList.appendChild(review);
        });
    }
    
    

    const wrapDiv = (text, params) => {
        const el = document.createElement("div");
        let textTarget = el;

        if (params.className) el.className = params.className;
        if (params.id) el.id = params.id;

        if (params.href) {
            const link = document.createElement("a");
            link.href = params.href;
            link.target = "_blank";
            el.appendChild(link);
            textTarget = link;
        }

        textTarget.textContent = text;

        return el;
    }

    // Helpers
    const num = s => parseFloat((s || "").replace(/[^\d.]/g, "")) || 0;
    const money = s => `$${s || "0.00"}`;
    const pretty = s => s ? `${Number(s.slice(8, 10))}th at ${s.slice(11, 16)}` : "";

    function clearSales() {
        salesTBody.innerHTML = "";
        totalGross.textContent = totalRevenue.textContent = "–";
    }

    function clearReviews() {
        reviewsList.innerHTML = "";
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


