import { writeFile } from 'node:fs/promises';
import { testApi } from '../tests/helpers/api.js';
const api=await testApi();
await writeFile('.local/dart-http-context.json',JSON.stringify({environment:'isolated-local-test',baseUrl:api.base,account:api.context.first}),{mode:0o600});
console.log(JSON.stringify({status:'ready',environment:'isolated-local-test',baseUrl:api.base,context:'private .local/dart-http-context.json'}));
const close=async()=>{await api.close();process.exit(0);};
process.once('SIGINT',close);process.once('SIGTERM',close);
