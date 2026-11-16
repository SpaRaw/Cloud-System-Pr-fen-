// KlangWerk Tickets – Zielsystem in Azure.
// Alles landet in EINER Ressourcengruppe (rg-pruefung-<nachname>). Bereitstellung in zwei Schritten:
//   1. deployApps=false  -> Infrastruktur (Registry, MySQL, Storage, ACS, Container-Apps-Umgebung, Budget)
//   2. Images bauen (az acr build), dann deployApps=true -> Redis, Functions, Shop
// Anleitung: infra/SETUP.md

targetScope = 'resourceGroup'

@description('Kurzname, wird in alle Ressourcennamen eingebaut (nur Kleinbuchstaben/Ziffern).')
@maxLength(9)
param name string = 'klangwerk'

@description('Region. Nur Regionen, die dein Abo erlaubt (Richtlinien prüfen).')
param location string = resourceGroup().location

@description('Region für MySQL (manche Abos erlauben MySQL nur in bestimmten Regionen).')
param mysqlLocation string = location

@description('Admin-Benutzer der MySQL-Datenbank.')
param mysqlAdmin string = 'kwadmin'

@secure()
@description('Admin-Kennwort der MySQL-Datenbank.')
param mysqlPassword string

@secure()
@description('Kennwort für den Redis-Container.')
param redisPassword string = newGuid()

@description('Deine öffentliche IP für Migration und Lasttest (Firewall der MySQL). Leer = keine Regel.')
param clientIp string = ''

@description('Mailadresse für die Budget-Alarme.')
param budgetEmail string

@description('Erster Tag des Monats, ab dem das Budget gilt (yyyy-MM-01).')
param budgetStart string = utcNow('yyyy-MM-01')

@description('Schritt 2: Container Apps (Redis, Functions, Shop) anlegen.')
param deployApps bool = false

@description('Image-Tag für shop und functions.')
param imageTag string = 'v1'

@description('Rate-Limit pro IP und Sekunde. Für den Lasttest hochsetzen (alle k6-Käufer kommen von einer IP).')
param rateLimitIp string = '300'

@description('Optional: nur diese Konten dürfen ins Admin (kommagetrennt). Leer = jedes Konto im Tenant.')
param adminEmails string = ''

var suffix = uniqueString(resourceGroup().id)
var tags = { projekt: 'klangwerk', zweck: 'pruefung' }

// ---------- Identität (kein Schlüssel im Code, Zugriff auf Storage und Registry per Managed Identity) ----------
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${name}'
  location: location
  tags: tags
}

// ---------- Container Registry (Basic) ----------
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acr${name}${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, 'acrpull')
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

// ---------- Storage: Queue „bestellungen“, Blob „tickets“ und „bilder“ ----------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${name}${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // nur Managed Identity
    supportsHttpsTrafficOnly: true
  }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource queue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'bestellungen'
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource ticketsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'tickets'
}

resource bilderContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'bilder'
}

var storageRollen = {
  blobOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Storage Blob Data Owner (Functions-Host braucht Leases)
  queueContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
}

resource storageRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for rolle in items(storageRollen): {
    name: guid(storage.id, identity.id, rolle.value)
    scope: storage
    properties: {
      principalId: identity.properties.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', rolle.value)
    }
  }
]

// ---------- MySQL Flexible Server (verwaltete Datenbank) ----------
resource mysql 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: 'mysql-${name}-${suffix}'
  location: mysqlLocation
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '8.0.21'
    administratorLogin: mysqlAdmin
    administratorLoginPassword: mysqlPassword
    storage: { storageSizeGB: 20, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource mysqlDb 'Microsoft.DBforMySQL/flexibleServers/databases@2023-12-30' = {
  parent: mysql
  name: 'klangwerk'
  properties: { charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }
}

// Zugriff aus Azure-Diensten (Container Apps). Für eine Produktion: VNet-Integration statt öffentlichem Zugang.
resource mysqlAzure 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2023-12-30' = {
  parent: mysql
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource mysqlClient 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2023-12-30' = if (!empty(clientIp)) {
  parent: mysql
  name: 'Migration'
  properties: { startIpAddress: clientIp, endIpAddress: clientIp }
}

// ---------- Azure Communication Services – Mailversand ----------
resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: 'email-${name}-${suffix}'
  location: 'global'
  tags: tags
  properties: { dataLocation: 'Europe' }
}

resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: { domainManagement: 'AzureManaged', userEngagementTracking: 'Disabled' }
}

resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: 'acs-${name}-${suffix}'
  location: 'global'
  tags: tags
  properties: { dataLocation: 'Europe', linkedDomains: [emailDomain.id] }
}

// ---------- Logs (mit Tageslimit, damit sie nichts kosten) ----------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${name}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}

