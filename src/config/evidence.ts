import{mkdir}from'node:fs/promises';
import{resolve,relative,isAbsolute}from'node:path';
export async function evidenceDirectory():Promise<string>{
  const roots=[resolve('.local/evidence'),resolve('../brain/logs/agent-c/evidence')];
  const root=roots[0]!;
  const directory=resolve(process.env.XLAND_EVIDENCE_DIR??resolve(root,'P2/runs',new Date().toISOString().replace(/[:.]/g,'-')));
  if(!roots.some(r=>{const suffix=relative(r,directory);return !suffix.startsWith('..')&&!isAbsolute(suffix);}))throw new Error('Evidence must stay in the local QA or legacy Agent C namespace');
  await mkdir(directory,{recursive:true});return directory;
}
