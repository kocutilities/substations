/* ============================================================
   Configuration
   ============================================================ */
const REFRESH_MS = 60 * 1000;          // reload meter-data.js this often
const STALE_MIN  = 3;                   // no reading for this long = not live
const MAX_POINTS = 3600;                // 1 h of raw seconds draws unbucketed; longer ranges bucket down


/* ============================================================
   Theme - stored under this page's own key, so no other page on this PC
   can change it or be changed by it
   ============================================================ */
const ICON_MOON = '<svg class="i" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICON_SUN  = '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/>' +
                  '<path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>';
(function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('pm1125h-meter-logger.theme'); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon();
})();
function updateThemeIcon() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.getElementById('themeBtn').innerHTML = dark ? ICON_SUN : ICON_MOON;
}
document.getElementById('themeBtn').addEventListener('click', function () {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pm1125h-meter-logger.theme', next); } catch (e) {}
    updateThemeIcon();
    render();                                   // charts are canvas: redraw in the new colours
});

// Both layouts now open their recordings menu themselves, in the page: this
// used to slide a sidebar in, and the elements no longer exist.

/* ============================================================
   Helpers
   ============================================================ */
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function ink() {
    return {
        text: css('--text'), dim: css('--text-dim'), faint: css('--text-faint'),
        grid: css('--border'), surface: css('--surface'),
    };
}
function alpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

let OFFSET_MS = 180 * 60000;                  // replaced from the data file (Kuwait, UTC+3)
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function local(ms) { return new Date(ms + OFFSET_MS); }   // read with getUTC* = site-local time
function fmtHM(ms)   { const d = local(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
function fmtDate(ms) { const d = local(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; }
function fmtDT(ms)   { return `${fmtDate(ms)} ${fmtHM(ms)}`; }
function fmtHMS(ms)  { const d = local(ms); return `${fmtHM(ms)}:${pad(d.getUTCSeconds())}`; }
let FINE = false;                                   // true while the view is raw sub-minute readings
function fmtAt(ms)   { return FINE ? `${fmtDate(ms)} ${fmtHMS(ms)}` : fmtDT(ms); }
function fmtDur(sec) { return sec < 60 ? `${sec} s` : sec < 3600 ? `${+(sec / 60).toFixed(1)} min` : `${+(sec / 3600).toFixed(1)} h`; }
function localDayKey(ms)  { const d = local(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - OFFSET_MS; }
function localHourKey(ms) { return Math.floor((ms + OFFSET_MS) / 3600000) * 3600000 - OFFSET_MS; }

const nf = (v, d = 1) => (v == null || !isFinite(v)) ? '–'
    : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const unit = (v, u, d) => `${nf(v, d)}<span class="unit">${u}</span>`;
const mean = a => { let s = 0, c = 0; for (const v of a) if (v != null) { s += v; c++; } return c ? s / c : null; };

/* ============================================================
   Data
   ============================================================ */
const charts = {};
let RANGE_H = 24;
try { const r = localStorage.getItem('pm1125h-meter-logger.range'); if (r !== null) RANGE_H = +r; } catch (e) {}

function dataset() { return window.METER_DATA || null; }

// The data file holds two views of one recording (tools/build_dashboard.py):
//   minute - one point per minute for the whole history
//   fine   - raw rows for the last few hours, only for 1-second recordings
// Short ranges use the raw readings when they cover the range; everything
// else uses the minute summaries, which keep each minute's true min and max.
function source(D) {
    if (!D) return null;
    const F = D.fine;
    if (F && F.t.length && RANGE_H && RANGE_H <= (D.meta.fine_hours || 0)) return F;
    return D.minute;
}
function latestView(D) { return D && D.fine && D.fine.t.length ? D.fine : (D ? D.minute : null); }
const timesOf = V => V.t.map(x => (V.t0 + x) * 1000);

// Rows in the selected range, as parallel arrays with absolute times (ms).
function slice() {
    const D = dataset();
    const V = source(D);
    if (!V || !V.t.length) return null;
    const t = timesOf(V);
    const last = t[t.length - 1];
    const from = RANGE_H ? last - RANGE_H * 3600000 + V.step * 1000 : -Infinity;
    let i0 = 0;
    while (i0 < t.length && t[i0] < from) i0++;
    const pick = key => (V[key] || []).slice(i0);
    const S = { t: t.slice(i0), last, from: t[i0], step: V.step };
    ['n','kw','kw_min','kw_max','kvar','kva','pf','pf_min','hz','v','v_min','v_max',
     'v_ry','v_yb','v_br','v_ry_max','v_yb_max','v_br_max','v_ry_min','v_yb_min','v_br_min','v_rn','v_yn','v_bn','ir','iy','ib','ir_max','iy_max','ib_max','ir_min','iy_min','ib_min','in','i','i_unbal','v_unbal','wh','dm_kva_peak',
     // harmonics, where the meter recorded them; absent keys slice to []
     'thd_ir','thd_iy','thd_ib','thd_ir_max','thd_vr','thd_vy','thd_vb']
        .forEach(k => S[k] = pick(k));

    // The meter reports currents below its suppression threshold (A.SUP) as
    // exactly 0. On this installation the smallest non-zero neutral reading is
    // 37.5 A (15 mA x 2500:1), so a 0 means "below the cut-off", not "no current".
    // Treat those as unknown so they neither draw a false dip nor drag averages down.
    S.inCut = S.in.map(v => v === 0);
    S.in = S.in.map(v => v === 0 ? null : v);
    const nz = (D.minute.in || []).concat(D.fine ? D.fine.in || [] : []).filter(v => v != null && v > 0);
    S.cutoff = nz.length ? Math.floor(Math.min(...nz)) : null;

    // Energy per row from the cumulative counter, index-aligned with t.
    // Negative or absurd jumps are a counter reset, not consumption, so they
    // contribute nothing. A gap's energy lands in the first row after it,
    // which keeps totals right at the cost of a little timing precision.
    const whAll = V.wh || [];
    S.e = S.t.map((_, j) => {
        const k = i0 + j;
        if (k === 0 || whAll[k] == null || whAll[k - 1] == null) return null;
        const d = whAll[k] - whAll[k - 1];
        return (d >= 0 && d < 5e7) ? d / 1000 : null;
    });
    return S;
}

// Bucket a time series down to <= MAX_POINTS for drawing. Each bucket keeps
// the mean, and the true min / max of the min / max columns, so peaks survive.
// Empty buckets become null, which breaks the line instead of bridging a gap.
function bucket(S, key, minKey, maxKey) {
    const stepMs = S.step * 1000;
    const span = (S.t[S.t.length - 1] - S.t[0]) / stepMs + 1;
    const size = Math.max(1, Math.ceil(span / MAX_POINTS)) * stepMs;
    const start = S.t[0];
    const nb = Math.floor((S.t[S.t.length - 1] - start) / size) + 1;
    const sum = new Float64Array(nb), cnt = new Uint32Array(nb);
    const mn = new Float64Array(nb).fill(Infinity), mx = new Float64Array(nb).fill(-Infinity);
    for (let j = 0; j < S.t.length; j++) {
        const b = Math.floor((S.t[j] - start) / size);
        const v = S[key][j];
        if (v != null) { sum[b] += v; cnt[b]++; }
        if (minKey) { const a = S[minKey][j] ?? v; if (a != null && a < mn[b]) mn[b] = a; }
        if (maxKey) { const a = S[maxKey][j] ?? v; if (a != null && a > mx[b]) mx[b] = a; }
    }
    const avg = [], lo = [], hi = [];
    for (let b = 0; b < nb; b++) {
        const x = start + b * size;
        avg.push({ x, y: cnt[b] ? sum[b] / cnt[b] : null });
        if (minKey) lo.push({ x, y: isFinite(mn[b]) ? mn[b] : null });
        if (maxKey) hi.push({ x, y: isFinite(mx[b]) ? mx[b] : null });
    }
    return { avg, lo, hi, sizeSec: size / 1000 };
}

/* ============================================================
   Chart plumbing
   ============================================================ */
if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.animation = false;
}

// Crosshair: a hairline at the hovered x, so every series is read at one instant.
const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
        const a = chart.tooltip && chart.tooltip.getActiveElements();
        if (!a || !a.length) return;
        const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = ink().dim; ctx.globalAlpha = .45; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.restore();
    }
};

function setHint(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function mount(id, config, emptyText) {
    const el = document.getElementById(id);
    // Each layout decides which panels it shows, so a missing canvas is not a
    // fault - it means this page does not draw that chart.
    if (!el) { charts[id] = null; return; }
    if (charts[id]) charts[id].destroy();
    const empty = el.parentElement.querySelector('.empty');
    if (empty && !empty.dataset.base) empty.dataset.base = empty.textContent;
    if (empty) empty.textContent = emptyText || empty.dataset.base;
    if (!config) { el.style.display = 'none'; if (empty) empty.style.display = 'grid'; charts[id] = null; return; }
    el.style.display = ''; if (empty) empty.style.display = 'none';
    charts[id] = new Chart(el, config);
}

function tooltipStyle() {
    const k = ink();
    return {
        backgroundColor: css('--bg-elev'), titleColor: k.text, bodyColor: k.text,
        borderColor: css('--border-strong'), borderWidth: 1, padding: 10,
        boxPadding: 4, usePointStyle: true, cornerRadius: 6,
    };
}

function timeAxis(S) {
    const k = ink();
    const spanH = (S.t[S.t.length - 1] - S.t[0]) / 3600000;
    return {
        type: 'linear', min: S.t[0], max: S.t[S.t.length - 1],
        grid: { display: false }, border: { color: k.grid },
        ticks: {
            color: k.dim, maxRotation: 0, autoSkipPadding: 18, maxTicksLimit: 8,
            callback: v => spanH > 30 ? fmtDate(v) + (spanH <= 96 ? ' ' + fmtHM(v) : '')
                : spanH < 0.5 ? fmtHMS(v) : fmtHM(v),
        },
    };
}
function valueAxis(title, opts = {}) {
    const k = ink();
    return Object.assign({
        grid: { color: k.grid, drawTicks: false }, border: { display: false },
        ticks: { color: k.dim, padding: 6, maxTicksLimit: 6 },
        title: title ? { display: true, text: title, color: k.faint, font: { size: 11 } } : undefined,
    }, opts);
}
const line = (label, data, color, extra = {}) => Object.assign({
    label, data, borderColor: color, backgroundColor: color,
    borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBorderWidth: 2,
    pointHoverBorderColor: ink().surface, tension: 0, spanGaps: false,
    borderJoinStyle: 'round', borderCapStyle: 'round', parsing: false,
}, extra);
// min-max band: upper bound fills down to the lower bound, as a 10% wash
const band = (lo, hi, color) => [
    { label: '_lo', data: lo, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, parsing: false, spanGaps: false },
    { label: '_hi', data: hi, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '-1',
      backgroundColor: alpha(color, .12), parsing: false, spanGaps: false },
];

function lineOptions(S, yTitle, yExtra, tooltipFmt, showLegend = true) {
    const k = ink();
    return {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 4 } },
        plugins: {
            legend: {
                display: showLegend, align: 'start',
                labels: {
                    color: k.text, usePointStyle: true, pointStyle: 'line', boxWidth: 18, padding: 14,
                    filter: it => !it.text.startsWith('_'),
                },
            },
            tooltip: Object.assign(tooltipStyle(), {
                filter: it => !it.dataset.label.startsWith('_'),
                callbacks: {
                    title: items => items.length ? fmtAt(items[0].parsed.x) : '',
                    label: it => ` ${it.dataset.label}: ${tooltipFmt(it.parsed.y)}`,
                },
            }),
            datalabels: { display: false },
            // Wheel or pinch to zoom, drag to scroll, double-click to reset.
            // Limited to the loaded range and to ten readings wide, so it can
            // never wander off the data or zoom past the resolution recorded.
            zoom: {
                limits: { x: { min: S.t[0], max: S.t[S.t.length - 1],
                               minRange: Math.max(S.step * 10000, 10000) } },
                // Dragging is handled below, not here: the plugin's pan works in
                // pixels and, against an axis of epoch milliseconds, moved the
                // view by days. Wheel and pinch zoom stay with the plugin.
                pan: { enabled: false },
                zoom: {
                    mode: 'x', wheel: { enabled: true, speed: .08 }, pinch: { enabled: true },
                    onZoomComplete: ({ chart }) => syncZoom(chart),
                },
            },
        },
        scales: { x: timeAxis(S), y: valueAxis(yTitle, yExtra) },
    };
}

