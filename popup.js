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
    const reviewsTBody = document.querySelector("#reviewsTable tbody");
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
        chrome.runtime.sendMessage({type: "FETCH_DAILY_SALES"}, res => {
            console.log(res);
            res.success ? renderSalesChart(res.data) : alert("Daily sales fetch failed");
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
        totalGross.textContent = money(grossSum.toFixed(2));
        totalRevenue.textContent = money(revSum.toFixed(2));

        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const daysPassed = new Date().getDate();
        const grossPerDay = grossSum / daysPassed;
        const expected = grossPerDay * daysInMonth;
        expectedGross = money(Math.round(expected).toFixed(2));
        expectedNet = money(Math.round(expected * 0.7).toFixed(2));
    }

    function renderSalesChart(data) {
        const salesByDay = {};

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let i = 1; i <= daysInMonth; i++) {
            salesByDay[i] = 0;
        }

        for (let key in data) {
            const day = new Date(key).getDate();
            const v = data[key];
            let sales = v.carted;
            if (v.chargebacks) sales -= v.chargebacks;
            if (v.refunds) sales -= v.refunds;
            salesByDay[day] += Math.max(sales, 0);
        }

        const chart = document.getElementById('chart');
        chart.innerHTML = '';

        const chartWidth = chart.clientWidth;
        const chartHeight = chart.clientHeight;

        const maxSales = Math.max(...Object.values(salesByDay), 1);

        const barWidth = chartWidth / daysInMonth;

        for (let i = 1; i <= daysInMonth; i++) {
            const sales = salesByDay[i];
            const bar = document.createElement('div');
            bar.classList.add('bar');
            bar.style.left = `${(i - 1) * barWidth}px`;
            bar.style.height = `${(sales / maxSales) * chartHeight}px`;
            bar.style.width = `${barWidth}px`;

            setTooltip(bar, () => `${i}th: ${sales} sales`);

            chart.appendChild(bar);
        }
    }

    function setTooltip(el, callback){
        el.addEventListener('mouseenter', (e) => {
            tooltip.textContent = callback();
            tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', (e) => {
            const px = Math.min(Math.max(e.pageX - tooltip.offsetWidth / 2, 0), window.innerWidth - tooltip.offsetWidth);
            tooltip.style.left = `${px}px`;
            tooltip.style.top = `${e.pageY - 30}px`;
        });
        el.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    }

    // Render reviews table with ★, subject, full text
    function renderReviews(list) {
        clearReviews();
        list.forEach(r => {
            const tr = reviewsTBody.insertRow();
            const td = tr.insertCell();
            const rating = Number(r.rating);
            const stars = "★".repeat(rating) + "✰".repeat(5 - rating) || "–";

            [
                wrapDiv(r.packageName, {
                    className: "packageName",
                    href: `https://assetstore.unity.com/packages/slug/${r.packageId}#reviews`
                }),
                wrapDiv(stars + " " + r.subject, {
                    className: "subject",
                    href: `https://publisher.unity.com/review/${r.threadId}/detail`
                }),
                wrapDiv(r.createdTime?.slice(0, 10), {className: "date"} ),
                wrapDiv(r.body, {className: "body"})
            ].forEach(el => {
                td.appendChild(el);
            });
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


