#!/usr/bin/env bash
# KlangWerk – Schritte 6 bis 10 aus infra/PORTAL.md per Azure CLI (Cloud Shell, Bash).
#
#   6  Container-Apps-Umgebung cae-klangwerk (+ VNet, Log Analytics mit 0,1 GB/Tag)
#   7  Redis als Container App (TCP intern, 1 Replik, Kennwort als Secret)
#   8  Functions in der Container-Apps-Umgebung (+ alle App-Einstellungen)
#   9  Shop als Container App (Secrets, Skalierung 0–10, mehrere Revisionen)
#  10  Easy Auth mit Entra ID für den Shop
#
# Voraussetzung: Schritte 0–5 sind erledigt (Ressourcengruppe, VM, Registry mit kw-shop:v1 und
# kw-functions:v1, MySQL, Storage, ACS). Das Skript findet diese Ressourcen selbst in der Gruppe.
#
# Aufruf in der Cloud Shell (Bash):
#   bash cloudshell-ab-schritt6.sh                       # fragt nach, was es nicht selbst findet
#   RG=rg-pruefung-meier bash cloudshell-ab-schritt6.sh  # Ressourcengruppe vorgeben
#
# Optionale Variablen: RG, REGION (bevorzugte Region), MYSQL_PW, ADMIN_EMAILS, IMAGE_TAG (Standard v1),
#                      SKIP_AUTH=1 (Schritt 10 auslassen)
#
# Das Skript darf beliebig oft laufen: Vorhandenes wird wiederverwendet bzw. aktualisiert,
# Kaputtes (Status „Failed“) wird gelöscht und neu angelegt.
# Alle ermittelten Werte landen in ~/klangwerk-werte.env (nur für dich lesbar).

set -Eeuo pipefail
trap 'echo -e "\n\e[31m✖ Abbruch in Zeile $LINENO: $BASH_COMMAND\e[0m" >&2' ERR

# ---------------------------------------------------------------- Einstellungen
ERLAUBTE_REGIONEN=(germanywestcentral italynorth austriaeast)
IMAGE_TAG=${IMAGE_TAG:-v1}
ENV_NAME=cae-klangwerk
VNET=vnet-klangwerk
LOGS=log-klangwerk
REDIS_APP=redis-klangwerk
SHOP_APP=shop-klangwerk
WERTE=~/klangwerk-werte.env
TMP=$(mktemp -d); chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT

schritt() { echo -e "\n\e[1;34m=== $* ===\e[0m"; }
ok()      { echo -e "\e[32m✔ $*\e[0m"; }
warn()    { echo -e "\e[33m⚠ $*\e[0m"; }
fail()    { echo -e "\e[31m✖ $*\e[0m" >&2; exit 1; }
merke()   { # Wert in ~/klangwerk-werte.env speichern (überschreibt alten Eintrag)
  touch "$WERTE"; chmod 600 "$WERTE"
  grep -v "^$1=" "$WERTE" > "$TMP/w" || true
  printf "%s=%q\n" "$1" "$2" >> "$TMP/w"; mv "$TMP/w" "$WERTE"; chmod 600 "$WERTE"
}
# Werte aus einem früheren Lauf laden (Redis-Kennwort, MySQL-Kennwort …)
# shellcheck disable=SC1090
[[ -f $WERTE ]] && source "$WERTE"

