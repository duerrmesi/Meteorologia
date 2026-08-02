# 🌤️ Wetter-Station-Dashboard

Das **Wetter-Station-Dashboard** ist ein modernes, hochgradig interaktives Web-Interface zur Visualisierung lokaler Umweltdaten in Echtzeit. Es empfängt Daten von einer autonomen Hardware-Wetterstation und speichert diese sicher in einer Cloud-Datenbank (Firebase).

## ✨ Features
- **Echtzeit-Daten**: Automatische Aktualisierung der Messwerte (Temperatur, Luftfeuchtigkeit, Luftdruck, Windrichtung, UV-Index).
- **Interaktive Diagramme**: Detaillierte historische Verläufe der Wetterdaten über ein interaktives Chart.
- **Responsives Design**: Optimiert für Desktop, Tablet und Smartphone.
- **Cloud-Anbindung**: Zuverlässige Datenhaltung über Firebase Realtime Database.

---

## 🛠️ Verwendete Technologien
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend/Datenbank**: Firebase Realtime Database
- **Hardware**: ESP32 Mikrocontroller

---

## 🔌 Hardware & Systemumgebung

Das System erfasst Daten über eigene Sensoren und sendet diese via WLAN (im JSON-Format) an die Firebase-Datenbank.

### 1. Basis-Hardware
- **Mikrocontroller**: ESP32 
- **Stromversorgung**: Powerbank 
- **Datenübertragung**: WLAN (2.4 GHz)

### 2. Sensoren & Pin-Belegung
- **Temperatur, Luftfeuchtigkeit, Luftdruck**: BME280 über I2C (SDA: 21, SCL: 22). *(Hinweis: Ein DHT11 ist im C++ Code als Backup implementiert).*
- **Windrichtung**: AS5600 Magnetsensor (über I2C). 
- **UV-Sensor**: Analoger UV-Sensor (z. B. GUVA-S12SD). Angeschlossen an Pin 34 (ADC1), da dieser bei aktivem WLAN zuverlässig misst.

### 3. Hardware-Logik (Taster & Deep Sleep)
- **WLAN-Setup**: Ein Taster an Pin 33 (gegen GND) dient zum erzwungenen Starten des WiFiManager-Setup-Portals. 
- **Schutzschaltung**: Zur Vermeidung von "Floating Pins" und versehentlichen Hardware-Wakes während des Deep Sleeps wird ein externer 330-Ohm-Widerstand zwischen 3V3 und Pin 33 genutzt.

---

## 🚀 Installation & Start (Website)
Da es sich um eine reine Frontend-Anwendung handelt, sind keine komplexen Build-Tools notwendig:
1. Das Repository klonen oder als ZIP herunterladen.
2. Den Ordner öffnen.
3. Die Datei `index.html` in einem modernen Webbrowser (Chrome, Firefox, Safari, Edge) öffnen.
4. *Alternativ*: Mit einem lokalen Entwicklungsserver (z.B. der "Live Server" Erweiterung in VS Code) starten.
