import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForLocalReady} from './local-postgres.mjs';
import {runLocalChild} from './run-local-child.mjs';
test('recovery transitions to ready without another start attempt',async()=>{let attempts=0;const result=await waitForLocalReady(async()=>{if(++attempts<3)throw Object.assign(new Error('recovery'),{code:'57P03'});},{timeoutMs:200,intervalMs:1});assert.equal(result.attempts,3);});
test('recovery deadline fails and credentials fail immediately',async()=>{await assert.rejects(waitForLocalReady(async()=>{throw Error('not ready');},{timeoutMs:10,intervalMs:1}),/READY_TIMEOUT/);let attempts=0;await assert.rejects(waitForLocalReady(async()=>{attempts++;throw Object.assign(Error('private'),{code:'28P01'});}),/authentication failed/);assert.equal(attempts,1);});
test('owned child timeout terminates process and rejects; nonzero exit survives',async()=>{const timed=runLocalChild(['-e','setInterval(()=>{},1000)'],{timeoutMs:100,stdio:'ignore'});await assert.rejects(timed.done,/SUBPROCESS_TIMEOUT/);assert.throws(()=>process.kill(timed.child.pid,0));await assert.rejects(runLocalChild(['-e','process.exit(7)'],{stdio:'ignore'}).done,/EXIT_7/);await runLocalChild(['-e','process.exit(0)'],{stdio:'ignore'}).done;});
// Avoid embedded-postgres's beforeExit(0) masking node:test failure status.
process.once('beforeExit',()=>{if(process.exitCode)process.exit(process.exitCode);});
