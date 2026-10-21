import {readdir,readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
// Outside the server checkout so ancestor ignore rules cannot omit src/config.
const releaseId=process.env.XLAND_RELEASE_ID ?? `xland-server-${new Date().toISOString().replace(/[:.]/g,'-')}`;
if(!/^[a-zA-Z0-9_-]+$/.test(releaseId))throw new Error('Invalid release identifier');
const target=resolve('../.release-staging',releaseId);
const evidence=resolve('.local/release',releaseId);
await mkdir(evidence,{recursive:true});
await mkdir(target,{recursive:true});
const files=['Dockerfile','.dockerignore','package.json','package-lock.json','tsconfig.json','tsconfig.build.json'];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isSymbolicLink())throw new Error('Symlink in source');
  if(entry.isDirectory())await walk(path);else if(entry.isFile())files.push(path);
}}
await walk('src');
await walk('public');
const manifest=[];
for(const path of files.sort()){
  if((await lstat(path)).isSymbolicLink())throw new Error('Symlink in source');
  const bytes=await readFile(path);const destination=join(target,path);
  await mkdir(resolve(destination,'..'),{recursive:true});await copyFile(path,destination);
  manifest.push({path:path.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const staged=[];
async function check(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const path=join(dir,entry.name);if(entry.isDirectory())await check(path);else staged.push(relative(target,path));
}}
await check(target);
if(staged.some(p=>!files.includes(p)&&!files.includes(p.replaceAll('\\','/'))))throw new Error('Unexpected staged file');
await writeFile(join(evidence,'server-source-manifest.json'),JSON.stringify({time:new Date().toISOString(),target,files:manifest},null,2));
console.log(JSON.stringify({target,files:manifest.length,bytes:manifest.reduce((s,f)=>s+f.bytes,0)}));
