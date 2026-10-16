import{mkdir,writeFile}from'node:fs/promises';
import{resolve}from'node:path';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const evidence=resolve('../brain/logs/agent-c/evidence/P2-W2',stamp);
await mkdir(evidence,{recursive:true});await mkdir('.local',{recursive:true});
await writeFile('.local/w2-run.json',JSON.stringify({stamp,evidence}));
console.log(JSON.stringify({stamp,evidence,note:'New evidence only; no DB access, no credentials changed. Preserve prior baseline snapshots/manifests.'}));
