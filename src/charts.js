import { metricConfigs, METRICS } from './types.js';

/** @type {Chart|null} */
let mainChart = null;

/** @type {number} */
let lockedYMin = null;
/** @type {number} */
let lockedYMax = null;
/** @type {boolean} */
let rafPending = false;

/** @type {boolean} */
let chartJsLoaded = false;
/** @type {Promise<void>|null} */
let chartJsLoadPromise = null;

/**
 * Lazy-load Chart.js
 * @returns {Promise<void>}
 */
export async function ensureChartJsLoaded() {
    if (chartJsLoaded) return;
    if (chartJsLoadPromise) return chartJsLoadPromise;
    
    chartJsLoadPromise = (async () => {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
            script.onload = () => { chartJsLoaded = true; resolve(); };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    })();
    
    return chartJsLoadPromise;
}

/** @type {number|null} */
let resizeTimeout = null;

/**
 * Schedule chart update with RAF throttling
 */
export function scheduleChartUpdate() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
        updateChart();
        rafPending = false;
    });
}

/**
 * Debounced chart resize handler
 */
export function handleChartResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (mainChart) {
            mainChart.resize();
        }
    }, 100);
}

/**
 * Wind rose plugin for Chart.js
 */
export const windRosePlugin = {
    id: 'windRoseBg',
    beforeDraw(chart) {
        if (chart.config._metric !== 'windDirectionDeg') return;
        const { ctx } = chart;
        const xAxis = chart.scales.x;
        if (!xAxis) return;

        const centerX = (chart.chartArea.left + chart.chartArea.right) / 2;
        const centerY = (chart.chartArea.top + chart.chartArea.bottom) / 2;
        const width = chart.chartArea.right - chart.chartArea.left;
        const pixelsPerUnit = width / (2 * xAxis.max);
        const maxRadius = 100 * pixelsPerUnit;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;

        const rings = [0.25, 0.5, 0.75, 1.0];
        rings.forEach(ratio => {
            const r = maxRadius * ratio;
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
            ctx.stroke();
        });

        const directions = [
            { label: 'N', deg: 0 }, { label: 'NO', deg: 45 }, { label: 'O', deg: 90 },
            { label: 'SO', deg: 135 }, { label: 'S', deg: 180 }, { label: 'SW', deg: 225 },
            { label: 'W', deg: 270 }, { label: 'NW', deg: 315 }
        ];

        directions.forEach(d => {
            const rad = d.deg * Math.PI / 180;
            const xEnd = centerX + maxRadius * Math.sin(rad);
            const yEnd = centerY - maxRadius * Math.cos(rad);

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(xEnd, yEnd);
            ctx.stroke();

            const offset = 18;
            const xText = centerX + (maxRadius + offset) * Math.sin(rad);
            const yText = centerY - (maxRadius + offset) * Math.cos(rad);
            ctx.fillStyle = (d.deg % 90 === 0) ? '#ff9b26' : '#8b95a5';
            ctx.font = '11px Poppins, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(d.label, xText, yText);
        });

        ctx.restore();
    }
};

/**
 * Process wind rose data
 * @param {WeatherData[]} rawHistoryData - Raw data
 * @param {number} currentSpanMs - Time span in ms
 * @param {number} timeShiftMs - Time shift in ms
 * @returns {{scatterPoints: WindRosePoint[], startTime: number, endTime: number}}
 */
export function processWindRoseData(rawHistoryData, currentSpanMs, timeShiftMs) {
    const now = Date.now();
    const endTime = now - timeShiftMs;
    const startTime = endTime - currentSpanMs;

    const filtered = rawHistoryData.filter(d => 
        d.timestamp >= startTime && 
        d.timestamp <= endTime && 
        d.windDirectionDeg != null && 
        d.windDirectionDeg !== -1
    );

    const scatterPoints = filtered.map(d => {
        const ratio = (d.timestamp - startTime) / currentSpanMs;
        const r = Math.max(0, Math.min(100, ratio * 100));
        const rad = d.windDirectionDeg * Math.PI / 180;

        return {
            x: r * Math.sin(rad),
            y: r * Math.cos(rad),
            deg: d.windDirectionDeg,
            timestamp: d.timestamp,
            timeStr: new Date(d.timestamp).toLocaleString("de-DE")
        };
    });

    return { scatterPoints, startTime, endTime };
}

