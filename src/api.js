import { FIREBASE_LATEST, FIREBASE_7DAYS } from './types.js';

/** @type {WeatherData[]} */
let cachedHistory = [];
/** @type {WeatherData|null} */
let cachedLive = null;
/** @type {number} */
let lastHistoryFetch = 0;
/** @type {number} */
let lastLiveFetch = 0;

/** @type {Function[]} */
const pendingSync = [];

/**
 * Initialize from localStorage
 */
export function initCache() {
    try {
        const hist = localStorage.getItem('weather_history');
        const live = localStorage.getItem('weather_live');
        const histTime = localStorage.getItem('weather_history_time');
        const liveTime = localStorage.getItem('weather_live_time');
        
        if (hist) cachedHistory = JSON.parse(hist);
        if (live) cachedLive = JSON.parse(live);
        if (histTime) lastHistoryFetch = parseInt(histTime, 10);
        if (liveTime) lastLiveFetch = parseInt(liveTime, 10);
    } catch (e) {
        console.warn('Cache init failed:', e);
    }
}

/**
 * Save to localStorage
 */
function saveCache() {
    try {
        localStorage.setItem('weather_history', JSON.stringify(cachedHistory));
        localStorage.setItem('weather_history_time', String(lastHistoryFetch));
        if (cachedLive) {
            localStorage.setItem('weather_live', JSON.stringify(cachedLive));
            localStorage.setItem('weather_live_time', String(lastLiveFetch));
        }
    } catch (e) {
        console.warn('Cache save failed:', e);
    }
}

/**
 * Check if online
 * @returns {Promise<boolean>}
 */
async function isOnline() {
    try {
        await fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', cache: 'no-cache' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Fetch live data with offline fallback
 * @returns {Promise<WeatherData|null>}
 */
export async function fetchLive() {
    const online = await isOnline();
    
    if (online) {
        try {
            const res = await fetch(FIREBASE_LATEST);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data) {
                cachedLive = data;
                lastLiveFetch = Date.now();
                saveCache();
                return data;
            }
        } catch (e) {
            console.error('Live fetch failed:', e);
        }
    }
    
    // Offline fallback
    if (cachedLive) {
        console.log('Using cached live data');
        return cachedLive;
    }
    return null;
}

/**
 * Fetch history data with offline fallback
 * @returns {Promise<WeatherData[]>}
 */
export async function fetchHistory() {
    const online = await isOnline();
    
    if (online) {
        try {
            const res = await fetch(FIREBASE_7DAYS);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data) {
                cachedHistory = Object.values(data).sort((a, b) => a.timestamp - b.timestamp);
                lastHistoryFetch = Date.now();
                saveCache();
                return cachedHistory;
            }
        } catch (e) {
            console.error('History fetch failed:', e);
        }
    }
    
    // Offline fallback
    if (cachedHistory.length) {
        console.log('Using cached history data');
        return cachedHistory;
    }
    return [];
}

/**
 * Queue a failed request for background sync
 * @param {string} type - 'live' or 'history'
 */
export function queueForSync(type) {
    pendingSync.push({ type, time: Date.now() });
}

/**
 * Process queued sync requests
 * @returns {Promise<void>}
 */
export async function processSyncQueue() {
    if (!pendingSync.length) return;
    
    const online = await isOnline();
    if (!online) return;
    
    const toProcess = [...pendingSync];
    pendingSync.length = 0;
    
    for (const item of toProcess) {
        try {
            if (item.type === 'live') await fetchLive();
            else if (item.type === 'history') await fetchHistory();
        } catch (e) {
            console.error('Sync failed:', e);
            pendingSync.push(item); // Re-queue
        }
    }
}

/**
 * Get cached live data
 * @returns {WeatherData|null}
 */
export function getCachedLive() {
    return cachedLive;
}

/**
 * Get cached history data
 * @returns {WeatherData[]}
 */
export function getCachedHistory() {
    return cachedHistory;
}

/**
 * Get last fetch times
 * @returns {{live: number, history: number}}
 */
export function getLastFetchTimes() {
    return { live: lastLiveFetch, history: lastHistoryFetch };
}

/**
 * Initialize background sync listener
 */
export function initBackgroundSync() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SYNC_TRIGGERED') {
                processSyncQueue();
            }
        });
    }
}