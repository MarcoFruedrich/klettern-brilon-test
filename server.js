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
let dbPool = null; // Mit DATABASE_URL: Postgres statt flüchtiger lokaler JSON-Datei.
// Für öffentliches Hosting: Zugangsdaten ausschließlich über die geheimen Server-Umgebungsvariablen.
const ENV_ADMIN_USER = process.env.ADMIN_USERNAME || '';
const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const HAS_ENV_AUTH = Boolean(ENV_ADMIN_USER && ENV_ADMIN_PASSWORD);
const ENV_PASSWORD_HASH = HAS_ENV_AUTH ? crypto.scryptSync(ENV_ADMIN_PASSWORD, 'brilon-server-login-v1', 64) : null;
// Gruppenpreis-Matrix. Leere Beträge bedeuten „Preis auf Anfrage“.
const DEFAULT_PRICES = {
  published:true,
  tiers:[{max:5,duration:'ca. 2,5 Stunden'},{max:10,duration:'ca. 3 Stunden'},{max:15,duration:'ca. 3,5 Stunden'}],
  programs:[
    {id:'toprope',name:'Toprope-Klettern',prices:['','','']},
    {id:'bouldern',name:'Bouldern',prices:['','','']},
    {id:'pusiken',name:'Pusiken – Seilaufstieg',prices:['','','']},
    {id:'abseilen',name:'Kontrolliertes Abseilen',prices:['','','']},
    {id:'stationen',name:'Erlebnis- und Teamstationen',prices:['','','']},
    {id:'mix',name:'Kletter- und Erlebnisprogramm',prices:['','','']}
  ],
  birthday:{price:'',duration:'ca. 3 Stunden'}
};
const copyDefaults=()=>JSON.parse(JSON.stringify(DEFAULT_PRICES));
function priceValue(raw) {
 if(raw===null||raw===undefined||String(raw).trim()==='')return '';
 const value=String(raw).trim().replace(',','.');
 if(!/^(?:[1-9]\d{0,4}|0)(?:\.\d{1,2})?$/.test(value) || Number(value)<=0 || Number(value)>99999)throw Error('Preis muss eine positive Zahl bis 99.999,00 sein.');
 return Number(value).toFixed(2);
}
function validatePrices(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Ungültige Preisdaten.');
 if(typeof raw.published!=='boolean')throw Error('Veröffentlichung bitte festlegen.');
 if(!Array.isArray(raw.tiers)||raw.tiers.length!==3)throw Error('Genau drei Gruppenstufen sind erforderlich.');
 let last=0;
 const tiers=raw.tiers.map((tier)=>{
  const max=Number(tier?.max),duration=String(tier?.duration??'').trim();
  if(!Number.isInteger(max)||max<=last||max>500)throw Error('Gruppengrenzen müssen aufsteigend zwischen 1 und 500 sein.');
  if(duration.length>80)throw Error('Zeitangabe zu lang.');last=max;return {max,duration};
 });
 if(!Array.isArray(raw.programs)||raw.programs.length<1||raw.programs.length>16)throw Error('Bitte 1 bis 16 Programmblöcke anlegen.');
 const ids=new Set(),names=new Set();
 const programs=raw.programs.map(pr=>{
  const id=String(pr?.id??''),name=String(pr?.name??'').trim();
  if(!/^[a-z0-9_-]{2,36}$/.test(id)||ids.has(id))throw Error('Programm-ID fehlt oder ist doppelt.');ids.add(id);
  if(!name||name.length>70||names.has(name.toLowerCase()))throw Error('Programmname fehlt oder ist doppelt.');names.add(name.toLowerCase());
  if(!Array.isArray(pr.prices)||pr.prices.length!==3)throw Error('Jeder Programmblock braucht drei Preisfelder.');
  return {id,name,prices:pr.prices.map(priceValue)};
 });
 const duration=String(raw.birthday?.duration??'').trim();if(duration.length>80)throw Error('Geburtstagsdauer zu lang.');
 return {published:raw.published,tiers,programs,birthday:{price:priceValue(raw.birthday?.price),duration}};
}
async function loadPrices(){
 if(dbPool){const {rows}=await dbPool.query("SELECT data FROM brilon_settings WHERE id='preise'");return rows.length?rows[0].data:copyDefaults();}
 return readJson('preise.json',copyDefaults());
}
async function savePrices(value){
 if(dbPool)await dbPool.query("INSERT INTO brilon_settings(id,data) VALUES('preise',$1::jsonb) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",[JSON.stringify(value)]);
 else atomicJson('preise.json',value);
}
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
async function loadActions(){
 if (dbPool) { const {rows}=await dbPool.query('SELECT data FROM brilon_aktionen ORDER BY created_at, id'); return rows.map(r=>r.data); }
 const actions=readJson('aktionen.json',[]);
 if(!Array.isArray(actions))throw Error('Angebotsdatei ist beschädigt.');
 return actions;
}
async function createActionRecord(a, actions){
 if(dbPool) await dbPool.query('INSERT INTO brilon_aktionen (id, data) VALUES ($1, $2::jsonb)',[a.id,JSON.stringify(a)]);
 else atomicJson('aktionen.json',[...actions,a]);
}
async function updateActionRecord(id,a,actions,index){
 if(dbPool) await dbPool.query('UPDATE brilon_aktionen SET data=$2::jsonb, updated_at=NOW() WHERE id=$1',[id,JSON.stringify(a)]);
 else {actions[index]=a;atomicJson('aktionen.json',actions);}
}
async function deleteActionRecord(id,actions,index){
 if(dbPool) await dbPool.query('DELETE FROM brilon_aktionen WHERE id=$1',[id]);
 else {actions.splice(index,1);atomicJson('aktionen.json',actions);}
}
async function restoreActionRecords(actions){
 if(dbPool){
  const client=await dbPool.connect();
  try{
   await client.query('BEGIN');
   await client.query('DELETE FROM brilon_aktionen');
   for(const a of actions)await client.query('INSERT INTO brilon_aktionen (id,data) VALUES ($1,$2::jsonb)',[a.id,JSON.stringify(a)]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 } else atomicJson('aktionen.json',actions);
}
function validateBackup(raw){
 if(!Array.isArray(raw)||raw.length>200)throw Error('Die Sicherung enthält zu viele oder ungültige Angebote.');
 const ids=new Set();
 return raw.map(a=>{
  if(!a||typeof a.id!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id)))throw Error('Ungültige Angebots-ID in der Sicherung.');
  if(ids.has(a.id))throw Error('Doppelte Angebots-ID in der Sicherung.');ids.add(a.id);
  return {id:a.id,...validateAction(a)};
 });
}
async function initializeDatabase(){
 if(!process.env.DATABASE_URL){console.log('Speicherung: lokal (nicht dauerhaft auf Render Free).');return;}
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:15000,idleTimeoutMillis:10000});
 pool.on('error',err=>console.error('Postgres-Verbindungsfehler:',err.code||err.message));
 try{
  await pool.query('CREATE TABLE IF NOT EXISTS brilon_aktionen (id UUID PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('CREATE TABLE IF NOT EXISTS brilon_settings (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
 }catch(err){await pool.end();throw err;}
 dbPool=pool;
 console.log('Speicherung: externe PostgreSQL-Datenbank verbunden.');
}
function getCookie(req){const header=req.headers.cookie||'';for(const c of header.split(';')){const idx=c.indexOf('=');if(idx!==-1&&c.slice(0,idx).trim()===COOKIE)return c.slice(idx+1).trim();}return '';}
function loggedIn(req){const sid=getCookie(req);if(!/^[a-f0-9]{64}$/.test(sid))return false;const key=crypto.createHash('sha256').update(sid).digest('hex');const s=sessions.get(key);if(!s)return false;if(s.expires<Date.now()){sessions.delete(key);return false;}return true;}
function cookie(value, expired=false){return `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${expired?0:21600}${IS_PRODUCTION?'; Secure':''}`;}
function checkMutation(req){if(req.headers['x-brilon-admin']!=='1')return false;const origin=req.headers.origin;if(!origin)return true;try{const orig=new URL(origin);return orig.host===req.headers.host&&(orig.protocol==='https:'||(!IS_PRODUCTION&&orig.protocol==='http:'));}catch{return false;}}
function cleanup(){for(const [key,s] of sessions)if(s.expires<Date.now())sessions.delete(key);for(const [key,attempt] of loginAttempts)if(Date.now()-attempt.started>ATTEMPT_WINDOW_MS)loginAttempts.delete(key);}
async function body(req,maxBytes=20000){return new Promise((resolve,reject)=>{let chunks=[],total=0,failed=false;req.on('data',c=>{total+=c.length;if(total>maxBytes){failed=true;reject(Error('Eingabe ist zu groß.'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('Ungültige JSON-Daten.'));}});req.on('error',reject);});}
function safeStatic(res, file, cache='public, max-age=600') {try{const stat=fs.statSync(file);if(!stat.isFile())return text(res,404,'Nicht gefunden.');const ext=path.extname(file).toLowerCase();if(!MIME[ext])return text(res,404,'Nicht gefunden.');res.writeHead(200,{'Content-Type':MIME[ext], 'Content-Length':stat.size,'Cache-Control':cache,...security});fs.createReadStream(file).pipe(res);}catch{return text(res,404,'Nicht gefunden.');}}
async function handler(req,res){
 try {
  cleanup();
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  const pathname=decodeURIComponent(u.pathname);
  if(pathname==='/api/preise'&&req.method==='GET'){
    const prices=await loadPrices();const publicPrices=prices.published?prices:{...prices,programs:prices.programs.map(p=>({...p,prices:['','','']})),birthday:{...prices.birthday,price:''}};return json(res,200,{prices:loggedIn(req)?prices:publicPrices,storage:loggedIn(req)?(dbPool?'database':'temporary'):undefined});
  }
  if(pathname==='/api/preise'&&req.method==='PUT'){
    if(!loggedIn(req))return json(res,401,{error:'Bitte zuerst anmelden.'});
    if(!checkMutation(req))return json(res,403,{error:'Anfrage nicht erlaubt.'});
    const prices=validatePrices(await body(req,45000));await savePrices(prices);
    return json(res,200,{saved:true,prices});
  }
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
   if(req.method==='GET'&&pathname==='/api/aktionen')return json(res,200,{actions:await loadActions(),storage:dbPool?'database':'temporary'});
   if(!checkMutation(req))return json(res,403,{error:'Anfrage nicht erlaubt.'});
   if(req.method==='POST'&&pathname==='/api/aktionen/import'){
    const data=await body(req,700000);
    if(!data||data.confirm!=='ERSETZEN')return json(res,400,{error:'Bestätigung fehlt.'});
    const incoming=validateBackup(data.actions);
    await restoreActionRecords(incoming);
    return json(res,200,{imported:incoming.length});
   }
   const actions=await loadActions();
   if(req.method==='POST'&&pathname==='/api/aktionen'){
    if(actions.length>=200)return json(res,400,{error:'Es können höchstens 200 Aktionen gespeichert werden.'});
    const val=validateAction(await body(req));const a={id:crypto.randomUUID(),...val};await createActionRecord(a,actions);return json(res,201,{action:a});
   }
   const id=pathname.slice('/api/aktionen/'.length);const i=actions.findIndex(a=>a.id===id);
   if(i===-1)return json(res,404,{error:'Angebot nicht gefunden.'});
   if(req.method==='PUT'){const val=validateAction(await body(req));const updated={id,...val};await updateActionRecord(id,updated,actions,i);return json(res,200,{action:updated});}
   if(req.method==='DELETE'){await deleteActionRecord(id,actions,i);return json(res,200,{deleted:true});}
   return json(res,405,{error:'Methode nicht erlaubt.'});
  }
  if(pathname==='/aktionen-daten.js'&&req.method==='GET'){
   const all=(await loadActions()).filter(a=>a.published===true);
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
initializeDatabase()
 .then(()=>server.listen(PORT,HOST,()=>console.log(`Klettern Brilon bereit: http://${HOST}:${PORT}`)))
 .catch(err=>{console.error('Datenbank-Start fehlgeschlagen:',err.code||err.message);process.exitCode=1;});
