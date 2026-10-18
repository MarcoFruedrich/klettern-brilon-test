'use strict';
(function () {
  const publicData = Array.isArray(window.BRILON_AKTIONEN) ? window.BRILON_AKTIONEN : [];
  const $ = id => document.getElementById(id);
  const today = new Date();
  const todayISO = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
  const categories = {tag:'Tagesangebot', special:'Sonderaktion', ferien:'Ferien & Gruppen'};
  const assets = {tag:'fotos/klettern.jpg',special:'fotos/aktion.jpg',ferien:'fotos/team.jpg'};
  const clean = value => String(value == null ? '' : value).trim();
  const validDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d+'T12:00:00').getTime()) && new Date(d+'T12:00:00').toLocaleDateString('sv-SE') === d;
  const isValid = a => a && typeof a === 'object' && typeof a.id==='string' && typeof a.title==='string' && validDay(a.startDate) && validDay(a.endDate) && a.endDate>=a.startDate && Object.hasOwn(categories,a.category);
  const isPublic = a => isValid(a) && a.published===true && a.endDate>=todayISO;
  const timeOK = v => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const fmtDate = str => new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'long',year:'numeric'}).format(new Date(str+'T12:00:00'));
  const spanDate = a => a.startDate===a.endDate ? fmtDate(a.startDate) : fmtDate(a.startDate)+' – '+fmtDate(a.endDate);
  function element(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function card(a,preview=false){
    const box=element('article','aktion-card');
    const media=element('div','aktion-banner');
    const img=document.createElement('img');img.src=assets[a.category];img.alt='Klettern in der Jugendherberge Brilon';img.loading='lazy';media.append(img,element('span','aktion-category',categories[a.category]));box.append(media);
    const b=element('div','aktion-card-content');
    if(a.badge)b.append(element('span','aktion-pill',a.badge));
    b.append(element('h3','',a.title),element('p','',a.description));
    const meta=element('div','aktion-meta');
    meta.append(element('span','', '📅 '+spanDate(a)));
    if(a.startTime)meta.append(element('span','', '🕒 '+a.startTime+(a.endTime?' – '+a.endTime:'')+' Uhr'));
    if(a.minCount || a.maxCount)meta.append(element('span','', '👥 '+(a.minCount&&a.maxCount ? a.minCount+'–'+a.maxCount : a.minCount ? 'ab '+a.minCount : 'bis '+a.maxCount)+' Teilnehmende'));
    if(a.details)meta.append(element('span','', 'ℹ️ '+a.details));
    b.append(meta,element('div','aktion-price',a.price||'Preis auf Anfrage'));
    const link=element('a','button button-dark',preview?'Anfrage auf Website ↗':'Aktion anfragen ↗');link.href='index.html?aktion='+encodeURIComponent(a.id)+'#buchen';b.append(link);box.append(b);return box;
  }
  function setupMenu(){const b=$('menuToggle'),n=$('siteNav');if(!b || !n)return;b.addEventListener('click',()=>{const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));n.classList.toggle('open',open);});n.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{n.classList.remove('open');b.setAttribute('aria-expanded','false');}));}
  document.querySelectorAll('.js-year').forEach(node=>node.textContent=String(today.getFullYear()));setupMenu();
  const publicCards=$('aktionCards');
  if(publicCards){
    let activeFilter='alle';
    const render=filter=>{
      activeFilter=filter;
      const source=window.BRILON_VORSCHAU?(window.BRILON_AKTIONEN||[]):publicData;
      const publish=source.filter(isPublic).sort((a,b)=>a.startDate.localeCompare(b.startDate));
      const filtered=filter==='alle'?publish:publish.filter(a=>a.category===filter);
      publicCards.replaceChildren();
      $('publicStatus').textContent=filtered.length?filtered.length+' aktuelle'+(filtered.length===1?' Aktion':' Aktionen'):'Aktuell keine veröffentlichten Aktionen in dieser Kategorie.';
      if(!filtered.length){const empty=element('div','aktion-empty');empty.append(element('span','', '🧗'),element('h3','', 'Hier wird es bald spannend!'),element('p','', 'Zurzeit ist kein zusätzliches Tages- oder Sonderangebot veröffentlicht. Du kannst trotzdem jederzeit ein individuelles Kletterangebot anfragen.'));const a=element('a','button button-dark','Wunschtermin anfragen ↗');a.href='index.html#buchen';empty.append(a);publicCards.append(empty);return;}
      filtered.forEach(item=>publicCards.append(card(item)));
    };
    document.querySelectorAll('[data-action-filter]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-action-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));render(btn.dataset.actionFilter);}));
    render('alle');
    if(window.BRILON_VORSCHAU)document.addEventListener('brilon:aktionen-aktualisiert',()=>render(activeFilter));
  }
  const editor=$('actionEditor');if(!editor)return;
  const STORAGE='brilon-tagesaktionen-v1';
  let actions=[], editing=null;
  try{const raw=localStorage.getItem(STORAGE);actions=raw?JSON.parse(raw):JSON.parse(JSON.stringify(publicData));if(!Array.isArray(actions))throw Error('Ungültige lokale Daten');actions=actions.filter(isValid);}catch(e){actions=publicData.filter(isValid);$('editorMessage').textContent='Lokale Speicherung ist in diesem Browser eventuell nicht verfügbar. Bitte unbedingt die JSON-Sicherung herunterladen.';}
  function store(){try{localStorage.setItem(STORAGE,JSON.stringify(actions));return true;}catch(e){$('editorMessage').textContent='Lokale Speicherung nicht möglich. Bitte über „Sicherung als JSON herunterladen“ sichern.';return false;}}
  const fields=['title','category','badge','startDate','endDate','startTime','endTime','minCount','maxCount','price','description','details'];
  function reset(){editing=null;editor.reset();$('actionId').value='';$('formHeading').textContent='Neue Aktion eintragen';$('deleteCurrent').hidden=true;$('editorMessage').textContent='';$('startDate').value=todayISO;$('endDate').value=todayISO;}
  function load(action){reset();editing=action.id;$('actionId').value=action.id;fields.forEach(k=>$(k).value=clean(action[k]));$('published').checked=action.published===true;$('formHeading').textContent='Aktion bearbeiten';$('deleteCurrent').hidden=false;editor.scrollIntoView({behavior:'smooth',block:'start'});}
  function renderAdmin(){
    const list=$('adminList'),preview=$('adminPreview');list.replaceChildren();preview.replaceChildren();
    if(!actions.length)list.append(element('p','small','Noch keine Aktionen eingetragen. Erstelle links dein erstes Angebot.'));
    actions.slice().sort((a,b)=>a.startDate.localeCompare(b.startDate)).forEach(a=>{
      const item=element('div','admin-list-card');const info=element('div');info.append(element('b','',a.title));info.append(element('small','',spanDate(a)+' · '+categories[a.category]));info.append(element('small',a.published?'tag-published':'tag-draft',a.published?'● Veröffentlicht (nach Upload)':'○ Entwurf'));const btn=element('button','', 'Bearbeiten');btn.type='button';btn.addEventListener('click',()=>load(a));item.append(info,btn);list.append(item);
    });
    const visible=actions.filter(isPublic).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    if(!visible.length){preview.append(element('p','small','Noch keine aktuellen veröffentlichten Aktionen. Markiere ein Angebot als veröffentlicht und speichere es.'));}
    visible.forEach(a=>preview.append(card(a,true)));
    if(window.BRILON_VORSCHAU){window.BRILON_AKTIONEN=JSON.parse(JSON.stringify(actions));document.dispatchEvent(new Event('brilon:aktionen-aktualisiert'));}
  }
  editor.addEventListener('submit',e=>{
    e.preventDefault();if(!editor.reportValidity())return;
    const input={};fields.forEach(k=>input[k]=clean($(k).value));
    const a={...input,id:editing||('brilon-'+Date.now()+'-'+Math.random().toString(36).slice(2,9)),published:$('published').checked};
    if(!validDay(a.startDate)||!validDay(a.endDate)||a.endDate<a.startDate){$('editorMessage').textContent='Bitte einen gültigen Zeitraum eingeben (Enddatum nicht vor Startdatum).';return;}
    if(!timeOK(a.startTime)||!timeOK(a.endTime)||a.startTime&&a.endTime&&a.startDate===a.endDate&&a.endTime<=a.startTime){$('editorMessage').textContent='Bitte die Uhrzeiten überprüfen.';return;}
    if(a.minCount&&a.maxCount&&Number(a.minCount)>Number(a.maxCount)){$('editorMessage').textContent='Die Mindestteilnehmerzahl darf nicht größer als die maximale Teilnehmerzahl sein.';return;}
    const pos=actions.findIndex(i=>i.id===a.id);if(pos>=0)actions[pos]=a;else actions.push(a);
    store();renderAdmin();reset();$('editorMessage').textContent='Aktion lokal gespeichert. Für die öffentliche Anzeige bitte zusätzlich die Datendatei exportieren und auf den Webspace hochladen.';
  });
  $('resetForm').addEventListener('click',reset);
  $('deleteCurrent').addEventListener('click',()=>{if(!editing)return;const a=actions.find(x=>x.id===editing);if(!a || !confirm('Soll die Aktion „'+a.title+'“ wirklich gelöscht werden?'))return;actions=actions.filter(x=>x.id!==editing);store();reset();renderAdmin();$('editorMessage').textContent='Aktion entfernt. Für die öffentliche Website die Datendatei erneut exportieren.';});
  const presets={tag:{title:'Offenes Tagesklettern',category:'tag',description:'Ein Kletterangebot für interessierte Gäste, Familien und Einzelpersonen. Teilnahme nach Anmeldung und persönlicher Bestätigung.',badge:'Tagesaktion'},special:{title:'Kletter-Special',category:'special',description:'Ein besonderes Klettererlebnis mit zusätzlichen Stationen und Herausforderungen. Details werden vor der Anmeldung abgestimmt.',badge:'Special'},ferien:{title:'Klettern in den Ferien',category:'ferien',description:'Gemeinsam klettern, Neues ausprobieren und Abenteuer erleben – mit Anleitung und Zeit für individuelle Herausforderungen.',badge:'Ferienaktion'}};
  document.querySelectorAll('[data-template]').forEach(b=>b.addEventListener('click',()=>{reset();const a=presets[b.dataset.template];Object.entries(a).forEach(([k,v])=>$(k).value=v);$('editorMessage').textContent='Vorlage eingefügt. Bitte Datum, Zeiten und weitere Details ergänzen.';}));
  function download(name,content,mime){const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  $('exportData').addEventListener('click',()=>{
    const cleanActions=actions.filter(isValid).map(a=>({id:a.id,title:a.title,category:a.category,badge:a.badge||'',startDate:a.startDate,endDate:a.endDate,startTime:a.startTime||'',endTime:a.endTime||'',minCount:a.minCount||'',maxCount:a.maxCount||'',price:a.price||'',description:a.description||'',details:a.details||'',published:a.published===true}));
    download('aktionen-daten.js','/* Daten für Klettern & Abenteuer Brilon – hochladen in den Website-Hauptordner. */\nwindow.BRILON_AKTIONEN = '+JSON.stringify(cleanActions,null,2)+';\n','text/javascript;charset=utf-8');
    $('exportMessage').textContent='Datei heruntergeladen. Bitte auf deinem Webspace die bestehende Datei „aktionen-daten.js“ ersetzen, damit die Besucher die aktualisierten Angebote sehen.';
  });
  $('exportBackup').addEventListener('click',()=>download('brilon-aktionen-sicherung.json',JSON.stringify(actions,null,2),'application/json;charset=utf-8'));
  $('importData').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>500000)throw Error('Datei zu groß');const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed)||!parsed.every(isValid))throw Error('Ungültige Daten');if(!confirm('Diese Sicherung enthält '+parsed.length+' Einträge. Die bisher lokal gespeicherten Einträge ersetzen?'))return;actions=parsed.map(a=>({...a,published:a.published===true}));store();reset();renderAdmin();$('editorMessage').textContent='Sicherung übernommen. Bitte für die öffentliche Website erneut exportieren.';}catch(err){$('editorMessage').textContent='Sicherung konnte nicht gelesen werden. Bitte eine gültige JSON-Sicherung verwenden.';}finally{e.target.value='';}});
  reset();renderAdmin();
})();
