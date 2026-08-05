import { metricConfigs, METRICS, TIMEFRAMES } from './types.js';
import { animateValueUpdate, setConnectionStatus, updateGauge, updateSunTimes, getWindDirectionText, calculateDewPoint, calculateFeelsLike, calculatePressureTrend, groupByDay, formatTimeLabel } from './utils.js';
import { fetchLive, fetchHistory, initCache, processSyncQueue, getCachedLive, getCachedHistory, getLastFetchTimes, initBackgroundSync } from './api.js';
import { updateChart, scheduleChartUpdate, destroyChart, setLockedYRange, clearLockedYRange, ensureChartJsLoaded, handleChartResize } from './charts.js';

/** @type {WeatherData[]} */
let rawHistoryData = [];
/** @type {string} */
let currentMetric = 'temperature';
/** @type {string} */
let currentTimeframe = '24h';
/** @type {number} */
let currentSpanMs = 24 * 3600000;
/** @type {number} */
let timeShiftMs = 0;

/**
 * Initialize the dashboard
 */
export async function initDashboard() {
    initCache();
    
    // Show cached data immediately
    const cachedLive = getCachedLive();
    if (cachedLive) {
        updateLiveUI(cachedLive);
        setConnectionStatus('offline');
    }
    
    const cachedHistory = getCachedHistory();
    if (cachedHistory.length) {
        rawHistoryData = cachedHistory;
        renderHistoryUI(cachedHistory);
        updateTimeShiftDisplay();
    }
    
    // Fetch fresh data
    await refreshAllData();
    
    // Setup event listeners
    initEventListeners();
    initTouchAndMouseEvents();
    initPullToRefresh();
    initPWAInstall();
    initServiceWorker();
    initBackgroundSync();
    
    // Debounced chart resize handler
    window.addEventListener('resize', handleChartResize);
    
    // Show skeleton loader for chart
    const skeleton = document.getElementById('chartSkeleton');
    if (skeleton) skeleton.style.display = 'block';
    
    // Start periodic updates
    setInterval(refreshLiveData, 60000);
    setInterval(refreshHistoryData, 5 * 60000);
    setInterval(() => processSyncQueue(), 30000);
}

/**
 * Refresh all data
 */
async function refreshAllData() {
    try {
        const [live, history] = await Promise.all([fetchLive(), fetchHistory()]);
        
        if (live) updateLiveUI(live);
        if (history.length) {
            rawHistoryData = history;
            renderHistoryUI(history);
        }
        setConnectionStatus('online');
        updateTimeShiftDisplay();
        await safeUpdateChart();
    } catch (e) {
        console.error('Refresh failed:', e);
        setConnectionStatus('offline');
    }
}

/**
 * Refresh live data only
 */
async function refreshLiveData() {
    try {
        const live = await fetchLive();
        if (live) updateLiveUI(live);
        setConnectionStatus('online');
    } catch (e) {
        console.error('Live refresh failed:', e);
        setConnectionStatus('offline');
    }
}

/**
 * Refresh history data only
 */
async function refreshHistoryData() {
    try {
        const history = await fetchHistory();
        if (history.length) {
            rawHistoryData = history;
            renderHistoryUI(history);
            await safeUpdateChart();
        }
    } catch (e) {
        console.error('History refresh failed:', e);
    }
}

/**
 * Update live UI with new data
 * @param {WeatherData} data - Live data
 */
