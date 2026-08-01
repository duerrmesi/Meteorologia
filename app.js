// ============================================================================
// WETTER ANALYTICS DASHBOARD - HAUPTSKRIPT (JS)
// ============================================================================

// --- FIREBASE DATENBANK-ENDPUNKTE ---
// Firebase Realtime Database URLs zum Abrufen der aktuellen und historischen Messwerte
const FIREBASE_BASE = "https://meteorologia-377e2-default-rtdb.europe-west1.firebasedatabase.app";
const FIREBASE_LATEST = `${FIREBASE_BASE}/messwerte.json`;
// Lädt maximal 10.080 Einträge (entspricht exakt 7 Tagen bei 1-Minuten-Intervallen)
const FIREBASE_7DAYS = `${FIREBASE_BASE}/historie.json?orderBy=%22timestamp%22&limitToLast=10080`;

// --- GLOBAL CHART CONFIGURATION ---
// Setzt globale Standardfarben für das Chart.js Diagramm
Chart.defaults.color = '#8b95a5';
Chart.defaults.borderColor = '#212733';
let mainChart = null; // Globale Referenz auf die Chart.js-Instanz

// --- GLOBALE ZUSTANDSVARIABLEN (STATE MANAGEMENT) ---
let rawHistoryData = [];      // Unveränderter Datenstrom aus der Datenbank
let currentChartData = [];    // Datenbasis für das aktuell angezeigte Diagramm
let currentMetric = 'temperature'; // Aktiv gewählte Messgröße (z. B. 'temperature', 'humidity')
let currentTimeframe = '24h';      // Gewählter Zeitbereich (z. B. '24h', '7d')

let currentSpanMs = 24 * 3600000;  // Sichtbares Zeitfenster in Millisekunden (Standard: 24h)
let timeShiftMs = 0;              // Verschiebung in die Vergangenheit (0 = Echtzeit)

// Variablen zum Einfrieren der Y-Achsenskalierung während des Wischens (verhindert optisches Ruckeln)
let lockedYMin = null;
let lockedYMax = null;