// The time-series panels. They pan and zoom as one: reading current against
// power at the same instant is the whole point of having them on one page.
const TIME_CHARTS = ['cPower', 'cCurrent', 'cVolt', 'cPf', 'cHz', 'cVpair', 'cThdI', 'cThdV'];
let syncing = false;

function syncZoom(src) {
    if (syncing) return;
    syncing = true;
    const { min, max } = src.scales.x;
    TIME_CHARTS.forEach(id => {
        const c = charts[id];
        if (c && c !== src && c.zoomScale) c.zoomScale('x', { min, max }, 'none');
    });
    syncing = false;
    const zoomed = !!(src.isZoomedOrPanned && src.isZoomedOrPanned());
    document.getElementById('zoomReset').setAttribute('aria-pressed', String(zoomed));
}

// The buttons set the window themselves rather than calling the plugin's
// zoom()/pan(): those take pixels, and against an axis of epoch milliseconds
// they moved the view by days. Setting min and max is unambiguous.
let FULL = null;                        // [first, last] of what is loaded, ms

function liveChart() {
    const id = TIME_CHARTS.find(k => charts[k]);
    return id ? charts[id] : null;
}

function showWindow(lo, hi) {
    if (!FULL) return;
    const minSpan = Math.max((dataset()?.minute?.step || 60) * 10000, 10000);
    let span = Math.min(Math.max(hi - lo, minSpan), FULL[1] - FULL[0]);
    let mid = (lo + hi) / 2;
    lo = Math.max(FULL[0], Math.min(mid - span / 2, FULL[1] - span));
    hi = lo + span;
    syncing = true;
    TIME_CHARTS.forEach(id => charts[id] && charts[id].zoomScale &&
        charts[id].zoomScale('x', { min: lo, max: hi }, 'none'));
    syncing = false;
    const whole = hi - lo >= (FULL[1] - FULL[0]) - 1000;
    document.getElementById('zoomReset').setAttribute('aria-pressed', String(!whole));
}

function zoomBy(factor) {
    const c = liveChart(); if (!c) return;
    const { min, max } = c.scales.x, mid = (min + max) / 2, span = (max - min) / factor;
    showWindow(mid - span / 2, mid + span / 2);
}

// Move through time by a third of what is on screen.
function panBy(direction) {
    const c = liveChart(); if (!c) return;
    const { min, max } = c.scales.x, shift = (max - min) / 3 * direction;
    showWindow(min + shift, max + shift);
}

// Drag left or right to move through time. Vertical gestures are left to the
// page (touch-action: pan-y), so this does not fight scrolling on a phone.
function attachDrag(canvas) {
    let from = null;

    canvas.addEventListener('pointerdown', e => {
        const c = charts[canvas.id];
        if (!c || e.button !== 0) return;
        from = { x: e.clientX, min: c.scales.x.min, max: c.scales.x.max,
                 width: c.chartArea.right - c.chartArea.left };
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', e => {
        if (!from || !from.width) return;
        const perPixel = (from.max - from.min) / from.width;
        const shift = -(e.clientX - from.x) * perPixel;
        if (Math.abs(e.clientX - from.x) < 3) return;      // a click, not a drag
        showWindow(from.min + shift, from.max + shift);
    });

    const end = e => {
        if (!from) return;
        from = null;
        if (e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
        }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
}

function resetZoom() {
    syncing = true;
    TIME_CHARTS.forEach(id => charts[id] && charts[id].resetZoom && charts[id].resetZoom('none'));
    syncing = false;
    document.getElementById('zoomReset').setAttribute('aria-pressed', 'false');
}

function barOptions(yTitle, titleFmt, valueFmt, extra = {}) {
    const k = ink();
    return Object.assign({
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: Object.assign(tooltipStyle(), {
                callbacks: { title: titleFmt, label: it => ` ${valueFmt(it.parsed.y)}` },
            }),
            datalabels: { display: false },
        },
        scales: {
            x: { grid: { display: false }, border: { color: k.grid }, ticks: { color: k.dim, maxRotation: 0, autoSkipPadding: 8 } },
            y: valueAxis(yTitle, { beginAtZero: true }),
        },
    }, extra);
}
const barStyle = color => ({
    backgroundColor: color, hoverBackgroundColor: color,
    maxBarThickness: 24, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start',
    categoryPercentage: .8, barPercentage: .9,
});

/* ============================================================
   Render
   ============================================================ */
