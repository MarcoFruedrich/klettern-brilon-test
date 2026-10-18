'use strict';
(() => {
 const $=id=>document.getElementById(id), base='/api/aktionen';
 let actions=[], editing=null, busy=false;
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const fields=['title','category','badge','startDate','endDate','startTime','endTime','minCount','maxCount','price','description','details'];
 const categoryNames={tag:'Tagesangebot',special:'Sonderaktion',ferien:'Ferien & Gruppen'};
 const photos={tag:'/fotos/klettern.jpg',special:'/fotos/aktion.jpg',ferien:'/fotos/team.jpg'};
 const presets={tag:{title:'Offenes Tagesklettern',category:'tag',description:'Gemeinsam klettern und neue Herausforderungen ausprobieren. Teilnahme nur nach Anmeldung und persönlicher Bestätigung.',badge:'Tagesangebot'},special:{title:'Besonderes Kletter-Special',category:'special',description:'Eine Kletteraktion mit besonderen Herausforderungen, die individuell mit der Gruppe abgestimmt wird.',badge:'Special'},ferien:{title:'Klettern in den Ferien',category:'ferien',description:'Gemeinsam klettern, Neues ausprobieren und spannende Erlebnisse sammeln – mit Anleitung.',badge:'Ferienangebot'}};
 function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function msg(id,message,error=false){const el=$(id);el.textContent=message;el.classList.toggle('error',error);}
 function view(logged){$('loadingArea').hidden=true;$('loginArea').hidden=logged;$('dashboardArea').hidden=!logged;$('logoutBtn').hidden=!logged;if(!logged)$('password').value='';}
 async function request(url,opts={}){
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{'X-Brilon-Admin':'1',...(opts.body?{'Content-Type':'application/json'}:{})},...opts});
  let data;try{data=await r.json();}catch{throw Error('Der Server antwortet nicht korrekt.');}
  if(r.status===401&&url!=='/api/login'){view(false);throw Error('Sitzung abgelaufen. Bitte neu anmelden.');}
  if(!r.ok)throw Error(data.error||'Die Aktion konnte nicht ausgeführt werden.');return data;
 }
 async function load(){const data=await request(base);actions=data.actions;render();}
 async function init(){try{const sess=await request('/api/session');view(sess.loggedIn);if(sess.loggedIn)await load();}catch(e){$('loadingArea').hidden=true;$('loginArea').hidden=false;msg('loginMessage','Verbindung zum Server nicht möglich. Bitte die Website über den gestarteten Server öffnen.',true);}}
 $('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const b=$('loginBtn');b.disabled=true;msg('loginMessage','Anmeldung läuft …');
  try{await request('/api/login',{method:'POST',body:JSON.stringify({username:$('username').value.trim(),password:$('password').value})});view(true);msg('loginMessage','');await load();$('username').value='';}catch(err){msg('loginMessage',err.message,true);}finally{b.disabled=false;}
 });
 $('showPassword').addEventListener('click',()=>{const p=$('password');p.type=p.type==='password'?'text':'password';$('showPassword').textContent=p.type==='text'?'Verbergen':'Anzeigen';});
 $('logoutBtn').addEventListener('click',async()=>{try{await request('/api/logout',{method:'POST'});view(false);actions=[];reset();}catch(err){alert(err.message);}});
 function reset(){editing=null;$('actionEditor').reset();$('formHeading').textContent='Neue Aktion anlegen';$('deleteCurrent').hidden=true;$('startDate').value=today();$('endDate').value=today();msg('editorMessage','');}
 function edit(a){reset();editing=a.id;fields.forEach(k=>$(k).value=a[k]??'');$('published').checked=a.published===true;$('formHeading').textContent='Aktion bearbeiten';$('deleteCurrent').hidden=false;$('actionEditor').scrollIntoView({behavior:'smooth',block:'start'});$('title').focus({preventScroll:true});}
 function render(){
  const list=$('adminList'),preview=$('adminPreview');list.replaceChildren();preview.replaceChildren();
  const sorted=[...actions].sort((a,b)=>a.startDate.localeCompare(b.startDate));
  $('totalCount').textContent=String(actions.length);$('activeCount').textContent=String(actions.filter(a=>a.published&&a.endDate>=today()).length);
  if(!sorted.length)list.append(node('p','muted','Noch keine Aktionen vorhanden. Erstelle dein erstes Angebot.'));
  for(const a of sorted){const div=node('div','admin-list-card'+(a.endDate<today()?' expired':''));const info=node('div');info.append(node('b','',a.title),node('small','',a.startDate+' – '+a.endDate+' · '+(categoryNames[a.category]||'')),node('small',a.published?'tag-published':'tag-draft',a.published?'● Veröffentlicht':'○ Entwurf'));const btn=node('button','', 'Bearbeiten');btn.type='button';btn.addEventListener('click',()=>edit(a));div.append(info,btn);list.append(div);}
  const visible=sorted.filter(a=>a.published===true&&a.endDate>=today());
  if(!visible.length)preview.append(node('p','muted','Noch keine aktuellen veröffentlichten Aktionen.'));
  for(const a of visible){const box=node('div','preview-card'),img=node('img');img.src=photos[a.category]||photos.tag;img.alt='Kletterangebot';const body=node('div','body');body.append(node('small','',categoryNames[a.category]+' · '+a.startDate),node('h3','',a.title),node('p','',a.description),node('strong','',a.price||'Preis auf Anfrage'));box.append(img,body);preview.append(box);}
 }
 $('actionEditor').addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!e.target.reportValidity())return;
  const a={};fields.forEach(k=>a[k]=$(k).value.trim());a.published=$('published').checked;
  if(a.endDate<a.startDate)return msg('editorMessage','Das Enddatum darf nicht vor dem Startdatum liegen.',true);
  if(a.startDate===a.endDate&&a.startTime&&a.endTime&&a.endTime<=a.startTime)return msg('editorMessage','Das Ende muss nach dem Beginn liegen.',true);
  if(a.minCount&&a.maxCount&&Number(a.minCount)>Number(a.maxCount))return msg('editorMessage','Die Mindestteilnehmerzahl darf nicht größer als die Höchstzahl sein.',true);
  busy=true;$('saveAction').disabled=true;msg('editorMessage','Speichern …');
  try{const isEdit=Boolean(editing),res=await request(isEdit?base+'/'+encodeURIComponent(editing):base,{method:isEdit?'PUT':'POST',body:JSON.stringify(a)});await load();reset();msg('editorMessage','Gespeichert! '+(res.action.published?'Die Aktion ist jetzt öffentlich sichtbar.':'Die Aktion ist als Entwurf gespeichert.'));}catch(err){msg('editorMessage',err.message,true);}finally{busy=false;$('saveAction').disabled=false;}
 });
 $('deleteCurrent').addEventListener('click',async()=>{if(!editing||busy)return;const a=actions.find(x=>x.id===editing);if(!a||!confirm(`„${a.title}“ wirklich löschen?`))return;busy=true;try{await request(base+'/'+encodeURIComponent(editing),{method:'DELETE'});await load();reset();msg('editorMessage','Aktion gelöscht. Sie wird öffentlich nicht mehr angezeigt.');}catch(err){msg('editorMessage',err.message,true);}finally{busy=false;}});
 $('newAction').addEventListener('click',()=>{reset();$('title').focus();});$('resetForm').addEventListener('click',reset);
 document.querySelectorAll('[data-template]').forEach(btn=>btn.addEventListener('click',()=>{reset();Object.entries(presets[btn.dataset.template]).forEach(([k,v])=>$(k).value=v);msg('editorMessage','Vorlage eingefügt. Bitte Datum und Details anpassen.');}));
 $('exportBackup').addEventListener('click',()=>{
   const blob=new Blob([JSON.stringify(actions,null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob); const a=document.createElement('a');
   a.href=url;a.download='brilon-tagesangebote-sicherung.json';document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),2500);
 });
 reset();init();
})();
