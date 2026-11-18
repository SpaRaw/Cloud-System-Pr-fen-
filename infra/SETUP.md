# Deployment auf Azure – Altsystem und Zielsystem

Diese Anleitung baut beide Systeme in deinem Azure-for-Students-Abo auf:

- **Altsystem** auf einer kleinen Linux-VM mit Docker (Nachweis 1): Next.js-Monolith, MySQL, Mailpit,
  alles auf einer Maschine wie beim Hoster.
- **Zielsystem** per Bicep (`infra/main.bicep`): Container Apps (Shop, Redis), Functions on Container Apps,
  MySQL Flexible Server, Storage (Queue + Blob), Communication Services, Budget.

Dann migrierst du die Daten von der VM in die verwaltete Datenbank, testest und räumst auf.

Alles läuft in **einer** Ressourcengruppe `rg-pruefung-<nachname>`. Befehle aus der Repo-Wurzel, in Bash
(Linux, macOS, WSL oder Azure Cloud Shell). Platzhalter in `<…>` ersetzen.

> **Ehrlicher Hinweis:** Das Bicep-Template kompiliert, wurde aber noch nicht gegen ein echtes Abo ausgeführt.
> Wenn ein Schritt scheitert, stehen unter [Fehlerbehebung](#fehlerbehebung) die wahrscheinlichsten Stellen.
> Jede Fehlermeldung als Screenshot sichern: Laut Aufgabe kostet ein gesperrter Dienst mit Begründung keine Punkte.

---

## 0. Vorbereitung (einmalig)

Lokal installiert: Azure CLI (`az`), Node 22 mit pnpm (`corepack enable`, dann `pnpm install` im Repo),
`ssh`/`scp`, Docker (nur für den Lasttest mit k6).

```bash
az login
az account show --query "{abo:name, id:id}" -o table

NACHNAME=<nachname>                       # nur Kleinbuchstaben
RG=rg-pruefung-$NACHNAME
MAIL=<deine-mail-fuer-budget-alarme>
MEINE_IP=$(curl -s https://api.ipify.org)

# Welche Regionen erlaubt dein Abo? Azure for Students setzt eine Richtlinie.
az policy assignment list --query "[].{name:displayName, regionen:parameters.listOfAllowedLocations.value}" -o jsonc
REGION=<erlaubte-region-moeglichst-eu>    # z. B. swedencentral, germanywestcentral, westeurope

# Ressourcen-Provider registrieren (dauert ein paar Minuten, einmal pro Abo)
for p in Microsoft.App Microsoft.Web Microsoft.ContainerRegistry Microsoft.DBforMySQL \
         Microsoft.Storage Microsoft.Communication Microsoft.OperationalInsights Microsoft.Network \
         Microsoft.Compute Microsoft.ManagedIdentity Microsoft.Consumption; do
  az provider register -n $p --wait
done

az group create -n $RG -l $REGION
```

**Screenshot:** Ressourcengruppe `rg-pruefung-<nachname>`.

Das Budget (30 $, Alarme bei ca. 10 $ und 20 $) wird in Schritt 2 automatisch mit angelegt. Wenn du es
schon am ersten Tag brauchst, bevor du Schritt 2 machst:

```bash
az consumption budget create -g $RG --budget-name budget-pruefung --amount 30 --time-grain Monthly \
  --start-date $(date +%Y-%m-01) --end-date 2027-12-31 --category Cost
# Alarme bei 10 $ und 20 $ dann im Portal: Kostenverwaltung → Budgets → budget-pruefung → Warnungen
```

---

## 1. Altsystem auf einer VM (Nachweis 1)

### 1.1 VM anlegen

`Standard_B2s` (2 vCPU, 4 GB) reicht, um die Images auf der VM zu bauen. Kostet nur, solange sie läuft
(ca. 0,05 $/h). Nach jeder Sitzung **deallokieren** (Schritt 9).

```bash
az vm create -g $RG -n vm-altsystem \
  --image Ubuntu2404 --size Standard_B2s \
  --admin-username azureuser --generate-ssh-keys \
  --public-ip-sku Standard \
  --custom-data infra/legacy-vm/cloud-init.yml \
  --nsg-rule SSH

VM_IP=$(az vm show -d -g $RG -n vm-altsystem --query publicIps -o tsv)

# Shop des Altsystems (Port 3001) nur für deine IP öffnen
az network nsg rule create -g $RG --nsg-name vm-altsystemNSG -n shop-3001 --priority 1010 \
  --source-address-prefixes $MEINE_IP --destination-port-ranges 3001 --access Allow --protocol Tcp

# Warten, bis cloud-init Docker installiert hat (1–3 min)
ssh azureuser@$VM_IP 'cloud-init status --wait && docker --version && docker compose version'
```

> Ist `Standard_B2s` in deiner Region gesperrt: `az vm list-sizes -l $REGION -o table` und eine andere
> B-Größe mit mindestens 2 GB RAM nehmen.

### 1.2 Repo auf die VM kopieren und starten

```bash
git archive --format=tar.gz -o /tmp/klangwerk.tgz HEAD
scp /tmp/klangwerk.tgz azureuser@$VM_IP:/opt/klangwerk/
ssh azureuser@$VM_IP 'cd /opt/klangwerk && tar xzf klangwerk.tgz && docker compose up -d --build legacy mailpit'
```

Das startet nur den Altsystem-Teil des Compose-Stacks: `mysql-legacy`, `legacy-init` (Altschema 001 +
erfundene Testdaten, darunter das Pflicht-Event mit 500 Tickets), `legacy` und `mailpit`. Der erste Build
dauert 3–5 Minuten.

```bash
ssh azureuser@$VM_IP 'cd /opt/klangwerk && docker compose ps && docker compose logs legacy-init'
```

Altsystem öffnen: `http://<VM_IP>:3001` (Admin: `admin` / `admin`).
Mails des Altsystems ansehen (Mailpit ist nicht öffentlich, nur per Tunnel):

```bash
ssh -N -L 8025:localhost:8025 azureuser@$VM_IP     # dann http://localhost:8025
```

**Screenshots:** VM im Portal, Altsystem im Browser, `docker compose ps` auf der VM.

---

## 2. Zielsystem: Infrastruktur

```bash
MYSQL_PW='<langes-kennwort-mit-Gross-klein-Ziffer>'   # mind. 8 Zeichen, 3 Zeichenklassen

az deployment group create -g $RG -n infra -f infra/main.bicep -p \
  name=klangwerk mysqlPassword="$MYSQL_PW" clientIp=$MEINE_IP budgetEmail=$MAIL deployApps=false \
  --query properties.outputs -o jsonc
```

Dauert 10–15 Minuten (MySQL und die Container-Apps-Umgebung brauchen am längsten). Angelegt werden:

| Ressource | Zweck |
| --- | --- |
| `id-klangwerk` | Managed Identity für Registry und Storage – kein Schlüssel im Code |
| `acrklangwerk…` | Container Registry (Basic) für die Images |
| `stklangwerk…` | Storage: Queue `bestellungen`, Blob `tickets` und `bilder`, Schlüsselzugriff aus |
| `mysql-klangwerk-…` | MySQL Flexible Server B1ms, Datenbank `klangwerk`, Firewall: Azure-Dienste + deine IP |
| `acs-…`, `email-…` | Communication Services mit Azure-Maildomain |
| `log-klangwerk` | Log Analytics mit Tageslimit 0,1 GB |
| `vnet-klangwerk`, `cae-klangwerk` | Container-Apps-Umgebung im eigenen VNet (nötig für TCP zu Redis) |
| `budget-pruefung` | 30 $ mit Alarmen bei ca. 10 $ und 20 $ |

**Screenshots:** Ressourcengruppe mit allen Ressourcen, Budget mit Warnungen.

---

## 3. Zielsystem: Images bauen

Die Images werden **in Azure** gebaut (`az acr build`), lokal brauchst du dafür kein Docker.

```bash
ACR=$(az acr list -g $RG --query "[0].name" -o tsv)
az acr build -r $ACR -t kw-shop:v1      -f apps/shop/Dockerfile .
az acr build -r $ACR -t kw-functions:v1 -f apps/functions/Dockerfile .
az acr repository list -n $ACR -o table
```

---

## 4. Zielsystem: Apps bereitstellen

```bash
az deployment group create -g $RG -n apps -f infra/main.bicep -p \
  name=klangwerk mysqlPassword="$MYSQL_PW" clientIp=$MEINE_IP budgetEmail=$MAIL \
  deployApps=true imageTag=v1 \
  --query properties.outputs -o jsonc

SHOP_URL=$(az deployment group show -g $RG -n apps --query properties.outputs.shopUrl.value -o tsv)
FUNC=$(az functionapp list -g $RG --query "[0].name" -o tsv)
FUNC_URL=$(az deployment group show -g $RG -n apps --query properties.outputs.functionsUrl.value -o tsv)
echo $SHOP_URL $FUNC_URL
```

Angelegt werden `redis-klangwerk` (1 Replik, nur intern per TCP), `func-klangwerk-…` (Functions in der
Container-Apps-Umgebung, 1 Instanz wegen des 5-s-Timers) und `shop-klangwerk` (öffentlich, 0–10 Replikas).

Die Datenbank ist noch leer, der Shop zeigt also noch keine Events. Die kommen mit der Migration (Schritt 6).

Kurzer Funktionstest:

```bash
curl -s "$FUNC_URL/api/kauf/verfuegbar?ids=" ; echo     # -> {}
curl -s -o /dev/null -w "%{http_code}\n" $SHOP_URL/shop  # -> 200 (nach der Migration mit Events)
```

**Screenshots:** Container App `shop-klangwerk` → Revisionen, Secrets (geschwärzt), Umgebungsvariablen.

---

## 5. Admin mit Entra ID schützen (Easy Auth)

Portal → Container App `shop-klangwerk` → **Authentifizierung** → **Identitätsanbieter hinzufügen** →
**Microsoft**:

- App-Registrierung: **Neue erstellen**, unterstützte Kontotypen: **Aktueller Mandant**
- Nicht authentifizierte Anforderungen: **Anonymen Zugriff zulassen**
  (der Shop ist öffentlich, nur `/admin` verlangt Anmeldung – das prüft `apps/shop/src/proxy.ts`)

Test: `$SHOP_URL/admin` → Microsoft-Login → Eventliste. Optional nur dein Konto zulassen:
Schritt 4 mit zusätzlich `adminEmails=<deine-uni-mail>` wiederholen.

**Screenshot:** Authentifizierung mit Microsoft-Anbieter.

---

## 6. Daten migrieren und umschalten (Nachweis 2)

Quelle ist die MySQL **auf der VM**, Ziel die MySQL Flexible. Die Migration läuft **auf der VM** im
Compose-Service `migration` (dasselbe Skript wie im lokalen Stack, nur mit Azure als Ziel). Die VM darf die
MySQL Flexible erreichen, weil die Firewall-Regel „Azure-Dienste zulassen“ aus Schritt 2 Azure-IPs erlaubt.

```bash
MYSQL_HOST=$(az mysql flexible-server list -g $RG --query "[0].fullyQualifiedDomainName" -o tsv)

# 1. Altsystem auf „nur lesen“: Shop stoppen, die Datenbank läuft weiter
ssh azureuser@$VM_IP 'cd /opt/klangwerk && docker compose stop legacy'

# 2. Zählen -> Dump -> Import in MySQL Flexible (TLS) -> 002_azure.sql -> Zählen
ssh azureuser@$VM_IP "cd /opt/klangwerk && docker compose run --rm --no-deps \
  -e ZIEL_HOST=$MYSQL_HOST -e ZIEL_USER=kwadmin -e ZIEL_PASSWORD='$MYSQL_PW' -e ZIEL_SSL=1 migration"
```

Die Ausgabe zeigt die Zeilen je Tabelle in der Quelle, importiert, wendet `002_azure.sql` an und zeigt die
Zeilen im Ziel. Beide Zählungen müssen gleich sein. **Screenshot dieser Ausgabe = Nachweis 2.**
Ein zweiter Aufruf meldet „schon migriert“ und ändert nichts.

Ausführliche Prüfung je Event (doppelte Plätze, Zähler) von deinem Rechner aus, `pnpm install` vorher:
`DATABASE_URL="mysql://kwadmin:$MYSQL_PW@$MYSQL_HOST:3306/klangwerk?ssl=true" pnpm --filter @kw/db zaehlen`

> Enthält die Quelle schon doppelt verkaufte Plätze (weil du vorher den Lasttest gegen das Altsystem
> gefahren hast), bricht `002_azure.sql` am Unique-Key ab. Das ist Absicht. Dann die VM-Datenbank neu
> aufsetzen: `ssh azureuser@$VM_IP 'cd /opt/klangwerk && docker compose down -v && docker compose up -d legacy mailpit'`
> und die Migration wiederholen. Den Lasttest gegen das Altsystem also **nach** der Migration fahren.
> Ist das Ziel schon teilweise befüllt: in MySQL Flexible `DROP DATABASE klangwerk; CREATE DATABASE klangwerk;`
> und erneut migrieren.

3. Umschalten: In der Realität jetzt DNS auf `$SHOP_URL` umstellen. Für die Prüfung reicht: Shop in Azure
öffnen, Events sind da, Kauf funktioniert.

**Rückweg:** VM-Shop wieder starten (`docker compose start legacy`), DNS zurück. Bestellungen, die in
der Zwischenzeit in Azure entstanden sind, per `mysqldump --where` zurückspielen.

---

## 7. Nachweise im Zielsystem

### Kauf entkoppelt (Nachweis 4)

Im Shop ein Ticket kaufen. Danach im Portal zeigen:

- Storage → Warteschlangen → `bestellungen` (kurz sichtbar, dann leer)
- Storage → Container → `tickets` → `<event-id>/<bestellung>.pdf`
- Function-App → Protokolle: `Bestellung …: 1 Ticket(s) erstellt und versendet`
- die Mail mit PDF im Postfach (Absender `DoNotReply@…azurecomm.net`, ggf. im Spam-Ordner)

### Lasttest (Nachweis 5)

Alle k6-Käufer kommen von deiner IP, deshalb das Rate-Limit vorher anheben und danach zurücksetzen:

```bash
az functionapp config appsettings set -g $RG -n $FUNC --settings RATE_LIMIT_IP=100000

MYSQL_URL="mysql://kwadmin:$MYSQL_PW@$MYSQL_HOST:3306/klangwerk?ssl=true"
DATABASE_URL="$MYSQL_URL" BASE=$SHOP_URL ./loadtest/run.sh ziel

az functionapp config appsettings set -g $RG -n $FUNC --settings RATE_LIMIT_IP=300
```

Das Skript legt ein frisches Event mit 500 Tickets an, schickt 200 virtuelle Käufer 2 Minuten lang durch den
echten Ablauf und prüft danach in MySQL: `✔ verkauft ≤ Kontingent` und `✔ keine Bestellung verloren`.
**Screenshots:** Skript-Ausgabe, Container App `shop-klangwerk` → Metriken → Replikaanzahl.

Zum Vergleich gegen das Altsystem auf der VM. Die VM-Datenbank erreichst du per SSH-Tunnel, in einem
zweiten Terminal: `ssh -N -L 3307:localhost:3307 azureuser@$VM_IP` (lokalen Compose-Stack vorher stoppen,
der belegt sonst Port 3307). Vorher Shop auf der VM wieder starten:
`ssh azureuser@$VM_IP 'cd /opt/klangwerk && docker compose start legacy'`.

```bash
DATABASE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3307/klangwerk BASE=http://$VM_IP:3001 ./loadtest/run.sh legacy
```

### Idempotenz (Nachweis 6)

```bash
EVENT_ID=$(curl -s $SHOP_URL/shop | grep -o 'shop/[0-9a-f-]\{36\}' | head -1 | cut -d/ -f2)
KEY=$(az functionapp keys list -g $RG -n $FUNC --query "functionKeys.default" -o tsv)
curl -s -X POST "$FUNC_URL/api/test/idempotenz?eventId=$EVENT_ID&code=$KEY"
# -> {"nachrichtenEingespielt":2,"bestellungen":1,"tickets":1,"status":"versendet","ok":true}
```

Ohne Schlüssel antwortet der Endpunkt mit 401. **Screenshot:** Antwort + Function-Protokoll mit beiden
Zustellungen („wird parallel verarbeitet“).

---

## 8. Updates ohne Ausfallzeit

```bash
az acr build -r $ACR -t kw-shop:v2 -f apps/shop/Dockerfile .
az containerapp update -g $RG -n shop-klangwerk --image $ACR.azurecr.io/kw-shop:v2
az containerapp revision list -g $RG -n shop-klangwerk -o table     # alte und neue Revision parallel
az containerapp ingress traffic set -g $RG -n shop-klangwerk --revision-weight latest=100
```

Für die Functions: neues Image bauen, dann
`az functionapp config container set -g $RG -n $FUNC --image $ACR.azurecr.io/kw-functions:v2`.

---

## 9. Kosten sparen und aufräumen

Was Geld kostet, solange es existiert:

| Ressource | ungefähr | sparen |
| --- | --- | --- |
| VM `vm-altsystem` (B2s) | 0,05 $/h läuft, Platte ca. 1 $/Monat | nach jeder Sitzung deallokieren |
| Redis-Container + Functions (je 1 Instanz) | wenige Cent bis ca. 1 $/Tag | nach jeder Sitzung löschen |
| MySQL Flexible B1ms | im Studentenabo ggf. 750 h/Monat frei, sonst ca. 0,5 $/Tag | stoppen |
| Container Registry Basic | ca. 0,17 $/Tag | bis zum Ende behalten |
| Shop | skaliert auf null | – |

Nach jeder Arbeitssitzung:

```bash
az vm deallocate -g $RG -n vm-altsystem
az containerapp delete -g $RG -n redis-klangwerk -y
az functionapp delete -g $RG -n $FUNC
az mysql flexible-server stop -g $RG -n $(az mysql flexible-server list -g $RG --query "[0].name" -o tsv)
```

Vor der nächsten Sitzung bzw. der Prüfung:

```bash
az vm start -g $RG -n vm-altsystem                       # neue IP? -> VM_IP neu abfragen
az mysql flexible-server start -g $RG -n <mysql-server>
# Schritt 4 erneut ausführen (legt Redis und Functions wieder an)
```

Die Daten liegen in MySQL, Redis baut sich beim ersten Zugriff selbst wieder auf.

Nach der Notenbekanntgabe:

```bash
az group delete -n $RG -y
```

---

## Fehlerbehebung

| Symptom | Wahrscheinliche Ursache | Lösung |
| --- | --- | --- |
| `RequestDisallowedByPolicy` | Region oder Dienst im Abo gesperrt | Screenshot, andere Region: `-p location=<…>` bzw. `mysqlLocation=<…>` |
| MySQL: `SkuNotAvailable` | B1ms in der Region nicht verfügbar | `mysqlLocation=<andere-region>` |
| Schritt 4: Functions-Ressource schlägt fehl | „Functions on Container Apps“ per `Microsoft.Web/sites` mit `managedEnvironmentId` in deiner Region/API-Version nicht verfügbar | Fehlermeldung sichern; Alternative: Functions-Image als normale Container App mit KEDA-Queue-Scaler – sag Bescheid, dann passe ich das Bicep an |
| Shop: 500 bei Kauf, Log `ECONNREFUSED redis-klangwerk` | interner TCP-Name von Redis anders | Portal → `redis-klangwerk` → Ingress: FQDN ablesen, in Schritt 4 `REDIS_URL` darauf ändern |
| Functions starten nicht, `AcrPull`/401 | Rollenzuweisung noch nicht aktiv | 2–3 Minuten warten, Schritt 4 wiederholen |
| Queue wird nicht abgearbeitet | Rolle „Storage Queue Data Contributor“ fehlt noch | wie oben, dann `az functionapp restart -g $RG -n $FUNC` |
| Keine Mail | ACS-Domain noch nicht verknüpft oder Mail im Spam | Portal → Communication Services → E-Mail → Domänen prüfen |
| `migrieren.sh`: Access denied | Firewall ohne deine aktuelle IP | `az mysql flexible-server firewall-rule create -g $RG -n <server> --rule-name ich --start-ip-address $MEINE_IP --end-ip-address $MEINE_IP` |
