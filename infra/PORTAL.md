# Deployment über das Azure-Portal – Altsystem und Zielsystem

Klickanleitung für dieselbe Architektur wie `infra/main.bicep`, aber Schritt für Schritt im Portal.
Die Ressourcengruppe `rg-pruefung-<nachname>` gibt es schon. **Jede Ressource unten kommt in diese Gruppe
und in dieselbe Region** (eine, die dein Abo erlaubt, möglichst in der EU).

Zwei Dinge gehen im Portal nicht per Klick und laufen deshalb in der **Cloud Shell** (das `>_`-Symbol oben
rechts im Portal, Bash wählen): das Bauen der Docker-Images und das Kopieren des Repos auf die VM.
Die Cloud Shell hat `az`, `ssh` und `scp` schon dabei.

Unterschied zur Bicep-Variante, damit es im Portal einfacher bleibt: Registry-Zugriff per Admin-Benutzer und
Storage per Verbindungszeichenfolge statt Managed Identity. Beides liegt als Secret bzw. App-Einstellung in
Azure, nicht im Code, und erfüllt damit Nachweis 3.

**Namen, die in dieser Anleitung vorkommen** (Suffix `<xy>` = deine Initialen o. Ä., Namen müssen teils
weltweit eindeutig sein):

| Ressource | Name |
| --- | --- |
| VM Altsystem | `vm-altsystem` |
| Container Registry | `acrklangwerk<xy>` |
| MySQL Flexible Server | `mysql-klangwerk-<xy>` |
| Storage Account | `stklangwerk<xy>` |
| Communication Services / Email | `acs-klangwerk-<xy>` / `email-klangwerk-<xy>` |
| Container-Apps-Umgebung | `cae-klangwerk` |
| Redis | `redis-klangwerk` |
| Function App | `func-klangwerk-<xy>` |
| Shop | `shop-klangwerk` |

Lege dir eine Notizdatei an, du brauchst unterwegs einige Werte (Kennwörter, Verbindungszeichenfolgen, URLs).

---

## 0. Budget (am ersten Tag)

Ressourcengruppe öffnen → **Kostenverwaltung → Budgets → + Hinzufügen**

- Name `budget-pruefung`, Zurücksetzungszeitraum *Monatlich*, Betrag **30**
- **Weiter** → Warnungsbedingungen: *Tatsächlich* **33 %** (≈ 10 $) und *Tatsächlich* **67 %** (≈ 20 $),
  E-Mail-Empfänger: deine Adresse → **Erstellen**

Screenshot: Budget mit beiden Warnungen.

---

## 1. Altsystem auf einer VM (Nachweis 1)

### 1.1 VM erstellen

**Virtuelle Computer → + Erstellen → Virtueller Azure-Computer**

*Grundeinstellungen*
- Ressourcengruppe: `rg-pruefung-<nachname>`, Name `vm-altsystem`, Region wie oben
- Image: **Ubuntu Server 24.04 LTS – x64**
- Größe: **Standard_B2s** (2 vCPU, 4 GiB; zum Bauen der Images nötig). Gesperrt? Andere B-Größe mit ≥ 2 GiB.
- Authentifizierung: **Öffentlicher SSH-Schlüssel**, Benutzername `azureuser`, *Neues Schlüsselpaar
  generieren* (beim Erstellen den `.pem` herunterladen)
- Eingangsports: **SSH (22)**

*Erweitert*
- **Benutzerdefinierte Daten**: den kompletten Inhalt von `infra/legacy-vm/cloud-init.yml` einfügen
  (installiert Docker und Compose)

**Überprüfen + erstellen → Erstellen**, Schlüssel herunterladen.

### 1.2 Port 3001 für dich öffnen

VM → **Netzwerk → Netzwerkeinstellungen → + Portregel erstellen → Eingehende Portregel**
- Quelle: *Meine IP-Adresse*, Zielportbereiche **3001**, Protokoll TCP, Name `shop-3001` → **Hinzufügen**

Öffentliche IP der VM notieren (VM → Übersicht).

### 1.3 Repo auf die VM und starten (Cloud Shell)

1. GitHub → Repo → **Code → Download ZIP**.
2. Cloud Shell öffnen → **Dateien verwalten → Hochladen**: die ZIP-Datei und den `.pem`-Schlüssel.
3. In der Cloud Shell:

