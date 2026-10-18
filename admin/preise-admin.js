 'use strict';
(() => {
const el=id=>document.getElementById(id);
let prices=null;
const money=x=>x===''?'':String(x).replace('.',',');
const defaults={published:true,tiers:[{max:5,duration:'ca. 2,5 Stunden'},{max:10,duration:'ca. 3 Stunden'},{max:15,duration:'ca. 3,5 Stunden'}],programs:[{id:'mix',name:'Kletter- und Erlebnisprogramm',prices:['','','']}],birthday:{price:'',duration:'ca. 3 Stunden'}};
const msg=(t,bad=false)=>{el('pricesStatus').textContent=t;el('pricesStatus').classList.toggle('error',bad);};
async function call(url,opts={}){
 const r=await fetch(url,{cache:'no-store',credentials:'same-origin',headers:{'X-Brilon-Admin':'1',...(opts.body?{'Content-Type':'application/json'}:{})},...opts});
 const value=await r.json();if(!r.ok)throw Error(value.error||'Fehler bei der Speicherung.');return value;
}
function field(label,value,attr={}){const wrapper=document.createElement('div');wrapper.className='field';const l=document.createElement('label');l.textContent=label;const inp=document.createElement('input');inp.value=value??'';inp.type=attr.type||'text';for(const [k,v] of Object.entries(attr))if(k!=='type')inp.setAttribute(k,v);wrapper.append(l,inp);return [wrapper,inp];}
function render(){
 el('tierAdminGrid').replaceChildren();el('programAdminList').replaceChildren();
 prices.tiers.forEach((t,i)=>{
  const box=document.createElement('div');box.className='tier-admin';const hdr=document.createElement('strong');hdr.textContent='Stufe '+(i+1);box.append(hdr);
  const [a,count]=field('Bis wie viele Personen?',t.max,{type:'number',min:String(i?prices.tiers[i-1].max+1:1),max:'500',step:'1',required:'true'});
  const [b,duration]=field('Dauer / Zeitraum',t.duration,{maxlength:'80'});
  count.addEventListener('input',()=>{t.max=Number(count.value)||0;renderProgramHeaders();});duration.addEventListener('input',()=>t.duration=duration.value);
  box.append(a,b);el('tierAdminGrid').append(box);
 });
 prices.programs.forEach((pr,i)=>{
  const box=document.createElement('div');box.className='program-admin';const top=document.createElement('div');top.className='program-admin-top';
  const [title,name]=field('Programmblock',pr.name,{maxlength:'70',required:'true'});name.addEventListener('input',()=>pr.name=name.value);
  const remove=document.createElement('button');remove.type='button';remove.className='button button-outline btn-sm';remove.textContent='Entfernen';remove.disabled=prices.programs.length<=1;remove.addEventListener('click',()=>{if(!confirm('Programmblock wirklich entfernen? Die eingegebenen Preise gehen verloren.'))return;prices.programs.splice(i,1);render();});top.append(title,remove);box.append(top);
  const grid=document.createElement('div');grid.className='price-admin-grid';pr.prices.forEach((price,j)=>{
    const [fieldEl,input]=field('Preis bis '+prices.tiers[j].max+' Personen (€)',price,{type:'number',step:'0.01',min:'0.01',max:'99999',placeholder:'Auf Anfrage'});
    input.dataset.tierPrice=String(j);input.addEventListener('input',()=>pr.prices[j]=input.value);
    grid.append(fieldEl);
  });box.append(grid);el('programAdminList').append(box);
 });
 el('birthdayPrice').value=prices.birthday.price;el('birthdayDuration').value=prices.birthday.duration;el('pricesPublished').checked=prices.published;
}
function renderProgramHeaders(){el('programAdminList').querySelectorAll('.program-admin').forEach(pr=>{pr.querySelectorAll('[data-tier-price]').forEach((inp,i)=>{const label=inp.closest('.field')?.querySelector('label');if(label)label.textContent='Preis bis '+prices.tiers[i].max+' Personen (€)';});});}
function collect(){prices.birthday.price=el('birthdayPrice').value;prices.birthday.duration=el('birthdayDuration').value;prices.published=el('pricesPublished').checked;prices.programs.forEach((pr,i)=>{const card=el('programAdminList').children[i];pr.name=card.querySelector('.program-admin-top input').value.trim();pr.prices=[...card.querySelectorAll('[data-tier-price]')].map(n=>n.value);});prices.tiers.forEach((t,i)=>{const ins=el('tierAdminGrid').children[i].querySelectorAll('input');t.max=Number(ins[0].value);t.duration=ins[1].value;});return prices;}
async function load(){try{const r=await call('/api/preise');prices=r.prices||structuredClone(defaults);render();}catch(e){msg('Bitte erst im Verwaltungsbereich anmelden. '+e.message,true);}}
el('addProgram').addEventListener('click',()=>{if(prices.programs.length>=16)return msg('Maximal 16 Programmblöcke möglich.',true);collect();prices.programs.push({id:'extra_'+Date.now().toString(36),name:'Neues Kletterprogramm',prices:['','','']});render();});
el('pricesForm').addEventListener('submit',async e=>{e.preventDefault();if(!e.target.reportValidity())return;const cfg=collect();const b=el('savePrices');b.disabled=true;msg('Preise werden gespeichert …');try{const data=await call('/api/preise',{method:'PUT',body:JSON.stringify(cfg)});prices=data.prices;render();msg('Gespeichert! Die neuen Preise erscheinen sofort auf der öffentlichen Website.');}catch(error){msg(error.message,true);}finally{b.disabled=false;}});
el('pricesExport').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(collect(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='klettern-brilon-preisliste-sicherung.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);});
el('pricesImport').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(file.size>45000)throw Error('Datei zu groß.');const incoming=JSON.parse(await file.text());
  if(!Array.isArray(incoming.tiers)||!Array.isArray(incoming.programs)||!incoming.birthday)throw Error('Keine gültige Preisliste.');
  if(!confirm('Alle derzeitigen Gruppenpreise und Programme durch die Sicherung ersetzen und sofort veröffentlichen?'))return;
  const data=await call('/api/preise',{method:'PUT',body:JSON.stringify(incoming)});prices=data.prices;render();msg('Preisübersicht aus Sicherung wiederhergestellt.');
 }catch(error){msg('Wiederherstellung fehlgeschlagen: '+error.message,true);}finally{e.target.value='';}
});
const target=el('dashboardArea');const observer=new MutationObserver(()=>{if(!target.hidden)load();});observer.observe(target,{attributes:true,attributeFilter:['hidden']});
})();