function render() {
    const D = dataset();
    if (D && D.meta) OFFSET_MS = (D.meta.tz_offset_min ?? 180) * 60000;
    const S = slice();
    updateStatus(D);
    FINE = !!(S && S.step < 60);
    FULL = S && S.t.length ? [S.t[0], S.t[S.t.length - 1]] : null;

    const hasFine = !!(D && D.fine && D.fine.t.length);
    document.getElementById('zoomReset').setAttribute('aria-pressed', 'false');
    if (D && D.meta) {
        // A survey file names its own site; the fixed installation's name is
        // baked into the page, and would otherwise label another panel's data.
        if (D.meta.site && !D.meta.feeder) {
            const put = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
            // With the picker in place the title is a control, not a label:
            // writing text into it would throw the dropdown away on every redraw.
            if (!document.getElementById('siteSelect')) {
                document.querySelector('.page-title').textContent =
                    D.meta.site + (document.body.dataset.titleSuffix || '');
            }
            document.title = `${D.meta.site} · Meter Trends`;
            put('navName', D.meta.site);
            put('sideSite', D.meta.site);
            put('sideDetail', `${D.meta.meter} · CT ${D.meta.ct}`);
            document.getElementById('crumbs').innerHTML =
                D.meta.site.split(/\s*\/\s*/).map(part =>
                    `<span class="crumb">${part}</span>`).join('') +
                `<span class="crumb" id="ctCrumb">CT ${D.meta.ct}</span>`;
        }
        const r = D.meta.resolution_s;
        document.getElementById('pageSub').textContent = r && r < 60
            ? `Recorded one reading every ${r === 1 ? 'second' : r + ' seconds'} from the PM1125H power meter`
            : 'Recorded one reading per minute from the PM1125H power meter';
    }
    document.querySelectorAll('#rangeSeg .fine-only').forEach(b => { b.hidden = !hasFine; });
    document.querySelectorAll('#rangeSeg button').forEach(b =>
        b.setAttribute('aria-pressed', String(+b.dataset.hours === RANGE_H)));

    if (!S || !S.t.length) {
        ['cPower','cCurrent','cPeriod','cVolt','cPf','cHz','cEnergy','cProfile','cPhaseAvg','cVpair','cThdI','cThdV'].forEach(id => mount(id, null));
        document.getElementById('rangeMeta').textContent = 'No readings recorded yet.';
        return;
    }

    const covered = (S.t[S.t.length - 1] - S.t[0]) / 3600000;
    const rangeName = !RANGE_H ? 'all recordings' : RANGE_H < 1 ? `last ${Math.round(RANGE_H * 60)} min`
        : RANGE_H < 48 ? `last ${RANGE_H} h` : `last ${RANGE_H / 24} days`;
    const what = FINE ? `${S.step}-second readings` : (D.meta.resolution_s < 60 ? 'minute summaries' : 'readings');
    document.getElementById('rangeMeta').textContent =
        `${S.t.length.toLocaleString()} ${what} · ${fmtAt(S.t[0])} – ${fmtAt(S.t[S.t.length - 1])}` +
        (RANGE_H && covered + 0.02 < RANGE_H ? ` · only ${covered < 1 ? Math.round(covered * 60) + ' min' : covered.toFixed(1) + ' h'} recorded so far` : '');

    renderKpis(S, rangeName);
    renderPower(S);
    renderCurrents(S);
    renderPeriods(S);
    renderPhaseNeutral(S);
    renderThd(S);
    renderSmallTrend(S, 'cPf', 'Power factor', 'pf', 'pf_min', null, '--accent', '', 3);
    renderSmallTrend(S, 'cHz', 'Frequency', 'hz', null, null, '--accent', 'Hz', 2);
    renderEnergy(S);
    renderProfile(S);
    renderPhaseAvg(S);
    renderVpair(S);
    renderAssessment();
    renderLegends(S);          // v2 only: the min/max/avg/current tables
    renderGauge(S);            // v2 only: the power-factor dial

    const M = D.meta;
    const footEl = document.getElementById('footNote') || document.getElementById('foot');
    footEl.innerHTML =
        `${M.meter} · CT ${M.ct} · data file updated ${fmtDT(M.generated_ms)} · ` +
        `${M.rows_in_db.toLocaleString()} readings stored since ${fmtDT(Date.parse(M.first_in_db))}, ` +
        `recorded every ${fmtDur(M.resolution_s)}` +
        (M.fine_hours ? ` (raw readings shown for ranges up to ${M.fine_hours} h; longer ranges use per-minute summaries)` : '') +
        `. ` +
        `Times are Kuwait local time (UTC+3). Energy is taken from the meter's cumulative kWh counter, ` +
        `so totals stay correct across gaps in recording. Charts spanning long ranges average readings into ` +
        `buckets but keep each bucket's true minimum and maximum.`;
}

function updateStatus(D) {
    // The page shows no live/stale pill any more: these are survey recordings,
    // finished days read back from a file, so "Not updating" was telling the
    // truth about a thing nobody was waiting for. The range line already says
    // which day is on screen.
    const el = document.getElementById('status'), txt = document.getElementById('statusText');
    if (!el || !txt) return;
    const V = latestView(D);
    if (!V || !V.t.length) { el.className = 'status stale'; txt.textContent = 'No data yet'; return; }
    const lastMs = (V.t0 + V.t[V.t.length - 1]) * 1000;
    const ageMin = (Date.now() - lastMs) / 60000;
    if (ageMin <= STALE_MIN) {
        el.className = 'status live';
        txt.innerHTML = `Live <small>· last reading ${V.step < 60 ? fmtHMS(lastMs) : fmtHM(lastMs)}</small>`;
    } else {
        el.className = 'status stale';
        txt.innerHTML = `Not updating <small>· last reading ${fmtDT(lastMs)}</small>`;
    }
}

// "<37 A" when the cut-off is known, "below cut-off" when every reading was cut
function neutralText(value, cut, S) {
    if (value != null) return `${nf(value, 0)} A`;
    if (cut) return S.cutoff ? `<${S.cutoff} A` : 'below cut-off';
    return '– A';
}

function renderKpis(S, rangeName) {
    const L = S.t.length - 1;
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

    set('kpiKw', unit(S.kw[L], 'kW', 1));
    set('kpiKwSub', `avg ${nf(mean(S.kw), 1)} kW · ${nf(S.kvar[L], 1)} kVAR now`);

    const pfNow = S.pf[L];
    let pfMin = null; S.t.forEach((_, j) => { const x = S.pf_min[j] ?? S.pf[j]; if (x != null && (pfMin == null || x < pfMin)) pfMin = x; });
    set('kpiPf', nf(pfNow, 3));
    set('kpiPfSub', `lowest ${nf(pfMin, 3)} in ${rangeName}`);

    set('kpiV', unit(S.v[L], 'V', 1));

    // Peak / low = the highest and lowest single phase-pair voltage. Only a
    // sub-minute recording has every reading of each pair; the minute recording
    // keeps min/max for the 3-phase average only (its pair columns are one sample
    // per minute), so there both are of the average and say so.
    let vPk = -Infinity, vPkAt = null, vPkWhat = '', vLw = Infinity, vLwAt = null, vLwWhat = '';
    const vSeen = (hi, lo, t, what) => {
        if (hi != null && hi > vPk) { vPk = hi; vPkAt = t; vPkWhat = what; }
        if (lo != null && lo < vLw) { vLw = lo; vLwAt = t; vLwWhat = what; }
    };
    if ((dataset().meta.resolution_s || 60) < 60) {
        S.t.forEach((t, j) => [['R-Y', 'v_ry'], ['Y-B', 'v_yb'], ['B-R', 'v_br']].forEach(([pair, k]) =>
            vSeen(S[k + '_max'][j] ?? S[k][j], S[k + '_min'][j] ?? S[k][j], t, pair)));
    } else {
        S.t.forEach((t, j) => vSeen(S.v_max[j] ?? S.v[j], S.v_min[j] ?? S.v[j], t, '3-phase avg'));
    }
    set('kpiVSub', vPkAt ? `peak ${nf(vPk, 1)} V (${vPkWhat}) at ${fmtAt(vPkAt)}` : '&nbsp;');
    set('kpiVPk',  vLwAt ? `low ${nf(vLw, 1)} V (${vLwWhat}) at ${fmtAt(vLwAt)}` : '&nbsp;');

    set('kpiI', unit(S.i[L], 'A', 1));
    set('kpiISub', `R ${nf(S.ir[L], 0)} · Y ${nf(S.iy[L], 0)} · B ${nf(S.ib[L], 0)} · N ${neutralText(S.in[L], S.inCut[L], S)}`);

    // Peak / low = the highest and lowest single-phase reading in the range.
    // Minute summaries carry each minute's true max and min; raw 1-second rows
    // are their own max and min.
    let iPk = -Infinity, iPkAt = null, iPkPh = '', iLw = Infinity, iLwAt = null, iLwPh = '';
    S.t.forEach((t, j) => {
        [['R', 'ir'], ['Y', 'iy'], ['B', 'ib']].forEach(([ph, k]) => {
            const hi = S[k + '_max'][j] ?? S[k][j], lo = S[k + '_min'][j] ?? S[k][j];
            if (hi != null && hi > iPk) { iPk = hi; iPkAt = t; iPkPh = ph; }
            if (lo != null && lo < iLw) { iLw = lo; iLwAt = t; iLwPh = ph; }
        });
    });
    set('kpiIPk', iPkAt ? `peak ${nf(iPk, 1)} A (${iPkPh} phase) at ${fmtAt(iPkAt)}` : '&nbsp;');
    set('kpiILw', iLwAt ? `low ${nf(iLw, 1)} A (${iLwPh} phase) at ${fmtAt(iLwAt)}` : '&nbsp;');

    const energy = S.e.reduce((s, v) => s + (v || 0), 0);
    set('kpiE', unit(energy, 'kWh', energy < 1000 ? 1 : 0));
    set('kpiESub', `since ${fmtDT(S.t[0])}`);

    let pk = -Infinity, pkAt = null;
    S.t.forEach((t, j) => { const v = S.kw_max[j] ?? S.kw[j]; if (v != null && v > pk) { pk = v; pkAt = t; } });
    set('kpiPk', isFinite(pk) ? unit(pk, 'kW', 1) : '–');
    set('kpiPkSub', pkAt ? `at ${fmtAt(pkAt)} (highest single reading)` : '&nbsp;');

    const avgKw = mean(S.kw);
    const lf = (avgKw != null && pk > 0) ? avgKw / pk : null;
    set('kpiLf', lf == null ? '–' : unit(lf * 100, '%', 0));
    set('kpiLfSub', lf == null ? '&nbsp;' : `average ÷ peak · ${lf >= .7 ? 'steady load' : lf >= .5 ? 'moderately variable' : 'peaky load'}`);

    const ub = mean(S.i_unbal);
    let chip = '';
    if (ub != null) {
        const [cls, label] = ub <= 5 ? ['good', 'Balanced'] : ub <= 10 ? ['warn', 'Watch'] : ['bad', 'High'];
        const icon = cls === 'good' ? '✓' : '!';
        chip = `<span class="chip ${cls}" title="Average current unbalance">${icon} ${label}</span>`;
    }
    set('kpiUb', ub == null ? '–' : unit(ub, '%', 1) + chip);
    set('kpiUbSub', `${rangeName} average · neutral ${mean(S.in) != null ? '≈ ' : ''}${neutralText(mean(S.in), S.inCut.some(Boolean), S)}`);
    document.getElementById('kpiUbSub').title = S.inCut.some(Boolean) && S.cutoff
        ? `Neutral average leaves out minutes below the meter's ${S.cutoff} A cut-off` : '';
}

