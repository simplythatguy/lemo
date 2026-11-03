import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.LEMO_PLAYWRIGHT_MODULE??'playwright');
export {assert,readFileSync,writeFileSync};
export const OUT=fileURLToPath(new URL('../results/',import.meta.url)).replace(/\/$/,'');
mkdirSync(OUT,{recursive:true});
export const BASE='http://127.0.0.1:5173';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const fixture=JSON.parse(readFileSync(new URL('./fixtures/take.json',import.meta.url)));
export const bytes=readFileSync(new URL('./fixtures/take.bin',import.meta.url));
export const rows=[];
export function receipt(name,value){rows.push({name,...value});writeFileSync(`${OUT}/independent-receipts.json`,JSON.stringify(rows,null,2));console.log(name,JSON.stringify(value));}
export async function request(path,method='GET',data,binary,headers={}){
 return fetch(`${BASE}/api${path}`,{method,headers:{...(binary?{'content-type':'application/octet-stream'}:data===undefined?{}:{'content-type':'application/json'}),...headers},body:binary??(data===undefined?undefined:JSON.stringify(data))});
}
export async function api(...args){const r=await request(...args);assert.ok(r.ok,`${args[1]??'GET'} ${args[0]}: ${r.status} ${r.ok?'':await r.text()}`);return r.json();}
export function deck(){return {title:'Independent 3a5fb62 review',team:['Ana','Ben'],groups:[{id:'first',name:'Slides 1–2',speaker:0,seconds:30,slides:[{id:'s1',kind:'statement',text:'First review slide'},{id:'s2',kind:'statement',text:'Second review slide'}],script:['First original words','Second original words']},{id:'second',name:'Slide 3',speaker:0,slides:[{id:'s3',kind:'statement',text:'Third review slide'}],script:['Third original words']}]};}
export function body(personId,overrides={}){return {groupId:'first',personId,durationMs:fixture.durationMs,cues:fixture.cues,mime:fixture.mime,size:bytes.length,chunks:1,slides:['s1','s2'],...overrides};}
export async function seed({recorded=false}={}){
 const room=await api('/rooms','POST',{}),code=room.code;
 const ana=await api(`/rooms/${code}/people`,'POST',{name:'Ana'}),ben=await api(`/rooms/${code}/people`,'POST',{name:'Ben'});
 await api(`/rooms/${code}/deck`,'PUT',deck());await api(`/rooms/${code}/assignments/first`,'PUT',{personId:ana.id});
 const save=async (person=ana,overrides={})=>{const take=await api(`/rooms/${code}/takes`,'POST',body(person.id,overrides));await api(`/rooms/${code}/takes/${take.id}/chunks/0`,'PUT',undefined,bytes);return take;};
 const take=recorded?await save():null;return {code,ana,ben,take,save};
}
export async function launch(){return chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});}
export async function page(browser,{width=1440,height=900,motion='no-preference'}={}){
 const c=await browser.newContext({viewport:{width,height},hasTouch:width<601,isMobile:width<601,deviceScaleFactor:1,reducedMotion:motion,permissions:['camera','microphone'],acceptDownloads:true});
 const p=await c.newPage();p.setDefaultTimeout(10000);p.errors=[];p.dialogs=[];p.answer=false;
 p.on('pageerror',e=>p.errors.push(e.message));p.on('dialog',async d=>{p.dialogs.push({type:d.type(),message:d.message()});if(p.answer&&d.type()==='confirm')await d.accept();else await d.dismiss();});return p;
}
export async function open(p,r){await p.goto(BASE);await p.evaluate(r=>localStorage.setItem(`lemo.seat.${r.code}`,JSON.stringify({personId:r.ana.id,name:r.ana.name})),{code:r.code,ana:r.ana});await p.goto(`${BASE}/r/${r.code}`);await p.locator('.st-room').waitFor();await p.locator('.st-stage canvas').waitFor();await p.waitForTimeout(250);}
export async function split(p){await p.locator('.st-strip-g').first().locator('.st-thumb').nth(1).click({button:'right'});await p.getByRole('menuitem',{name:'Split here',exact:true}).click();}
export async function until(fn,ms=10000){const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw Error('condition timed out');await new Promise(r=>setTimeout(r,40));}}
export async function shot(p,name){await p.waitForTimeout(450);await p.screenshot({path:`${OUT}/${name}.png`});}
export async function turnOff(p){const toggle=p.getByRole('button',{name:'Turn camera off',exact:true});if(!await toggle.count())await p.locator('.st-tile-menu').first().click();await p.getByRole('button',{name:'Turn camera off',exact:true}).first().click();if(await p.getByRole('dialog',{name:'People',exact:true}).count())await p.keyboard.press('Escape');await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().length===0);}
export async function cached(p,code){return p.evaluate(async code=>{const {takeCache}=await import('/src/studio/takeCache.ts');return Promise.all((await takeCache.inRoom(code)).map(async t=>({...t,blob:{size:t.blob.size,type:t.blob.type,sha:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await t.blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('')}})));},code);}
export async function download(p,name){const event=p.waitForEvent('download');await p.getByRole('button',{name:/^Download camera recording/}).first().click();const d=await event;const path=`${OUT}/${name}`;await d.saveAs(path);return {path,size:readFileSync(path).length,sha:sha(readFileSync(path)),suggested:d.suggestedFilename()};}
export async function inject(p,r,takes){await p.evaluate(async ({r,takes,bytes,mime,cues,durationMs})=>{const {takeCache}=await import('/src/studio/takeCache.ts');for(const t of takes)await takeCache.put({key:crypto.randomUUID(),room:r.code,groupId:'first',personId:r.ana.id,takeId:null,blob:new Blob([new Uint8Array(bytes)],{type:mime}),mime,cues,durationMs,slides:['s1','s2'],name:'Slides 1–2',sent:0,createdAt:Date.now(),...t});},{r:{code:r.code,ana:r.ana},takes,bytes:[...bytes],...fixture});}