/**
 * Process chart data with bucket aggregation
 * @param {WeatherData[]} rawHistoryData - Raw data
 * @param {string} currentMetric - Current metric
 * @param {number} currentSpanMs - Time span in ms
 * @param {number} timeShiftMs - Time shift in ms
 * @returns {{points: ChartPoint[], stepMins: number, startTime: number, endTime: number}}
 */
export function processChartData(rawHistoryData, currentMetric, currentSpanMs, timeShiftMs) {
    const now = Date.now();
    const endTime = now - timeShiftMs;
    const startTime = endTime - currentSpanMs;

    if (!rawHistoryData || !rawHistoryData.length) return { points: [], stepMins: 1, startTime, endTime };

    let stepMins;
    if (currentSpanMs <= 2 * 3600000) stepMins = 1;
    else if (currentSpanMs <= 6 * 3600000) stepMins = 5;
    else if (currentSpanMs <= 24 * 3600000) stepMins = 15;
    else if (currentSpanMs <= 7 * 86400000) stepMins = 60;
    else stepMins = 24 * 60;

    const filtered = rawHistoryData.filter(d => 
        d.timestamp >= startTime && 
        d.timestamp <= endTime && 
        d[currentMetric] != null && 
        d[currentMetric] !== -1
    );

    let points = [];
    let prevTs = null;

    if (stepMins <= 1 || filtered.length <= 300) {
        filtered.forEach(d => {
            if (prevTs !== null && (d.timestamp - prevTs) > 3600000) {
                points.push({ x: prevTs + 1, y: null });
            }
            points.push({ x: d.timestamp, y: d[currentMetric] });
            prevTs = d.timestamp;
        });
        return { points, stepMins, startTime, endTime };
    }

    const stepMs = stepMins * 60000;
    const buckets = new Map();
    filtered.forEach(d => {
        const bucketKey = Math.floor(d.timestamp / stepMs) * stepMs;
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, { sum: 0, count: 0 });
        const b = buckets.get(bucketKey);
        b.sum += d[currentMetric];
        b.count++;
    });

    const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
    sortedKeys.forEach(ts => {
        const b = buckets.get(ts);
        if (prevTs !== null && (ts - prevTs) > 3600000) {
            points.push({ x: prevTs + 1, y: null });
        }
        points.push({ x: ts, y: b.sum / b.count });
        prevTs = ts;
    });

    return { points, stepMins, startTime, endTime };
}

/**
 * Update or create the chart
 * @param {string} currentMetric - Current metric
 * @param {WeatherData[]} rawHistoryData - Raw data
 * @param {number} currentSpanMs - Time span in ms
 * @param {number} timeShiftMs - Time shift in ms
 * @param {function(Date, number): string} formatTimeLabel - Time label formatter
 */
