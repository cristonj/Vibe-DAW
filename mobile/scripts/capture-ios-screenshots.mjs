import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const run=(...args)=>execFileSync('xcrun',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const identity=JSON.parse(fs.readFileSync('app-identity.json','utf8'));
const devices=Object.values(JSON.parse(run('simctl','list','devices','available','-j')).devices).flat();
const phone=devices.filter(d=>/iPhone.*Pro Max/.test(d.name)).at(-1);
const tablet=devices.filter(d=>/iPad Pro.*(13-inch|12.9-inch)/.test(d.name)).at(-1);
if(!phone || !tablet)throw new Error('Required iPhone Pro Max and large iPad Pro simulators missing');
const products='simulator-build/Build/Products/Release-iphonesimulator';
const apps=fs.readdirSync(products).filter(file=>file.endsWith('.app'));
if(apps.length!==1)throw new Error('Expected one generated Simulator application');
const app=path.resolve(products,apps[0]);
fs.mkdirSync('screenshots',{recursive:true});
for(const [name,device] of [['iphone',phone],['ipad',tablet]]){
 console.log(`Capture ${name}: ${device.name}`);
 if(device.state!=='Booted')run('simctl','boot',device.udid);
 run('simctl','bootstatus',device.udid,'-b');
 run('simctl','ui',device.udid,'appearance','light');
 run('simctl','status_bar',device.udid,'override','--time','9:41','--batteryState','charged','--batteryLevel','100','--wifiMode','active','--wifiBars','3');
 run('simctl','install',device.udid,app);
 run('simctl','launch',device.udid,identity.bundle);
 await new Promise(resolve=>setTimeout(resolve,30000));
 run('simctl','io',device.udid,'screenshot',`screenshots/${name}-main.png`);
 run('simctl','shutdown',device.udid);
}
