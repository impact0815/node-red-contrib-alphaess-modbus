# @impact0815/node-red-contrib-alphaess-modbus

[English version → README.md](https://github.com/impact0815/node-red-contrib-alphaess-modbus/blob/main/README.md)

Lokaler Zugriff auf **Alpha-ESS**-Speichersysteme (SMILE-Serie, Storion) per **Modbus TCP**, ohne Cloud.

- Echtzeitdaten von Netzzähler, PV-Zähler, Batterie, Wechselrichter und System
- Abgeleitete Werte: Hausverbrauch, Autarkie, Eigenverbrauchsquote
- Tageswerte seit Mitternacht (Ortszeit) und die Werte des Vortags
- Alarme und Warnungen als Text, mit einem Ausgang, der nur bei Änderungen sendet
- Erkennung veralteter Daten pro Registerblock
- MQTT direkt über eine vorhandene MQTT-Broker-Konfiguration von Node-RED, ohne zusätzliche MQTT-Node
- Optionale Steuerung, **standardmäßig abgeschaltet**: Dispatch (Laden/Entladen), Einspeisegrenze, Lade-/Entladezeitfenster
- Schonendes Schreiben: unveränderte Werte werden nicht geschrieben, nur geänderte Register, optionaler Mindestabstand
- Funktioniert mit aktueller und älterer EMS-Firmware (automatischer Rückfall auf die ältere Registerliste)
- Editor und Hilfe auf **Englisch und Deutsch**
- Keine Laufzeitabhängigkeiten

Registeradressen und Skalierungen beruhen auf der *AlphaESS Household Modbus Register Parameter List*
(Nachfolger der *Register Parameter List V1.1*).

## Haftungsausschluss

> **Nutzung auf eigene Gefahr. Keine Gewährleistung.**

- Dies ist ein unabhängiges Community-Projekt. Es ist **nicht mit Alpha ESS verbunden und wird von Alpha ESS weder unterstützt
  noch empfohlen**. „Alpha ESS“, „SMILE“ und „Storion“ dienen nur zur Beschreibung der Kompatibilität; die Marken gehören ihren Inhabern.
- Die Software wird **„wie besehen“ und ohne jede Gewährleistung** bereitgestellt, siehe [LICENSE](LICENSE) (MIT).
  Eine Haftung der Autoren für Schäden aus der Nutzung ist ausgeschlossen, soweit gesetzlich zulässig.
- Das **Lesen** von Daten verändert das System nicht. **Schreibbefehle** (Dispatch, Einspeisegrenze, Zeitfenster) verändern, wie das
  System lädt, entlädt und ins Netz einspeist. Falsche Werte können zu ungewolltem Netzbezug, zu tiefer oder zu flacher Entladung,
  fehlender Notstromreserve oder einer Einspeisung entgegen den Vorgaben des Netzbetreibers führen und die Herstellergarantie berühren.
- Der Schreibzugriff ist standardmäßig abgeschaltet. Aktiviere ihn nur, wenn dir die Wirkung jedes Befehls klar ist; beginne mit
  kurzen Laufzeiten und prüfe das Ergebnis in der Hersteller-App.
- Die Registerangaben beruhen auf der Herstellerdokumentation und auf Tests an einzelnen Anlagen.
  Dein Modell oder deine Firmware kann sich anders verhalten.

## Installation

Über *Palette verwalten* im Node-RED-Editor (Suche nach `alphaess-modbus`) oder im Node-RED-Benutzerverzeichnis (meist `~/.node-red`):

```
npm install @impact0815/node-red-contrib-alphaess-modbus
```

Danach Node-RED neu starten.

Voraussetzungen: Node-RED 3.0 oder neuer, Node.js 18 oder neuer und aktiviertes Modbus TCP am Alpha-ESS-System.

### Docker

Beim offiziellen Image `nodered/node-red` nach `/data` installieren, damit das Paket ein Update des Containers übersteht:

```
docker exec -it node-red bash -c "cd /data && npm install @impact0815/node-red-contrib-alphaess-modbus"
docker restart node-red
```

Nach Installation oder Update den Editor im Browser neu laden (F5), sonst fehlen neue Ausgänge und Einstellungen.

### Umstieg vom Paket ohne Scope (Versionen vor 0.4.0)

Bis 0.3.x hieß das Paket `node-red-contrib-alphaess-modbus` (aus einer lokalen Datei installiert).
Beide Pakete liefern dieselben Node-Typen, deshalb zuerst das alte entfernen. Flows und Einstellungen bleiben erhalten:

```
cd ~/.node-red        # Docker: docker exec -it node-red bash -c "cd /data && ..."
npm uninstall node-red-contrib-alphaess-modbus
npm install @impact0815/node-red-contrib-alphaess-modbus
```

## Schnellstart

1. Eine **AlphaESS-Modbus**-Node einfügen und eine Verbindung mit der IP-Adresse des Systems anlegen (Port 502, Unit-ID 85).
2. Standardblöcke und Intervall von 15 s beibehalten. An Ausgang 1 eine Debug-Node anschließen und deployen.
3. Nach wenigen Sekunden zeigt der Status `PV … | Netz … | SOC … | Last …`.
4. Optional: einen dauerhaften Kontextspeicher für die [Tageswerte](#tageswerte) einrichten und einen [MQTT](#mqtt)-Broker auswählen.

Zeigt der Status `ECONNREFUSED`, siehe [Fehlersuche](#fehlersuche).

## Sprachen

| Teil | Sprache |
|---|---|
| Editor (Beschriftungen, Hinweise) und Hilfe in der Seitenleiste | Englisch oder Deutsch, je nach Spracheinstellung des Editors (*Benutzereinstellungen → Sprache*, Standard: Browsersprache) |
| Statustexte unter der Node, Log- und Fehlermeldungen | Sprache des Node-RED-Servers |
| Daten in `msg.payload` (Feldnamen, Alarm- und Warnungstexte) und MQTT-Topics | immer Englisch, damit Flows unabhängig von der Sprache funktionieren |

Weitere Sprachen lassen sich unter `locales/` ergänzen, siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Konfiguration

### Verbindung (`alphaess-modbus-config`)

| Einstellung | Standard | Beschreibung |
|---|---|---|
| Host | – | IP-Adresse des Systems |
| Port | 502 | Modbus-TCP-Port |
| Unit-ID | 85 | Modbus-Slave-Adresse (0x55) |
| Timeout | 2000 ms | pro Anfrage |
| Pause | 20 ms | Pause zwischen zwei Anfragen |

Alle Nodes mit derselben Verbindung teilen sich eine TCP-Verbindung; Anfragen werden nacheinander gesendet.
Das EMS nimmt meist nur eine Modbus-TCP-Verbindung gleichzeitig an. Andere Modbus-Clients (auch ungenutzte
`modbus-client`-Konfigurationen anderer Pakete) führen zu `ECONNREFUSED`.

### Node (`alphaess-modbus`)

| Einstellung | Standard | Beschreibung |
|---|---|---|
| Intervall | 15 s | Abfrageintervall, `0` = nur bei Eingang |
| Langsame Blöcke | 300 s | Intervall für Systemkonfiguration, Zeitfenster und Dispatch-Status |
| Veraltet nach | 180 s | ein Block gilt nach dieser Zeit ohne erfolgreiches Lesen als veraltet |
| Blöcke lesen | – | Auswahl der zu lesenden Registerblöcke |
| EMS | EMS 3.5/3.6 | wählt die Texte für Batteriefehler und -warnungen |
| PV-Zähler addieren | aus | rechnet einen AC-gekoppelten PV-Wechselrichter in PV-Leistung und Tages-PV-Energie ein, siehe [PV-Zähler](#pv-zähler-ac-gekoppelte-anlagen) |
| Tageswerte-Speicher | Standard | Kontextspeicher für die Tageswerte, Auswahl aus den in `settings.js` konfigurierten Speichern; für Dauerhaftigkeit einen dauerhaften Speicher (z. B. `file`) wählen, siehe [Tageswerte](#tageswerte) |
| MQTT-Broker | – | optional, siehe [MQTT](#mqtt) |
| Schreibzugriff erlauben | aus | nötig für alle Steuerbefehle; zeigt im Editor einen Warnhinweis und schreibt beim Start einen Hinweis ins Log |
| Max. Leistung | – | optionale Obergrenze für die Dispatch-Leistung in W |
| Mindestabstand | 10 s | Mindestzeit zwischen zwei tatsächlichen Schreibvorgängen desselben Befehls, `0` = aus |
| SOC-Skalierung | 0.1 | %/bit für die SOC-Werte der Zeitfenster, siehe [SOC-Skalierung prüfen](#soc-skalierung-prüfen) |

### PV-Zähler (AC-gekoppelte Anlagen)

Der Block *PV-Zähler* liest einen zweiten Zähler, den es nur gibt, wenn ein zusätzlicher, externer PV-Wechselrichter ins Hausnetz
einspeist (AC-gekoppelte Anlage). Bei DC- und den meisten Hybridanlagen hängen alle Module am Alpha-ESS-Wechselrichter und sind schon
im Block *Wechselrichter* enthalten. Der Block ist deshalb standardmäßig aus: Bei Anlagen ohne PV-Zähler würde er nur Fehler (und einen
dauerhaften Alarm *Stale data*) oder Nullen liefern.

Prüfen in `payload.details.systemConfig`:

| Feld | PV-Zähler wahrscheinlich | Kein PV-Zähler |
|---|---|---|
| `systemMode.text` | `AC` oder `Hybrid` | `DC` |
| `pvCapacityGridInverter` | > 0 | 0 |
| `meterCtSelect.text` | enthält `PV meter` | enthält `PV CT` |

Ist einer vorhanden, den Block *PV-Zähler* und *PV-Zähler zu PV-Leistung / Tages-PV-Energie addieren* aktivieren.
Die Tages-PV-Energie des externen Wechselrichters kommt aus dem Block *Systemlaufdaten*, der aktiv bleiben muss.

## Ausgänge

### Ausgang 1 – Daten

Eine Nachricht pro Abfragezyklus und bei `read`. Die Hauptwerte heißen wie in der Cloud-Node
[node-red-contrib-alphaess](https://github.com/dehsgr/node-red-contrib-alphaess); Flows können also zwischen Cloud und lokalem Zugriff wechseln.

```json
{
  "consumption": 980, "grid": -720, "modules": 4000, "battery": -2300, "soc": 87.3,
  "gridImport": 0, "gridExport": 720, "batteryCharge": 2300, "batteryDischarge": 0,
  "autarky": 100, "selfConsumptionRate": 82,
  "daily": {
    "day": "2026-09-27", "since": "2026-09-27T00:00:05.000Z", "complete": true,
    "pv": 12.4, "gridFeed": 4.1, "gridImport": 1.2, "batteryCharge": 5.0, "batteryDischarge": 3.3,
    "batteryChargeFromGrid": 0, "consumption": 7.8, "selfConsumptionRate": 66.9, "autarky": 84.6
  },
  "yesterday": { "...": "gleicher Aufbau" },
  "alarms": [],
  "warnings": ["Battery: Temperature imbalance"],
  "blocks": { "grid": { "age": 0, "stale": false }, "inverter": { "age": 0, "stale": false } },
  "details": { "grid": {}, "battery": {}, "inverter": {}, "systemRun": {}, "systemConfig": {}, "timePeriod": {}, "dispatch": {} },
  "info": {
    "inverterInfo": { "serialNumber": "...", "armSoftwareVersion": "..." },
    "systemInfo": { "emsSerialNumber": "...", "emsVersion": {}, "wifiSerialNumber": "..." },
    "batteryInfo": { "serialNumbers": ["..."] }
  }
}
```

Vorzeichen:

- `grid`: + = Bezug, − = Einspeisung
- `battery`: + = Entladen, − = Laden
- `consumption = modules + grid + battery`

Leistungen in W, Energien in kWh.

Kann ein Block nicht gelesen werden, wird sein letzter Wert weiterverwendet, bis er veraltet. Danach wird er aus `details` entfernt,
und die davon abhängigen Werte fehlen. Die Lesefehler des aktuellen Zyklus stehen in `msg.errors`.

Werte, die nur neuere Firmware liefert, fehlen bei älteren Anlagen:

| Feld | Beschreibung |
|---|---|
| `details.grid.energyConsumeFromGridPhase`, `energyFeedToGridPhase` | Gesamtenergie je Phase L1–L3 in kWh |
| `details.inverter.pvPowerTotalRegister` | PV-Gesamtleistung laut Wechselrichter; `pvPowerTotal` (Summe PV1–PV6) ist immer vorhanden und wird für `modules` verwendet |
| `details.dispatch.pvSwitch` | PV-Schalter des Dispatch (Note 29) |
| `info.inverterInfo.armSoftwareVersion`, `info.systemInfo.wifiSerialNumber`, `info.batteryInfo.serialNumbers` | Geräteinformationen |

### Ausgang 2 – Alarm

Wird nur gesendet, wenn sich Alarme oder Warnungen ändern, und einmal nach dem Start:

```json
{ "active": true, "alarms": ["System: Grid_Meter_Lost"], "warnings": [], "timestamp": "..." }
```

Alarme sind: Systemfehler, Batteriefehler, Wechselrichterfehler (fault1/2 und fault extend), Wechselrichter im Modus *Fault*
und veraltete Blöcke. Warnungen sind Batterie- und Wechselrichterwarnungen (als Text) sowie ein fehlender Kontextspeicher für die Tageswerte.
Die Texte sind immer Englisch.

### Ausgang 3 – Befehlsantwort

Antwort auf jeden Befehl außer `read`: `readInfo`, `readRaw` und alle Schreibbefehle.
Datennachrichten auf Ausgang 1 enthalten deshalb nie Befehlsantworten.

| Eigenschaft | Beschreibung |
|---|---|
| `payload` | der betroffene Block, nach dem Befehl zurückgelesen (Rohwerte bei `readRaw`) |
| `written` | geschriebene Register `[{ "address": "0x0850", "values": [200] }]`, leer, wenn nichts geschrieben wurde |
| `unchanged` | `true`, wenn `feedIn` / `timePeriod` die gewünschten Werte schon hatten |

Alle anderen Eigenschaften der Eingangsnachricht bleiben erhalten. Fehler (ungültige Werte, Schreibschutz, Mindestabstand)
sind Node-Fehler und lassen sich mit einer *catch*-Node abfangen.

## Tageswerte

Das System liefert per Modbus nur Gesamtzähler. Die Tageswerte sind deshalb die Differenz zu den Zählerständen um Mitternacht
(Zeitzone des Servers). Diese Mitternachtswerte liegen im Kontext der Node.

- `daily.since` zeigt den Beginn der Zählung.
- `daily.complete` ist `true`, wenn die Zählung höchstens 15 Minuten nach Mitternacht begonnen hat, also der ganze Tag erfasst ist.
  `false` bedeutet: Node-RED lief um Mitternacht nicht, oder es gab tagsüber einen Neustart ohne dauerhaften Speicher.
- Wird ein Zähler tagsüber zurückgesetzt, bleibt der bis dahin erreichte Wert erhalten.

Damit die Tageswerte einen Neustart überstehen, in `settings.js` einen dauerhaften Kontextspeicher einrichten und ihn (hier `file`)
in der Node als *Tageswerte-Speicher* auswählen. Nach der Änderung Node-RED neu starten und den Editor neu laden, dann erscheint der Speicher in der Auswahl:

```js
contextStorage: {
    default: { module: "memory" },
    file:    { module: "localfilesystem" }
},
```

Existiert der gewählte Speicher nicht, nutzt Node-RED stillschweigend den Standardspeicher. Die Node erkennt das,
schreibt beim Start eine Warnung ins Log, zeigt einen gelben Status und ergänzt eine Warnung in `payload.warnings`.

## MQTT

In der Node eine vorhandene MQTT-Broker-Konfiguration auswählen. Die Node sendet dann direkt, ohne MQTT-out-Node:

| Topic | Inhalt |
|---|---|
| `<Präfix>/consumption`, `/grid`, `/modules`, `/battery`, `/soc` | Zahl |
| `<Präfix>/gridImport`, `/gridExport`, `/batteryCharge`, `/batteryDischarge`, `/autarky`, `/selfConsumptionRate` | Zahl |
| `<Präfix>/daily/<Feld>` | Zahl (kWh oder %) |
| `<Präfix>/daily/complete` | `true` oder `false` |
| `<Präfix>/status` | `ok` oder `alarm` |
| `<Präfix>/alarm` | JSON, nur bei Änderung |
| `<Präfix>/info` | JSON, immer mit Retain |
| `<Präfix>/details/<Block>` | JSON, optional |

Standard-Präfix ist `alphaess`. QoS und Retain sind einstellbar.
Die Node nutzt die Verbindung der Kern-Konfiguration `mqtt-broker`, die deshalb in `settings.js` nicht deaktiviert sein darf.

## Eingangsbefehle (`msg.topic`)

| Topic | Payload | Beschreibung |
|---|---|---|
| `read` oder leer | – | alle aktivierten Blöcke sofort lesen, auch die langsamen |
| `readInfo` | – | Geräteinfos erneut lesen |
| `readRaw` | `{"address":1024,"count":10}` | Rohwerte von Holding-Registern, nur lesend |
| `dispatch` | `{"power":-3000,"soc":90,"duration":900,"mode":2}` | Dispatch starten |
| `dispatchStop` | – | Dispatch beenden |
| `feedIn` | `70` | maximale Einspeisung in % |
| `timePeriod` | `{"flag":1,"chargeCutSoc":90,"upsReserveSoc":10,"charge1":{"start":"01:00","stop":"05:00"}}` | Lade-/Entladezeitfenster |

Die Schreibbefehle benötigen **Schreibzugriff erlauben** – vorher den [Haftungsausschluss](#haftungsausschluss) lesen.
Die Antwort kommt auf Ausgang 3.

`dispatch`:

- `power` in W: negativ = laden, positiv = entladen.
- `soc`: Ziel in %. Standard 100 beim Laden, 10 beim Entladen.
- `duration` in Sekunden, Standard 300. Danach kehrt das System in den Normalbetrieb zurück.
- `mode`: Standard 2 = *State of Charge control*. Erlaubt: 1–10 und 19 (*No Battery Charge*).
  Test- und Inselmodi der Registerliste (BurnIn, OSW-Modi) werden abgelehnt.

`feedIn`: Eine Einspeisebegrenzung kann von deinem Netzbetreiber vorgeschrieben sein – nur ändern, wenn das zulässig ist.

`timePeriod` ändert nur die angegebenen Felder. `flag`: 0 = aus, 1 = laden, 2 = entladen, 3 = beides.
Vor dem ersten Schreiben die zurückgelesenen SOC-Werte mit der App vergleichen und bei Abweichung die *SOC-Skalierung* anpassen.

Ein niedrigerer `upsReserveSoc` wirkt sofort: Der Akku kann direkt bis zum neuen Wert entladen.
Soll das erst zu einer bestimmten Zeit passieren (z. B. in der Nacht vor einem sonnigen Tag), den Befehl erst dann senden.

### SOC-Skalierung prüfen

Laut Dokumentation haben `upsReserveSoc` und `chargeCutSoc` eine Auflösung von 0,1 %/bit, es gibt aber Anlagen mit 1 %/bit.
Vor dem ersten `timePeriod`-Schreibbefehl prüfen:

1. `{"topic": "readRaw", "payload": {"address": 2128, "count": 1}}` senden (Register 0x0850, UPS-Reserve-SOC).
2. Den Rohwert auf Ausgang 3 mit der Reserve in der App vergleichen. Reserve 10 % und Rohwert `10` → *SOC-Skalierung* auf `1`.
   Rohwert `100` → bei `0.1` bleiben.
3. Danach muss `details.timePeriod.upsReserveSoc` denselben Wert zeigen wie die App.

### So wird geschrieben

- **Unveränderte Werte werden nicht geschrieben.** `feedIn` und `timePeriod` lesen zuerst die aktuellen Register.
  Sind die Werte schon gesetzt, wird nichts geschrieben und `msg.unchanged` ist `true`.
  Ein Flow kann denselben Befehl also beliebig oft senden, ohne den Speicher des EMS abzunutzen.
- **Nur geänderte Register werden geschrieben.** Jeder zusammenhängende Bereich geänderter Register ist eine eigene Anfrage.
  Einstellungen, die zwischen Lesen und Schreiben in der App geändert wurden, werden nicht überschrieben.
  Stunde und Minute eines Zeitfensters sind getrennte Register, eine Zeitänderung kann also zwei Anfragen brauchen.
- **Mindestabstand.** Ein zweiter tatsächlicher Schreibvorgang desselben Befehls innerhalb des *Mindestabstands* schlägt mit einem Fehler fehl.
  Das schützt vor Schleifen im Flow. Anfragen ohne Änderung zählen nicht, und `dispatchStop` wird nie blockiert.
- `dispatch` und `dispatchStop` sind Befehle, keine Einstellungen, und werden immer geschrieben.

Bewusst **nicht** beschreibbar: Sicherheitstest, Reset/ATE-Modus, CT-Kalibrierung, Netzwerk- und Modbus-Einstellungen,
MOS-Steuerung der Batterie, SOC-Kalibrierung und die Dispatch-Testparameter (0x0889/0x088A).

## Beispiele

### Befehle aus anderen Tabs mit Rückmeldung

Im sendenden Flow eine *link call*-Node verwenden, vor der AlphaESS-Node eine *link in*-Node.
Für die Antwort **Ausgang 3** mit einer *switch*-Node auf `msg._linkSource` mit der Regel *ist nicht leer* verbinden,
danach eine *link out*-Node im Modus *Return to calling link node*:

```
[link in] → [AlphaESS Modbus] ─ Ausgang 3 → [switch: msg._linkSource ist nicht leer] → [link out: zurück]
                                                    └ sonst → [debug]
```

Antworten auf Befehle, die nicht per link call kamen (z. B. von einer Inject-Node), haben keine Rücksprungadresse und gehen auf den Ausgang *sonst*.
In der Node *Schreibzugriff erlauben* aktivieren.

### Reserve-SOC abhängig von der Wetterprognose

```js
// Function-Node vor dem link call
const sun = Number(global.get("sunhourstomorrow"));
if (!Number.isFinite(sun) || sun < 0) return null;
return { topic: "timePeriod", payload: { upsReserveSoc: sun >= 3 ? 10 : 20 } };
```

Der Befehl darf beliebig oft gesendet werden: Ist der Wert schon gesetzt, wird nichts geschrieben und die Antwort enthält `unchanged: true`.

### Werte in anderen Flows nutzen

```js
// Function-Node hinter Ausgang 1
global.set("alphaess", msg.payload);
return { payload: msg.payload.consumption };
```

Andere Tabs lesen dann z. B. `global.get("alphaess").details.timePeriod.upsReserveSoc`.

### Unvollständige Tage in Statistiken ignorieren

```js
// Function-Node hinter Ausgang 1, einmal täglich
const y = msg.payload.yesterday;
if (!y || !y.complete) return null;
return { payload: y };
```

### Nachts 15 Minuten aus dem Netz laden

```json
{ "topic": "dispatch", "payload": { "power": -3000, "soc": 90, "duration": 900 } }
```

`duration` kurz halten und bei Bedarf wiederholen. Bleibt der Flow stehen, kehrt das System von selbst in den Normalbetrieb zurück.

## Fehlersuche

| Symptom | Ursache und Lösung |
|---|---|
| `ECONNREFUSED` für alle Blöcke | Ein anderer Modbus-Client ist verbunden; das EMS nimmt nur eine Verbindung an. Nach alten `modbus-getter`/`modbus-write`-Nodes suchen, eine **ungenutzte `modbus-client`-Konfiguration** löschen (unter *Konfigurationsnodes*, dann *Vollständig* deployen) und andere Programme prüfen (Home Assistant, ioBroker, evcc). Sonst prüfen, ob Modbus TCP aktiv ist, oder das EMS neu starten. |
| `Timeout` / `Connect timeout` | Falsche IP, Netzwerk- oder Docker-Netzwerkproblem, langsame Verbindung. Test mit `nc -zv <ip> 502`; *Timeout* und *Pause* erhöhen. |
| `Modbus exception 2` für einen Block | Das System unterstützt diesen Block nicht (meist *PV-Zähler*). Block abschalten. Erweiterte Blöcke der neueren Registerliste fallen automatisch auf die ältere Länge zurück; das Log zeigt `extended registers not supported`. |
| Dauerhafter Alarm `Stale data: <Block>` | Der Block lässt sich nicht lesen; siehe `payload.blocks.<Block>.error`. |
| Tageswerte beginnen nach jedem Neustart neu, `daily.complete` ist `false` | Kein dauerhafter Kontextspeicher. In `settings.js` einrichten und als *Tageswerte-Speicher* auswählen (gelber Status `Speicher "…" fehlt`, wenn der gewählte Speicher nicht existiert). |
| SOC der Zeitfenster zeigt 1 statt 10 | Falsche *SOC-Skalierung*, siehe [SOC-Skalierung prüfen](#soc-skalierung-prüfen). |
| `Schreiben ist deaktiviert` | *Schreibzugriff erlauben* aktivieren. |
| `Schreiben blockiert, nächster Schreibvorgang in … s möglich` | Schutz durch den *Mindestabstand*. Warten oder den Flow auf Schleifen prüfen. |
| Neue Ausgänge/Einstellungen nach einem Update nicht sichtbar | Node-RED neu starten und den Editor neu laden (F5). |
| Node-Typen doppelt / Installationskonflikt nach Update auf 0.4.0 | Das alte Paket ohne Scope ist noch installiert, siehe [Umstieg](#umstieg-vom-paket-ohne-scope-versionen-vor-040). |
| Editor auf Englisch, obwohl Deutsch erwartet | Im Editor *Benutzereinstellungen → Sprache* auf *Deutsch* stellen oder die Browsersprache auf Deutsch setzen. |
| Link call läuft in einen Timeout | Ausgang 3 ist nicht mit der *link out*-Node im Rückgabemodus verbunden, siehe [Beispiele](#befehle-aus-anderen-tabs-mit-rückmeldung). |

## Registerblöcke

| Block | Start | Anzahl (ältere Firmware) | Gelesen |
|---|---|---|---|
| grid | 0x0010 | 51 (39) | jedes Intervall |
| pvMeter | 0x0090 | 39 | jedes Intervall |
| battery | 0x0100 | 73 | jedes Intervall |
| inverter | 0x0400 | 85 (83) | jedes Intervall |
| systemRun | 0x08D0 | 6 | jedes Intervall |
| systemConfig | 0x0800 | 18 | langsames Intervall |
| timePeriod | 0x084F | 19 | langsames Intervall |
| dispatch | 0x0880 | 11 (9) | langsames Intervall |
| inverterInfo | 0x0640 | 25 (20) | beim Start, dann täglich |
| systemInfo | 0x0740 | 25 (15) | beim Start, dann täglich |
| batteryInfo | 0x0150 | 30 (–) | beim Start, dann täglich |

Blöcke mit zwei Angaben werden zuerst mit der größeren Länge gelesen. Lehnt das System ab (Modbus-Exception 2 oder 3),
liest die Node ab dann die ältere Länge. `payload.blocks.<Block>.registers` zeigt die reduzierte Länge.
Die Seriennummern der Batteriemodule werden übersprungen, wenn das System sie nicht liefert.

Nicht unterstützt: der Wechselrichterblock *Byte Watt* (0x0500), der HHE-MEC-Systemblock (0x06FA–0x072B), Echonet (Japan),
Frequenz-Dispatch, AUX-, Generator- und PV-Changer-Blöcke.

## Entwicklung

```
npm test                                  # Unit- und Integrationstests gegen den eingebauten Simulator
npm run simulator                         # Modbus-TCP-Simulator auf Port 5020
node test/mock-server.js 5020 --legacy    # Simulator einer älteren Firmware (Registerliste V1.1)
```

Für einen Test ohne echte Anlage den Simulator starten und die Verbindung auf `127.0.0.1:5020` stellen.
Beiträge und Übersetzungen: siehe [CONTRIBUTING.md](CONTRIBUTING.md). Fehlermeldungen: https://github.com/impact0815/node-red-contrib-alphaess-modbus/issues

## Lizenz

MIT – siehe [LICENSE](LICENSE). Ohne Gewährleistung, siehe [Haftungsausschluss](#haftungsausschluss).