```bash
VM_IP=<oeffentliche-ip-der-vm>
chmod 600 ~/vm-altsystem_key.pem
alias vmssh="ssh -i ~/vm-altsystem_key.pem azureuser@$VM_IP"

vmssh 'cloud-init status --wait && docker compose version'      # wartet, bis Docker installiert ist
scp -i ~/vm-altsystem_key.pem ~/Cloud-System-Pr-fen-*.zip azureuser@$VM_IP:/opt/klangwerk/repo.zip
vmssh 'sudo apt-get install -y unzip >/dev/null && cd /opt/klangwerk && unzip -q repo.zip && mv Cloud-System-Pr-fen-*/* Cloud-System-Pr-fen-*/.[!.]* . 2>/dev/null; docker compose up -d --build legacy mailpit'
vmssh 'cd /opt/klangwerk && docker compose ps && docker compose logs legacy-init'
```

Der erste Build dauert 3–5 Minuten. Danach läuft das Altsystem unter `http://<VM_IP>:3001`
(Admin `admin` / `admin`), mit MySQL und Testdaten (Pflicht-Event mit 500 Tickets) auf derselben Maschine.

Screenshots: VM-Übersicht, Altsystem im Browser.

---

## 2. Container Registry

**Container-Registrierungen → + Erstellen**
- Name `acrklangwerk<xy>`, Preisplan **Basic** → **Erstellen**

Danach: Registry → **Einstellungen → Zugriffsschlüssel → Administratorbenutzer: aktivieren**.
Anmeldeserver, Benutzername und Kennwort notieren.

### Images bauen (Cloud Shell)

```bash
cd ~ && unzip -q Cloud-System-Pr-fen-*.zip && cd Cloud-System-Pr-fen-*/
ACR=acrklangwerk<xy>
az acr build -r $ACR -t kw-shop:v1      -f apps/shop/Dockerfile .
az acr build -r $ACR -t kw-functions:v1 -f apps/functions/Dockerfile .
```

Registry → **Repositorys**: `kw-shop` und `kw-functions` mit Tag `v1`.

---

## 3. MySQL Flexible Server (verwaltete Datenbank)

**Azure Database for MySQL – flexible Server → + Erstellen → Flexibler Server**

*Grundeinstellungen*
- Servername `mysql-klangwerk-<xy>`, MySQL-Version **8.0**
- Workloadtyp **Für Entwicklung oder Hobbyprojekte**
- Compute + Speicher → **Konfigurieren**: *Burstfähig*, **Standard_B1ms**, Speicher 20 GiB,
  Automatische Vergrößerung aus, Hochverfügbarkeit aus
- Authentifizierung *Nur MySQL*, Administrator `kwadmin`, Kennwort notieren

*Netzwerk*
- *Öffentlicher Zugriff (zulässige IP-Adressen)*
- Haken bei **Öffentlichen Zugriff von jedem Azure-Dienst … auf diesen Server zulassen** (VM und Container
  Apps müssen hinein)
- **+ Aktuelle Client-IP-Adresse hinzufügen** (für Prüfabfragen und Lasttest von deinem Rechner)

**Überprüfen + erstellen → Erstellen** (ca. 10 min).

Danach: Server → **Datenbanken → + Hinzufügen** → Name **`klangwerk`**, Zeichensatz `utf8mb4` → Speichern.

Notieren: Servername `mysql-klangwerk-<xy>.mysql.database.azure.com`. Die Verbindungs-URL für die Apps lautet:

```
mysql://kwadmin:<kennwort>@mysql-klangwerk-<xy>.mysql.database.azure.com:3306/klangwerk?ssl=true
```

(Sonderzeichen im Kennwort URL-kodieren, z. B. `@` → `%40`, `#` → `%23`.)

---

## 4. Storage Account (Queue und Blob)

**Speicherkonten → + Erstellen**
- Name `stklangwerk<xy>`, Leistung *Standard*, Redundanz **LRS** → **Erstellen**

Im Speicherkonto:
- **Datenspeicher → Warteschlangen → + Warteschlange**: `bestellungen`
- **Datenspeicher → Container → + Container**: `tickets` (privat) und `bilder` (privat)
- **Sicherheit + Netzwerk → Zugriffsschlüssel**: **Verbindungszeichenfolge** von key1 notieren

---

## 5. Mailversand (Azure Communication Services)

1. **E-Mail-Kommunikationsdienste → + Erstellen**: Name `email-klangwerk-<xy>`, Datenspeicherort *Europa*.
2. Ressource öffnen → **Domänen bereitstellen → 1-Klick hinzufügen** (Azure-verwaltete Domäne). Nach ein
   paar Minuten steht dort die Domäne `xxxx.azurecomm.net`. Absender ist dann
   **`DoNotReply@xxxx.azurecomm.net`** (MailFrom-Adresse in der Domäne nachsehen).