// ---------- Container-Apps-Umgebung im eigenen VNet (nötig für TCP-Ingress zu Redis) ----------
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'vnet-${name}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'aca'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [{ name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
    ]
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${name}'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: { infrastructureSubnetId: vnet.properties.subnets[0].id, internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

// ---------- Budget mit Alarmen bei 10 $ und 20 $ ----------
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-pruefung'
  properties: {
    category: 'Cost'
    amount: 30
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStart }
    notifications: {
      bei10: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 33, thresholdType: 'Actual', contactEmails: [budgetEmail] }
      bei20: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 67, thresholdType: 'Actual', contactEmails: [budgetEmail] }
    }
  }
}

// ================= Schritt 2: Apps =================
var dbUrl = 'mysql://${mysqlAdmin}:${uriComponent(mysqlPassword)}@${mysql.properties.fullyQualifiedDomainName}:3306/klangwerk?ssl=true'
var redisUrl = 'redis://:${redisPassword}@redis-${name}:6379'

// Redis als Container: 1 Replik, kein Scale-to-zero, nur intern per TCP erreichbar.
resource redis 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: 'redis-${name}'
  location: location
  tags: tags
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      secrets: [{ name: 'redis-password', value: redisPassword }]
      ingress: { external: false, transport: 'tcp', targetPort: 6379, exposedPort: 6379 }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'docker.io/library/redis:7-alpine'
          command: ['sh', '-c', 'exec redis-server --requirepass "$REDIS_PASSWORD" --save "" --appendonly no --maxmemory 400mb']
          env: [{ name: 'REDIS_PASSWORD', secretRef: 'redis-password' }]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

var gemeinsameEnv = [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'REDIS_URL', secretRef: 'redis-url' }
  { name: 'STORAGE_ACCOUNT_NAME', value: storage.name }
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
]

// Functions in derselben Container-Apps-Umgebung (Azure Functions on Azure Container Apps).
resource functions 'Microsoft.Web/sites@2024-04-01' = if (deployApps) {
  name: 'func-${name}-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux,container,azurecontainerapps'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: env.id
    workloadProfileName: 'Consumption'
    resourceConfig: { cpu: json('0.5'), memory: '1Gi' }
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/kw-functions:${imageTag}'
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: identity.id
      minimumElasticInstanceCount: 1 // Timer „aufraeumen“ alle 5 s braucht eine laufende Instanz
      functionAppScaleLimit: 10
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: identity.properties.clientId }
        { name: 'BestellQueue__queueServiceUri', value: storage.properties.primaryEndpoints.queue }
        { name: 'BestellQueue__credential', value: 'managedidentity' }
        { name: 'BestellQueue__clientId', value: identity.properties.clientId }
        { name: 'STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
        { name: 'DATABASE_URL', value: dbUrl }
        { name: 'REDIS_URL', value: redisUrl }
        { name: 'ACS_CONNECTION_STRING', value: acs.listKeys().primaryConnectionString }
        { name: 'MAIL_ABSENDER', value: 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}' }
        { name: 'RATE_LIMIT_IP', value: rateLimitIp }
        { name: 'NODE_ENV', value: 'production' }
      ]
    }
  }
  dependsOn: [acrPull, storageRoles, redis]
}

resource shop 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: 'shop-${name}'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Multiple' // Updates ohne Ausfallzeit: neue Revision, dann Traffic umschalten
      ingress: { external: true, targetPort: 3000, transport: 'auto', traffic: [{ latestRevision: true, weight: 100 }] }
      registries: [{ server: acr.properties.loginServer, identity: identity.id }]
      secrets: [
        { name: 'database-url', value: dbUrl }
        { name: 'redis-url', value: redisUrl }
      ]
    }
    template: {
      containers: [
        {
          name: 'shop'
          image: '${acr.properties.loginServer}/kw-shop:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(gemeinsameEnv, [
            { name: 'FUNCTIONS_URL', value: 'https://${functions!.properties.defaultHostName}' }
            { name: 'ADMIN_EMAILS', value: adminEmails }
          ])
          probes: [{ type: 'Readiness', httpGet: { path: '/shop', port: 3000 }, periodSeconds: 10 }]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 10
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
  dependsOn: [acrPull, storageRoles]
}

output resourceGroup string = resourceGroup().name
output registry string = acr.name
output registryServer string = acr.properties.loginServer
output mysqlHost string = mysql.properties.fullyQualifiedDomainName
output storageAccount string = storage.name
output mailAbsender string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
output shopUrl string = deployApps ? 'https://${shop!.properties.configuration.ingress.fqdn}' : ''
output functionsUrl string = deployApps ? 'https://${functions!.properties.defaultHostName}' : ''
