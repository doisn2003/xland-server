import {mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
export async function localEvidenceDirectory(){
 const root=resolve('../brain/logs/agent-c/evidence');
 const directory=resolve(process.env.XLAND_EVIDENCE_DIR??resolve(root,'P2-W3',new Date().toISOString().replace(/[:.]/g,'-')));
 const suffix=relative(root,directory);if(suffix.startsWith('..')||isAbsolute(suffix))throw new Error('Evidence must stay in Agent C namespace');
 await mkdir(directory,{recursive:true});return directory;
}