function renderPower(S) {
    const kw = bucket(S, 'kw', 'kw_min', 'kw_max');
    const kvar = bucket(S, 'kvar'), kva = bucket(S, 'kva');
    const cKw = css('--pw-kw'), cKvar = css('--pw-kvar'), cKva = css('--pw-kva');
    const how = kw.sizeSec > S.step ? `each point averages ${fmtDur(kw.sizeSec)} · band = kW min–max`
        : S.step < 60 ? `raw ${S.step}-second readings` : 'band = kW min–max within each minute';
    setHint('hintPower', `${how} · drag to move · scroll to zoom · buttons above`);
    mount('cPower', {
        type: 'line',
        data: { datasets: [
            ...band(kw.lo, kw.hi, cKw),
            // draw order: kVA first so kW lands on top - at a power factor near 1
            // the two lines coincide and kW would otherwise be hidden
            line('Apparent power (kVA)', kva.avg, cKva, { borderWidth: 0.75, legendRank: 3 }),
            line('Reactive power (kVAR)', kvar.avg, cKvar, { legendRank: 2 }),
            line('Active power (kW)', kw.avg, cKw, { borderWidth: 1.25, legendRank: 1 }),
        ]},
        options: (() => {
            const o = lineOptions(S, 'kW · kVAR · kVA', { beginAtZero: true }, v => nf(v, 1));
            const rank = { 'Active power (kW)': 1, 'Reactive power (kVAR)': 2, 'Apparent power (kVA)': 3 };
            o.plugins.legend.labels.sort = (a, b) => (rank[a.text] ?? 9) - (rank[b.text] ?? 9);
            o.plugins.tooltip.itemSort = (a, b) => (a.dataset.legendRank ?? 9) - (b.dataset.legendRank ?? 9);
            return o;
        })(),
        plugins: [crosshair],
    });
}

function renderCurrents(S) {
    const r = bucket(S, 'ir'), y = bucket(S, 'iy'), b = bucket(S, 'ib'), n = bucket(S, 'in');
    const cut = S.inCut.filter(Boolean).length;
    setHint('hintCurrent', !cut ? 'R · Y · B and neutral'
        : S.cutoff ? `neutral gaps = below the meter's ${S.cutoff} A cut-off (${cut} min)`
        : `neutral below the meter's current cut-off (${cut} min)`);
    mount('cCurrent', {
        type: 'line',
        data: { datasets: [
            line('R phase', r.avg, css('--ph-r')),
            line('Y phase', y.avg, css('--ph-y')),
            line('B phase', b.avg, css('--ph-b')),
            line('Neutral', n.avg, css('--ph-n'), { borderWidth: 0.75 }),
        ]},
        options: lineOptions(S, 'Amps', { beginAtZero: true }, v => `${nf(v, 1)} A`),
        plugins: [crosshair],
    });
}


function renderThd(S) {
    const row = document.getElementById('thdRow');
    if (!row) return;
    const has = ['thd_ir', 'thd_iy', 'thd_ib', 'thd_vr', 'thd_vy', 'thd_vb']
        .some(k => (S[k] || []).some(v => v != null));
    // A recording made with harmonics off has no THD columns at all. Drawing an
    // empty chart would read as "no distortion" instead of "not measured".
    row.hidden = !has;
    if (!has) { mount('cThdI', null); mount('cThdV', null); return; }

    const r = bucket(S, 'thd_ir'), y = bucket(S, 'thd_iy'), b = bucket(S, 'thd_ib');
    const worst = Math.max(...[r.avg, y.avg, b.avg].flat()
        .map(p => p && p.y).filter(v => v != null), 0);
    setHint('hintThd', `per phase · worst ${nf(worst, 0)} % in this range`);

    mount('cThdI', {
        type: 'line',
        data: { datasets: [
            line('R phase', r.avg, css('--ph-r')),
            line('Y phase', y.avg, css('--ph-y')),
            line('B phase', b.avg, css('--ph-b')),
        ]},
        options: lineOptions(S, '% of fundamental', { beginAtZero: true }, v => `${nf(v, 1)} %`),
        plugins: [crosshair],
    });

    const vr = bucket(S, 'thd_vr'), vy = bucket(S, 'thd_vy'), vb = bucket(S, 'thd_vb');
    mount('cThdV', {
        type: 'line',
        data: { datasets: [
            line('R-N', vr.avg, css('--ph-r')),
            line('Y-N', vy.avg, css('--ph-y')),
            line('B-N', vb.avg, css('--ph-b')),
        ]},
        // Voltage distortion is small where current distortion is large, so a
        // shared axis would flatten it to nothing. Its own scale, starting at
        // zero so the size is not exaggerated either.
        options: lineOptions(S, '% of fundamental', { beginAtZero: true, suggestedMax: 5 },
                             v => `${nf(v, 2)} %`),
        plugins: [crosshair],
    });

}

function renderSmallTrend(S, id, label, key, minKey, maxKey, colorVar, u, d) {
    if (!S[key].some(v => v != null)) return mount(id, null);
    const s = bucket(S, key, minKey, maxKey);
    const color = css(colorVar);
    const sets = [];
    if (minKey && maxKey) sets.push(...band(s.lo, s.hi, color));
    sets.push(line(label, s.avg, color));
    const yExtra = key === 'pf' ? { suggestedMax: 1 } : key === 'hz' ? { suggestedMin: 49.8, suggestedMax: 50.2 } : {};
    // single series: no legend box, the panel title names it
    mount(id, {
        type: 'line', data: { datasets: sets },
        options: lineOptions(S, u, yExtra, v => `${nf(v, d)}${u ? ' ' + u : ''}`, false),
        plugins: [crosshair],
    });
}

function renderEnergy(S) {
    const spanH = (S.t[S.t.length - 1] - S.t[0]) / 3600000;
    const byDay = spanH > 48;
    const keyOf = byDay ? localDayKey : localHourKey;
    const map = new Map(), mins = new Map();
    S.t.forEach((t, j) => { const k = keyOf(t); mins.set(k, (mins.get(k) || 0) + S.step);
        if (S.e[j] != null) map.set(k, (map.get(k) || 0) + S.e[j]); });
    const keys = [...map.keys()].sort((a, b) => a - b);
    const full = byDay ? 86400 : 3600;                // seconds in the bucket
    const cover = keys.map(k => Math.min(1, (mins.get(k) || 0) / full));
    document.getElementById('hEnergy').textContent = byDay ? 'Energy per day' : 'Energy per hour';
    setHint('hintEnergy', (byDay ? 'kWh, local days' : 'kWh, local hours') + ' · lighter = not fully recorded');
    if (!keys.length) return mount('cEnergy', null);
    mount('cEnergy', {
        type: 'bar',
        data: {
            labels: keys.map(k => byDay ? fmtDate(k) : fmtHM(k)),
            datasets: [{ label: 'Energy', data: keys.map(k => map.get(k)), ...barStyle(css('--accent')),
                backgroundColor: cover.map(c => c >= .98 ? css('--accent') : alpha(css('--accent'), .38)),
                hoverBackgroundColor: cover.map(c => c >= .98 ? css('--accent') : alpha(css('--accent'), .55)) }],
        },
        options: (() => {
            const o = barOptions('kWh',
                items => items.length ? (byDay ? fmtDate(keys[items[0].dataIndex]) :
                    `${fmtDate(keys[items[0].dataIndex])} ${fmtHM(keys[items[0].dataIndex])}–${fmtHM(keys[items[0].dataIndex] + 3600000)}`) : '',
                v => `${nf(v, 1)} kWh`);
            o.plugins.tooltip.callbacks.afterLabel = it => cover[it.dataIndex] < .98
                ? ` recorded ${Math.round(cover[it.dataIndex] * full / 60)} of ${full / 60} min (partial)` : '';
            return o;
        })(),
    });
}