3. **Kommunikationsdienste → + Erstellen**: Name `acs-klangwerk-<xy>`, Datenspeicherort *Europa*.
4. Ressource öffnen → **E-Mail → Domänen → Domäne verbinden** → die Domäne aus Schritt 2 auswählen.
5. **Einstellungen → Schlüssel**: **Verbindungszeichenfolge** (primär) notieren.

---

## 6. Container-Apps-Umgebung (mit eigenem VNet)

Eigenes VNet ist nötig, weil Redis per TCP angesprochen wird.

**Container Apps-Umgebungen → + Erstellen**
- Name `cae-klangwerk`, Umgebungstyp **Workloadprofile**
- *Überwachung*: Log Analytics *neu erstellen* (`log-klangwerk`)
- *Netzwerk*: **Eigenes virtuelles Netzwerk verwenden: Ja** → VNet *neu erstellen* `vnet-klangwerk`
  (Adressraum `10.40.0.0/16`), Infrastruktur-Subnetz *neu* `aca` mit `10.40.0.0/23`;
  Virtuelle IP: **Extern**
- **Erstellen** (ca. 5 min)

Tipp gegen Logkosten: Log Analytics `log-klangwerk` → **Nutzung und geschätzte Kosten → Tägliche
Obergrenze: 0,1 GB**.

---

## 7. Redis als Container App

**Container Apps → + Erstellen**

*Grundeinstellungen*: Name `redis-klangwerk`, Umgebung `cae-klangwerk`

*Container*
- Schnellstart-Image **aus**, Imagequelle **Docker Hub oder andere Registrierungen**, öffentlich
- Image und Tag: `docker.io/library/redis:7-alpine`
- Workloadprofil *Consumption*, CPU **0,25**, Arbeitsspeicher **0,5 Gi**
- Befehlsüberschreibung: `/bin/sh, -c`
- Argumentüberschreibung: `exec redis-server --requirepass "$REDIS_PASSWORD" --save "" --appendonly no --maxmemory 400mb`
- Umgebungsvariable `REDIS_PASSWORD` = ein selbst gewähltes Kennwort (später als Secret umstellen, s. u.)

*Eingang*
- Eingang **aktiviert**, Datenverkehr **Auf Container Apps-Umgebung beschränkt**
- Transport **TCP**, Zielport **6379**, Verfügbar gemachter Port **6379**

**Erstellen**. Danach:
- **Anwendung → Skalieren**: Min **1**, Max **1** (kein Scale-to-zero, sonst ist der Zustand weg)
- **Einstellungen → Geheimnisse → + Hinzufügen**: `redis-password` = dein Kennwort; dann **Container →
  Bearbeiten** und `REDIS_PASSWORD` auf *Verweis auf Geheimnis* `redis-password` umstellen
- **Eingang**: den internen Hostnamen notieren (meist einfach `redis-klangwerk`)

Redis-URL für die Apps: `redis://:<redis-kennwort>@redis-klangwerk:6379`

---

## 8. Functions in der Container-Apps-Umgebung

**Funktions-App → + Erstellen** → Hostingoption **Container Apps-Umgebung**

*Grundeinstellungen*
- Name `func-klangwerk-<xy>`, **Containerimage verwenden: Ja**, Region wie oben
- Container Apps-Umgebung: `cae-klangwerk`

*Speicher*: Speicherkonto `stklangwerk<xy>`

*Container*
- Imagequelle **Azure Container Registry**, Registry `acrklangwerk<xy>`, Image `kw-functions`, Tag `v1`
- CPU **0,5**, Arbeitsspeicher **1 Gi**

**Erstellen**. Danach in der Function App:

**Einstellungen → Umgebungsvariablen → App-Einstellungen**, hinzufügen:

| Name | Wert |
| --- | --- |
| `BestellQueue` | Storage-Verbindungszeichenfolge (Schritt 4) |
| `STORAGE_CONNECTION_STRING` | dieselbe Verbindungszeichenfolge |
| `DATABASE_URL` | MySQL-URL aus Schritt 3 |
| `REDIS_URL` | Redis-URL aus Schritt 7 |
| `ACS_CONNECTION_STRING` | ACS-Verbindungszeichenfolge (Schritt 5) |
| `MAIL_ABSENDER` | `DoNotReply@xxxx.azurecomm.net` |
| `RATE_LIMIT_IP` | `300` |
| `NODE_ENV` | `production` |

