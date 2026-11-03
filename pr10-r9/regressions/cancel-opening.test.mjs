import {test} from 'node:test';
import {OUT,seed,launch,page,open,assert,writeFileSync,shot,turnOff} from './common.mjs';
const b=await launch();
try {
 await test('turning the camera off cancels a requested recording while it is opening',async()=>{
  const r=await seed(),p=await page(b);
  try {
   await p.addInitScript(()=>{
    window.__media=[];let videoCalls=0;
    const raw=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async opts=>{
     const s=await raw(opts);
     if(opts.video!==false&&++videoCalls===2){window.__onHeld=true;await new Promise(resolve=>window.__releaseOn=resolve);}
     return s;
    };
    const Raw=MediaRecorder;
    window.MediaRecorder=new Proxy(Raw,{construct(T,args){window.__media.push(args[0].getTracks().map(t=>({kind:t.kind,state:t.readyState})));return Reflect.construct(T,args);}});
   });
   await open(p,r);await turnOff(p);await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('r');await p.waitForFunction(()=>window.__onHeld);
   let toggle=p.getByRole('button',{name:'Turn camera off',exact:true});if(!await toggle.count())await p.locator('.st-tile-menu').first().click();await p.getByRole('button',{name:'Turn camera off',exact:true}).click();
   if(await p.getByRole('dialog',{name:'People',exact:true}).count())await p.keyboard.press('Escape');
   await p.evaluate(()=>window.__releaseOn());await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().length===0);
   toggle=p.getByRole('button',{name:'Turn camera on',exact:true});if(!await toggle.count())await p.locator('.st-tile-menu').first().click();await p.getByRole('button',{name:'Turn camera on',exact:true}).click();
   await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().some(t=>t.readyState==='live'));
   await p.waitForTimeout(3400);const result={code:r.code,dock:await p.locator('.st-dock').getAttribute('class'),recorders:await p.evaluate(()=>window.__media),errors:p.errors};
   writeFileSync(OUT+'/cancel-opening.json',JSON.stringify(result,null,2));await shot(p,'cancel-opening');console.log(JSON.stringify(result));assert.deepEqual(result.recorders,[],'turning the camera back on must not start a cancelled request');assert.match(result.dock,/is-record\b/);assert.deepEqual(p.errors,[]);
  }finally{await p.context().close();}
 });
}finally{await b.close();}
