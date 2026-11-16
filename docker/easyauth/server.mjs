// Lokaler Ersatz für Container-Apps-Ingress + Easy Auth (Entra ID).
// Verhalten wie in Azure:
//  - Reverse Proxy vor dem Shop, hängt die Client-IP an X-Forwarded-For an
//  - entfernt von außen gesendete x-ms-client-principal*-Header (nicht fälschbar)
//  - /.auth/login/aad zeigt eine Login-Seite (statt Microsoft-Login), /.auth/logout meldet ab
//  - angemeldete Anfragen bekommen x-ms-client-principal-name (+ -id) wie bei Easy Auth
//  - nicht angemeldete Anfragen gehen durch („Anonymen Zugriff zulassen“)
import http from "node:http";
import { randomUUID } from "node:crypto";

const ZIEL = new URL(process.env.UPSTREAM ?? "http://shop:3000");
const PORT = Number(process.env.PORT ?? 3000);
const sitzungen = new Map(); // token -> { name, id }

const cookie = (req, name) =>
  (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];

function loginSeite(res, ziel) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="de"><meta name="viewport" content="width=device-width">
<title>Anmelden (lokal)</title>
<body style="font-family:system-ui;background:#f5f5f4;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="post" style="background:#fff;padding:32px;border-radius:12px;box-shadow:0 1px 3px #0002;display:grid;gap:12px;width:320px">
<strong style="font-size:20px">Microsoft Entra ID</strong>
<span style="color:#666;font-size:13px">Lokale Nachbildung von Easy Auth. In Azure erscheint hier der echte Microsoft-Login.</span>
<input name="email" type="email" required placeholder="admin@klangwerk.test" value="admin@klangwerk.test" style="padding:8px;border:1px solid #ccc;border-radius:6px">
<input type="hidden" name="ziel" value="${ziel.replace(/"/g, "")}">
<button style="padding:9px;background:#0f766e;color:#fff;border:0;border-radius:6px">Anmelden</button>
</form></body></html>`);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://lokal");
    if (url.pathname === "/.auth/login/aad") {
      if (req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        const f = new URLSearchParams(body);
        const token = randomUUID();
        sitzungen.set(token, { name: f.get("email") ?? "admin@klangwerk.test", id: randomUUID() });
        const ziel = (f.get("ziel") || "/").startsWith("/") ? f.get("ziel") || "/" : "/";
        res.writeHead(302, { location: ziel, "set-cookie": `AppServiceAuthSession=${token}; Path=/; HttpOnly; SameSite=Lax` });
        return res.end();
      }
      return loginSeite(res, url.searchParams.get("post_login_redirect_uri") ?? "/");
    }
    if (url.pathname === "/.auth/logout") {
      sitzungen.delete(cookie(req, "AppServiceAuthSession"));
      res.writeHead(302, { location: "/", "set-cookie": "AppServiceAuthSession=; Path=/; Max-Age=0" });
      return res.end();
    }
    if (url.pathname === "/.auth/me") {
      const s = sitzungen.get(cookie(req, "AppServiceAuthSession"));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(s ? [{ provider_name: "aad", user_id: s.name }] : []));
    }

    const headers = { ...req.headers };
    for (const h of Object.keys(headers)) if (h.startsWith("x-ms-client-principal")) delete headers[h];
    const s = sitzungen.get(cookie(req, "AppServiceAuthSession"));
    if (s) {
      headers["x-ms-client-principal-name"] = s.name;
      headers["x-ms-client-principal-id"] = s.id;
      headers["x-ms-client-principal-idp"] = "aad";
    }
    const ip = (req.socket.remoteAddress ?? "").replace("::ffff:", "");
    headers["x-forwarded-for"] = headers["x-forwarded-for"] ? `${headers["x-forwarded-for"]}, ${ip}` : ip;
    headers["x-forwarded-proto"] = "http";
    headers["x-forwarded-host"] = req.headers.host ?? "";

    const p = http.request({ hostname: ZIEL.hostname, port: ZIEL.port, path: req.url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    p.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("Shop nicht erreichbar");
    });
    req.pipe(p);
  })
  .listen(PORT, () => console.log(`Ingress + Easy Auth (lokal) auf :${PORT} -> ${ZIEL.href}`));