function renderProfile(S) {
    const sum = new Array(24).fill(0), cnt = new Array(24).fill(0);
    S.t.forEach((t, j) => { if (S.kw[j] == null) return; const h = local(t).getUTCHours(); sum[h] += S.kw[j]; cnt[h]++; });
    if (!cnt.some(c => c)) return mount('cProfile', null);
    const avg = sum.map((s, h) => cnt[h] ? s / cnt[h] : null);
    mount('cProfile', {
        type: 'bar',
        data: {
            labels: avg.map((_, h) => pad(h)),
            datasets: [{ label: 'Average kW', data: avg, ...barStyle(css('--pw-kw')) }],
        },
        options: barOptions('kW',
            items => items.length ? `${pad(items[0].dataIndex)}:00 – ${pad(items[0].dataIndex)}:59` : '',
            v => `${nf(v, 1)} kW average`),
    });
}

function renderPhaseAvg(S) {
    const vals = [mean(S.ir), mean(S.iy), mean(S.ib), mean(S.in)];
    if (vals.every(v => v == null)) return mount('cPhaseAvg', null);
    const colors = [css('--ph-r'), css('--ph-y'), css('--ph-b'), css('--ph-n')];
    const avg3 = mean(vals.slice(0, 3));
    const opts = barOptions('Amps', items => items.length ? ['R phase', 'Y phase', 'B phase', 'Neutral'][items[0].dataIndex] : '',
        v => `${nf(v, 1)} A` + (avg3 ? ` (${v >= avg3 ? '+' : ''}${nf((v / avg3 - 1) * 100, 1)}% vs 3-phase avg)` : ''));
    opts.interaction = { mode: 'nearest', intersect: false, axis: 'x' };
    // direct labels on the bar caps: four bars, so every value fits and is worth reading
    opts.plugins.datalabels = {
        display: true, anchor: 'end', align: 'end', offset: 2,
        color: ink().text, font: { weight: 600, size: 11.5 }, formatter: v => v == null ? '' : `${nf(v, 0)} A`,
    };
    opts.layout = { padding: { top: 20 } };
    mount('cPhaseAvg', {
        type: 'bar',
        data: { labels: ['R', 'Y', 'B', 'N'], datasets: [{ label: 'Average current', data: vals,
            backgroundColor: colors, hoverBackgroundColor: colors, maxBarThickness: 64,
            borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start' }] },
        options: opts,
        plugins: [ChartDataLabels],
    });
}

function renderPhaseNeutral(S) {
    const rn = bucket(S, 'v_rn'), yn = bucket(S, 'v_yn'), bn = bucket(S, 'v_bn');
    if ([rn, yn, bn].every(d => d.avg.every(p => p.y == null))) {
        setHint('hintVln', 'not recorded');
        return mount('cVolt', null, 'This meter does not report phase-to-neutral voltage');
    }
    // Phase-to-neutral spread is the one that follows single-phase load
    // imbalance, so it moves where the line-to-line figures barely do.
    const avgs = [mean(S.v_rn), mean(S.v_yn), mean(S.v_bn)].filter(v => v != null);
    const spread = avgs.length ? Math.max(...avgs) - Math.min(...avgs) : null;
    const pct = spread != null && mean(avgs) ? spread / mean(avgs) * 100 : null;
    setHint('hintVln', pct == null ? 'R-N · Y-N · B-N'
        : `spread ${nf(spread, 1)} V (${nf(pct, 2)} %)`);

    mount('cVolt', {
        type: 'line',
        data: { datasets: [
            line('R-N', rn.avg, css('--ph-r')),
            line('Y-N', yn.avg, css('--ph-y')),
            line('B-N', bn.avg, css('--ph-b')),
        ]},
        options: lineOptions(S, 'Volts', { beginAtZero: false }, v => `${nf(v, 1)} V`),
        plugins: [crosshair],
    });
}

function renderVpair(S) {
    const ry = bucket(S, 'v_ry', 'v_ry_min', 'v_ry_max');
    const yb = bucket(S, 'v_yb', 'v_yb_min', 'v_yb_max');
    const br = bucket(S, 'v_br', 'v_br_min', 'v_br_max');
    if ([ry, yb, br].every(d => d.avg.every(p => p.y == null))) return mount('cVpair', null);

    // How far apart the three pairs run, averaged over what is on screen. A
    // single spread figure says more about supply health than three numbers.
    const avgs = [mean(S.v_ry), mean(S.v_yb), mean(S.v_br)].filter(v => v != null);
    const spread = avgs.length ? Math.max(...avgs) - Math.min(...avgs) : null;
    const pct = spread != null && mean(avgs) ? spread / mean(avgs) * 100 : null;
    setHint('hintVpair', pct == null ? 'R-Y · Y-B · B-R'
        : `spread ${nf(spread, 1)} V (${nf(pct, 2)} %) · ` +
          (pct <= 1 ? 'well balanced' : pct <= 2 ? 'acceptable' : 'check supply'));

    const opts = lineOptions(S, 'Volts', { beginAtZero: false }, v => `${nf(v, 1)} V`);
    mount('cVpair', {
        type: 'line',
        data: { datasets: [
            line('R-Y', ry.avg, css('--ph-r')),
            line('Y-B', yb.avg, css('--ph-y')),
            line('B-R', br.avg, css('--ph-b')),
        ]},
        options: opts,
        plugins: [crosshair],
    });
}

function renderPeriods(S) {
    const D = dataset(), [h0, h1] = (D.meta.office_hours || [7, 15]);
    const buckets = [0, 0, 0];      // office hours, evening, night
    S.t.forEach((t, j) => {
        if (S.e[j] == null) return;
        const h = local(t).getUTCHours();
        const k = (h >= h0 && h < h1) ? 0 : (h >= h1 && h < 23) ? 1 : 2;
        buckets[k] += S.e[j];
    });
    const total = buckets.reduce((a, b) => a + b, 0);
    setHint('hintPeriod', total ? `${nf(total, 1)} kWh in range` : '');
    if (total <= 0) return mount('cPeriod', null);
    const labels = [`Office hours ${pad(h0)}–${pad(h1)}`, `Evening ${pad(h1)}–23`, `Night 23–${pad(h0)}`];
    const filled = buckets.filter(v => v > 0).length;
    if (filled < 2) {
        const which = labels[buckets.findIndex(v => v > 0)].replace(/ \d.*$/, '').toLowerCase();
        return mount('cPeriod', null,
            `All ${nf(total, 1)} kWh recorded so far fell in ${which}. ` +
            `The split appears once readings cover more of the day.`);
    }
    const colors = [css('--per-1'), css('--per-2'), css('--per-3')];
    const k = ink();
    mount('cPeriod', {
        type: 'doughnut',
        data: { labels, datasets: [{ data: buckets, backgroundColor: colors, hoverBackgroundColor: colors,
            borderColor: k.surface, borderWidth: 2, hoverOffset: 6 }] },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '58%',
            layout: { padding: 8 },
            plugins: {
                legend: { position: 'bottom', labels: { color: k.text, usePointStyle: true, pointStyle: 'circle', padding: 14,
                    generateLabels: chart => chart.data.labels.map((l, i) => ({
                        text: `${l}  ·  ${nf(buckets[i], 1)} kWh (${total ? Math.round(buckets[i] / total * 100) : 0}%)`,
                        fillStyle: colors[i], strokeStyle: colors[i], fontColor: k.text, index: i, hidden: false,
                    })) } },
                tooltip: Object.assign(tooltipStyle(), { callbacks: {
                    label: it => ` ${it.label}: ${nf(it.parsed, 1)} kWh (${Math.round(it.parsed / total * 100)}%)` } }),
                // label a segment only when it is big enough for the text to fit
                // A label belongs on the ring only if the ring can hold it.
                // In v2's short card the band is about 15px wide while "37%"
                // at 11px needs ~24px, so no amount of anchoring keeps it
                // inside - it has to not be drawn. Measured per arc, so the
                // same chart labels itself when the card is big and stays
                // clean when it is small; the legend carries the percentages
                // either way.
                datalabels: {
                    display: ctx => {
                        if (buckets[ctx.dataIndex] / total < .12) return false;
                        const arc = ctx.chart.getDatasetMeta(0).data[ctx.dataIndex];
                        if (!arc || arc.outerRadius == null) return false;
                        const band = arc.outerRadius - arc.innerRadius;
                        const mid = (arc.outerRadius + arc.innerRadius) / 2;
                        const along = Math.abs(arc.endAngle - arc.startAngle) * mid;
                        return band >= 26 && along >= 34;
                    },
                    anchor: 'center', align: 'center', clamp: true, clip: true,
                    color: '#fff', font: { weight: 700, size: 11 },
                    formatter: v => `${Math.round(v / total * 100)}%`,
                },
            },
        },
        plugins: [ChartDataLabels],
    });
}

/* ============================================================
   Version-2 extras. Both no-op on a page that does not have the
   elements, so a page without them is untouched by them.
   ============================================================ */

// The reference instrument panel puts min / max / avg / current under each
// chart. It is the quickest way to read a trend you are not staring at, and
// it costs a row of text.
const LEGENDS = {
    legPower:   [["Active power", "kw", "kW", 1], ["Reactive power", "kvar", "kVAR", 1],
                 ["Apparent power", "kva", "kVA", 1]],
    legCurrent: [["R phase", "ir", "A", 1], ["Y phase", "iy", "A", 1],
                 ["B phase", "ib", "A", 1], ["Neutral", "in", "A", 1]],
    legVpair:   [["R-Y", "v_ry", "V", 1], ["Y-B", "v_yb", "V", 1], ["B-R", "v_br", "V", 1]],
    legVolt:    [["R-N", "v_rn", "V", 1], ["Y-N", "v_yn", "V", 1], ["B-N", "v_bn", "V", 1]],
    legThd:     [["R phase", "thd_ir", "%", 1], ["Y phase", "thd_iy", "%", 1],
                 ["B phase", "thd_ib", "%", 1]],
};
const LEGEND_COLOURS = {
    kw: "--pw-kw", kvar: "--pw-kvar", kva: "--pw-kva",
    ir: "--ph-r", iy: "--ph-y", ib: "--ph-b", in: "--ph-n",
    v_ry: "--ph-r", v_yb: "--ph-y", v_br: "--ph-b",
    v_rn: "--ph-r", v_yn: "--ph-y", v_bn: "--ph-b",
    thd_ir: "--ph-r", thd_iy: "--ph-y", thd_ib: "--ph-b",
};

function renderLegends(S) {
    Object.entries(LEGENDS).forEach(([id, rows]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const body = rows.map(([label, key, unitText, dp]) => {
            const vals = (S[key] || []).filter(v => v != null);
            if (!vals.length) return "";
            const lo = Math.min(...(S[key + "_min"] || []).filter(v => v != null), ...vals);
            const hi = Math.max(...(S[key + "_max"] || []).filter(v => v != null), ...vals);
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const now = vals[vals.length - 1];
            const colour = css(LEGEND_COLOURS[key] || "--text-dim");
            return `<tr><td><span class="sw" style="background:${colour}"></span>${label}</td>` +
                   `<td>${nf(lo, dp)}</td><td>${nf(hi, dp)}</td><td>${nf(avg, dp)}</td>` +
                   `<td class="cur">${nf(now, dp)} ${unitText}</td></tr>`;
        }).join("");
        el.innerHTML = body
            ? `<thead><tr><th></th><th>min</th><th>max</th><th>avg</th><th>current</th></tr></thead>` +
              `<tbody>${body}</tbody>`
            : "";
    });
}

// A dial, because a number alone does not say whether 0.83 is fine. The arc is
// coloured by the same thresholds an engineer would use: below 0.90 is worth
// acting on, below 0.85 is costing real money in current.
function renderGauge(S) {
    const el = document.getElementById("gPf");
    if (!el) return;
    const pf = Math.abs(S.pf[S.pf.length - 1] ?? 0);
    const band = pf >= 0.95 ? "--good" : pf >= 0.90 ? "--warn" : "--bad";
    const colour = css(band), k = ink();
    document.getElementById("kpiPf").style.color = colour;
    mount("gPf", {
        type: "doughnut",
        data: { datasets: [{
            // 0.70 to 1.00 across the dial: below 0.7 the needle would pin and
            // the useful range would be squeezed into a third of the arc.
            data: [Math.max(0, pf - 0.7), Math.max(0, 1 - Math.max(pf, 0.7))],
            backgroundColor: [colour, css("--surface-3")],
            borderWidth: 0, circumference: 240, rotation: 240, cutout: "72%",
        }]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false },
                       datalabels: { display: false } },
        },
    });
}

