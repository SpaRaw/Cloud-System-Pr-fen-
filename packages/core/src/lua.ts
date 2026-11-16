// Alle Zustandsübergänge der Ticketplätze laufen als Lua-Skript in Redis.
// Redis führt ein Skript atomar aus: Kein anderer Befehl kann dazwischen.
// Dadurch kann ein Platz nie zweimal reserviert werden.
//
// Schlüssel je Event E (Hash-Tag {E} hält alles im selben Slot):
//   kw:{E}:meta        Hash   gesamt, bis (ms)                  – existiert nur nach Init
//   kw:{E}:plaetze     Hash   platz_nr -> 0 frei | 1 reserviert | 2 in Zahlung | 3 verkauft
//   kw:{E}:frei        Set    freie platz_nr (schnelles Ziehen)
//   kw:{E}:ablauf      ZSet   reservierungs_id -> Ablauf (ms) für Zustand 1 und 2
//   kw:{E}:res:<rid>   Hash   sid, plaetze, status, ablauf, anzahl, name, email
//   kw:{E}:sid:<sid>   String reservierungs_id der Session
//   kw:{E}:info:<sid>  String letzter Endzustand (abgelaufen | abgebrochen)
//   kw:{E}:wq          ZSet   Warteschlange sid -> Beitrittszeit (Reihenfolge)
//   kw:{E}:wq:anz      Hash   sid -> gewünschte Anzahl
//   kw:{E}:wq:rid      Hash   sid -> vorab vergebene reservierungs_id
//   kw:{E}:wq:seen     ZSet   sid -> letztes Polling (ms)
//   kw:{E}:wq:kopf     String "sid|seit" – wer wie lange an der Spitze steht
//   kw:{E}:outbox      ZSet   bestellungs_id -> Zeitpunkt der Bestätigung (bis MySQL quittiert)
//
// KEYS[1] = Präfix "kw:{E}:"  ·  ARGV[1] = jetzt (ms)  ·  ARGV[2..] = je Skript

