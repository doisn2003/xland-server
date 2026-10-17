import {spawn} from 'node:child_process';
export function runLocalChild(args,{timeoutMs=180000,stdio='inherit'}={}){
 const child=spawn(process.execPath,args,{stdio,windowsHide:true});
 const done=new Promise((ok,fail)=>{
 let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
 child.once('error',()=>{clearTimeout(timer);fail(new Error('LOCAL_TEST_CHILD_START_FAILED'));});
 child.once('exit',code=>{clearTimeout(timer);if(timedOut)fail(new Error('LOCAL_TEST_SUBPROCESS_TIMEOUT; owned child stopped, test DB retained'));else if(code===0)ok();else fail(new Error(`LOCAL_TEST_CHILD_EXIT_${code}`));});
 });return {child,done};
}