(`AzureWebJobsStorage`, `FUNCTIONS_EXTENSION_VERSION` und `FUNCTIONS_WORKER_RUNTIME` hat das Portal schon
gesetzt.) **Übernehmen**.

- **Einstellungen → Skalieren**: minimale Instanzen **1** (der Timer `aufraeumen` läuft alle 5 s), maximal 10
- **Übersicht**: Standarddomäne notieren → `FUNCTIONS_URL = https://func-klangwerk-<xy>.<…>.azurecontainerapps.io`
- **Funktionen**: Es müssen 9 Funktionen auftauchen (`reservieren`, `status`, `bestellen`, `bestaetigen`,
  `abbrechen`, `verfuegbar`, `aufraeumen`, `verarbeiten`, `idempotenzTest`)

Schnelltest im Browser: `https://<FUNCTIONS_URL>/api/kauf/verfuegbar?ids=` → `{}`

---

## 9. Shop als Container App (Nachweis 3)

**Container Apps → + Erstellen**

*Grundeinstellungen*: Name `shop-klangwerk`, Umgebung `cae-klangwerk`

*Container*
- Imagequelle **Azure Container Registry**, Registry `acrklangwerk<xy>`, Image `kw-shop`, Tag `v1`
- CPU **0,5**, Arbeitsspeicher **1 Gi**
- Umgebungsvariablen (die geheimen erst als Geheimnis anlegen, s. u., oder nach dem Erstellen umstellen):

| Name | Quelle | Wert |
| --- | --- | --- |
| `DATABASE_URL` | Geheimnis `database-url` | MySQL-URL |
| `REDIS_URL` | Geheimnis `redis-url` | Redis-URL |
| `STORAGE_CONNECTION_STRING` | Geheimnis `storage` | Storage-Verbindungszeichenfolge |
| `FUNCTIONS_URL` | manuell | `https://func-klangwerk-<xy>…` (ohne `/` am Ende) |
| `ADMIN_EMAILS` | manuell | optional: deine Mail, sonst leer lassen |

*Eingang*
- aktiviert, Datenverkehr **Von überall aus akzeptieren**, Transport *Automatisch*, Zielport **3000**

**Erstellen**. Danach:
- **Einstellungen → Geheimnisse**: `database-url`, `redis-url`, `storage` anlegen (falls noch nicht) und die
  Variablen unter **Container → Bearbeiten** auf *Verweis auf Geheimnis* stellen → neue Revision
- **Anwendung → Skalieren**: Min **0**, Max **10**, Regel *HTTP-Skalierung* mit 50 gleichzeitigen Anforderungen
- **Anwendung → Revisionen und Replikate → Revisionsmodus: Mehrere** (für Updates ohne Ausfallzeit)
- **Übersicht → Anwendungs-URL** notieren = `SHOP_URL`

Screenshots: Geheimnisse (Werte verborgen), Umgebungsvariablen mit Verweisen, Revisionen.

---

## 10. Admin mit Entra ID schützen (Easy Auth)

`shop-klangwerk` → **Sicherheit → Authentifizierung → Identitätsanbieter hinzufügen → Microsoft**
- App-Registrierung **neu erstellen**, unterstützte Kontotypen **Aktueller Mandant**
- Nicht authentifizierte Anforderungen: **Nicht authentifizierten Zugriff zulassen**
- **Hinzufügen**

Test: `SHOP_URL/admin` → Microsoft-Login → Eventliste (nach der Migration mit Events).

---

## 11. Daten migrieren (Nachweis 2)

Die Migration läuft auf der VM, von der MySQL im Docker-Container in die MySQL Flexible (mit TLS).
In der Cloud Shell:

```bash
MYSQL_HOST=mysql-klangwerk-<xy>.mysql.database.azure.com
MYSQL_PW='<kennwort-aus-schritt-3>'

# 1. Altsystem auf „nur lesen“: Shop stoppen, Datenbank läuft weiter
vmssh 'cd /opt/klangwerk && docker compose stop legacy'

# 2. Zählen -> mysqldump -> Import -> 002_azure.sql -> Zählen
vmssh "cd /opt/klangwerk && docker compose run --rm --no-deps \
  -e ZIEL_HOST=$MYSQL_HOST -e ZIEL_USER=kwadmin -e ZIEL_PASSWORD='$MYSQL_PW' -e ZIEL_SSL=1 migration"
```

Die Ausgabe zeigt die Zeilen je Tabelle vorher (VM) und nachher (Azure). Beide müssen gleich sein.
**Screenshot = Nachweis 2.** Danach zeigt `SHOP_URL/shop` die Events mit Live-Zähler.