// Konfiguration der Farben und Bezeichnungen für alle verschiedenen Sensoren
const metricConfigs = {
    temperature: { label: 'Temperatur (°C)', color: '#ff9b26', bg: 'rgba(255, 155, 38, 0.1)' },
    humidity: { label: 'Luftfeuchtigkeit (%)', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
    pressure: { label: 'Luftdruck (hPa)', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
    windDirectionDeg: { label: 'Windrose (Zentrum: Alt → Rand: Neu)', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)' },
    uvIndex: { label: 'UV-Index', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
    rainLast24h: { label: 'Niederschlag (mm)', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)' }
};

// ============================================================================
// 1. MATHEMATISCHE & METEOROLOGISCHE BERECHNUNGEN (SOFTWARE-SENSOREN)
// ============================================================================

// BERECHNUNG DES TAUPUNKTS (Magnus-Formel)
// Der Taupunkt beschreibt die Temperatur, auf die Luft abgekühlt werden muss, 
// damit die enthaltene Feuchtigkeit als Kondenswasser (Morgentau/Schimmel) ausfällt.
function calculateDewPoint(temp, humidity) {
    if (temp == null || humidity == null) return "--";
    // Magnus-Koeffizienten für den Bereich -45°C bis +60°C
    const a = 17.27;
    const b = 237.7;
    // Mathematische Hilfsvariable alpha
    const alpha = ((a * temp) / (b + temp)) + Math.log(humidity / 100.0);
    // Errechnete Taupunkttemperatur in Grad Celsius
    const dewPoint = (b * alpha) / (a - alpha);
    return dewPoint.toFixed(1) + " °C";
}

// BERECHNUNG DES DRUCKTRENDS UND STURMWARNUNG
// Ein rascher Druckfall von > 2 hPa in 3 Stunden deutet auf das Heranziehen eines Tiefdruckgebiets/Sturms hin.
function calculatePressureTrend(values) {
    if (!values || values.length < 2) return "--";
    const latest = values[values.length - 1]; // Aktuellster Messwert
    const targetTime = latest.timestamp - (3 * 60 * 60 * 1000); // Zeitpunkt vor genau 3 Stunden
    
    // Suche den nächstgelegenen Datenpunkt von vor 3 Stunden
    const pastEntry = values.find(v => v.timestamp >= targetTime) || values[0];
    
    if (!pastEntry || pastEntry.pressure == null || latest.pressure == null) return "--";
    
    // Differenzberechnung in hPa
    const diff = latest.pressure - pastEntry.pressure;
    
    // Sturmwarnungs-Badge bei starkem Druckabfall einblenden
    const badgeStorm = document.getElementById('badge-storm');
    if (badgeStorm) {
        badgeStorm.style.display = diff <= -2.0 ? "inline-flex" : "none";
    }

    // Pfeil-Symbolik bestimmen
    let arrow = diff > 1.5 ? "⇈" : diff > 0.5 ? "↗" : diff < -1.5 ? "⇊" : diff < -0.5 ? "↘" : "➔";
    return `${arrow} ${diff > 0 ? '+' : ''}${diff.toFixed(1)} hPa`;
}

// HILFSFUNKTION: Gradangabe (0-360°) in Windrichtungskürzel (z.B. N, NO, O) umrechnen
function getWindDirectionText(deg) {
    if (deg == null || deg === -1) return "--";
    const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW", "N"];
    return dirs[Math.round((deg % 360) / 45)];
}

// ============================================================================
// 2. ERWEITERTE TOUCH- UND MAUS-INTERAKTION (WISCHEN & PINCH-TO-ZOOM)
// ============================================================================

// Direktes Binden der Touch-Events an das HTML5 Canvas-Element
// Wir nutzen native Touch-Events, da diese auf Smartphones (iOS/Android) 100% verlässlich laufen.
function initTouchAndMouseEvents() {
    const canvas = document.getElementById('mainChart');
    const container = document.getElementById('chartContainer');
    if (!canvas || !container) return;

    let touchStartPinchDist = null; // Distanz zwischen 2 Fingern beim Zoom-Start
    let touchStartSpan = null;      // Zeitfenster-Spanne beim Zoom-Start
    let touchLastX = null;          // Letzte Finger-X-Position beim Wischen

    // ------------------------------------------------------------------------
    // A) MOBILE TOUCH-EVENTS (SMARTPHONES & TABLETS)
    // ------------------------------------------------------------------------
    
    // 1. TOUCH START (Finger berührt das Display)
    canvas.addEventListener('touchstart', function(e) {
        // Zwingend notwendig: Verhindert, dass das Handy die komplette Webseite scrollt
        if (e.cancelable) e.preventDefault();

        // Chart.js Tooltip vorübergehend deaktivieren, damit er das Wischen nicht stört
        if (mainChart) {
            mainChart.options.plugins.tooltip.enabled = false;
            if (mainChart.scales.y) {
                lockedYMin = mainChart.scales.y.min;
                lockedYMax = mainChart.scales.y.max;
            }
        }

        if (e.touches.length === 1) {
            // EIN FINGER: Wischen / Panning vorbereiten
            touchLastX = e.touches[0].clientX;
        } 
        else if (e.touches.length === 2) {
            // ZWEI FINGER: Pinch-to-Zoom vorbereiten (Pythagoras für Fingerabstand)
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartPinchDist = Math.hypot(dx, dy);
            touchStartSpan = currentSpanMs;
        }
    }, { passive: false });

    // 2. TOUCH MOVE (Finger bewegt sich über den Bildschirm)
    canvas.addEventListener('touchmove', function(e) {
        if (e.cancelable) e.preventDefault();

        if (e.touches.length === 1 && touchLastX !== null) {
            // EIN FINGER: Wischen ausführen
            const currentX = e.touches[0].clientX;
            const deltaX = currentX - touchLastX; // Gemessene Bewegung in Pixeln
            touchLastX = currentX;

            // Umrechnung von Pixel-Bewegung auf dem Display in Zeit-Millisekunden
            const pixelsPerMs = currentSpanMs / container.clientWidth;
            timeShiftMs += deltaX * pixelsPerMs;
            
            // Verhindert das Wischen in die Zukunft
            if (timeShiftMs < 0) timeShiftMs = 0;

            updateTimeShiftDisplay();
            updateChart();
        } 
        else if (e.touches.length === 2 && touchStartPinchDist !== null) {
            // ZWEI FINGER: Zoomen ausführen
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDist = Math.hypot(dx, dy);

            // Zoom-Verhältnis berechnen (Auseinanderziehen = Reinzoomen, Zusammenziehen = Rauszoomen)
            const zoomRatio = touchStartPinchDist / currentDist;
            let newSpanMs = touchStartSpan * zoomRatio;

            // Grenzen für den Zoom festlegen (Min. 15 Minuten, Max. 1 Jahr)
            if (newSpanMs < 15 * 60000) newSpanMs = 15 * 60000;
            if (newSpanMs > 365 * 86400000) newSpanMs = 365 * 86400000;

            currentSpanMs = newSpanMs;
            updateTimeShiftDisplay();
            updateChart();
        }
    }, { passive: false });

    // 3. TOUCH END / CANCEL (Finger wird vom Display abgehoben)
    function handleTouchEnd(e) {
        if (e.touches.length < 2) {
            touchStartPinchDist = null; // Zoom-Modus beenden
        }
        if (e.touches.length === 0) {
            touchLastX = null; // Wisch-Modus beenden
            lockedYMin = null;
            lockedYMax = null;

            // Tooltip wieder aktivieren
            if (mainChart) {
                mainChart.options.plugins.tooltip.enabled = true;
                updateChart();
            }
        }
    }
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    // ------------------------------------------------------------------------
    // B) DESKTOP MAUS-EVENTS (PC & LAPTOP)
    // ------------------------------------------------------------------------
    let isMouseDown = false;
    let mouseLastX = 0;

    canvas.addEventListener('mousedown', function(e) {
        isMouseDown = true;
        mouseLastX = e.clientX;
        canvas.style.cursor = 'grabbing';
        if (mainChart && mainChart.scales.y) {
            lockedYMin = mainChart.scales.y.min;
            lockedYMax = mainChart.scales.y.max;
        }
    });

    window.addEventListener('mousemove', function(e) {
        if (!isMouseDown) return;
        const deltaX = e.clientX - mouseLastX;
        mouseLastX = e.clientX;

        const pixelsPerMs = currentSpanMs / container.clientWidth;
        timeShiftMs += deltaX * pixelsPerMs;
        if (timeShiftMs < 0) timeShiftMs = 0;

        updateTimeShiftDisplay();
        updateChart();
    });

    window.addEventListener('mouseup', function() {
        if (isMouseDown) {
            isMouseDown = false;
            canvas.style.cursor = 'crosshair';
            lockedYMin = null;
            lockedYMax = null;
            updateChart();
        }
    });

    // Mausrad-Zoom (Zentriert exakt auf die Position des Mauszeigers)
    container.addEventListener('wheel', function(e) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        
        let chartAreaLeft = 0;
        let chartAreaRight = container.clientWidth;
        if (mainChart && mainChart.chartArea) {
            chartAreaLeft = mainChart.chartArea.left;
            chartAreaRight = mainChart.chartArea.right;
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
        updateChart();
    }, { passive: false });
}

// ============================================================================
// 3. API & DATENBANK ABFRAGEN (FIREBASE FETCH)
// ============================================================================

// Lädt die allerneuesten Live-Messwerte von Firebase und aktualisiert die UI-Karten
async function loadLive() {
    try {
        const res = await fetch(FIREBASE_LATEST);
        const data = await res.json();
        if (!data) return;

        // Aktualisierung der Hauptkarten
        document.getElementById('temp-main').innerText = data.temperature ? data.temperature.toFixed(2) + " °C" : "-- °C";
        document.getElementById('hum-val').innerText = data.humidity ? data.humidity.toFixed(0) + " %" : "-- %";
        document.getElementById('press-val').innerText = data.pressure ? data.pressure.toFixed(0) + " hPa" : "-- hPa";
        document.getElementById('wind-dir-val').innerText = getWindDirectionText(data.windDirectionDeg);
        document.getElementById('dew-point').innerText = calculateDewPoint(data.temperature, data.humidity);

        // Frostwarnungs-Badge aktivieren bei <= 3 °C
        const badgeFrost = document.getElementById('badge-frost');
        if (badgeFrost) badgeFrost.style.display = data.temperature <= 3 ? "inline-flex" : "none";

        // Platzhalter für noch nicht angeschlossene Sensoren verwalten
        handlePlaceholderSensor('wind-speed-val', 'wind-speed-tag', data.windSpeed, " km/h");
        handlePlaceholderSensor('uv-val', 'uv-tag', data.uvIndex, "");
        handlePlaceholderSensor('rain-val', 'rain-tag', data.rainLast24h, " mm");

        // Zeitstempel der letzten Aktualisierung anzeigen
        const date = new Date(data.timestamp || Date.now());
        document.getElementById('last-update').innerText = "Update: " + date.toLocaleTimeString("de-DE", {hour: '2-digit', minute:'2-digit'});
    } catch (e) { console.error("Fehler beim Laden der Live-Daten:", e); }
}

// Hilfsfunktion zur Kennzeichnung inaktiver Sensoren
function handlePlaceholderSensor(valId, tagId, value, unit) {
    const valElem = document.getElementById(valId);
    const tagElem = document.getElementById(tagId);
    if (!valElem || !tagElem) return;
    
    if (value === -1 || value == null) {
        valElem.innerText = "--";
        tagElem.style.display = "inline-block";
    } else {
        valElem.innerText = value + unit;
        tagElem.style.display = "none";
    }
}

// Initialisiert das Dashboard beim Aufruf der Seite
async function initDashboard() {
    try {
        const res = await fetch(FIREBASE_7DAYS);
        const data = await res.json();
        if (data) {
            // Sortiert die historischen Daten aufsteigend nach Zeitstempel
            rawHistoryData = Object.values(data).sort((a, b) => a.timestamp - b.timestamp);
            currentChartData = [...rawHistoryData];
            
            // Drucktrend initial berechnen
            const pressureTrendElem = document.getElementById('pressure-trend');
            if (pressureTrendElem) pressureTrendElem.innerText = calculatePressureTrend(rawHistoryData);
            
            // Tagesübersichten und Diagramm initialisieren
            renderDaysOverview();
            renderMinMaxGrid();
            updateTimeShiftDisplay();
            initTouchAndMouseEvents(); // Touch & Maus-Logik aktivieren
            updateChart();
        }
    } catch (e) { console.error("Fehler bei der Initialisierung:", e); }
}

// ============================================================================
// 4. CHART.JS DIAGRAMM & WINDROSEN-RENDERER
// ============================================================================

// EIGENES CHART.JS PLUGIN: Zeichnet die Kompassrose & Zeitringe im Windrosen-Modus
const windRosePlugin = {
    id: 'windRoseBg',
    beforeDraw(chart, args, options) {
        if (currentMetric !== 'windDirectionDeg') return;
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

        // 4 Zeitringe zeichnen (Zentrum: Alt -> Rand: Neu)
        const rings = [0.25, 0.5, 0.75, 1.0];
        rings.forEach(ratio => {
            const r = maxRadius * ratio;
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
            ctx.stroke();
        });

        // 8 Haupt-Himmelsrichtungen zeichnen (N, NO, O, SO, S, SW, W, NW)
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

// Verarbeitet Messdaten für die Windrose (Polarkoordinaten -> Kartesische Koordinaten X/Y)
function processWindRoseData() {
    const now = Date.now();
    const endTime = now - timeShiftMs;
    const startTime = endTime - currentSpanMs;

    const filtered = currentChartData.filter(d => d.timestamp >= startTime && d.timestamp <= endTime && d.windDirectionDeg != null && d.windDirectionDeg !== -1);

    const scatterPoints = filtered.map(d => {
        // Radius r (0 bis 100%) spiegelt das Alter des Messwerts wider
        const ratio = (d.timestamp - startTime) / currentSpanMs;
        const r = Math.max(0, Math.min(100, ratio * 100));
        const rad = d.windDirectionDeg * Math.PI / 180;
        
        // Umrechnung Grad/Radius in X/Y Koordinate
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

// Datenaufbereitung für das Standard-Liniendiagramm inkl. Interpolation an den Rändern
function processChartData() {
    if (!currentChartData || !currentChartData.length) return { labels: [], values: [] };
    
    const now = Date.now();
    const endTime = now - timeShiftMs;
    const startTime = endTime - currentSpanMs;
    
    // Dynamische Anpassung des Mittelung-Intervalls je nach gewähltem Zoom
    let stepMins = 15;
    if (currentSpanMs <= 2 * 3600000) stepMins = 5;
    else if (currentSpanMs <= 24 * 3600000) stepMins = 15;
    else if (currentSpanMs <= 7 * 86400000) stepMins = 60;
    else stepMins = 24 * 60;

    const metric = currentMetric;
    const filtered = currentChartData.filter(d => d.timestamp >= startTime && d.timestamp <= endTime && d[metric] != null && d[metric] !== -1);

    const labels = [];
    const values = [];

    filtered.forEach(d => {
        const date = new Date(d.timestamp);
        const timeLabel = stepMins < 60 
            ? date.toLocaleTimeString("de-DE", {hour: '2-digit', minute:'2-digit'})
            : date.toLocaleString("de-DE", { day: '2-digit', month: '2-digit', hour: '2-digit' }) + "h";
        
        labels.push(timeLabel);
        values.push(d[metric]);
    });

    return { labels, values };
}

// Hauptfunktion zum Neuzeichnen oder Aktualisieren des Charts
function updateChart() {
    const canvas = document.getElementById('mainChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const isWindRose = currentMetric === 'windDirectionDeg';
    const requiredType = isWindRose ? 'scatter' : 'line';

    let needsRebuild = true;
    if (mainChart) {
        if (mainChart.config.type === requiredType) needsRebuild = false;
        else mainChart.destroy(); // Chart zerstören falls der Typ wechselt (z.B. von Linie auf Windrose)
    }

    if (isWindRose) {
        const { scatterPoints, startTime, endTime } = processWindRoseData();
        const config = metricConfigs['windDirectionDeg'];
        const container = document.getElementById('chartContainer');
        const aspect = (container.clientWidth || 800) / (container.clientHeight || 380);
        
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
                        tooltip: { callbacks: { label: ctx => `Zeit: ${ctx.raw.timeStr} | Wind: ${getWindDirectionText(ctx.raw.deg)} (${ctx.raw.deg}°)` } }
                    },
                    scales: {
                        x: { min: -windMaxX, max: windMaxX, display: false },
                        y: { min: -windMaxY, max: windMaxY, display: false }
                    }
                },
                plugins: [windRosePlugin]
            });
        } else {
            mainChart.data.datasets[0].data = scatterPoints;
            mainChart.options.scales.x.min = -windMaxX;
            mainChart.options.scales.x.max = windMaxX;
            mainChart.options.scales.y.min = -windMaxY;
            mainChart.options.scales.y.max = windMaxY;
            mainChart.update();
        }
    } else {
        const { labels, values } = processChartData();
        const config = metricConfigs[currentMetric];

        let yAxisConfig = { grid: { color: '#212733' } };
        if (lockedYMin != null && lockedYMax != null) {
            yAxisConfig.min = lockedYMin;
            yAxisConfig.max = lockedYMax;
        }

        if (needsRebuild) {
            mainChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: config.label,
                        data: values,
                        borderColor: config.color,
                        backgroundColor: config.bg,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: currentSpanMs <= 24 * 3600000 ? 2 : 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: true, position: 'top' }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
                        y: yAxisConfig
                    }
                }
            });
        } else {
            mainChart.data.labels = labels;
            mainChart.data.datasets[0].data = values;
            mainChart.data.datasets[0].label = config.label;
            mainChart.data.datasets[0].borderColor = config.color;
            mainChart.data.datasets[0].backgroundColor = config.bg;
            mainChart.options.scales.y = yAxisConfig;
            mainChart.update();
        }
    }
}

