'use strict';
// Server für Klettern & Abenteuer Brilon. Benötigt Node.js >=20; keine npm-Pakete.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
const SITE = path.join(ROOT, 'site');
const DATA = path.join(ROOT, 'data');
const ADMIN = path.join(ROOT, 'admin');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE = 'brilon_sid';
const SESSION_MS = 6 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 6;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
// Für öffentliches Hosting: Zugangsdaten ausschließlich über die geheimen Server-Umgebungsvariablen.
const ENV_ADMIN_USER = process.env.ADMIN_USERNAME || '';
const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const HAS_ENV_AUTH = Boolean(ENV_ADMIN_USER && ENV_ADMIN_PASSWORD);
const ENV_PASSWORD_HASH = HAS_ENV_AUTH ? crypto.scryptSync(ENV_ADMIN_PASSWORD, 'brilon-server-login-v1', 64) : null;
const categories = new Set(['tag', 'special', 'ferien']);
const fields = {title:120, category:20, badge:40, startDate:10, endDate:10, startTime:5, endTime:5, minCount:8, maxCount:8, price:120, description:1600, details:500};
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.webp':'image/webp'};
const security = { 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin', 'X-Frame-Options':'DENY', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()' };
function json(res, status, obj, headers={}) {const b=Buffer.from(JSON.stringify(obj));res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...security,...headers});res.end(b);}
function text(res, status, content) {res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store',...security});res.end(content);}
function readJson(file, def) {try{return JSON.parse(fs.readFileSync(path.join(DATA,file),'utf8'));}catch(err){if(err.code==='ENOENT')return def; throw err;}}
function atomicJson(file, value) {const filename=path.join(DATA,file), tmp=filename+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,filename);}
function isDate(s) {if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false; const d=new Date(s+'T12:00:00Z');return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===s;}
function validateAction(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Bitte gültige Angebotsdaten übermitteln.');
 const a={};
 for(const [key,max] of Object.entries(fields)) {if(value[key]!=null&&typeof value[key]!=='string'&&typeof value[key]!=='number')throw Error('Ungültiges Feld: '+key); a[key]=String(value[key]??'').trim();if(a[key].length>max)throw Error('Feld zu lang: '+key);}
 if(!a.title||!a.description)throw Error('Bitte Titel und Beschreibung angeben.');
 if(!categories.has(a.category))throw Error('Bitte eine Angebotsart auswählen.');
 if(!isDate(a.startDate)||!isDate(a.endDate)||a.endDate<a.startDate)throw Error('Bitte einen gültigen Zeitraum angeben.');
 if(a.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.startTime))throw Error('Startzeit ungültig.');
 if(a.endTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.endTime))throw Error('Endzeit ungültig.');
 if(a.startTime&&a.endTime&&a.startDate===a.endDate&&a.endTime<=a.startTime)throw Error('Endzeit muss nach Startzeit liegen.');
 for(const k of ['minCount','maxCount']) if(a[k]&&(!/^\d+$/.test(a[k])||Number(a[k])<1||Number(a[k])>10000))throw Error('Teilnehmerzahl ungültig.');
 if(a.minCount&&a.maxCount&&Number(a.minCount)>Number(a.maxCount))throw Error('Mindestgröße ist größer als die Höchstgröße.');
 if(typeof value.published!=='boolean')throw Error('Veröffentlichungsstatus ungültig.');
 a.published=value.published;
 return a;
}
function loadActions(){const actions=readJson('aktionen.json',[]);if(!Array.isArray(actions))throw Error('Angebotsdatei ist beschädigt.');return actions;}
function getCookie(req){const header=req.headers.cookie||'';for(const c of header.split(';')){const idx=c.indexOf('=');if(idx!==-1&&c.slice(0,idx).trim()===COOKIE)return c.slice(idx+1).trim();}return '';}
function loggedIn(req){const sid=getCookie(req);if(!/^[a-f0-9]{64}$/.test(sid))return false;const key=crypto.createHash('sha256').update(sid).digest('hex');const s=sessions.get(key);if(!s)return false;if(s.expires<Date.now()){sessions.delete(key);return false;}return true;}
function cookie(value, expired=false){return `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${expired?0:21600}${IS_PRODUCTION?'; Secure':''}`;}
function checkMutation(req){if(req.headers['x-brilon-admin']!=='1')return false;const origin=req.headers.origin;if(!origin)return true;try{const orig=new URL(origin);return orig.host===req.headers.host&&(orig.protocol==='https:'||(!IS_PRODUCTION&&orig.protocol==='http:'));}catch{return false;}}
function cleanup(){for(const [key,s] of sessions)if(s.expires<Date.now())sessions.delete(key);for(const [key,attempt] of loginAttempts)if(Date.now()-attempt.started>ATTEMPT_WINDOW_MS)loginAttempts.delete(key);}
async function body(req){return new Promise((resolve,reject)=>{let chunks=[],total=0,failed=false;req.on('data',c=>{total+=c.length;if(total>20000){failed=true;reject(Error('Eingabe ist zu groß.'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('Ungültige JSON-Daten.'));}});req.on('error',reject);});}
function safeStatic(res, file, cache='public, max-age=600') {try{const stat=fs.statSync(file);if(!stat.isFile())return text(res,404,'Nicht gefunden.');const ext=path.extname(file).toLowerCase();if(!MIME[ext])return text(res,404,'Nicht gefunden.');res.writeHead(200,{'Content-Type':MIME[ext], 'Content-Length':stat.size,'Cache-Control':cache,...security});fs.createReadStream(file).pipe(res);}catch{return text(res,404,'Nicht gefunden.');}}
async function handler(req,res){
 try {
  cleanup();
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  const pathname=decodeURIComponent(u.pathname);
  if(pathname==='/api/session'&&req.method==='GET')return json(res,200,{loggedIn:loggedIn(req)});
  if(pathname==='/api/login'&&req.method==='POST'){
   if(!checkMutation(req))return json(res,403,{error:'Anfrage nicht erlaubt.'});
   const addr=req.socket.remoteAddress||'unknown', previous=loginAttempts.get(addr);
   if(previous&&Date.now()-previous.started<ATTEMPT_WINDOW_MS&&previous.count>=MAX_LOGIN_ATTEMPTS)return json(res,429,{error:'Zu viele Versuche. Bitte später erneut versuchen.'});
   const val=await body(req);
   if(typeof val.username!=='string'||typeof val.password!=='string'||val.password.length>512)return json(res,401,{error:'Anmeldung nicht möglich.'});
   let ok=false;
   if(HAS_ENV_AUTH){
    const candidate=crypto.scryptSync(val.password, 'brilon-server-login-v1', 64);
    const samePassword=crypto.timingSafeEqual(candidate,ENV_PASSWORD_HASH);
    ok=val.username===ENV_ADMIN_USER&&samePassword;
   } else {
    // Nur für ältere lokale Installationen mit vorhandenem privaten auth.json.
    const auth=readJson('auth.json',null);
    if(auth){const hash=crypto.scryptSync(val.password,Buffer.from(auth.salt,'hex'),64);
      const stored=Buffer.from(auth.hash,'hex');
      ok=val.username===auth.username&&stored.length===hash.length&&crypto.timingSafeEqual(hash,stored);}
   }
   if(!ok){const entry=previous&&Date.now()-previous.started<ATTEMPT_WINDOW_MS?previous:{count:0,started:Date.now()};entry.count++;loginAttempts.set(addr,entry);return json(res,401,{error:'Benutzername oder Passwort falsch.'});}
   loginAttempts.delete(addr);const id=crypto.randomBytes(32).toString('hex');sessions.set(crypto.createHash('sha256').update(id).digest('hex'),{expires:Date.now()+SESSION_MS});return json(res,200,{loggedIn:true},{'Set-Cookie':cookie(id)});
  }
  if(pathname==='/api/logout'&&req.method==='POST'){
   if(!checkMutation(req))return json(res,403,{error:'Anfrage nicht erlaubt.'});
   const id=getCookie(req);if(id)sessions.delete(crypto.createHash('sha256').update(id).digest('hex'));
   return json(res,200,{loggedIn:false},{'Set-Cookie':cookie('',true)});
  }
  if(pathname==='/api/aktionen'||pathname.startsWith('/api/aktionen/')){
   if(!loggedIn(req))return json(res,401,{error:'Bitte zuerst anmelden.'});
   if(req.method==='GET'&&pathname==='/api/aktionen')return json(res,200,{actions:loadActions()});
   if(!checkMutation(req))return json(res,403,{error:'Anfrage nicht erlaubt.'});
   const actions=loadActions();
   if(req.method==='POST'&&pathname==='/api/aktionen'){
    if(actions.length>=200)return json(res,400,{error:'Es können höchstens 200 Aktionen gespeichert werden.'});
    const val=validateAction(await body(req));const a={id:crypto.randomUUID(),...val};actions.push(a);atomicJson('aktionen.json',actions);return json(res,201,{action:a});
   }
   const id=pathname.slice('/api/aktionen/'.length);const i=actions.findIndex(a=>a.id===id);
   if(i===-1)return json(res,404,{error:'Angebot nicht gefunden.'});
   if(req.method==='PUT'){const val=validateAction(await body(req));actions[i]={id,...val};atomicJson('aktionen.json',actions);return json(res,200,{action:actions[i]});}
   if(req.method==='DELETE'){actions.splice(i,1);atomicJson('aktionen.json',actions);return json(res,200,{deleted:true});}
   return json(res,405,{error:'Methode nicht erlaubt.'});
  }
  if(pathname==='/aktionen-daten.js'&&req.method==='GET'){
   const all=loadActions().filter(a=>a.published===true);
   // JS-Datenquelle für bisheriges Frontend; keine Passwörter oder Entwürfe.
   const code='window.BRILON_AKTIONEN = '+JSON.stringify(all).replace(/</g,'\\u003c')+';\n';
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store',...security});return res.end(code);
  }
  if(pathname==='/verwaltung'||pathname==='/aktionen-verwaltung.html') {res.writeHead(302,{Location:'/verwaltung/',...security});return res.end();}
  if(pathname==='/verwaltung/'&&req.method==='GET')return safeStatic(res,path.join(ADMIN,'index.html'),'no-store');
  if((pathname==='/admin.js'||pathname==='/admin.css')&&req.method==='GET')return safeStatic(res,path.join(ADMIN,pathname.slice(1)),'no-store');
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Methode nicht erlaubt.'});
  if(pathname==='/')return safeStatic(res,path.join(SITE,'index.html'),'no-store');
  // Kein Directory-Traversal und keine Auslieferung der privaten Daten.
  const rel=pathname.replace(/^\/+/, '');
  const full=path.resolve(SITE,rel);
  if(!full.startsWith(SITE+path.sep))return text(res,404,'Nicht gefunden.');
  return safeStatic(res,full,path.extname(full)==='.html'?'no-store':'public, max-age=300');
 }catch(err){if(err.message&&/(Ungültig|ungültig|Bitte|Feld|muss|ist zu groß|größer|zu lang|Höchstgröße|Mindestgröße|Zeitraum|Teilnehmerzahl|Startzeit|Endzeit|Angebotsart)/.test(err.message))return json(res,400,{error:err.message});console.error('Serverfehler:',err.code||err.message);return json(res,500,{error:'Ein interner Fehler ist aufgetreten.'});}
}
fs.mkdirSync(DATA,{recursive:true});
if(!HAS_ENV_AUTH && !fs.existsSync(path.join(DATA,'auth.json'))) {console.error('Zugangsdaten fehlen: ADMIN_USERNAME und ADMIN_PASSWORD als Server-Umgebungsvariablen setzen.');process.exit(1);}
const server=http.createServer(handler);
server.listen(PORT,HOST,()=>console.log(`Klettern Brilon bereit: http://${HOST}:${PORT}`));
