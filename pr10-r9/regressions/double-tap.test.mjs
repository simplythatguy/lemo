import {test} from 'node:test';
import {OUT,seed,launch,page,open,assert,api,until,writeFileSync} from './common.mjs';
const b=await launch(),results=[];
try{
 for(const width of [1440,390])await test(`${width}px a second Keep tap cannot activate the replacement Next action`,async()=>{
  const r=await seed(),p=await page(b,{width,height:width===390?844:900});
  try{
   await open(p,r);await p.waitForFunction(()=>document.querySelector('.st-tile.is-mine video')?.srcObject?.getVideoTracks().some(t=>t.readyState==='live'));await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('r');await p.locator('.st-dock.is-recording').waitFor();await p.waitForTimeout(500);await p.getByRole('button',{name:'Stop',exact:true}).click();await p.locator('.st-dock.is-review').waitFor();
   const keep=p.getByRole('button',{name:/^Keep/}),box=await keep.boundingBox(),x=box.x+12,y=box.y+box.height/2;await p.mouse.click(x,y);await p.getByRole('button',{name:/^Next:/}).waitFor();await p.waitForTimeout(80);const target=await p.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.innerText,{x,y});assert.match(target,/Next:/,'the second tap must hit the actual replacement action');await p.mouse.click(x,y);await p.waitForTimeout(80);
   assert.match(await p.locator('.st-dock').getAttribute('class'),/is-retake/);await until(async()=>!!(await api(`/rooms/${r.code}`)).takes.first);await p.waitForTimeout(600);await p.getByRole('button',{name:/^Next:/}).click();await p.locator('.st-dock').getByRole('button',{name:'Assign to me',exact:true}).waitFor();assert.deepEqual(p.errors,[]);results.push({width,code:r.code,target,guarded:true,laterNextAccepted:true,errors:p.errors});writeFileSync(OUT+'/double-tap.json',JSON.stringify(results,null,2));
  }finally{await p.context().close();}
 });
}finally{await b.close();}