// ============================================================================
// 5. STEUERUNG & INTERAKTIONS-FUNKTIONEN
// ============================================================================

// Aktualisiert den Text unter dem Diagramm bezüglich Verschiebung & Zoom
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

// Umschalten des angezeigten Zeitfensters via Buttons
async function switchTimeframe(tf, btnElement) {
    currentTimeframe = tf;
    timeShiftMs = 0;

    document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
    if (btnElement && !btnElement.classList.contains('date-picker')) {
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
        const start = new Date(selectedDate); start.setHours(0,0,0,0);
        const end = new Date(selectedDate); end.setHours(23,59,59,999);
        
        timeShiftMs = Date.now() - end.getTime();
        currentSpanMs = end.getTime() - start.getTime();
    }
    
    updateTimeShiftDisplay();
    updateChart();
}

// Zeitverschiebung über Pfeil-Buttons
function shiftTime(hours) {
    timeShiftMs += hours * 3600000;
    if (timeShiftMs < 0) timeShiftMs = 0;
    updateTimeShiftDisplay();
    updateChart();
}

// Zurückstellen der Zeitverschiebung auf die Gegenwart
function resetTimeShift() {
    timeShiftMs = 0;
    updateTimeShiftDisplay();
    updateChart();
}

// Umschalten der aktuell angezeigten Metrik (Temp, Feuchte, Druck, etc.)
function switchMetric(metric) {
    currentMetric = metric;
    document.querySelectorAll('.chart-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    updateChart();
}

// EXPORT-FUNKTION: Lädt alle Messwerte der Datenbank als CSV-Datei für Excel herunter
function exportCSV() {
    if (!currentChartData || !currentChartData.length) return alert("Keine Daten vorhanden.");
    let csv = "Timestamp,Datum,Temperatur_C,Luftfeuchtigkeit_prozent,Luftdruck_hPa,Windrichtung_Grad,UV_Index,Regen_mm\n";
    currentChartData.forEach(d => {
        const dateStr = new Date(d.timestamp).toLocaleString("de-DE");
        csv += `${d.timestamp},"${dateStr}",${d.temperature ?? ''},${d.humidity ?? ''},${d.pressure ?? ''},${d.windDirectionDeg ?? ''},${d.uvIndex ?? ''},${d.rainLast24h ?? ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `wetter_daten_${Date.now()}.csv`;
    link.click();
}

// Render-Funktion für die 6-Tage-Temperaturübersicht
function renderDaysOverview() {
    const daily = {};
    rawHistoryData.forEach(v => {
        const d = new Date(v.timestamp);
        const dayKey = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
        if (!daily[dayKey]) daily[dayKey] = { temps: [], ts: v.timestamp };
        if (v.temperature != null) daily[dayKey].temps.push(v.temperature);
    });
    const days = Object.keys(daily).map(k => ({ label: k, temps: daily[k].temps, ts: daily[k].ts })).sort((a,b) => a.ts - b.ts).slice(-6);
    const grid = document.getElementById('days-history-grid');
    if (grid) {
        grid.innerHTML = days.map(d => 
            `<div class="day-card"><div class="day-name">${d.label}</div><div class="day-temp">Ø ${(d.temps.reduce((a,b)=>a+b,0)/d.temps.length).toFixed(1)}°</div></div>`
        ).join('');
    }
}

// Render-Funktion für die Tages-Extremwerte (Min / Max)
function renderMinMaxGrid() {
    const daily = {};
    rawHistoryData.forEach(v => {
        const d = new Date(v.timestamp);
        const dayKey = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
        if (!daily[dayKey]) daily[dayKey] = { temps: [], ts: v.timestamp };
        if (v.temperature != null) daily[dayKey].temps.push(v.temperature);
    });
    const days = Object.keys(daily).map(k => ({ label: k, temps: daily[k].temps, ts: daily[k].ts })).sort((a,b) => b.ts - a.ts).slice(0, 4);
    const grid = document.getElementById('min-max-grid');
    if (grid) {
        grid.innerHTML = days.map(d => 
            `<div class="min-max-card"><div class="date">${d.label}</div><div class="min-max-values"><span class="min-val">${Math.min(...d.temps).toFixed(1)} °C</span><span class="max-val">${Math.max(...d.temps).toFixed(1)} °C</span></div></div>`
        ).join('');
    }
}

// ============================================================================
// 6. INITIALISIERUNG DES SERVICE WORKERS (PWA STEUERUNG)
// ============================================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker erfolgreich registriert:', reg))
            .catch(err => console.error('Service Worker Registrierungsfehler:', err));
    });
}

// Startet den Abruf der Live-Messwerte sowie die Initialisierung des Dashboards
loadLive();
initDashboard();
// Automatische Aktualisierung der Live-Messwerte alle 60 Sekunden
setInterval(loadLive, 60000);
