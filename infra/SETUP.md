# Setup in Azure (Schritt für Schritt)

Voraussetzungen lokal: Azure CLI (`az`), Docker, Node 22 mit pnpm (`corepack enable`), dieses Repo.
Alle Befehle aus der Repo-Wurzel. Platzhalter in `<…>` ersetzen.

## 0. Anmelden, Region und Budget

```bash
az login
az account show --query "{abo:name, id:id}"
NACHNAME=<nachname>
RG=rg-pruefung-$NACHNAME

# Welche Regionen erlaubt dein Abo? (Azure for Students hat eine Richtlinie)
az policy assignment list --query "[].{name:displayName, regionen:parameters.listOfAllowedLocations.value}" -o jsonc
REGION=<erlaubte-region-moeglichst-eu>   # z. B. swedencentral, germanywestcentral, westeurope

az group create -n $RG -l $REGION
```

Screenshot für die Präsentation: Ressourcengruppe `rg-pruefung-<nachname>`.

## 1. Infrastruktur (ohne Apps)

```bash
MYSQL_PW='<langes-kennwort>'
MEINE_IP=$(curl -s https://api.ipify.org)

az deployment group create -g $RG -f infra/main.bicep -p \
  mysqlPassword="$MYSQL_PW" clientIp=$MEINE_IP budgetEmail=<deine-mail> deployApps=false \
  --query properties.outputs
```

Angelegt werden: Managed Identity, Container Registry (Basic), Storage (Queue `bestellungen`, Container
`tickets` und `bilder`, **ohne** Schlüsselzugriff), MySQL Flexible Server B1ms, Communication Services mit
Azure-Maildomain, Log Analytics (Tageslimit 0,1 GB), VNet und Container-Apps-Umgebung, Budget 30 $ mit
Alarmen bei ca. 10 $ und 20 $.

> Schlägt ein Dienst wegen einer Richtlinie fehl (z. B. MySQL in deiner Region): Fehlermeldung als Screenshot
> sichern, `mysqlLocation=<andere-region>` setzen und neu ausführen. Das kostet laut Aufgabe keine Punkte.

## 2. Images bauen (in Azure, kein lokales Docker nötig)

```bash
ACR=$(az acr list -g $RG --query "[0].name" -o tsv)
az acr build -r $ACR -t kw-shop:v1 -f apps/shop/Dockerfile .
az acr build -r $ACR -t kw-functions:v1 -f apps/functions/Dockerfile .
```

## 3. Apps bereitstellen

```bash
az deployment group create -g $RG -f infra/main.bicep -p \
  mysqlPassword="$MYSQL_PW" clientIp=$MEINE_IP budgetEmail=<deine-mail> deployApps=true imageTag=v1 \
  --query properties.outputs
```

Das legt an: `redis-klangwerk` (1 Replik, TCP intern), `func-klangwerk-…` (Functions in der Container-Apps-
Umgebung) und `shop-klangwerk` (öffentlich, skaliert 0–10).

## 4. Admin mit Entra ID schützen (Easy Auth)

Portal → Container App `shop-klangwerk` → **Authentifizierung** → **Identitätsanbieter hinzufügen** →
**Microsoft**:

- App-Registrierung: *Neue erstellen*, unterstützte Konten: *Aktueller Mandant*
- **Nicht authentifizierte Anforderungen: „Anonymen Zugriff zulassen“** (der Shop ist öffentlich, nur `/admin`
  verlangt Anmeldung – das prüft `apps/shop/src/proxy.ts`)

Optional nur bestimmte Konten zulassen: Parameter `adminEmails=<a@x.de>` beim Deployment.

## 5. Datenbank migrieren (Nachweis 2)

Altsystem lokal starten (`docker compose --profile legacy up -d --build`, dann `pnpm db:migrate -- --bis 001`
und `pnpm db:seed` gegen Port 3307), danach:

```bash
QUELLE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3307/klangwerk \
ZIEL_URL="mysql://kwadmin:$MYSQL_PW@$(az mysql flexible-server list -g $RG --query '[0].fullyQualifiedDomainName' -o tsv):3306/klangwerk?ssl=true" \
./scripts/migrieren.sh
```

Das Skript zeigt die Zählabfrage vorher und nachher. Achtung: Enthält die Quelle schon doppelt verkaufte
Plätze (z. B. nach dem Lasttest gegen das Altsystem), schlägt der Unique-Key in `002_azure.sql` fehl. Das ist
Absicht. Für die Demo die Quelle vorher neu aufsetzen oder den Lasttest gegen eine Kopie fahren.

## 6. Lasttest und Idempotenz (Nachweis 5 und 6)

```bash
# Rate-Limit pro IP für den Test anheben (alle k6-Käufer kommen von deiner IP)
az deployment group create … rateLimitIp=100000      # oder im Portal: Functions → Umgebungsvariablen

DATABASE_URL="$ZIEL_URL" BASE=https://<shop-url> ./loadtest/run.sh ziel
```

Idempotenz: Der Endpunkt ist mit einem Function-Key geschützt (ohne Schlüssel 401).

```bash
FUNC=$(az functionapp list -g $RG --query "[0].name" -o tsv)
KEY=$(az functionapp keys list -g $RG -n $FUNC --query "functionKeys.default" -o tsv)
curl -s -X POST "https://$(az functionapp show -g $RG -n $FUNC --query defaultHostName -o tsv)/api/test/idempotenz?eventId=<uuid>&code=$KEY"
# -> {"nachrichtenEingespielt":2,"bestellungen":1,"tickets":1,"status":"versendet","ok":true}
```

## 7. Updates ohne Ausfallzeit

```bash
az acr build -r $ACR -t kw-shop:v2 -f apps/shop/Dockerfile .
az containerapp update -g $RG -n shop-klangwerk --image $ACR.azurecr.io/kw-shop:v2
# neue Revision läuft parallel an; erst wenn sie bereit ist, bekommt sie den Traffic
az containerapp ingress traffic set -g $RG -n shop-klangwerk --revision-weight latest=100
```

## 8. Kosten sparen und aufräumen

Was dauerhaft Geld kostet, solange es existiert: Redis-Container und Functions (je 1 Instanz, wegen Timer
bzw. Zustand), MySQL (wenn nicht im Gratiskontingent), Container Registry Basic. Der Shop skaliert auf null.

- Nach jeder Arbeitssitzung:
  ```bash
  az containerapp delete -g $RG -n redis-klangwerk -y
  az functionapp delete -g $RG -n $FUNC
  az mysql flexible-server stop -g $RG -n <mysql-server>
  ```
  Vor der Demo: `az mysql flexible-server start …` und Schritt 3 erneut ausführen. Die Daten liegen in MySQL,
  Redis baut sich beim ersten Zugriff selbst wieder auf.
- Nach der Notenbekanntgabe: `az group delete -n $RG`.
