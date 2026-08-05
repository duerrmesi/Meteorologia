import { SUN_LAT, SUN_LNG } from './types.js';

/**
 * Calculate dew point using Magnus formula
 * @param {number|null} temp - Temperature in °C
 * @param {number|null} humidity - Humidity in %
 * @returns {string} Dew point in °C
 */
export function calculateDewPoint(temp, humidity) {
    if (temp == null || humidity == null) return "--";
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * temp) / (b + temp)) + Math.log(humidity / 100.0);
    const dewPoint = (b * alpha) / (a - alpha);
    return dewPoint.toFixed(1) + " °C";
}

/**
 * Calculate pressure trend over 3 hours
 * @param {WeatherData[]} values - Historical data
 * @returns {string} Trend string with arrow
 */
export function calculatePressureTrend(values) {
    if (!values || values.length < 2) return "--";
    const latest = values[values.length - 1];
    const targetTime = latest.timestamp - (3 * 60 * 60 * 1000);
    const pastEntry = values.find(v => v.timestamp >= targetTime) || values[0];

    if (!pastEntry || pastEntry.pressure == null || latest.pressure == null) return "--";

    const diff = latest.pressure - pastEntry.pressure;

    const badgeStorm = document.getElementById('badge-storm');
    if (badgeStorm) {
        badgeStorm.style.display = diff <= -2.0 ? "inline-flex" : "none";
    }

    let arrow = diff > 1.5 ? "⇈" : diff > 0.5 ? "↗" : diff < -1.5 ? "⇊" : diff < -0.5 ? "↘" : "➔";
    return `${arrow} ${diff > 0 ? '+' : ''}${diff.toFixed(1)} hPa`;
}

/**
 * Calculate feels-like temperature (windchill + heat index)
 * @param {number|null} temp - Temperature in °C
 * @param {number|null} windSpeed - Wind speed in km/h
 * @param {number|null} humidity - Humidity in %
 * @returns {string} Feels like temperature in °C
 */
export function calculateFeelsLike(temp, windSpeed, humidity) {
    if (temp == null) return "--";
    let feelsLike = temp;

    if (temp <= 10 && windSpeed != null && windSpeed > 4.8) {
        feelsLike = 13.12 + 0.6215 * temp - 11.37 * Math.pow(windSpeed, 0.16) + 0.3965 * temp * Math.pow(windSpeed, 0.16);
    } else if (temp >= 27 && humidity != null && humidity >= 40) {
        const t = temp;
        const r = humidity;
        feelsLike = -8.78469475556 + (1.61139411 * t) + (2.33854883889 * r) + (-0.14611605 * t * r) + (-0.012308094 * t * t) + (-0.0164248277778 * r * r) + (0.002211732 * t * t * r) + (0.00072546 * t * r * r) + (-0.000003582 * t * t * r * r);
    }
    return feelsLike.toFixed(1) + " °C";
}

/**
 * Update sunrise/sunset times
 */
export function updateSunTimes() {
    const sunEl = document.getElementById('sun-times');
    if (!sunEl || typeof SunCalc === 'undefined') return;

    const times = SunCalc.getTimes(new Date(), SUN_LAT, SUN_LNG);
    const sunrise = times.sunrise.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' });
    const sunset = times.sunset.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' });

    sunEl.innerHTML = `<i class="fas fa-sun" style="color:#ff9b26"></i> ${sunrise} &nbsp;&nbsp; <i class="fas fa-moon" style="color:#8b5cf6"></i> ${sunset}`;
}

/**
 * Convert degrees to wind direction abbreviation
 * @param {number|null} deg - Wind direction in degrees
 * @returns {string} Direction abbreviation
 */
export function getWindDirectionText(deg) {
    if (deg == null || deg === -1) return "--";
    const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW", "N"];
    return dirs[Math.round((deg % 360) / 45)];
}

/**
 * Group data by day
 * @param {WeatherData[]} data - Raw historical data
 * @returns {DailyGroup[]} Grouped by day
 */
export function groupByDay(data) {
    const daily = {};
    data.forEach(v => {
        const d = new Date(v.timestamp);
        const dayKey = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
        if (!daily[dayKey]) daily[dayKey] = { temps: [], ts: v.timestamp };
        if (v.temperature != null) daily[dayKey].temps.push(v.temperature);
    });
    return Object.keys(daily)
        .map(k => ({ label: k, temps: daily[k].temps, ts: daily[k].ts }))
        .sort((a, b) => a.ts - b.ts);
}

/**
 * Format time label based on step size
 * @param {Date} date - Date to format
 * @param {number} stepMins - Step size in minutes
 * @returns {string} Formatted time string
 */
export function formatTimeLabel(date, stepMins) {
    if (stepMins < 60) {
        return date.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' });
    } else if (stepMins < 24 * 60) {
        return date.toLocaleString("de-DE", { day: '2-digit', month: '2-digit', hour: '2-digit' }) + "h";
    } else {
        return date.toLocaleDateString("de-DE", { day: '2-digit', month: '2-digit' });
    }
}

/**
 * Animate value update in DOM element
 * @param {string} elementId - Element ID
 * @param {string} newText - New text content
 */
export function animateValueUpdate(elementId, newText) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (el.innerText === newText) return;
    el.classList.add('updating');
    el.innerText = newText;
    setTimeout(() => el.classList.remove('updating'), 300);
}

/**
 * Control connection status banner
 * @param {'online'|'offline'} status - Connection status
 */
export function setConnectionStatus(status) {
    const banner = document.getElementById('connection-banner');
    if (!banner) return;
    if (status === 'offline') {
        banner.classList.add('visible');
    } else {
        banner.classList.remove('visible');
    }
}

/**
 * Update SVG gauge
 * @param {string} gaugeId - Gauge circle element ID
 * @param {string} textId - Value text element ID
 * @param {string|null} tagId - Offline tag element ID
 * @param {number|null} value - Current value
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {string} unit - Unit string
 */
export function updateGauge(gaugeId, textId, tagId, value, min, max, unit) {
    const gaugeValueCircle = document.getElementById(gaugeId);
    const valueText = document.getElementById(textId);
    const tagElem = tagId ? document.getElementById(tagId) : null;

    if (value === -1 || value == null) {
        if (valueText) valueText.innerText = "--";
        if (tagElem) tagElem.style.display = "inline-block";
        if (gaugeValueCircle) gaugeValueCircle.style.strokeDashoffset = 251.2;
        return;
    }

    if (valueText) valueText.innerText = value + (unit ? " " : "") + unit;
    if (tagElem) tagElem.style.display = "none";

    if (gaugeValueCircle) {
        let percent = ((value - min) / (max - min)) * 100;
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;
        const offset = 251.2 - (percent * 251.2 / 100);
        gaugeValueCircle.style.strokeDashoffset = offset;
    }
}