/* ============================================================
   Observations and recommendations, against KOC standards

   Every threshold below is a clause, not an opinion. Read from the
   documents in D:\KOC Utility area\07-Standards-and-Training\KOC Standards:

     KOC-E-003 Part 1 Rev 4 (14/07/2021)
       9.5.2  "Mains voltage is subject to a variation of +/- 6 % and the
              frequency is subject to variation of +/- 2.5 %."
       9.5.3  "The minimum power factor of KOC power system shall be
              maintained at 0.95 lagging as per MEW Regulation."
       9.5.4(b)(iv)  building services in non-operating areas - office
              complex, housing - are 415 V, 3 phase, 4 wire.
     KOC-E-006 Rev 5 (21/09/2022)
       9.4.2  MEWRE Rule No. 5: minimum power factor 0.95 lagging, "which
              shall be followed for all electrical installations in KOC".
       9.4.5  "maintain the power factor between 0.95 lagging and Unity".
       9.3.3  harmonic filters / phase-shifted transformers where significant
              rectification is installed; "IEEE Std 519 shall be referred".
       8.4.1  harmonic analysis whenever non-linear load is a significant
              proportion of the system rating.
     KOC-E-016 Rev 0 (29/08/2024)
       8.1.4  "The PFC units shall be sized based on load profile to maintain
              the power factor between 0.95 lagging and unity (1)."
       8.4.1  THD and TDD shall comply with IEEE 519.
       8.4.2  de-tuning reactors designed on all harmonic contributions;
              "Precautions shall be made to avoid any resonance"; active
              filters where harmonic values are unknown.

   What this panel will not do: invent a limit. Where the standards reviewed
   give no figure - current unbalance is the example - the measurement is
   reported without a pass or fail, and says so.
   ============================================================ */
const KOC = {
    pfMin: 0.95,        // E-003 9.5.3, E-006 9.4.2 / 9.4.5, E-016 8.1.4
    vTol: 0.06,         // E-003 9.5.2
    hzTol: 0.025,       // E-003 9.5.2
    nominalHz: 50,      // E-003 9.5.1
};

// The existing mean() throws on an absent array; these recordings may have no
// THD columns at all, so the assessment needs helpers that treat "not recorded"
// as a value rather than an error.
function avgOf(a) {
    let s = 0, n = 0;
    for (const v of a || []) if (v != null) { s += v; n++; }
    return n ? s / n : null;
}
function minOf(a) { let m = null; for (const v of a || []) if (v != null && (m === null || v < m)) m = v; return m; }
function maxOf(a) { let m = null; for (const v of a || []) if (v != null && (m === null || v > m)) m = v; return m; }

// How much of the range sat outside a band, as a percentage of the samples.
function pctOutside(a, min, max) {
    let bad = 0, n = 0;
    for (const v of a || []) if (v != null) { n++; if (v < min || v > max) bad++; }
    return n ? bad / n * 100 : 0;
}

function assessStats(V, meta) {
    const P = avgOf(V.kw), Q = avgOf(V.kvar), S = avgOf(V.kva);
    const pfTotal = (P != null && S) ? Math.abs(P) / S : null;
    // Displacement power factor - the part capacitors can move. The rest of
    // the gap to the total is distortion, which they cannot.
    const pfDisp = (P != null && Q != null) ? Math.abs(P) / Math.hypot(P, Q) : null;
    const thd = avgOf([avgOf(V.thd_ir), avgOf(V.thd_iy), avgOf(V.thd_ib)].filter(x => x != null));
    const thdV = avgOf([avgOf(V.thd_vr), avgOf(V.thd_vy), avgOf(V.thd_vb)].filter(x => x != null));
    const nominal = (meta && meta.nominal_v) || 415;
    return {
        P, Q, S, pfTotal, pfDisp,
        pfMin: minOf(V.pf_min || V.pf),
        leading: Q != null && Q < 0,
        qShare: (Q != null && V.kvar) ? V.kvar.filter(x => x != null && x < 0).length /
                 Math.max(1, V.kvar.filter(x => x != null).length) : null,
        nominal,
        vMin: minOf(V.v_min || V.v), vMax: maxOf(V.v_max || V.v), vAvg: avgOf(V.v),
        vOut: pctOutside(V.v, nominal * (1 - KOC.vTol), nominal * (1 + KOC.vTol)),
        hzMin: minOf(V.hz), hzMax: maxOf(V.hz),
        thd, thdV, thdMax: maxOf(V.thd_ir_max),
        hasThd: thd != null,
        unbal: avgOf(V.i_unbal), unbalMax: maxOf(V.i_unbal),
        iAvg: avgOf(V.i), iN: avgOf(V.in),
        kvarTo95: (P != null && Q != null) ? Q - Math.abs(P) * Math.tan(Math.acos(KOC.pfMin)) : null,
    };
}

// kVAr needed, and what it buys, stated in amps because that is what the
// cable and the switchgear actually see.
function correctionNote(s) {
    if (s.P == null || s.vAvg == null) return '';
    const iNow = s.S * 1000 / (Math.sqrt(3) * s.vAvg);
    const iAt95 = (Math.abs(s.P) / KOC.pfMin) * 1000 / (Math.sqrt(3) * s.vAvg);
    const drop = iNow > 0 ? (1 - (iAt95 / iNow) ** 2) * 100 : 0;
    return `About <b>${nf(Math.abs(s.kvarTo95), 0)} kVAr</b> takes it to 0.95: ` +
           `${nf(iNow, 0)} A would fall to ${nf(iAt95, 0)} A, about ` +
           `${nf(drop, 0)} % less I²R loss in the cable and the transformer.`;
}

