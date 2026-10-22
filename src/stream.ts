import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Store } from './db.js';

function escapeXml(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function wrap(text: string, limit=38) {
  const words = text.replace(/\s+/g,' ').trim().split(' '); const lines: string[]=[]; let line='';
  for (const word of words) {
    if ((line+' '+word).trim().length > limit && line) {lines.push(line); line='';}
    if (word.length>limit) { if(line){lines.push(line);line='';} for(let i=0;i<word.length;i+=limit) lines.push(word.slice(i,i+limit)); }
    else line += (line?' ':'')+word;
  }
  if(line) lines.push(line);
  return lines.slice(0,7);
}
export function instructionSvg(text: string, status: string): string {
  const lines = wrap(text || 'Waiting for hero selection. Send your draft screenshot to the MLBB Coach.');
  const tspans=lines.map((l,i)=>`<tspan x="34" dy="${i===0?0:39}">${escapeXml(l)}</tspan>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#101827"/><rect x="0" y="0" width="12" height="360" fill="#4f9eff"/>
  <text x="34" y="48" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#8dbfff">MLBB ITEM COACH</text>
  <text x="605" y="48" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#93a3ba">${escapeXml(status.toUpperCase())}</text>
  <line x1="34" y1="68" x2="606" y2="68" stroke="#2c3b53"/>
  <text x="34" y="119" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#f3f7ff">${tspans}</text>
  <text x="34" y="335" font-family="Arial, sans-serif" font-size="16" fill="#879bb7">Updated automatically from screenshot</text></svg>`;
}
type Running = {
  process: ReturnType<typeof spawn>;
  dir: string;
  lastFetch: number;
  closed: boolean;
};
export function createStreamManager(store: Store) {
  const running = new Map<string,Running>();
  const stop = (token:string) => {
    const task=running.get(token); if(!task)return;
    task.closed=true; task.process.kill('SIGTERM'); running.delete(token);
    setTimeout(()=>rmSync(task.dir,{recursive:true,force:true}),2500).unref();
  };
  const start = (token:string) => {
    let task=running.get(token); if(task){task.lastFetch=Date.now();return task.dir;}
    const game=store.getGame(token); if(!game) return null;
    const dir=mkdtempSync(join(tmpdir(),'mlbb-hls-'));
    const args=['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','1','-vcodec','png','-i','pipe:0',
      '-vf','format=yuv420p','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-r','1','-g','2',
      '-f','hls','-hls_time','2','-hls_list_size','6','-hls_flags','delete_segments+omit_endlist+independent_segments',
      '-hls_segment_filename',join(dir,'part%06d.ts'),join(dir,'index.m3u8')];
    const child=spawn(process.env.FFMPEG||'ffmpeg',args,{stdio:['pipe','ignore','pipe']});
    const entry:Running={process:child,dir,lastFetch:Date.now(),closed:false};running.set(token,entry);
    child.stderr.on('data',()=>{});
    child.on('error',()=>stop(token));
    child.on('exit',()=>{if(running.get(token)===entry)stop(token);});
    void (async () => {
      while(!entry.closed){
        if(Date.now()-entry.lastFetch>90000){stop(token);break;}
        const current=store.getGame(token);
        const value=current ? store.latestInstruction(current)?.text : undefined;
        const svg=instructionSvg(value||'',current?.status||'ended');
        try {
          const png=await sharp(Buffer.from(svg)).png().toBuffer();
          if(entry.closed)break;
          if(!child.stdin.write(png)) await new Promise<void>(r=>child.stdin.once('drain',r));
        }catch{stop(token);break;}
        await new Promise(r=>setTimeout(r,1000));
      }
    })();
    return dir;
  };
  return {start,stop,close:()=>{for(const token of [...running.keys()])stop(token);}};
}
