/**
 * @typedef {Object} WeatherData
 * @property {number} timestamp - Unix timestamp in ms
 * @property {number|null} temperature - Temperature in °C
 * @property {number|null} humidity - Humidity in %
 * @property {number|null} pressure - Pressure in hPa
 * @property {number|null} windSpeed - Wind speed in km/h
 * @property {number|null} windDirectionDeg - Wind direction in degrees (0-360)
 * @property {number|null} uvIndex - UV Index
 * @property {number|null} rainLast24h - Rain in mm
 * @property {number|null} rssi - WiFi signal strength in dBm
 * @property {number|null} uptime - System uptime in seconds
 */

/**
 * @typedef {Object} MetricConfig
 * @property {string} label
 * @property {string} color
 * @property {string} bg
 */

/**
 * @typedef {Object} ChartPoint
 * @property {number} x - Timestamp
 * @property {number|null} y - Value
 */

/**
 * @typedef {Object} WindRosePoint
 * @property {number} x - X coordinate
 * @property {number} y - Y coordinate
 * @property {number} deg - Wind direction in degrees
 * @property {number} timestamp - Unix timestamp
 * @property {string} timeStr - Formatted time string
 */

/**
 * @typedef {Object} DailyGroup
 * @property {string} label - Formatted date label
 * @property {number[]} temps - Array of temperatures
 * @property {number} ts - Timestamp
 */

/** @type {Record<string, MetricConfig>} */
export const metricConfigs = {
    temperature: { label: 'Temperatur (°C)', color: '#ff9b26', bg: 'rgba(255, 155, 38, 0.1)' },
    humidity: { label: 'Luftfeuchtigkeit (%)', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
    pressure: { label: 'Luftdruck (hPa)', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
    windDirectionDeg: { label: 'Windrose (Zentrum: Alt → Rand: Neu)', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)' },
    uvIndex: { label: 'UV-Index', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
    rainLast24h: { label: 'Niederschlag (mm)', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)' }
};

/** @type {string[]} */
export const METRICS = Object.keys(metricConfigs);

/** @type {string[]} */
export const TIMEFRAMES = ['1h', '24h', '7d', 'all'];

/** @type {number} */
export const FIREBASE_BASE = "https://meteorologia-377e2-default-rtdb.europe-west1.firebasedatabase.app";
/** @type {string} */
export const FIREBASE_LATEST = `${FIREBASE_BASE}/messwerte.json`;
/** @type {string} */
export const FIREBASE_7DAYS = `${FIREBASE_BASE}/historie.json?orderBy=%22timestamp%22&limitToLast=10080`;

/** @type {number} */
export const SUN_LAT = 51.3127;
/** @type {number} */
export const SUN_LNG = 9.4816;