const prelude = `
local P = KEYS[1]
local NOW = tonumber(ARGV[1])
local CFG = cjson.decode(ARGV[2])
local function k(s) return P .. s end

local function wq_entfernen(sid)
  redis.call('ZREM', k('wq'), sid)
  redis.call('HDEL', k('wq:anz'), sid)
  redis.call('HDEL', k('wq:rid'), sid)
  redis.call('ZREM', k('wq:seen'), sid)
end

local function setze_plaetze(liste, zustand)
  for p in string.gmatch(liste, '[^,]+') do redis.call('HSET', k('plaetze'), p, zustand) end
end

local function freigeben(rid, grund)
  local rk = k('res:' .. rid)
  local liste = redis.call('HGET', rk, 'plaetze')
  redis.call('ZREM', k('ablauf'), rid)
  if not liste then return 0 end
  for p in string.gmatch(liste, '[^,]+') do
    redis.call('HSET', k('plaetze'), p, '0')
    redis.call('SADD', k('frei'), p)
  end
  local sid = redis.call('HGET', rk, 'sid')
  if sid then
    if redis.call('GET', k('sid:' .. sid)) == rid then redis.call('DEL', k('sid:' .. sid)) end
    redis.call('SET', k('info:' .. sid), grund, 'EX', 300)
  end
  redis.call('DEL', rk)
  return 1
end

local function abgelaufene_freigeben()
  local ids = redis.call('ZRANGEBYSCORE', k('ablauf'), '-inf', NOW, 'LIMIT', 0, 200)
  for _, rid in ipairs(ids) do freigeben(rid, 'abgelaufen') end
  return #ids
end

local function reservieren(sid, n, rid)
  local gezogen = redis.call('SPOP', k('frei'), n)
  table.sort(gezogen, function(a, b) return tonumber(a) < tonumber(b) end)
  local liste = table.concat(gezogen, ',')
  setze_plaetze(liste, '1')
  local ablauf = NOW + CFG.reservierungMs
  redis.call('HSET', k('res:' .. rid), 'sid', sid, 'plaetze', liste, 'status', '1', 'ablauf', ablauf, 'anzahl', n)
  redis.call('ZADD', k('ablauf'), ablauf, rid)
  redis.call('SET', k('sid:' .. sid), rid)
  redis.call('DEL', k('info:' .. sid))
end

local function ausverkauft()
  return redis.call('SCARD', k('frei')) == 0 and redis.call('ZCARD', k('ablauf')) == 0
end

-- First-Fit über die Warteschlange. Steht jemand länger als CFG.spitzeMs an der Spitze,
-- wird er nicht mehr übersprungen (Schutz gegen Verhungern großer Bestellungen).
local function zuteilen()
  local alt = redis.call('ZRANGEBYSCORE', k('wq:seen'), '-inf', NOW - CFG.warteTimeoutMs)
  for _, s in ipairs(alt) do wq_entfernen(s) end

  local kopf = redis.call('ZRANGE', k('wq'), 0, 0)[1]
  if not kopf then redis.call('DEL', k('wq:kopf')) return 0 end
  local seit = NOW
  local kv = redis.call('GET', k('wq:kopf'))
  if kv then
    local ks, kt = string.match(kv, '^(.*)|(%d+)$')
    if ks == kopf then seit = tonumber(kt) end
  end
  redis.call('SET', k('wq:kopf'), kopf .. '|' .. seit)

  local frei = redis.call('SCARD', k('frei'))
  if frei == 0 then return 0 end
  local strikt = (NOW - seit) > CFG.spitzeMs
  local kandidaten = redis.call('ZRANGE', k('wq'), 0, CFG.scanBreite - 1)
  local zugeteilt = 0
  for _, s in ipairs(kandidaten) do
    local n = tonumber(redis.call('HGET', k('wq:anz'), s) or '1')
    if n <= frei then
      reservieren(s, n, redis.call('HGET', k('wq:rid'), s))
      wq_entfernen(s)
      frei = frei - n
      zugeteilt = zugeteilt + 1
      if frei == 0 then break end
    elseif strikt and s == kopf then
      break
    end
  end
  return zugeteilt
end

-- Antwort: { zustand, frei, a, b, c }
local function status(sid)
  local frei = redis.call('SCARD', k('frei'))
  local rid = redis.call('GET', k('sid:' .. sid))
  if rid then
    local r = redis.call('HMGET', k('res:' .. rid), 'status', 'plaetze', 'ablauf')
    if r[1] == '1' then return { 'reserviert', frei, rid, r[2], r[3] } end
    if r[1] == '2' then return { 'zahlung', frei, rid, r[2], r[3] } end
    if r[1] == '3' then return { 'verkauft', frei, rid, r[2], '0' } end
  end
  local rang = redis.call('ZRANK', k('wq'), sid)
  if rang then
    if ausverkauft() then wq_entfernen(sid) return { 'ausverkauft', frei } end
    -- Heuristik: Die älteste Reservierung läuft zuerst ab. Wer auf Position p steht,
    -- kommt wahrscheinlich dran, wenn die p-älteste Reservierung abläuft.
    local schaetzung = -1
    local e = redis.call('ZRANGE', k('ablauf'), rang, rang, 'WITHSCORES')
    if e[2] then schaetzung = math.max(0, tonumber(e[2]) - NOW) end
    local n = redis.call('HGET', k('wq:anz'), sid) or '1'
    return { 'wartend', frei, tostring(rang + 1), tostring(schaetzung), n }
  end
  local info = redis.call('GET', k('info:' .. sid))
  if info then return { info, frei } end
  if ausverkauft() then return { 'ausverkauft', frei } end
  return { 'keine', frei }
end

local function initialisiert()
  return redis.call('EXISTS', k('meta')) == 1
end
`;

/** ARGV: jetzt, cfg, gesamt, bis, ...verkaufte platz_nr */
export const LUA_INIT = `
local P = KEYS[1]
local function k(s) return P .. s end
if redis.call('EXISTS', k('meta')) == 1 then return 0 end
local gesamt = tonumber(ARGV[3])
local verkauft = {}
for i = 5, #ARGV do verkauft[ARGV[i]] = true end
redis.call('DEL', k('plaetze'), k('frei'), k('ablauf'))
local frei = {}
for p = 1, gesamt do
  local s = tostring(p)
  if verkauft[s] then
    redis.call('HSET', k('plaetze'), s, '3')
  else
    redis.call('HSET', k('plaetze'), s, '0')
    frei[#frei + 1] = s
    if #frei >= 5000 then redis.call('SADD', k('frei'), unpack(frei)) frei = {} end
  end
end
if #frei > 0 then redis.call('SADD', k('frei'), unpack(frei)) end
redis.call('HSET', k('meta'), 'gesamt', gesamt, 'bis', ARGV[4])
return 1
`;