export async function updateChart(currentMetric, rawHistoryData, currentSpanMs, timeShiftMs, formatTimeLabel) {
    await ensureChartJsLoaded();
    
    const canvas = document.getElementById('mainChart');
    const skeleton = document.getElementById('chartSkeleton');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Hide skeleton loader
    if (skeleton) skeleton.style.display = 'none';

    const isWindRose = currentMetric === 'windDirectionDeg';
    const requiredType = isWindRose ? 'scatter' : 'line';

    let needsRebuild = true;
    if (mainChart) {
        if (mainChart.config.type === requiredType) needsRebuild = false;
        else mainChart.destroy();
    }

    const config = metricConfigs[currentMetric];
    const container = document.getElementById('chartContainer');
    const aspect = container ? (container.clientWidth || 800) / (container.clientHeight || 380) : 2.1;

    if (isWindRose) {
        const { scatterPoints, startTime, endTime } = processWindRoseData(rawHistoryData, currentSpanMs, timeShiftMs);

        let windMaxX = aspect > 1 ? 110 * aspect : 110;
        let windMaxY = aspect > 1 ? 110 : 110 / aspect;

        if (needsRebuild) {
            mainChart = new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: config.label,
                        data: scatterPoints,
                        borderColor: config.color,
                        backgroundColor: config.bg,
                        borderWidth: 2,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: {
                        legend: { display: true, position: 'top' },
                        windRoseBg: { startTime, endTime },
                        tooltip: { 
                            callbacks: { 
                                label: ctx => `Zeit: ${ctx.raw.timeStr} | Wind: ${getWindDirectionText(ctx.raw.deg)} (${ctx.raw.deg}°)` 
                            } 
                        }
                    },
                    scales: {
                        x: { min: -windMaxX, max: windMaxX, display: false },
                        y: { min: -windMaxY, max: windMaxY, display: false }
                    }
                },
                plugins: [windRosePlugin]
            });
            mainChart.config._metric = currentMetric;
        } else {
            mainChart.data.datasets[0].data = scatterPoints;
            mainChart.options.scales.x.min = -windMaxX;
            mainChart.options.scales.x.max = windMaxX;
            mainChart.options.scales.y.min = -windMaxY;
            mainChart.options.scales.y.max = windMaxY;
            mainChart.update();
        }
    } else {
        const { points, stepMins, startTime, endTime } = processChartData(rawHistoryData, currentMetric, currentSpanMs, timeShiftMs);

        let yAxisConfig = { grid: { color: '#212733' } };
        if (lockedYMin != null && lockedYMax != null) {
            yAxisConfig.min = lockedYMin;
            yAxisConfig.max = lockedYMax;
        }

        if (needsRebuild) {
            mainChart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: config.label,
                        data: points,
                        borderColor: config.color,
                        backgroundColor: config.bg,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: currentSpanMs <= 24 * 3600000 ? 2 : 0,
                        spanGaps: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: 'nearest', axis: 'x', intersect: false },
                    plugins: {
                        legend: { display: true, position: 'top' },
                        tooltip: {
                            callbacks: {
                                title: function(context) {
                                    if (!context.length) return '';
                                    return new Date(context[0].parsed.x).toLocaleString("de-DE");
                                }
                            }
                        }
                    },
                    scales: {
                        x: { 
                            type: 'linear',
                            grid: { display: false }, 
                            ticks: { 
                                maxTicksLimit: 10,
                                callback: function(value) {
                                    return formatTimeLabel(new Date(value), stepMins);
                                }
                            },
                            min: startTime,
                            max: endTime
                        },
                        y: yAxisConfig
                    }
                }
            });
            mainChart.config._metric = currentMetric;
        } else {
            mainChart.data.datasets[0].data = points;
            mainChart.data.datasets[0].label = config.label;
            mainChart.data.datasets[0].borderColor = config.color;
            mainChart.data.datasets[0].backgroundColor = config.bg;
            mainChart.data.datasets[0].pointRadius = currentSpanMs <= 24 * 3600000 ? 2 : 0;
            mainChart.options.scales.x.ticks.callback = function(value) {
                return formatTimeLabel(new Date(value), stepMins);
            };
            mainChart.options.scales.x.min = startTime;
            mainChart.options.scales.x.max = endTime;
            mainChart.options.scales.y = yAxisConfig;
            mainChart.update();
        }
    }
}

/**
 * Set locked Y axis range (for panning)
 * @param {number|null} min - Min value
 * @param {number|null} max - Max value
 */
export function setLockedYRange(min, max) {
    lockedYMin = min;
    lockedYMax = max;
}

/**
 * Clear locked Y axis range
 */
export function clearLockedYRange() {
    lockedYMin = null;
    lockedYMax = null;
}

/**
 * Get chart instance
 * @returns {Chart|null}
 */
export function getChart() {
    return mainChart;
}

/**
 * Destroy chart
 */
export function destroyChart() {
    if (mainChart) {
        mainChart.destroy();
        mainChart = null;
    }
}