> Wenn du vorher schon einen Lasttest gegen das Altsystem gefahren hast, bricht `002_azure.sql` am
> Unique-Key ab (doppelt verkaufte Plätze). Das ist Absicht. Dann auf der VM neu aufsetzen:
> `vmssh 'cd /opt/klangwerk && docker compose down -v && docker compose up -d legacy mailpit'`, in
> MySQL Flexible die Datenbank `klangwerk` löschen und neu anlegen, Migration wiederholen.

Rückweg: `vmssh 'cd /opt/klangwerk && docker compose start legacy'` – das Altsystem ist sofort wieder da.

---

## 12. Nachweise 4–6

**Kauf entkoppelt (4):** Im Shop ein Ticket kaufen. Im Portal zeigen: Storage → Warteschlangen →
`bestellungen`, Storage → Container → `tickets` → PDF, Function App → **Protokollstream**
(`Bestellung …: 1 Ticket(s) erstellt und versendet`), Mail mit PDF im Postfach (ggf. Spam).

**Lasttest (5):** läuft von deinem Rechner (braucht Docker für k6 und `pnpm install` im Repo).
Vorher Function App → Umgebungsvariablen → `RATE_LIMIT_IP` = `100000` (alle k6-Käufer kommen von einer IP),
danach zurück auf `300`.

```bash
DATABASE_URL="mysql://kwadmin:<kennwort>@$MYSQL_HOST:3306/klangwerk?ssl=true" BASE=<SHOP_URL> ./loadtest/run.sh ziel
```

Erwartet: `✔ verkauft ≤ Kontingent, kein Platz doppelt` und `✔ keine Bestellung verloren`.
Screenshot dazu: `shop-klangwerk` → **Überwachung → Metriken → Replikatanzahl**.

**Idempotenz (6):** Function App → **Funktionen → App-Schlüssel** → `default` kopieren. Eine Event-ID aus
der Shop-URL (`/shop/<id>`) nehmen. In der Cloud Shell:

```bash
curl -s -X POST "<FUNCTIONS_URL>/api/test/idempotenz?eventId=<event-id>&code=<default-key>"
# -> {"nachrichtenEingespielt":2,"bestellungen":1,"tickets":1,"status":"versendet","ok":true}
```

---

## 13. Updates ohne Ausfallzeit

Neues Image bauen (`az acr build … -t kw-shop:v2 …` in der Cloud Shell), dann `shop-klangwerk` →
**Container → Bearbeiten und bereitstellen** → Tag `v2` → **Erstellen**. Unter **Revisionen** laufen alte
und neue Revision parallel; Traffic auf 100 % für die neue Revision stellen, wenn sie *Bereit* ist.

---

## 14. Kosten sparen und aufräumen

Nach jeder Arbeitssitzung:
- `vm-altsystem` → **Beenden** (Status *Beendet (Zuordnung aufgehoben)*)
- `mysql-klangwerk-<xy>` → **Beenden**
- `redis-klangwerk` und `func-klangwerk-<xy>` kosten je eine laufende Instanz. Für längere Pausen löschen
  und vor der Demo nach Schritt 7 bzw. 8 neu anlegen; die Daten liegen in MySQL, Redis baut sich selbst auf.

Nach der Notenbekanntgabe: Ressourcengruppe → **Ressourcengruppe löschen**.

---

## Wenn etwas nicht klappt

| Symptom | Ursache | Lösung |
| --- | --- | --- |
| Erstellen scheitert mit Richtlinienfehler | Region oder Dienst im Abo gesperrt | Screenshot sichern, andere Region bzw. Ersatzdienst, begründen |
| Hostingoption „Container Apps-Umgebung“ fehlt bei der Function App | in der Region nicht angeboten | Region wechseln oder melden, dann gibt es eine Variante als normale Container App |
| Shop zeigt Fehler, Log `ECONNREFUSED redis-klangwerk` | interner TCP-Name anders | `redis-klangwerk` → Eingang: Hostnamen ablesen, `REDIS_URL` in Shop und Functions anpassen |
| Kauf bleibt bei „In Verarbeitung“ | `BestellQueue` falsch oder Queue fehlt | App-Einstellung prüfen, Warteschlange `bestellungen` vorhanden? Function App neu starten |
| Keine Mail | Domäne nicht verbunden oder Spam | Schritt 5.4 prüfen, Spam-Ordner |
| Migration: Access denied / Timeout | Firewall der MySQL | Schritt 3 *Netzwerk*: Haken „Azure-Dienste zulassen“ gesetzt? |