/** ARGV: jetzt, cfg, sid, anzahl, neue_rid */
export const LUA_RESERVIEREN =
  prelude +
  `
if not initialisiert() then return { 'init', 0 } end
if NOW > tonumber(redis.call('HGET', k('meta'), 'bis')) then return { 'nicht_im_verkauf', 0 } end
local sid, n, rid = ARGV[3], tonumber(ARGV[4]), ARGV[5]
abgelaufene_freigeben()

local vorhanden = redis.call('GET', k('sid:' .. sid))
if vorhanden then
  local st = redis.call('HGET', k('res:' .. vorhanden), 'status')
  if st == '3' or not st then redis.call('DEL', k('sid:' .. sid)) else return status(sid) end
end
if redis.call('ZSCORE', k('wq'), sid) then
  redis.call('ZADD', k('wq:seen'), NOW, sid)
  return status(sid)
end
if ausverkauft() then return { 'ausverkauft', 0 } end

-- Jeder Kauf startet in der Warteschlange. Ist genug frei, teilt zuteilen() sofort zu,
-- der Kunde merkt dann nichts von der Schlange.
redis.call('ZADD', k('wq'), NOW, sid)
redis.call('HSET', k('wq:anz'), sid, n)
redis.call('HSET', k('wq:rid'), sid, rid)
redis.call('ZADD', k('wq:seen'), NOW, sid)
redis.call('DEL', k('info:' .. sid))
zuteilen()
return status(sid)
`;

/** ARGV: jetzt, cfg, sid  – Polling (1 s). Hält den Platz in der Schlange am Leben. */
export const LUA_STATUS =
  prelude +
  `
if not initialisiert() then return { 'init', 0 } end
local sid = ARGV[3]
abgelaufene_freigeben()
if redis.call('ZSCORE', k('wq'), sid) then redis.call('ZADD', k('wq:seen'), NOW, sid) end
zuteilen()
return status(sid)
`;

/** ARGV: jetzt, cfg, sid, name, email  – „zahlungspflichtig bestellen“: 1 -> 2 */
export const LUA_BESTELLEN =
  prelude +
  `
if not initialisiert() then return { 'init', 0 } end
local sid = ARGV[3]
abgelaufene_freigeben()
local rid = redis.call('GET', k('sid:' .. sid))
if not rid then return status(sid) end
local rk = k('res:' .. rid)
local st = redis.call('HGET', rk, 'status')
if st ~= '1' then return status(sid) end
local liste = redis.call('HGET', rk, 'plaetze')
local ablauf = NOW + CFG.zahlungMs
setze_plaetze(liste, '2')
redis.call('HSET', rk, 'status', '2', 'ablauf', ablauf, 'name', ARGV[4], 'email', ARGV[5])
redis.call('ZADD', k('ablauf'), ablauf, rid)
return status(sid)
`;

/** ARGV: jetzt, cfg, sid  – Zahlung bestätigt: 2 -> 3, Eintrag in die Outbox.
 *  Antwort bei Erfolg: { 'verkauft', frei, rid, plaetze, '0', name, email } */
export const LUA_BESTAETIGEN =
  prelude +
  `
if not initialisiert() then return { 'init', 0 } end
local sid = ARGV[3]
abgelaufene_freigeben()
local rid = redis.call('GET', k('sid:' .. sid))
if not rid then return status(sid) end
local rk = k('res:' .. rid)
local r = redis.call('HMGET', rk, 'status', 'plaetze', 'name', 'email')
if r[1] == '2' then
  setze_plaetze(r[2], '3')
  redis.call('HSET', rk, 'status', '3')
  redis.call('ZREM', k('ablauf'), rid)
  redis.call('ZADD', k('outbox'), NOW, rid)
elseif r[1] ~= '3' then
  return status(sid)
end
return { 'verkauft', redis.call('SCARD', k('frei')), rid, r[2], '0', r[3], r[4] }
`;

/** ARGV: jetzt, cfg, sid  – Abbrechen in Zustand 1 oder 2, oder Warteschlange verlassen. */
export const LUA_ABBRECHEN =
  prelude +
  `
if not initialisiert() then return { 'init', 0 } end
local sid = ARGV[3]
local rid = redis.call('GET', k('sid:' .. sid))
if rid then
  local st = redis.call('HGET', k('res:' .. rid), 'status')
  if st == '1' or st == '2' then freigeben(rid, 'abgebrochen') end
end
if redis.call('ZSCORE', k('wq'), sid) then
  wq_entfernen(sid)
  redis.call('SET', k('info:' .. sid), 'abgebrochen', 'EX', 300)
end
abgelaufene_freigeben()
zuteilen()
return status(sid)
`;

/** ARGV: jetzt, cfg, outbox_alter_ms  – Timer: Abgelaufenes freigeben, zuteilen,
 *  hängende Outbox-Einträge zurückgeben (werden erneut in die Queue gelegt). */
export const LUA_AUFRAEUMEN =
  prelude +
  `
if not initialisiert() then return { 0, 0, {} } end
local freigegeben = 0
repeat
  local n = abgelaufene_freigeben()
  freigegeben = freigegeben + n
until n < 200
local zugeteilt = zuteilen()
local haengend = redis.call('ZRANGEBYSCORE', k('outbox'), '-inf', NOW - tonumber(ARGV[3]), 'LIMIT', 0, 100)
return { freigegeben, zugeteilt, haengend }
`;
