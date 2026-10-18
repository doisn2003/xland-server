// Freeze the actual working source, including B's untracked files. No Git reset/stash.
import {readdir,readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const server=resolve(dirname(fileURLToPath(import.meta.url)),'..'), mobile=resolve(server,'../xland-mobile');
process.chdir(server);
const hash=b=>createHash('sha256').update(b).digest('hex');
const excluded=new Set(['.git','.local','.dart_tool','.gradle','build','ephemeral','.symlinks','local.properties','key.properties','Generated.xcconfig','flutter_export_environment.sh']);
async function files(root,part='') {
 const result=[];
 for(const d of await readdir(resolve(root,part),{withFileTypes:true})) {
  if(excluded.has(d.name)||/\.(jks|keystore)$/.test(d.name))continue;
  const p=part?`${part}/${d.name}`:d.name;
  if(d.isDirectory())result.push(...await files(root,p));else if(d.isFile())result.push(p);
 }
 return result.sort();
}
async function manifest(root,paths){return Promise.all(paths.map(async path=>({path,sha256:hash(await readFile(resolve(root,path)))})));}
const contextPath=resolve('.local/p3-context.json');
if(['create','seal'].includes(process.argv[2])){
 let active=false;try{await access('.local/p3-preview.lock');active=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(active)throw Error('Stop the owned P3 instance before changing its snapshot/bundle; shared preview is untouched');
}
if(process.argv[2]==='create') {
 const id=new Date().toISOString().replace(/[-:.]/g,'');
 const evidence=resolve('../brain/logs/agent-c/evidence/P3-W0',id),sandbox=resolve('../xland-mobile/.local/p3',id,'mobile');
 await mkdir(evidence,{recursive:true});await mkdir(sandbox,{recursive:true});
 let paths=[];
 for(const directory of ['lib','assets','test','integration_test','android','ios','web','tool']) {
  try{paths.push(...(await files(mobile,directory)));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 paths.push('pubspec.yaml','pubspec.lock','analysis_options.yaml','.metadata');paths.sort();
 const before=await manifest(mobile,paths);
 for(const {path} of before){await mkdir(dirname(resolve(sandbox,path)),{recursive:true});await copyFile(resolve(mobile,path),resolve(sandbox,path));}
 const copied=await manifest(sandbox,paths),after=await manifest(mobile,paths);
 if(JSON.stringify(before)!==JSON.stringify(copied)||JSON.stringify(before)!==JSON.stringify(after))throw Error('SOURCE_CHANGED_DURING_FREEZE: retry a new snapshot; preserve old evidence');
 const source={timestamp:new Date().toISOString(),mobileHead:execFileSync('git',['rev-parse','HEAD'],{cwd:mobile}).toString().trim(),serverHead:execFileSync('git',['rev-parse','HEAD']).toString().trim(),includesUntrackedPresentationAssetsTests:true,files:copied};
 await writeFile(resolve(evidence,'mobile-source.json'),JSON.stringify(source,null,2));
 const context={id,evidence,sandbox,sourceHash:hash(JSON.stringify(copied)),sdk:resolve('../xland-mobile/.local/flutter-3.47.5-native'),apiPort:3002,webPort:5557,mediaPort:5563,instance:'p3w0'};
 await writeFile(contextPath,JSON.stringify(context,null,2),{mode:0o600});
 console.log(JSON.stringify({event:'p3_source_frozen',id,files:copied.length,sourceHash:context.sourceHash,evidence}));
}else if(process.argv[2]==='seal') {
 const c=JSON.parse(await readFile(contextPath,'utf8')),web=resolve(c.sandbox,'build/web');
 const frozen=JSON.parse(await readFile(resolve(c.evidence,'mobile-source.json'),'utf8'));
 for(const f of frozen.files)if(hash(await readFile(resolve(c.sandbox,f.path)))!==f.sha256)throw Error('Frozen source changed during build; reject artifact');
 const paths=(await files(web)).filter(p=>p!=='xland-build.json');
 const bundleFiles=await manifest(web,paths),bundleHash=hash(JSON.stringify(bundleFiles));
 const sdk=JSON.parse(await readFile(resolve(c.sdk,'bin/cache/flutter.version.json'),'utf8'));
 if(sdk.flutterVersion!=='3.47.5'&&sdk.frameworkVersion!=='3.47.5')throw Error('Pinned SDK version mismatch');
 const build={timestamp:new Date().toISOString(),sourceHash:c.sourceHash,bundleHash,sdk,sourceFilesUnchanged:true,mode:'DEMO synthetic project-created media; public W0; W1 awaits A/T0',apiBase:`http://127.0.0.1:${c.apiPort}/api/v1`,mediaBase:`http://127.0.0.1:${c.mediaPort}`,files:bundleFiles};
 await writeFile(resolve(web,'xland-build.json'),JSON.stringify(build,null,2));
 const apk=resolve(c.sandbox,'build/app/outputs/flutter-apk/app-debug.apk');let artifact=c.artifact??null;
 if(artifact&&hash(await readFile(artifact.path))!==artifact.sha256)throw Error('Saved feed artifact changed');
 // Integration tests also write app-debug.apk. Only the feed builder may label
 // a new output as the feed artifact; never relabel an integration APK.
 if(process.argv.includes('--feed-built')){
  const bytes=await readFile(apk);const dest=resolve(c.sandbox,'../artifacts/current-feed-cproof-debug.apk');await mkdir(dirname(dest),{recursive:true});await copyFile(apk,dest);artifact={path:dest,bytes:bytes.length,sha256:hash(bytes),package:'vn.xland.xland_mobile.cproof',target:'lib/bootstrap/native_feed_proof_main.dart',apiBase:`http://10.0.2.2:${c.apiPort}/api/v1`,mediaBase:`http://10.0.2.2:${c.mediaPort}`};
 }
 await writeFile(resolve(c.evidence,'build-artifacts.json'),JSON.stringify({web:build,android:artifact},null,2));
 await writeFile(contextPath,JSON.stringify({...c,bundle:web,bundleHash,artifact},null,2),{mode:0o600});
 console.log(JSON.stringify({event:'p3_artifacts_sealed',bundleHash,android:artifact?{sha256:artifact.sha256,bytes:artifact.bytes}:null}));
}else{console.error('Usage: node scripts/p3-snapshot.mjs create | seal');process.exitCode=2;}