function kocFindings(s, meta) {
    const F = [];
    const add = (level, title, detail, clause, action) =>
        F.push({ level, title, detail, clause, action });

    /* ---- power factor ------------------------------------------------- */
    if (s.pfTotal != null) {
        const pf = s.pfTotal, disp = s.pfDisp;
        const distortionLed = disp != null && disp >= KOC.pfMin && pf < KOC.pfMin;
        if (distortionLed) {
            add('action', `Power factor ${nf(pf, 3)} — distortion, not displacement`,
                `Displacement power factor is <b>${nf(disp, 3)}</b>, already inside the limit; the ` +
                `total is pulled down to ${nf(pf, 3)} by harmonic current` +
                (s.hasThd ? ` (current THD ${nf(s.thd, 0)} %)` : '') + `. ` +
                `Capacitors correct displacement only.`,
                'KOC-E-016 §8.4.2 — de-tuning reactors, avoid resonance; KOC-E-006 §9.3.3 — IEEE 519',
                `<b>Do not fit plain capacitors here.</b> They would do little for the power factor ` +
                `and can resonate with the supply inductance at a harmonic. A harmonic study per ` +
                `KOC-E-006 §8.4 should decide between de-tuned capacitors and an active filter.`);
        } else if (pf < KOC.pfMin) {
            add('action', `Power factor ${nf(pf, 3)} — below the 0.95 minimum`,
                `Averaged over the range, against a minimum of 0.95 lagging. ` +
                (s.pfMin != null ? `Lowest single reading ${nf(s.pfMin, 3)}. ` : '') +
                correctionNote(s),
                'KOC-E-003 Pt1 §9.5.3 and KOC-E-006 §9.4.2 — MEWRE Rule No. 5, minimum 0.95 lagging',
                `Correction is required. Size the equipment from the load profile per KOC-E-016 ` +
                `§8.1.4` + (s.hasThd ? `, and with current THD at ${nf(s.thd, 0)} % the bank must be ` +
                `de-tuned (KOC-E-016 §8.4.2).`
                : `. Harmonics were not recorded on this visit, so KOC-E-016 §8.4.2 calls for a ` +
                  `harmonic measurement before the type of bank is chosen.`));
        } else {
            add('ok', `Power factor ${nf(pf, 3)} — compliant`,
                `At or above the 0.95 lagging minimum across the range.`,
                'KOC-E-003 Pt1 §9.5.3; KOC-E-006 §9.4.5', '');
        }

        // Direction is a separate question from magnitude: a feeder can be
        // inside the band on paper and still be exporting reactive power.
        if (s.leading) {
            add('action', `Reactive power is leading (${nf(s.Q, 1)} kVAr)`,
                `Reactive power is negative in ${nf((s.qShare || 0) * 100, 0)} % of the range ` +
                `(${nf(s.Q, 1)} kVAr average), so this feeder is exporting reactive power: ` +
                `capacitance is already connected and is over-correcting at this load.`,
                'KOC-E-006 §9.4.5 — maintain between 0.95 lagging and unity; leading is outside that band',
                `Check whether the capacitor bank is switching with load or stuck on. A fixed bank ` +
                `on a feeder whose load varies will over-correct at light load, raising voltage ` +
                `further on a board already running high.`);
        }
    }

    /* ---- voltage ------------------------------------------------------ */
    if (s.vMax != null) {
        const band = [s.nominal * (1 - KOC.vTol), s.nominal * (1 + KOC.vTol)];
        const pcMin = (s.vMin / s.nominal - 1) * 100, pcMax = (s.vMax / s.nominal - 1) * 100;
        const breach = s.vMin < band[0] || s.vMax > band[1];
        add(breach ? 'action' : (Math.max(Math.abs(pcMin), Math.abs(pcMax)) > 4.5 ? 'watch' : 'ok'),
            `Voltage ${nf(s.vMin, 1)}–${nf(s.vMax, 1)} V (${nf(pcMin, 1)} % to ${nf(pcMax, 1)} %)`,
            `Against ${nf(s.nominal, 0)} V nominal, the permitted band is ` +
            `${nf(band[0], 1)}–${nf(band[1], 1)} V.` +
            (breach ? ` <b>${nf(s.vOut, 1)} % of the range sat outside it.</b>` : ' Within band.'),
            'KOC-E-003 Pt1 §9.5.2 — ±6 %; §9.5.4(b)(iv) — building services at 415 V',
            breach
                ? `Raise with the supply authority / check the transformer tap. Note that adding ` +
                  `capacitors raises voltage further, so power-factor correction and the tap ` +
                  `setting have to be decided together.`
                : (Math.abs(pcMax) > 4.5
                    ? `Close to the upper limit. Any capacitor bank added to this board will push ` +
                      `it higher — size and switch accordingly.` : ''));
    }

    /* ---- harmonics ---------------------------------------------------- */
    if (s.hasThd) {
        const bad = s.thd >= 15;
        add(bad ? 'action' : (s.thd >= 8 ? 'watch' : 'ok'),
            `Current THD ${nf(s.thd, 1)} %` + (s.thdMax != null ? `, peaking at ${nf(s.thdMax, 0)} %` : ''),
            `Voltage THD ${s.thdV != null ? nf(s.thdV, 2) + ' %' : 'not recorded'}, which is what ` +
            `other equipment on the board actually sees. ` +
            `Current distortion of this order points to rectifier loads — UPS, drives, switch-mode supplies.`,
            'KOC-E-016 §8.4.1 and KOC-E-006 §9.3.3 — THD/TDD to IEEE 519',
            bad ? `A harmonic study is warranted (KOC-E-006 §8.4). Note that IEEE 519 limits ` +
                  `<i>demand</i> distortion (TDD) at the point of common coupling against the ` +
                  `short-circuit ratio — this survey measures THD at the feeder, so it shows the ` +
                  `scale of the problem but cannot by itself declare a breach.`
                : '');
    } else {
        add('info', 'Harmonics not recorded on this visit',
            `Without THD it cannot be said whether a power-factor shortfall is displacement ` +
            `(correctable with capacitors) or distortion (which capacitors would make worse).`,
            'KOC-E-016 §8.4.2 — active filters where harmonic values are unknown',
            `Repeat the recording with harmonics enabled before specifying any correction.`);
    }

    /* ---- neutral ------------------------------------------------------ */
    if (s.iN != null && s.iAvg) {
        const share = s.iN / s.iAvg * 100;
        if (share >= 50) {
            add('action', `Neutral current ${nf(s.iN, 0)} A — ${nf(share, 0)} % of phase current`,
                `Phase currents average ${nf(s.iAvg, 0)} A with ${nf(s.unbal, 1)} % unbalance, which ` +
                `accounts for only a small part of this. The remainder is third-harmonic current, ` +
                `which adds in the neutral instead of cancelling.`,
                'KOC-E-008 §8.3.1(f) — effects of harmonics in cable sizing',
                `Check the neutral conductor rating on this feeder. A neutral sized at half the ` +
                `phase conductor, as older installations often are, is being asked to carry more ` +
                `than that.`);
        }
    }

    /* ---- frequency ---------------------------------------------------- */
    if (s.hzMin != null) {
        const band = [KOC.nominalHz * (1 - KOC.hzTol), KOC.nominalHz * (1 + KOC.hzTol)];
        const breach = s.hzMin < band[0] || s.hzMax > band[1];
        add(breach ? 'watch' : 'ok', `Frequency ${nf(s.hzMin, 2)}–${nf(s.hzMax, 2)} Hz`,
            `Permitted ${nf(band[0], 2)}–${nf(band[1], 2)} Hz.` + (breach ? ' Outside band.' : ' Within band.'),
            'KOC-E-003 Pt1 §9.5.1 and §9.5.2 — 50 Hz ±2.5 %', '');
    }

    /* ---- unbalance: measured, but no KOC figure to measure it against -- */
    if (s.unbal != null) {
        add('info', `Current unbalance ${nf(s.unbal, 1)} % average` +
            (s.unbalMax != null ? `, ${nf(s.unbalMax, 1)} % peak` : ''),
            `Reported for information. The KOC standards reviewed for this panel set no numeric ` +
            `limit for current unbalance on an LV feeder, so no pass or fail is claimed here.`,
            'no limit found in KOC-E-003 Pt1, E-006, E-008, E-016', '');
    }

    const order = { action: 0, watch: 1, info: 2, ok: 3 };
    F.sort((a, b) => order[a.level] - order[b.level]);
    return F;
}

