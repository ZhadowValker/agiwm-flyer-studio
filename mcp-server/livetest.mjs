import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
const require_w=(p,b64)=>fs.writeFileSync(p,Buffer.from(b64,'base64'));
const S='/tmp/claude-0/-home-claude/d7294383-0dd7-55a2-a0eb-a5126958e4db/scratchpad/';
const env={...process.env,PORT:'8101',MCP_SECRET:'s3cret',DATA_DIR:'/tmp/livedata',STUDIO_FILE:S+'test2.html',FLYER_HTML:S+'test2.html',CHROMIUM_PATH:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'};
const srv=spawn('node',['server.js'],{env,stdio:'inherit'}); await new Promise(r=>setTimeout(r,1500));
const B='http://localhost:8101'; let ok=true; const chk=(n,c)=>{console.log(c?'PASS':'FAIL',n); if(!c) ok=false;};
try{
  const r0=await fetch(B+'/api/state'); chk('api rejects no key',r0.status===401);
  const br=await chromium.launch({executablePath:env.CHROMIUM_PATH,args:['--no-sandbox']}); const pg=await br.newPage({viewport:{width:1440,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e)));
  await pg.goto(B+'/#live=s3cret'); await pg.waitForTimeout(1500);
  chk('pill is Live',(await pg.innerText('#liveBtn')).includes('Live'));
  // MCP -> UI
  const c=new Client({name:'t',version:'1'}); await c.connect(new StreamableHTTPClientTransport(new URL(B+'/mcp/s3cret')));
  console.log('tools',(await c.listTools()).tools.map(t=>t.name).join(','));
  const ppl=await c.callTool({name:'list_people',arguments:{}}); console.log(ppl.content[0].text);
  const u=await c.callTool({name:'update_flyer',arguments:{left_speaker:{person:'Pastor Elizabeth'},date_left:{date:'2026-11-07',time:'7:00 AM IST'},zoom:{meeting_id:'111 222 3333'},accent:{preset:'emerald'},background:{preset:'sage'}}});
  console.log(u.content[0].text.slice(0,200)); await pg.waitForTimeout(1500);
  const txt=await pg.innerText('#stage'); chk('UI shows name from library',txt.includes('PASTOR ELIZABETH AMARA')); chk('UI shows new zoom id',txt.includes('111 222 3333')); chk('UI shows date',txt.toUpperCase().includes('7TH')||txt.toUpperCase().includes('NOV'));
  chk('photo applied in UI',await pg.evaluate(()=>{const e=document.querySelector('#stage .ph');return !!e&&/url\(/.test(e.style.backgroundImage||getComputedStyle(e).backgroundImage);}));
  await pg.click('#liveBtn'); await pg.waitForTimeout(200); const feedTxt=await pg.innerText('#liveFeed'); chk('feed shows instruction',/Claude/.test(feedTxt)&&/left speaker/.test(feedTxt)); await pg.screenshot({path:S+'live1.png'});
  // UI -> server
  await pg.keyboard.press('Escape'); await pg.click('#zid'); await pg.waitForTimeout(300);
  const inp=pg.locator('#props input[type=text]').first(); await inp.fill('999 888 7777'); await pg.waitForTimeout(1800);
  const g=await c.callTool({name:'get_flyer',arguments:{}}); chk('Claude sees hand edit',g.content[0].text.includes('999 888 7777')); chk('photo kept on server after UI send',g.content[0].text.includes('"photo": "(set)"'));
  // render current
  const rc=await c.callTool({name:'render_current_flyer',arguments:{size:'1280x720'}}); chk('render current returns image',rc.content.some(x=>x.type==='image'));
  require_img: { const im=rc.content.find(x=>x.type==='image'); (await import('node:fs')).writeFileSync(S+'live_render.png',Buffer.from(im.data,'base64')); }
  // bad person
  const bad=await c.callTool({name:'update_flyer',arguments:{left_speaker:{person:'Nobody Here'}}}); chk('unknown person gives clear error',bad.isError&&/No one named/.test(bad.content[0].text));
  // REST patch (bot path)
  const pr=await fetch(B+'/api/patch?k=s3cret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({by:'WhatsApp',heading:'Night of Prayer'})}); chk('REST patch ok',pr.ok);
  await pg.waitForTimeout(1200); const hd=await pg.evaluate(()=>document.querySelector('#hd').textContent); console.log('heading text:',JSON.stringify(hd)); chk('UI got bot change',hd.toUpperCase().includes('NIGHTOFPRAYER'));
  // schedule tools
  const SCH='Spkrs for November\n1st week of November Rev Rajakumari Ammagaru\n2nd week...... Dr Nirmala sathyanandam garu\n3rd week...... Ruth j Amma\n4th week...... ps Lilly Rose Ammagaru';
  const pl=await c.callTool({name:'plan_schedule',arguments:{text:SCH}}); console.log(pl.content[0].text); chk('plan has 4 weeks',/Planned 4 flyers/.test(pl.content[0].text)&&/2026-11-28/.test(pl.content[0].text));
  const ms=await c.callTool({name:'make_schedule',arguments:{text:SCH,size:'1280x720',format:'jpg'}}); chk('make_schedule returns 4 images',ms.content.filter(x=>x.type==='image').length===4);
  ms.content.filter(x=>x.type==='image').forEach((im,i)=>require_w(S+'sched'+(i+1)+'.jpg',im.data));
  const pw=await c.callTool({name:'publish_week',arguments:{week:2}}); console.log(pw.content[0].text); await pg.waitForTimeout(1500);
  chk('UI shows week 2 speaker',(await pg.innerText('#stage')).toUpperCase().includes('DR NIRMALA')&&(await pg.innerText('#stage')).includes('14'));
  const sp=await fetch(B+'/api/schedule?k=s3cret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:SCH})}); chk('api schedule',(await sp.json()).weeks.length===4);
  const im3=await fetch(B+'/api/schedule/3.png?k=s3cret'); chk('api week 3 png',im3.ok&&(await im3.arrayBuffer()).byteLength>5000);
  console.log('page errors',errs); await br.close();
}catch(e){console.log('ERR',e); ok=false;} finally{srv.kill(); console.log(ok?'ALL OK':'SOME FAILED'); process.exit(0);}
