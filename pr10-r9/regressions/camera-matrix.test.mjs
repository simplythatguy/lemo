import {test} from 'node:test';
import {OUT,seed,launch,page,open,assert,writeFileSync,shot,turnOff,api,until} from './common.mjs';
const b=await launch(),results=[];
async function switchOff(p){
 if(!await p.getByRole('button',{name:'Turn camera off',exact:true}).count())await p.locator('.st-tile-menu').first().click();
 await p.getByRole('button',{name:'Turn camera off',exact:true}).click();
 if(await p.getByRole('dialog',{name:'People',exact:true}).count())await p.keyboard.press('Escape');
}
try{
 for(const width of [1440,390])for(const recorded of [false,true])for(const command of ['r','click'])await test(`${width}px ${recorded?'Retake':'Record'} keeps a requested take through an unfinished camera-off open via ${command}`,async()=>{
  const r=await seed({recorded}),p=await page(b,{width,height:width===390?844:900});
  try{
   await p.addInitScript(()=>{
    window.__media=[];
    const raw=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async opts=>{const stream=await raw(opts);if(opts.video===false&&!window.__offHeld){window.__offHeld=true;await new Promise(resolve=>window.__releaseOff=resolve);}return stream;};
    const Raw=MediaRecorder;
    window.MediaRecorder=new Proxy(Raw,{construct(T,args){window.__media.push({at:performance.now(),tracks:args[0].getTracks().map(t=>({kind:t.kind,state:t.readyState}))});return Reflect.construct(T,args);}});
   });
   await open(p,r);await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().some(t=>t.readyState==='live'));
   await switchOff(p);await p.waitForFunction(()=>window.__offHeld);await p.waitForTimeout(150);
   if(command==='r'){await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('r');}
   else await (recorded?p.getByRole('button',{name:/^Retake/}):p.locator('.st-rec')).click();
   assert.deepEqual(await p.evaluate(()=>window.__media),[],'no recorder may use the old stream before the replacement resolves');
   assert.ok(!/is-countdown|is-recording/.test(await p.locator('.st-dock').getAttribute('class')),'countdown waits for the live replacement');
   await p.evaluate(()=>window.__releaseOff());await p.locator('.st-dock.is-recording').waitFor();await p.waitForTimeout(450);
   const trace=await p.evaluate(()=>window.__media);
   assert.equal(trace.length,1);assert.ok(trace[0].tracks.some(t=>t.kind==='video'));assert.ok(trace[0].tracks.some(t=>t.kind==='audio'));assert.ok(trace[0].tracks.every(t=>t.state==='live'));
   await shot(p,`camera-ready-${width}-${recorded?'retake':'record'}-${command}`);
   await p.getByRole('button',{name:'Stop',exact:true}).click();await p.locator('.st-dock.is-review').waitFor();await p.getByRole('button',{name:/^Keep/}).click();
   await until(async()=>{const room=await api(`/rooms/${r.code}`);return !!room.takes.first&&room.takes.first.id!==r.take?.id;});
   const take=(await api(`/rooms/${r.code}`)).takes.first;assert.ok(take.size>0);assert.ok(take.durationMs>0);assert.deepEqual(p.errors,[]);
   results.push({width,recorded,command,code:r.code,trace,take:{id:take.id,size:take.size,durationMs:take.durationMs},errors:p.errors});writeFileSync(OUT+'/camera-matrix.json',JSON.stringify(results,null,2));
  }finally{await p.context().close();}
 });
 for(const width of [1440,390])await test(`${width}px a denied camera reopen drops the pending take and retry does not record automatically`,async()=>{
  const r=await seed(),p=await page(b,{width,height:width===390?844:900});
  try{
   await p.addInitScript(()=>{
    window.__media=[];let videoCalls=0;
    const raw=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async opts=>{if(opts.video!==false&&++videoCalls===2)throw new DOMException('Denied in local boundary test','NotAllowedError');return raw(opts);};
    const Raw=MediaRecorder;window.MediaRecorder=new Proxy(Raw,{construct(T,args){window.__media.push(args[0].getTracks().map(t=>({kind:t.kind,state:t.readyState})));return Reflect.construct(T,args);}});
   });
   await open(p,r);await turnOff(p);await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('r');await p.locator('.st-dock.is-camera-error').waitFor();assert.deepEqual(await p.evaluate(()=>window.__media),[]);
   await p.getByRole('button',{name:'Try again',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().some(t=>t.readyState==='live'));await p.waitForTimeout(3400);
   assert.deepEqual(await p.evaluate(()=>window.__media),[],'retry must not revive the failed request');assert.match(await p.locator('.st-dock').getAttribute('class'),/is-record\b/);
   await shot(p,`camera-retried-${width}`);await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('r');await p.locator('.st-dock.is-recording').waitFor();await p.keyboard.press('Escape');assert.deepEqual(p.errors,[]);
   results.push({width,case:'denied-reopen-retry',code:r.code,errors:p.errors});writeFileSync(OUT+'/camera-matrix.json',JSON.stringify(results,null,2));
  }finally{await p.context().close();}
 });
}finally{await b.close();}