function renderAssessment() {
    const host = document.getElementById('assessBody');
    if (!host) return;
    const D = dataset(), V = slice();
    if (!V || !V.t.length) { host.innerHTML = '<div class="empty">No readings in this range</div>'; return; }
    const s = assessStats(V, D && D.meta);
    const F = kocFindings(s, D && D.meta);
    const label = { action: 'Action', watch: 'Watch', ok: 'Compliant', info: 'For information' };

    host.innerHTML = F.map(f => `
        <div class="finding ${f.level}">
            <div class="f-head"><span class="f-tag">${label[f.level]}</span>
                <span class="f-title">${f.title}</span></div>
            <div class="f-detail">${f.detail}</div>
            ${f.action ? `<div class="f-action"><b>Recommendation</b> ${f.action}</div>` : ''}
            <div class="f-clause">${f.clause}</div>
        </div>`).join('');
}

/* ============================================================
   Range filter, live reload
   ============================================================ */
// A button on every chart panel to fill the window with it, and Escape to
// come back. The charts resize themselves; only the container changes.
// An expanded panel covers the controls, so move the whole bar - time range,
// zoom, and the line saying what is on screen - into the panel, and put it
// back on close. Moving the real controls beats a second copy that could drift
// out of step with the first.
const filterBar = document.querySelector('.filters');
const barHome = filterBar.parentNode;
const barAfter = filterBar.nextSibling;

function expandPanel(panel) {
    const on = !panel.classList.contains('expanded');
    document.querySelectorAll('.panel.expanded').forEach(p => {
        p.classList.remove('expanded');
        p.querySelector('.expand-btn').textContent = 'Expand';
    });
    barHome.insertBefore(filterBar, barAfter);          // always home first

    panel.classList.toggle('expanded', on);
    document.body.classList.toggle('has-expanded', on);
    panel.querySelector('.expand-btn').textContent = on ? 'Close' : 'Expand';

    if (on) {
        const head = panel.querySelector('.panel-head');
        head.parentNode.insertBefore(filterBar, head.nextSibling);
        // zoom and pan mean nothing on a bar chart or a dot plot
        const isTrend = TIME_CHARTS.some(id => panel.querySelector('#' + id));
        filterBar.classList.toggle('no-zoom', !isTrend);
    } else {
        filterBar.classList.remove('no-zoom');
    }
    // let the layout settle, then tell the charts their boxes changed
    setTimeout(() => Object.values(charts).forEach(c => c && c.resize()), 60);
}

document.querySelectorAll('.panel').forEach(panel => {
    const head = panel.querySelector('.panel-head');
    if (!head || !panel.querySelector('canvas')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'expand-btn';
    btn.textContent = 'Expand';
    btn.title = 'Fill the window with this chart (Esc to close)';
    btn.addEventListener('click', () => expandPanel(panel));
    head.appendChild(btn);
});

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.panel.expanded');
    if (open) expandPanel(open);
});

document.getElementById('panBack').addEventListener('click', () => panBy(-1));
document.getElementById('panFwd').addEventListener('click', () => panBy(1));
document.getElementById('zoomIn').addEventListener('click', () => zoomBy(1.6));
document.getElementById('zoomOut').addEventListener('click', () => zoomBy(1 / 1.6));
document.getElementById('zoomReset').addEventListener('click', resetZoom);
TIME_CHARTS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dblclick', resetZoom);
    el.style.touchAction = 'pan-y';   // vertical gestures stay with the page
    el.classList.add('pan-drag');
    attachDrag(el);
});

document.getElementById('rangeSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-hours]'); if (!b) return;
    RANGE_H = +b.dataset.hours;
    try { localStorage.setItem('pm1125h-meter-logger.range', String(RANGE_H)); } catch (err) {}
    render();
});

// file:// pages cannot fetch(), but they can load a script. Re-inserting the
// data file picks up whatever tools/build_dashboard.py last wrote.
// One recording per file under sites/, listed in sites/index.js. Switching is
// a script load and a redraw - no server, no rebuild, so a survey of 30 panels
// is a menu rather than 30 commands.
let CURRENT_SITE = null;

function loadSite(file, name) {
    const s = document.createElement('script');
    s.src = 'sites/' + file + '?t=' + Date.now();
    s.onload = () => {
        s.remove();
        CURRENT_SITE = file;
        try { localStorage.setItem('pm1125h-meter-logger.site', file); } catch (e) {}
        markNav(file);
        resetZoom();
        render();
    };
    s.onerror = () => {
        s.remove();
        document.getElementById('rangeMeta').textContent = `Could not load ${name}.`;
    };
    document.body.appendChild(s);
}

function markNav(file) {
    document.querySelectorAll('#nav a').forEach(a => {
        const on = a.dataset.file === file;
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const sel = document.getElementById('siteSelect');
    if (sel && sel.value !== file) sel.value = file;
}

// The site name in the header IS the picker. The hamburger menu listed every
// recording from the start, but a menu behind an icon is something you have to
// be told about - people read the title, see the name of a place, and have no
// reason to think it can be changed. A select wearing the title's own type
// says "there are others" without taking any space.
function buildSitePicker(list) {
    const host = document.querySelector('.page-title');
    if (!host) return null;

    if (!document.getElementById('sitePickerCss')) {
        const css = document.createElement('style');
        css.id = 'sitePickerCss';
        css.textContent = `
.site-select{font:inherit;color:inherit;background-color:transparent;
  border:1px solid var(--border-strong,rgba(255,255,255,.22));border-radius:10px;
  padding:5px 34px 5px 11px;-webkit-appearance:none;appearance:none;cursor:pointer;
  max-width:min(72vw,680px);line-height:1.25;
  background-image:url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' \
stroke='%2393a1bf' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>\
<path d='M6 9l6 6 6-6'/></svg>");
  background-repeat:no-repeat;background-position:right 10px center;background-size:17px}
.site-select:hover{border-color:var(--accent,#4c7dff)}
.site-select:focus-visible{outline:2px solid var(--accent,#4c7dff);outline-offset:2px}
/* Windows draws the open list with the page's colours only if the options say so */
.site-select option{background:#101829;color:#e9eefb;font-size:14px}
:root[data-theme="light"] .site-select option{background:#fff;color:#101829}
.page-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;margin:2px 0 0}
.site-pick-hint{font-size:10.5px;letter-spacing:.14em;font-weight:600;white-space:nowrap;
  text-transform:uppercase;color:var(--text-faint,#63719a)}`;
        document.head.appendChild(css);
    }

    const hint = document.createElement('span');
    hint.className = 'site-pick-hint';
    hint.textContent = 'Location';

    const sel = document.createElement('select');
    sel.id = 'siteSelect';
    sel.className = 'site-select';
    sel.setAttribute('aria-label', 'Select location');
    list.forEach(rec => {
        const o = document.createElement('option');
        o.value = rec.file;
        const when = rec.started ? fmtDate(Date.parse(rec.started)) : '';
        o.textContent = rec.site + (when ? '  \u00b7  ' + when : '');
        sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
        const rec = list.find(r => r.file === sel.value);
        if (rec) loadSite(rec.file, rec.site);
    });

    host.textContent = '';
    host.appendChild(hint);
    host.appendChild(sel);
    return sel;
}

function buildNav() {
    const list = window.SITE_INDEX;
    const nav = document.getElementById('nav');
    if (!Array.isArray(list) || !list.length) return;      // single-file page, as before
    if (!nav) { buildSitePicker(list); return startSite(list); }   // picker only, no menu
    const icon = '<span class="ico"><svg class="i" viewBox="0 0 24 24">' +
                 '<path d="M3 17l5-6 4 3 5-8 4 4"/><path d="M3 21h18"/></svg></span>';
    nav.innerHTML = '';
    list.forEach(rec => {
        const a = document.createElement('a');
        a.href = '#';
        a.dataset.file = rec.file;
        const when = rec.started ? fmtDate(Date.parse(rec.started)) : '';
        a.innerHTML = `${icon}<span>${rec.site}<span class="when">${when}` +
                      `${rec.ct ? ' · CT ' + rec.ct : ''}</span></span>`;
        a.addEventListener('click', e => { e.preventDefault(); loadSite(rec.file, rec.site); });
        nav.appendChild(a);
    });
    buildSitePicker(list);
    startSite(list);
}

// Last place you looked at, else the most recent recording.
function startSite(list) {
    let want = null;
    try { want = localStorage.getItem('pm1125h-meter-logger.site'); } catch (e) {}
    const start = list.find(r => r.file === want) || list[list.length - 1];
    loadSite(start.file, start.site);
}

function reloadData() {
    const before = window.METER_DATA && window.METER_DATA.meta.generated_ms;
    const s = document.createElement('script');
    s.src = 'meter-data.js?t=' + Date.now();
    s.onload = () => { s.remove(); const after = window.METER_DATA && window.METER_DATA.meta.generated_ms;
        if (after !== before) render(); else updateStatus(window.METER_DATA); };
    s.onerror = () => s.remove();
    document.body.appendChild(s);
}
setInterval(() => { if (!CURRENT_SITE) reloadData(); }, REFRESH_MS);

if (typeof Chart === 'undefined') {
    document.getElementById('rangeMeta').textContent =
        'Charts could not load - the page needs an internet connection for the Chart.js library.';
} else {
    if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);
    Chart.defaults.plugins.datalabels = Object.assign(Chart.defaults.plugins.datalabels || {}, { display: false });
    render();
    buildNav();
}
