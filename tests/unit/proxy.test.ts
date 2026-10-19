import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app.js';
import { trustedProxyHops } from '../../src/config/environment.js';

test('proxy configuration fails closed; local default ignores forwarded IP', async () => {
  assert.equal(trustedProxyHops({}),0);
  assert.equal(trustedProxyHops({TRUST_PROXY_HOPS:'1'}),1);
  for(const value of ['true','2','-1','1junk'])assert.throws(()=>trustedProxyHops({TRUST_PROXY_HOPS:value}));
  for(const hops of [0,1] as const) {
    const api=Router();api.get('/peer',(req,res)=>res.json({ip:req.ip}));
    const server=createApp({api,trustProxyHops:hops,checkReadiness:async()=>true}).listen(0,'127.0.0.1');
    await once(server,'listening');
    try {
      const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/peer`,{
        headers:{'X-Forwarded-For':'198.51.100.7, 203.0.113.9'}});
      const body=await response.json() as {ip:string};
      assert.equal(body.ip,hops===1?'203.0.113.9':'127.0.0.1');
    } finally {server.close();await once(server,'close');}
  }
});
