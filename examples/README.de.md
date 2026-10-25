# Beispiele

Importierbare Beispiele für [`@impact0815/node-red-contrib-alphaess-modbus`](https://github.com/impact0815/node-red-contrib-alphaess-modbus).

In Node-RED können die Dateien über **Menü → Import → Datei** importiert werden. Alternativ den JSON-Inhalt kopieren und **Menü → Import → Zwischenablage** verwenden.

## Verfügbare Beispiele

### `alphaess-modbus-example.json`

Einfacher Beispiel-Flow für die AlphaESS-Modbus-Node.

Der Flow eignet sich als Einstieg zum lokalen Lesen der Alpha-ESS-Daten über Modbus TCP und zum Prüfen der Ausgänge der Node.

### `alphaess-dashboard-flowfuse.json`

Vollständiges zweisprachiges (DE/EN) Energie-Dashboard für **FlowFuse Dashboard 2.0**.

Das Dashboard visualisiert unter anderem aktuelle PV-Erzeugung, Hausverbrauch, Netzbezug/-einspeisung, Batteriezustand, Energiefluss, PV-Strings, Netzphasen, 24-h-Verlauf, Tagesenergiebilanz, Systemzustand sowie abgesicherte Steuerfunktionen.

Wenn in derselben Node-RED-Instanz bereits FlowFuse Dashboard 2.0 verwendet wird, nur eine `ui-base` behalten und die importierte AlphaESS-Seite bzw. Gruppe dem vorhandenen Dashboard zuweisen.

### `07-pv-string-diagnostics-flowfuse.json`

Optionales Add-on für das FlowFuse-Dashboard-2.0-Beispiel. Es vergleicht zwei PV-Strings auch dann sinnvoll, wenn an den beiden MPPT-Eingängen unterschiedlich viel DC-Leistung installiert ist.

Statt die aktuelle Leistung der Strings direkt miteinander zu vergleichen, normalisiert das Add-on jeden String anhand seiner konfigurierten installierten Wp-Leistung. Dadurch lässt sich beispielsweise folgende Konfiguration sinnvoll vergleichen:

- PV1: 10 × 405 Wp = 4,05 kWp
- PV2: 8 × 405 Wp = 3,24 kWp
- Erwartetes Leistungsverhältnis unter vergleichbaren Bedingungen: 1,25 : 1

Das Widget zeigt für beide Strings aktuelle Leistung, installierte Leistung, spezifische Leistung, Spannung und Strom. Zusätzlich werden erwartetes Verhältnis, gemessenes Verhältnis, normalisierte Abweichung und eine Einschätzung angezeigt, ob einer der Strings relativ schwächer arbeitet.

Um Fehlwarnungen durch kurzzeitige Wolken, Schatten oder unterschiedliche MPPT-Reaktionen zu reduzieren, erfolgt die Bewertung erst oberhalb einer konfigurierbaren Mindest-PV-Leistung und wird über mehrere qualifizierte Messwerte geglättet.

Im Dashboard können konfiguriert und gespeichert werden:

- Name der Strings
- Anzahl der Module je String
- Wp je Modul
- Mindest-Gesamtleistung für eine Bewertung
- Warnschwelle
- kritische Schwelle
- Anzahl der Messwerte zur Glättung

Die Konfiguration wird im Flow-Context unter `alphaPvStringConfig` gespeichert. Wenn der Context-Store `file` vorhanden ist, wird dieser verwendet; andernfalls der Standard-Store.

Details zu Einrichtung und Bewertungsmethode stehen in [`07-pv-string-diagnostics-README.de.md`](07-pv-string-diagnostics-README.de.md).

## Hinweise

- Die Beispiele sind Community-Beispiele und für die Runtime-Node nicht erforderlich.
- Schreibzugriff bleibt in der AlphaESS-Node standardmäßig deaktiviert. Dashboard-Steuerfunktionen funktionieren erst, wenn **Allow write access** bewusst aktiviert wurde.
- Die PV-String-Bewertung ist eine Plausibilitätsprüfung und keine elektrische Fehlerdiagnose. Unterschiedliche Ausrichtung, Neigung, Verschattung, Temperatur und Modultoleranzen können auch bei technisch einwandfreien Strings zu legitimen Unterschieden führen.
