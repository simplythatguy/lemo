import {test} from 'node:test';
import {OUT,seed,launch,page,api,assert,writeFileSync,shot} from './common.mjs';
const b=await launch(),receipts=[];
async function coldOpen(p,code,person){await p.goto('http://127.0.0.1:5173');await p.evaluate(({code,person})=>localStorage.setItem(`lemo.seat.${code}`,JSON.stringify({personId:person.id,name:person.name})),{code,person});await p.goto('http://127.0.0.1:5173/r/'+code);await p.locator('.st-room').waitFor();}
try{
 for(const action of ['make','next','retake'])await test(`the first ${action} press on a freshly opened room is accepted`,async()=>{
  const r=await seed({recorded:true}),code=r.code,person=r.ana,p=await page(b);
  if(action==='make'){const room=await api('/rooms/'+code);await api('/rooms/'+code+'/deck','PUT',{...room.deck,groups:room.deck.groups.slice(0,1)});}
  try{
   await p.addInitScript(()=>{new MutationObserver(()=>{if(!window.__roomAt&&document.querySelector('.st-room'))window.__roomAt=performance.now();}).observe(document,{childList:true,subtree:true});});
   await coldOpen(p,code,person);
   const button=action==='make'?p.getByRole('button',{name:/Make the video/}):action==='next'?p.getByRole('button',{name:/^Next:/}):p.getByRole('button',{name:/^Retake/});
   if(action==='retake')await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().some(t=>t.readyState==='live'));
   const clickMs=await p.evaluate(()=>performance.now()-window.__roomAt);await button.click();
   let success=false;try{if(action==='make')await p.locator('.st-stage.is-export,.st-result').first().waitFor({timeout:1800});else if(action==='next')await p.locator('.st-dock').getByRole('button',{name:'Assign to me',exact:true}).waitFor({timeout:1800});else await p.locator('.st-dock.is-countdown').waitFor({timeout:1800});success=true;}catch{}
   const result={action,code,clickMs,success,dock:(await p.locator('.st-dock').count()?await p.locator('.st-dock').getAttribute('class'):null),text:(await p.locator('body').innerText()).slice(-500),errors:p.errors};receipts.push(result);writeFileSync(OUT+'/cold-actions.json',JSON.stringify(receipts,null,2));await shot(p,'cold-'+action);console.log(JSON.stringify(result));assert.ok(success,'a first deliberate press must not be suppressed as a double tap');
  }finally{await p.context().close();}
 });
}finally{await b.close();}