function updateLiveUI(data) {
    try { animateValueUpdate('temp-main', data.temperature != null ? data.temperature.toFixed(2) + " °C" : "-- °C"); } catch (e) { console.error('temp-main update failed:', e); }
    try { animateValueUpdate('dew-point', calculateDewPoint(data.temperature, data.humidity)); } catch (e) { console.error('dew-point update failed:', e); }
    try { animateValueUpdate('feels-like', calculateFeelsLike(data.temperature, data.windSpeed, data.humidity)); } catch (e) { console.error('feels-like update failed:', e); }
    try { updateSunTimes(); } catch (e) { console.error('updateSunTimes failed:', e); }

    try {
        if (data.rssi != null) {
            const rssiEl = document.getElementById('rssi-val');
            const wifiStatus = document.getElementById('wifi-status');
            if (rssiEl) rssiEl.innerText = data.rssi;
            if (wifiStatus) {
                wifiStatus.className = 'wifi-status';
                if (data.rssi < -80) wifiStatus.classList.add('bad');
                else if (data.rssi < -70) wifiStatus.classList.add('weak');
            }
        }
    } catch (e) { console.error('rssi update failed:', e); }

    try {
        if (data.uptime != null) {
            const uptimeEl = document.getElementById('uptime-val');
            if (uptimeEl) {
                const days = Math.floor(data.uptime / 86400);
                const hours = Math.floor((data.uptime % 86400) / 3600);
                uptimeEl.innerText = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
            }
        }
    } catch (e) { console.error('uptime update failed:', e); }

    try { updateGauge('gauge-hum', 'hum-val', null, data.humidity, 0, 100, '%'); } catch (e) { console.error('humidity gauge failed:', e); }
    try { updateGauge('gauge-press', 'press-val', null, data.pressure, 950, 1050, 'hPa'); } catch (e) { console.error('pressure gauge failed:', e); }
    try { updateGauge('gauge-windspeed', 'wind-speed-val', 'wind-speed-tag', data.windSpeed, 0, 100, 'km/h'); } catch (e) { console.error('windspeed gauge failed:', e); }
    try { updateGauge('gauge-uv', 'uv-val', 'uv-tag', data.uvIndex, 0, 11, ''); } catch (e) { console.error('uv gauge failed:', e); }
    try { updateGauge('gauge-rain', 'rain-val', 'rain-tag', data.rainLast24h, 0, 50, 'mm'); } catch (e) { console.error('rain gauge failed:', e); }
    
    try { animateValueUpdate('wind-dir-val', getWindDirectionText(data.windDirectionDeg)); } catch (e) { console.error('wind-dir update failed:', e); }

    try {
        const badgeFrost = document.getElementById('badge-frost');
        if (badgeFrost) badgeFrost.style.display = (data.temperature != null && data.temperature <= 3) ? "inline-flex" : "none";
    } catch (e) { console.error('badge-frost failed:', e); }

    try {
        const date = new Date(data.timestamp || Date.now());
        document.getElementById('last-update').innerText = "Update: " + date.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' });
    } catch (e) { console.error('last-update failed:', e); }
    
    try {
        const pressureTrendElem = document.getElementById('pressure-trend');
        if (pressureTrendElem) pressureTrendElem.innerText = calculatePressureTrend(rawHistoryData);
    } catch (e) { console.error('pressure-trend failed:', e); }
}

/**
 * Render history-based UI
 * @param {WeatherData[]} history - Historical data
 */
function renderHistoryUI(history) {
    const dailyGroups = groupByDay(history);
    renderDaysOverview(dailyGroups);
    renderMinMaxGrid(dailyGroups);
}

/**
 * Render 6-day overview
 * @param {DailyGroup[]} dailyGroups - Grouped daily data
 */
function renderDaysOverview(dailyGroups) {
    const days = dailyGroups.slice(-6);
    const grid = document.getElementById('days-history-grid');
    if (grid) {
        grid.innerHTML = days.map(d =>
            `<div class="day-card"><div class="day-name">${d.label}</div><div class="day-temp">Ø ${(d.temps.reduce((a, b) => a + b, 0) / d.temps.length).toFixed(1)}°</div></div>`
        ).join('');
    }
}

/**
 * Render min/max grid
 * @param {DailyGroup[]} dailyGroups - Grouped daily data
 */
function renderMinMaxGrid(dailyGroups) {
    const days = [...dailyGroups].reverse().slice(0, 4);
    const grid = document.getElementById('min-max-grid');
    if (grid) {
        grid.innerHTML = days.map(d =>
            `<div class="min-max-card"><div class="date">${d.label}</div><div class="min-max-values"><span class="min-val">${Math.min(...d.temps).toFixed(1)} °C</span><span class="max-val">${Math.max(...d.temps).toFixed(1)} °C</span></div></div>`
        ).join('');
    }
}

/**
 * Update time shift display
 */