# Für YAML: Werte stehen in "…", dürfen also kein " oder \ enthalten
yamlsicher() { [[ $1 != *'"'* && $1 != *'\'* ]] || fail "Wert enthält \" oder \\ und passt nicht ins YAML: ${1:0:12}…"; }

# Status einer Container App: leer = gibt es nicht
ca_status() { az containerapp show -g "$RG" -n "$1" --query properties.provisioningState -o tsv 2>/dev/null || true; }

# ---------------------------------------------------------------- Vorbereitung
schritt "Vorbereitung"
az account show --query "{Abo:name, Benutzer:user.name}" -o table >/dev/null || fail "Nicht angemeldet: az login"
az config set extension.use_dynamic_install=yes_without_prompt core.only_show_errors=true >/dev/null 2>&1 || true
az extension add -n containerapp --upgrade -y >/dev/null 2>&1 || warn "containerapp-Erweiterung konnte nicht aktualisiert werden"

for p in Microsoft.App Microsoft.OperationalInsights Microsoft.Network Microsoft.Web; do
  [[ $(az provider show -n $p --query registrationState -o tsv 2>/dev/null) == Registered ]] \
    || { echo "Registriere Provider $p …"; az provider register -n $p --wait; }
done

if [[ -z ${RG:-} ]]; then
  mapfile -t gruppen < <(az group list --query "[?starts_with(name,'rg-pruefung')].name" -o tsv)
  if [[ ${#gruppen[@]} -eq 1 ]]; then RG=${gruppen[0]}
  else read -rp "Name der Ressourcengruppe: " RG; fi
fi
az group show -n "$RG" -o none || fail "Ressourcengruppe $RG nicht gefunden"
ok "Ressourcengruppe: $RG"

# Regionsreihenfolge: REGION, sonst Region der Gruppe, dann die übrigen erlaubten
RG_REGION=$(az group show -n "$RG" --query location -o tsv)
REGIONEN=()
for r in ${REGION:-} "$RG_REGION" "${ERLAUBTE_REGIONEN[@]}"; do
  if [[ " ${ERLAUBTE_REGIONEN[*]} " == *" $r "* && " ${REGIONEN[*]:-} " != *" $r "* ]]; then REGIONEN+=("$r"); fi
done
echo "Regionen in dieser Reihenfolge: ${REGIONEN[*]}"

# --- Registry (Schritt 2)
ACR=$(az acr list -g "$RG" --query "[0].name" -o tsv)
[[ -n $ACR ]] || fail "Keine Container Registry in $RG (Schritt 2 fehlt)"
XY=${ACR#acrklangwerk}; [[ $XY == "$ACR" || -z $XY ]] && XY=$(echo "$RG" | sed 's/.*-//' | tr -cd 'a-z0-9' | cut -c1-8)
ACR_SERVER=$(az acr show -n "$ACR" --query loginServer -o tsv)
az acr update -n "$ACR" --admin-enabled true -o none
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PW=$(az acr credential show -n "$ACR" --query "passwords[0].value" -o tsv)
for img in kw-shop kw-functions; do
  tags=$(az acr repository show-tags -n "$ACR" --repository $img -o tsv 2>/dev/null || true)
  if ! grep -qx "$IMAGE_TAG" <<<"$tags"; then
    if [[ -f apps/shop/Dockerfile ]]; then
      warn "$img:$IMAGE_TAG fehlt – baue es jetzt (3–6 min)"
      az acr build -r "$ACR" -t "$img:$IMAGE_TAG" -f "apps/${img#kw-}/Dockerfile" . -o none
    else
      fail "$img:$IMAGE_TAG fehlt in $ACR. Skript im Repo-Ordner starten (dann baut es selbst) oder Schritt 2 nachholen."
    fi
  fi
done
ok "Registry $ACR_SERVER, Images kw-shop:$IMAGE_TAG und kw-functions:$IMAGE_TAG vorhanden"
FUNC_NAME=${FUNC_NAME:-func-klangwerk-$XY}

# --- Storage (Schritt 4)
ST=$(az storage account list -g "$RG" --query "[0].name" -o tsv)
[[ -n $ST ]] || fail "Kein Speicherkonto in $RG (Schritt 4 fehlt)"
ST_CS=$(az storage account show-connection-string -g "$RG" -n "$ST" --query connectionString -o tsv)
az storage queue create -n bestellungen --connection-string "$ST_CS" -o none
for c in tickets bilder; do az storage container create -n $c --connection-string "$ST_CS" -o none; done
ok "Storage $ST (Queue bestellungen, Container tickets/bilder)"

# --- MySQL (Schritt 3)
read -r MYSQL_SERVER MYSQL_HOST MYSQL_USER MYSQL_STATE < <(az mysql flexible-server list -g "$RG" \
  --query "[0].[name, fullyQualifiedDomainName, administratorLogin, state]" -o tsv)
[[ -n ${MYSQL_SERVER:-} ]] || fail "Kein MySQL Flexible Server in $RG (Schritt 3 fehlt)"
if [[ $MYSQL_STATE == Stopped ]]; then echo "MySQL ist gestoppt, starte …"; az mysql flexible-server start -g "$RG" -n "$MYSQL_SERVER" -o none; fi
az mysql flexible-server db show -g "$RG" -s "$MYSQL_SERVER" -d klangwerk -o none 2>/dev/null \
  || az mysql flexible-server db create -g "$RG" -s "$MYSQL_SERVER" -d klangwerk --charset utf8mb4 -o none
az mysql flexible-server firewall-rule show -g "$RG" -n "$MYSQL_SERVER" --rule-name AllowAzureServices -o none 2>/dev/null \
  || az mysql flexible-server firewall-rule create -g "$RG" -n "$MYSQL_SERVER" --rule-name AllowAzureServices \
       --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none
if [[ -z ${MYSQL_PW:-} ]]; then read -rsp "Kennwort von $MYSQL_USER auf $MYSQL_SERVER: " MYSQL_PW; echo; fi
merke MYSQL_PW "$MYSQL_PW"
MYSQL_PW_URL=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$MYSQL_PW")
DB_URL="mysql://$MYSQL_USER:$MYSQL_PW_URL@$MYSQL_HOST:3306/klangwerk?ssl=true"
ok "MySQL $MYSQL_HOST (Datenbank klangwerk, Azure-Dienste zugelassen)"

# --- Mail (Schritt 5)
ACS_ID=$(az resource list -g "$RG" --resource-type Microsoft.Communication/communicationServices --query "[0].id" -o tsv)
EMAIL_ID=$(az resource list -g "$RG" --resource-type Microsoft.Communication/emailServices --query "[0].id" -o tsv)
ACS_CS=""; MAIL_ABSENDER=""
if [[ -n $ACS_ID && -n $EMAIL_ID ]]; then
  ACS_CS=$(az rest --method post --url "https://management.azure.com$ACS_ID/listKeys?api-version=2023-04-01" --query primaryConnectionString -o tsv)
  DOMAIN_ID=$(az rest --method get --url "https://management.azure.com$EMAIL_ID/domains?api-version=2023-04-01" --query "value[0].id" -o tsv || true)
  if [[ -n $DOMAIN_ID ]]; then
    MAIL_ABSENDER="DoNotReply@$(az rest --method get --url "https://management.azure.com$DOMAIN_ID?api-version=2023-04-01" --query properties.mailFromSenderDomain -o tsv)"
    verbunden=$(az rest --method get --url "https://management.azure.com$ACS_ID?api-version=2023-04-01" --query "properties.linkedDomains[0]" -o tsv || true)
    if [[ -z $verbunden ]]; then
      echo "Verbinde Mail-Domäne mit $(basename "$ACS_ID") …"
      az rest --method patch --url "https://management.azure.com$ACS_ID?api-version=2023-04-01" \
        --body "{\"properties\":{\"linkedDomains\":[\"$DOMAIN_ID\"]}}" -o none
    fi
    ok "Mail: Absender $MAIL_ABSENDER"
  else
    warn "Keine Domäne im E-Mail-Dienst (Schritt 5.2). Mails gehen erst, wenn du sie nachholst und das Skript erneut startest."
  fi
else
  warn "Communication Services / E-Mail-Dienst fehlt (Schritt 5). Weiter ohne Mailversand."
fi

# ================================================================ 6. Container-Apps-Umgebung
schritt "6. Container-Apps-Umgebung $ENV_NAME"

aufraeumen_umgebung() {
  warn "Räume halb angelegte Umgebung auf …"
  az containerapp env delete -g "$RG" -n "$ENV_NAME" -y -o none 2>/dev/null || true
  az network vnet delete -g "$RG" -n "$VNET" -o none 2>/dev/null || true
  az monitor log-analytics workspace delete -g "$RG" -n "$LOGS" --force true -y -o none 2>/dev/null || true
}

umgebung_anlegen() { # $1 = Region
  local r=$1
  echo "Versuche Region $r …"
  az monitor log-analytics workspace create -g "$RG" -n "$LOGS" -l "$r" --retention-time 30 --quota 0.1 -o none || return 1
  az network vnet create -g "$RG" -n "$VNET" -l "$r" --address-prefixes 10.40.0.0/16 \
     --subnet-name aca --subnet-prefixes 10.40.0.0/23 -o none || return 1
  az network vnet subnet update -g "$RG" --vnet-name "$VNET" -n aca --delegations Microsoft.App/environments -o none || return 1
  local subnet law_id law_key
  subnet=$(az network vnet subnet show -g "$RG" --vnet-name "$VNET" -n aca --query id -o tsv)
  law_id=$(az monitor log-analytics workspace show -g "$RG" -n "$LOGS" --query customerId -o tsv)
  law_key=$(az monitor log-analytics workspace get-shared-keys -g "$RG" -n "$LOGS" --query primarySharedKey -o tsv)
  echo "Lege Umgebung an (ca. 5–10 min) …"
  az containerapp env create -g "$RG" -n "$ENV_NAME" -l "$r" \
     --enable-workload-profiles --infrastructure-subnet-resource-id "$subnet" --internal-only false \
     --logs-destination log-analytics --logs-workspace-id "$law_id" --logs-workspace-key "$law_key" -o none || return 1
  [[ $(az containerapp env show -g "$RG" -n "$ENV_NAME" --query properties.provisioningState -o tsv) == Succeeded ]]
}

ENV_STATUS=$(az containerapp env show -g "$RG" -n "$ENV_NAME" --query properties.provisioningState -o tsv 2>/dev/null || true)
if [[ $ENV_STATUS == Succeeded ]]; then
  ok "Umgebung gibt es schon"
else
  [[ -n $ENV_STATUS ]] && warn "Umgebung hat Status $ENV_STATUS"
  aufraeumen_umgebung
  erfolg=""
  for r in "${REGIONEN[@]}"; do
    if umgebung_anlegen "$r"; then erfolg=$r; break; fi
    warn "Region $r hat nicht geklappt."
    aufraeumen_umgebung
  done
  [[ -n $erfolg ]] || fail "Container-Apps-Umgebung ließ sich in keiner erlaubten Region anlegen (Fehlermeldungen oben, Screenshot sichern)."
fi
REGION=$(az containerapp env show -g "$RG" -n "$ENV_NAME" --query location -o tsv | tr -d ' ' | tr '[:upper:]' '[:lower:]')
ENV_ID=$(az containerapp env show -g "$RG" -n "$ENV_NAME" --query id -o tsv)
merke REGION "$REGION"
ok "Umgebung $ENV_NAME in $REGION"

# ================================================================ 7. Redis
schritt "7. Redis als Container App"
REDIS_PW=${REDIS_PW:-}
if [[ -z $REDIS_PW && $(ca_status $REDIS_APP) == Succeeded ]]; then
  REDIS_PW=$(az containerapp secret show -g "$RG" -n $REDIS_APP --secret-name redis-password --query value -o tsv 2>/dev/null || true)
fi
[[ -n $REDIS_PW ]] || REDIS_PW=$(openssl rand -hex 16)
merke REDIS_PW "$REDIS_PW"

cat > "$TMP/redis.yaml" <<EOF
location: $REGION
properties:
  environmentId: $ENV_ID
  workloadProfileName: Consumption
  configuration:
    activeRevisionsMode: Single
    secrets:
      - name: redis-password
        value: "$REDIS_PW"
    ingress:
      external: false
      transport: tcp
      targetPort: 6379
      exposedPort: 6379
  template:
    containers:
      - name: redis
        image: docker.io/library/redis:7-alpine
        command: ["/bin/sh", "-c"]
        args: ['exec redis-server --requirepass "\$REDIS_PASSWORD" --save "" --appendonly no --maxmemory 400mb']
        env:
          - name: REDIS_PASSWORD
            secretRef: redis-password
        resources:
          cpu: 0.25
          memory: 0.5Gi
    scale:
      minReplicas: 1
      maxReplicas: 1
EOF

ca_anlegen() { # $1 = Name, $2 = YAML-Datei
  local s; s=$(ca_status "$1")
  if [[ -n $s && $s != Succeeded ]]; then
    warn "$1 hat Status $s, lösche und lege neu an"
    az containerapp delete -g "$RG" -n "$1" -y -o none
    s=""
  fi
  if [[ -z $s ]]; then az containerapp create -g "$RG" -n "$1" --yaml "$2" -o none
  else                 az containerapp update -g "$RG" -n "$1" --yaml "$2" -o none; fi
}
ca_anlegen $REDIS_APP "$TMP/redis.yaml"
REDIS_URL="redis://:$REDIS_PW@$REDIS_APP:6379"
ok "Redis läuft intern unter $REDIS_APP:6379"

# ================================================================ 8. Functions
schritt "8. Functions ($FUNC_NAME)"
FUNC_SETTINGS=(
  "BestellQueue=$ST_CS"
  "STORAGE_CONNECTION_STRING=$ST_CS"
  "DATABASE_URL=$DB_URL"
  "REDIS_URL=$REDIS_URL"
  "ACS_CONNECTION_STRING=$ACS_CS"
  "MAIL_ABSENDER=$MAIL_ABSENDER"
  "RATE_LIMIT_IP=${RATE_LIMIT_IP:-300}"
  "NODE_ENV=production"
)
FUNC_MODUS=functionapp
FUNC_STATUS=$(az functionapp show -g "$RG" -n "$FUNC_NAME" --query id -o tsv 2>/dev/null || true)
if [[ -z $FUNC_STATUS ]]; then
  echo "Lege Function App in der Container-Apps-Umgebung an (ca. 3–5 min) …"
  FUNC_ARGS=(-g "$RG" -n "$FUNC_NAME" --environment "$ENV_NAME" --workload-profile-name Consumption
             --storage-account "$ST" --functions-version 4 --runtime node
             --image "$ACR_SERVER/kw-functions:$IMAGE_TAG" --registry-server "$ACR_SERVER"
             --registry-username "$ACR_USER" --registry-password "$ACR_PW" -o none)
  # erst mit 0,5 CPU / 1 Gi, bei älterer CLI ohne diese Angaben, sonst Ersatzvariante
  if ! az functionapp create "${FUNC_ARGS[@]}" --cpu 0.5 --memory 1Gi \
     && ! { az functionapp delete -g "$RG" -n "$FUNC_NAME" -o none 2>/dev/null; az functionapp create "${FUNC_ARGS[@]}"; }; then
    warn "Function App in der Container-Apps-Umgebung geht hier nicht. Ersatz: Functions-Image als normale Container App."
    az functionapp delete -g "$RG" -n "$FUNC_NAME" -o none 2>/dev/null || true
    FUNC_MODUS=containerapp
  fi
else
  ok "Function App gibt es schon, aktualisiere Image und Einstellungen"
  az functionapp config container set -g "$RG" -n "$FUNC_NAME" --image "$ACR_SERVER/kw-functions:$IMAGE_TAG" \
     --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PW" -o none || true
fi

if [[ $FUNC_MODUS == functionapp ]]; then
  az functionapp config appsettings set -g "$RG" -n "$FUNC_NAME" --settings "${FUNC_SETTINGS[@]}" -o none
  # Timer „aufraeumen“ alle 5 s braucht eine laufende Instanz
  az resource update -g "$RG" -n "$FUNC_NAME" --resource-type Microsoft.Web/sites \
     --set properties.siteConfig.minimumElasticInstanceCount=1 properties.siteConfig.functionAppScaleLimit=10 -o none 2>/dev/null || true
  az functionapp restart -g "$RG" -n "$FUNC_NAME" -o none || true
  FUNC_HOST=$(az functionapp show -g "$RG" -n "$FUNC_NAME" --query defaultHostName -o tsv)
else
  FUNC_NAME=func-klangwerk
  for v in "$ST_CS" "$DB_URL" "$ACS_CS" "$ACR_PW"; do yamlsicher "$v"; done
  cat > "$TMP/func.yaml" <<EOF
location: $REGION
properties:
  environmentId: $ENV_ID
  workloadProfileName: Consumption
  configuration:
    activeRevisionsMode: Single
    registries:
      - server: $ACR_SERVER
        username: $ACR_USER
        passwordSecretRef: acr-password
    secrets:
      - { name: acr-password, value: "$ACR_PW" }
      - { name: storage, value: "$ST_CS" }
      - { name: database-url, value: "$DB_URL" }
      - { name: redis-url, value: "$REDIS_URL" }
      - { name: acs, value: "$ACS_CS" }
    ingress:
      external: true
      targetPort: 80
      transport: auto
  template:
    containers:
      - name: functions
        image: $ACR_SERVER/kw-functions:$IMAGE_TAG
        resources: { cpu: 0.5, memory: 1Gi }
        env:
          - { name: AzureWebJobsStorage, secretRef: storage }
          - { name: BestellQueue, secretRef: storage }
          - { name: STORAGE_CONNECTION_STRING, secretRef: storage }
          - { name: DATABASE_URL, secretRef: database-url }
          - { name: REDIS_URL, secretRef: redis-url }
          - { name: ACS_CONNECTION_STRING, secretRef: acs }
          - { name: MAIL_ABSENDER, value: "$MAIL_ABSENDER" }
          - { name: RATE_LIMIT_IP, value: "${RATE_LIMIT_IP:-300}" }
          - { name: NODE_ENV, value: production }
          - { name: FUNCTIONS_WORKER_RUNTIME, value: node }
          - { name: FUNCTIONS_EXTENSION_VERSION, value: "~4" }
    scale:
      minReplicas: 1
      maxReplicas: 10
EOF
  ca_anlegen $FUNC_NAME "$TMP/func.yaml"
  FUNC_HOST=$(az containerapp show -g "$RG" -n $FUNC_NAME --query properties.configuration.ingress.fqdn -o tsv)
fi
FUNCTIONS_URL="https://$FUNC_HOST"
merke FUNC_NAME "$FUNC_NAME"; merke FUNC_MODUS "$FUNC_MODUS"; merke FUNCTIONS_URL "$FUNCTIONS_URL"

echo -n "Warte, bis die Functions antworten "
for _ in $(seq 1 40); do
  if curl -fsS -m 10 "$FUNCTIONS_URL/api/kauf/verfuegbar?ids=" >/dev/null 2>&1; then echo; ok "Functions antworten: $FUNCTIONS_URL"; break; fi
  echo -n "."; sleep 10
done
curl -fsS -m 10 "$FUNCTIONS_URL/api/kauf/verfuegbar?ids=" >/dev/null 2>&1 \
  || warn "Functions antworten noch nicht. Weiter; prüfe später: $FUNCTIONS_URL/api/kauf/verfuegbar?ids="

# ================================================================ 9. Shop
schritt "9. Shop als Container App"
for v in "$ST_CS" "$DB_URL" "$ACR_PW" "${ADMIN_EMAILS:-}"; do yamlsicher "$v"; done
cat > "$TMP/shop.yaml" <<EOF
location: $REGION
properties:
  environmentId: $ENV_ID
  workloadProfileName: Consumption
  configuration:
    activeRevisionsMode: Multiple
    registries:
      - server: $ACR_SERVER
        username: $ACR_USER
        passwordSecretRef: acr-password
    secrets:
      - { name: acr-password, value: "$ACR_PW" }
      - { name: database-url, value: "$DB_URL" }
      - { name: redis-url, value: "$REDIS_URL" }
      - { name: storage, value: "$ST_CS" }
    ingress:
      external: true
      targetPort: 3000
      transport: auto
      traffic:
        - latestRevision: true
          weight: 100
  template:
    containers:
      - name: shop
        image: $ACR_SERVER/kw-shop:$IMAGE_TAG
        resources: { cpu: 0.5, memory: 1Gi }
        env:
          - { name: DATABASE_URL, secretRef: database-url }
          - { name: REDIS_URL, secretRef: redis-url }
          - { name: STORAGE_CONNECTION_STRING, secretRef: storage }
          - { name: FUNCTIONS_URL, value: "$FUNCTIONS_URL" }
          - { name: ADMIN_EMAILS, value: "${ADMIN_EMAILS:-}" }
        probes:
          - type: Readiness
            httpGet: { path: /shop, port: 3000 }
            periodSeconds: 10
    scale:
      minReplicas: 0
      maxReplicas: 10
      rules:
        - name: http
          http:
            metadata:
              concurrentRequests: "50"
EOF
ca_anlegen $SHOP_APP "$TMP/shop.yaml"
SHOP_FQDN=$(az containerapp show -g "$RG" -n $SHOP_APP --query properties.configuration.ingress.fqdn -o tsv)
SHOP_URL="https://$SHOP_FQDN"
merke SHOP_URL "$SHOP_URL"
ok "Shop: $SHOP_URL/shop"

# ================================================================ 10. Easy Auth
schritt "10. Admin mit Entra ID schützen"
if [[ ${SKIP_AUTH:-0} == 1 ]]; then
  warn "übersprungen (SKIP_AUTH=1)"
else
  TENANT=$(az account show --query tenantId -o tsv)
  CALLBACK="$SHOP_URL/.auth/login/aad/callback"
  APP_ID=$(az ad app list --display-name "$SHOP_APP-auth" --query "[0].appId" -o tsv 2>/dev/null || true)
  if [[ -z $APP_ID ]]; then
    APP_ID=$(az ad app create --display-name "$SHOP_APP-auth" --sign-in-audience AzureADMyOrg \
               --web-redirect-uris "$CALLBACK" --enable-id-token-issuance true --query appId -o tsv 2>/dev/null || true)
  else
    az ad app update --id "$APP_ID" --web-redirect-uris "$CALLBACK" --enable-id-token-issuance true 2>/dev/null || true
  fi
  if [[ -z $APP_ID ]]; then
    warn "App-Registrierung darfst du per CLI nicht anlegen. Schritt 10 dann im Portal (PORTAL.md), der Rest steht."
  else
    az ad sp show --id "$APP_ID" -o none 2>/dev/null || az ad sp create --id "$APP_ID" -o none 2>/dev/null || true
    APP_SECRET=$(az ad app credential reset --id "$APP_ID" --display-name easyauth --years 1 --query password -o tsv)
    az containerapp auth microsoft update -g "$RG" -n $SHOP_APP --client-id "$APP_ID" --client-secret "$APP_SECRET" \
       --tenant-id "$TENANT" --issuer "https://login.microsoftonline.com/$TENANT/v2.0" --yes -o none
    az containerapp auth update -g "$RG" -n $SHOP_APP --enabled true --unauthenticated-client-action AllowAnonymous -o none
    ok "Easy Auth aktiv, Test: $SHOP_URL/admin"
  fi
fi

# ================================================================ Zusammenfassung
merke RG "$RG"; merke MYSQL_HOST "$MYSQL_HOST"; merke ACR "$ACR"
schritt "Fertig"
cat <<EOF
Region:          $REGION
Shop:            $SHOP_URL/shop
Admin:           $SHOP_URL/admin
Functions:       $FUNCTIONS_URL  (Modus: $FUNC_MODUS)
MySQL:           $MYSQL_HOST
Alle Werte:      $WERTE   (mit 'source $WERTE' in die Shell laden)

Nächste Schritte (PORTAL.md):
  11  Migration auf der VM:   MYSQL_HOST=$MYSQL_HOST  ZIEL_USER=$MYSQL_USER
  12  Idempotenz-Test:
EOF
if [[ $FUNC_MODUS == functionapp ]]; then
  echo "      KEY=\$(az functionapp keys list -g $RG -n $FUNC_NAME --query functionKeys.default -o tsv)"
else
  echo "      Schlüssel liegt im Speicherkonto $ST, Container azure-webjobs-secrets"
fi
echo "      curl -s -X POST \"$FUNCTIONS_URL/api/test/idempotenz?eventId=<event-id>&code=\$KEY\""
