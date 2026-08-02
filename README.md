# Wetter-Station-Dashboard

## Hardware & Systemumgebung

Das primäre Ziel dieses Projekts ist die Entwicklung eines umfassenden Wetter-Station-Dashboards. Es handelt sich um ein autonomes System, das über eigene Hardware lokale Umweltdaten erfasst und diese über eine Cloud-Datenbank in Echtzeit auf einer modernen, hochgradig interaktiven Web-Oberfläche visualisiert.

### 1. Basis-Hardware
- **Mikrocontroller**: ESP 32. 
- **Stromversorgung**: Powerbank. 
- **Datenübertragung**: Der ESP32 sendet die gesammelten Sensordaten via WLAN im JSON-Format an die Firebase Realtime Database (Details zur DB-Struktur siehe Fetch-Requests im Code). 

### 2. Sensoren & Pin-Belegung
- **Temperatur, Luftfeuchtigkeit, Luftdruck**: BME280 über I2C (SDA: 21, SCL: 22). Ein DHT11 ist im C++ Code noch als Backup hinterlegt. 
- **Windrichtung**: AS5600 Magnetsensor (über I2C). 
- **UV-Sensor**: Analoger UV-Sensor (z. B. GUVA-S12SD). Dieser ist an Pin 34 (ADC1) angeschlossen, da dieser Pin bei aktivem WLAN zuverlässig funktioniert. 

### 3. Hardware-Logik (Taster & Deep Sleep)
- **WLAN-Setup**: Ein Taster an Pin 33 (gegen GND) dient zum erzwungenen Starten des WiFiManager-Setup-Portals. 
- **Schutzschaltung**: Zur Vermeidung von "Floating Pins" und versehentlichen Hardware-Wakes während des Deep Sleeps wird ein externer 330-Ohm-Widerstand zwischen 3V3 und Pin 33 genutzt.