function updateTimeShiftDisplay() {
    const tag = document.getElementById('shift-status-tag');
    if (!tag) return;

    let spanText = "";
    if (currentSpanMs < 3600000) spanText = (currentSpanMs / 60000).toFixed(0) + " Min";
    else if (currentSpanMs < 86400000) spanText = (currentSpanMs / 3600000).toFixed(1) + " Std";
    else spanText = (currentSpanMs / 86400000).toFixed(1) + " Tage";

    if (timeShiftMs === 0) {
        tag.innerText = `Fenster: ${spanText} (Aktuell)`;
    } else {
        const hoursPast = (timeShiftMs / 3600000).toFixed(1);
        tag.innerText = `Fenster: ${spanText} [-${hoursPast}h zurück verschoben]`;
    }
}

/**
 * Switch timeframe
 * @param {string} tf - Timeframe
 * @param {HTMLElement|null} btnElement - Button element
 */
export function switchTimeframe(tf, btnElement) {
    currentTimeframe = tf;
    timeShiftMs = 0;

    document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
        const dp = document.getElementById('date-picker');
        if (dp) dp.value = "";
    }

    if (tf === '1h') currentSpanMs = 3600000;
    else if (tf === '24h') currentSpanMs = 86400000;
    else if (tf === '7d') currentSpanMs = 7 * 86400000;
    else if (tf === 'all') {
        if (rawHistoryData.length > 0) currentSpanMs = Date.now() - rawHistoryData[0].timestamp;
        else currentSpanMs = 86400000;
    }
    else if (tf === 'date') {
        const selectedDate = document.getElementById('date-picker').value;
        if (!selectedDate) return;
        const start = new Date(selectedDate); start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDate); end.setHours(23, 59, 59, 999);
        timeShiftMs = Date.now() - end.getTime();
        currentSpanMs = end.getTime() - start.getTime();
    }

    updateTimeShiftDisplay();
    safeUpdateChart();
}

/**
 * Safely update chart with error boundary
 */
async function safeUpdateChart() {
    try {
        await updateChart(currentMetric, rawHistoryData, currentSpanMs, timeShiftMs, formatTimeLabel);
    } catch (e) {
        console.error('Chart update failed:', e);
        // Show error state in chart container
        const container = document.getElementById('chartContainer');
        const skeleton = document.getElementById('chartSkeleton');
        if (container && !container.querySelector('.chart-error')) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'chart-error';
            errorDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--text-muted);text-align:center;padding:20px;';
            errorDiv.innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size:24px;color:#ef4444;margin-bottom:8px;display:block;"></i>Diagramm konnte nicht geladen werden';
            container.appendChild(errorDiv);
        }
        if (skeleton) skeleton.style.display = 'none';
    }
}

/**
 * Shift time
 * @param {number} hours - Hours to shift
 */
export function shiftTime(hours) {
    timeShiftMs += hours * 3600000;
    if (timeShiftMs < 0) timeShiftMs = 0;
    updateTimeShiftDisplay();
    safeUpdateChart();
}

/**
 * Reset time shift
 */
export function resetTimeShift() {
    timeShiftMs = 0;
    updateTimeShiftDisplay();
    safeUpdateChart();
}

/**
 * Switch metric
 * @param {string} metric - Metric name
 * @param {HTMLElement} btnElement - Button element
 */
