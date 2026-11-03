import {test} from 'node:test';
import {OUT,seed,launch,page,open,assert,writeFileSync,shot,turnOff} from './common.mjs';
const b=await launch(),rows=[];
try{
 for(const recorded of [false,true])for(const command of ['r','click'])await test(`${recorded?'Retake':'Record'} survives camera-off initialization in flight via ${command}`,async()=>{
  const r=await seed({recorded}),p=await page(b);try{
   await p.addInitScript(()=>{window.__media=[];const raw=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async opts=>{const s=await raw(opts);if(opts.video===false&&!window.__offReady){window.__offReady=true;await new Promise(resolve=>window.__releaseOff=resolve);}return s;};const Raw=MediaRecorder;window.MediaRecorder=new Proxy(Raw,{construct(T,args){window.__media.push({at:performance.now(),tracks:args[0].getTracks().map(t=>({kind:t.kind,state:t.readyState}))});return Reflect.construct(T,args);}});});
   await open(p,r);await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().some(t=>t.readyState==='live'));await p.getByRole('button',{name:'Turn camera off',exact:true}).click();await p.waitForFunction(()=>window.__offReady);await p.waitForTimeout(150);
   if(command==='r'){await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('r');}else if(recorded)await p.getByRole('button',{name:/^Retake/}).click();else await p.locator('.st-rec').click();await p.evaluate(()=>window.__releaseOff());await p.waitForTimeout(3800);const outcome=await p.locator('.st-dock').getAttribute('class'),trace=await p.evaluate(()=>window.__media);await shot(p,`camera-start-failed-${recorded?'retake':'record'}-${command}`);rows.push({code:r.code,recorded,command,outcome,trace,errors:p.errors});writeFileSync(`${OUT}/camera-start-regression.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.at(-1)));assert.match(outcome,/is-recording/,'the requested take should still be recording after countdown');
  }finally{await p.context().close();}
 });
 await test('camera-off R records once its stream has settled',async()=>{const r=await seed(),p=await page(b);try{await open(p,r);await turnOff(p);await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('r');await p.locator('.st-dock.is-recording').waitFor();await p.keyboard.press('Escape');console.log('settled control',r.code);assert.deepEqual(p.errors,[]);}finally{await p.context().close();}});
}finally{await b.close();}