export function switchMetric(metric, btnElement) {
    currentMetric = metric;
    document.querySelectorAll('.chart-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    safeUpdateChart();
}

/**
 * Export CSV
 */
export function exportCSV() {
    if (!rawHistoryData || !rawHistoryData.length) return alert("Keine Daten vorhanden.");
    let csv = "Timestamp,Datum,Temperatur_C,Luftfeuchtigkeit_prozent,Luftdruck_hPa,Windrichtung_Grad,UV_Index,Regen_mm\n";
    rawHistoryData.forEach(d => {
        const dateStr = new Date(d.timestamp).toLocaleString("de-DE");
        csv += `${d.timestamp},"${dateStr}",${d.temperature ?? ''},${d.humidity ?? ''},${d.pressure ?? ''},${d.windDirectionDeg ?? ''},${d.uvIndex ?? ''},${d.rainLast24h ?? ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `wetter_daten_${Date.now()}.csv`;
    link.click();
}

/**
 * Initialize event listeners
 */
function initEventListeners() {
    const metricTabs = document.getElementById('chart-metric-tabs');
    if (metricTabs) {
        metricTabs.addEventListener('click', e => {
            const btn = e.target.closest('[data-metric]');
            if (btn) switchMetric(btn.dataset.metric, btn);
        });
    }

    const timeframeTabs = document.getElementById('chart-timeframe-tabs');
    if (timeframeTabs) {
        timeframeTabs.addEventListener('click', e => {
            const tfBtn = e.target.closest('[data-timeframe]');
            if (tfBtn) {
                switchTimeframe(tfBtn.dataset.timeframe, tfBtn);
                return;
            }
            const actionBtn = e.target.closest('[data-action="export-csv"]');
            if (actionBtn) exportCSV();
        });
    }

    const datePicker = document.getElementById('date-picker');
    if (datePicker) {
        datePicker.addEventListener('change', () => switchTimeframe('date', null));
    }

    const shiftTabs = document.getElementById('chart-shift-tabs');
    if (shiftTabs) {
        shiftTabs.addEventListener('click', e => {
            const shiftBtn = e.target.closest('[data-shift]');
            if (shiftBtn) {
                shiftTime(parseInt(shiftBtn.dataset.shift, 10));
                return;
            }
            const resetBtn = e.target.closest('[data-action="reset-shift"]');
            if (resetBtn) resetTimeShift();
        });
    }
}

/**
 * Initialize touch and mouse events
 */
function initTouchAndMouseEvents() {
    const canvas = document.getElementById('mainChart');
    const container = document.getElementById('chartContainer');
    if (!canvas || !container) return;

    let touchStartPinchDist = null;
    let touchStartSpan = null;
    let touchLastX = null;

    canvas.addEventListener('touchstart', e => {
        if (e.cancelable) e.preventDefault();
        const chart = getChart();
        if (chart) {
            chart.options.plugins.tooltip.enabled = false;
            if (chart.scales.y) {
                setLockedYRange(chart.scales.y.min, chart.scales.y.max);
            }
        }
        if (e.touches.length === 1) {
            touchLastX = e.touches[0].clientX;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartPinchDist = Math.hypot(dx, dy);
            touchStartSpan = currentSpanMs;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        if (e.cancelable) e.preventDefault();
        if (e.touches.length === 1 && touchLastX !== null) {
            const currentX = e.touches[0].clientX;
            const deltaX = currentX - touchLastX;
            touchLastX = currentX;
            const pixelsPerMs = currentSpanMs / container.clientWidth;
            timeShiftMs += deltaX * pixelsPerMs;
            if (timeShiftMs < 0) timeShiftMs = 0;
            updateTimeShiftDisplay();
            scheduleChartUpdate();
        } else if (e.touches.length === 2 && touchStartPinchDist !== null) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDist = Math.hypot(dx, dy);
            const zoomRatio = touchStartPinchDist / currentDist;
            let newSpanMs = touchStartSpan * zoomRatio;
            if (newSpanMs < 15 * 60000) newSpanMs = 15 * 60000;
            if (newSpanMs > 365 * 86400000) newSpanMs = 365 * 86400000;
            currentSpanMs = newSpanMs;
            updateTimeShiftDisplay();
            scheduleChartUpdate();
        }
    }, { passive: false });

    function handleTouchEnd() {
        touchStartPinchDist = null;
        touchLastX = null;
        clearLockedYRange();
        const chart = getChart();
        if (chart) {
            chart.options.plugins.tooltip.enabled = true;
            safeUpdateChart();
        }
    }
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    let isMouseDown = false;
    let mouseLastX = 0;

    canvas.addEventListener('mousedown', e => {
        isMouseDown = true;
        mouseLastX = e.clientX;
        canvas.style.cursor = 'grabbing';
        const chart = getChart();
        if (chart && chart.scales.y) {
            setLockedYRange(chart.scales.y.min, chart.scales.y.max);
        }
    });

    window.addEventListener('mousemove', e => {
        if (!isMouseDown) return;
        const deltaX = e.clientX - mouseLastX;
        mouseLastX = e.clientX;
        const pixelsPerMs = currentSpanMs / container.clientWidth;
        timeShiftMs += deltaX * pixelsPerMs;
        if (timeShiftMs < 0) timeShiftMs = 0;
        updateTimeShiftDisplay();
        scheduleChartUpdate();
    });

    window.addEventListener('mouseup', () => {
        if (isMouseDown) {
            isMouseDown = false;
            canvas.style.cursor = 'crosshair';
            clearLockedYRange();
            safeUpdateChart();
        }
    });

    container.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        let chartAreaLeft = 0, chartAreaRight = container.clientWidth;
        const chart = getChart();
        if (chart && chart.chartArea) {
            chartAreaLeft = chart.chartArea.left;
            chartAreaRight = chart.chartArea.right;
        }
        const chartWidth = chartAreaRight - chartAreaLeft;
        const clampedX = Math.max(chartAreaLeft, Math.min(chartAreaRight, mouseX));
        const mouseRatio = (clampedX - chartAreaLeft) / chartWidth;
        const now = Date.now();
        const currentEndTime = now - timeShiftMs;
        const currentStartTime = currentEndTime - currentSpanMs;
        const mouseTimestamp = currentStartTime + mouseRatio * currentSpanMs;
        const zoomAmount = 0.15;
        let newSpanMs = currentSpanMs;
        if (e.deltaY > 0) newSpanMs *= (1 + zoomAmount);
        else newSpanMs *= (1 - zoomAmount);
        if (newSpanMs < 15 * 60000) newSpanMs = 15 * 60000;
        if (newSpanMs > 365 * 86400000) newSpanMs = 365 * 86400000;
        currentSpanMs = newSpanMs;
        timeShiftMs = now - mouseTimestamp - currentSpanMs * (1 - mouseRatio);
        if (timeShiftMs < 0) timeShiftMs = 0;
        updateTimeShiftDisplay();
        scheduleChartUpdate();
    }, { passive: false });
}

/**
 * Initialize pull-to-refresh
 */
function initPullToRefresh() {
    let startY = 0;
    let pulling = false;
    const threshold = 80;
    
    document.addEventListener('touchstart', e => {
        if (window.scrollY === 0) {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });
    
    document.addEventListener('touchmove', e => {
        if (!pulling) return;
        const deltaY = e.touches[0].clientY - startY;
        if (deltaY > threshold) {
            document.body.classList.add('pull-to-refresh');
        }
    }, { passive: true });
    
    document.addEventListener('touchend', async e => {
        if (!pulling) return;
        pulling = false;
        const deltaY = e.changedTouches[0].clientY - startY;
        document.body.classList.remove('pull-to-refresh');
        if (deltaY > threshold) {
            await refreshAllData();
        }
    });
}

/**
 * Initialize PWA install prompt
 */
function initPWAInstall() {
    let deferredPrompt;
    const installBtn = document.getElementById('pwa-install-btn');
    
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.style.display = 'flex';
    });
    
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') installBtn.style.display = 'none';
            deferredPrompt = null;
        });
    }
}

/**
 * Show update notification
 */
export function showUpdateNotification() {
    const toast = document.createElement('div');
    toast.className = 'update-toast';
    toast.innerHTML = `
        <i class="fas fa-sync-alt"></i>
        <span>Neue Version verfügbar</span>
        <button onclick="location.reload()">Aktualisieren</button>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
}

/**
 * Get current state
 */
export function getState() {
    return {
        currentMetric,
        currentTimeframe,
        currentSpanMs,
        timeShiftMs,
        rawHistoryDataLength: rawHistoryData.length
    };
}

/**
 * Initialize service worker with update detection
 */
export function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('Service Worker erfolgreich registriert:', reg);
                    
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    showUpdateNotification();
                                }
                            });
                        }
                    });
                })
                .catch(err => console.error('Service Worker Registrierungsfehler:', err));
            
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                refreshing = true;
                window.location.reload();
            });
        });
    }
}