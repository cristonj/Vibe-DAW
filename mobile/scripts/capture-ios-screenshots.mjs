import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const query=(...args)=>execFileSync('xcrun',args,{encoding:'utf8',timeout:60000,killSignal:'SIGKILL'});
const run=(args,timeout=60000)=>{console.log('xcrun '+args.join(' '));execFileSync('xcrun',args,{stdio:'inherit',timeout,killSignal:'SIGKILL'});};
const identity=JSON.parse(fs.readFileSync('app-identity.json','utf8'));
const inventory=JSON.parse(query('simctl','list','devices','available','-j')).devices;
const runtimes=Object.keys(inventory).filter(k=>k.includes('.iOS-')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const types=JSON.parse(query('simctl','list','devicetypes','-j')).devicetypes;
const devices=runtimes.flatMap(runtime=>inventory[runtime].map(device=>({...device,runtime})));
console.log('Available devices: '+JSON.stringify(devices.map(d=>({name:d.name,runtime:d.runtime}))));
const phones=devices.filter(d=>/iPhone.*Pro Max/.test(d.name));
// Prefer an established 13-inch model; new-device first boots can stall on hosted runners.
const tablets=devices.filter(d=>/iPad Pro.*(13-inch|12.9-inch)/.test(d.name));
tablets.sort((a,b)=>Number(/M4/.test(b.name))-Number(/M4/.test(a.name)));
const products='simulator-build/Build/Products/Release-iphonesimulator';
const apps=fs.readdirSync(products).filter(file=>file.endsWith('.app'));
if(apps.length!==1)throw new Error('Expected one generated Simulator application');
const app=path.resolve(products,apps[0]);
fs.mkdirSync('screenshots',{recursive:true});
const requested=process.argv[2];
for(const [name,candidates] of [['iphone',phones],['ipad',tablets]]){
 if(requested && requested!==name)continue;
 let captured=false;
 const type=name==='iphone'?(types.find(t=>/iPhone 16 Pro Max/.test(t.name))||types.find(t=>/iPhone.*Pro Max/.test(t.name))):(types.find(t=>/iPad Pro.*13-inch.*M4/.test(t.name))||types.find(t=>/iPad Air.*13-inch/.test(t.name))||types.find(t=>/iPad Pro.*13-inch/.test(t.name)));
 const fresh=type?runtimes.slice(0,2).map(runtime=>({name:type.name,runtime,state:'Shutdown',type:type.identifier})):candidates.slice(0,2);
 for(const candidate of fresh){
  const device={...candidate,udid:candidate.udid};
  try {
   console.log(`Capture ${name}: ${device.name} (${device.runtime})`);
   if(device.type)device.udid=query('simctl','create',`Store capture ${name}`,device.type,device.runtime).trim();
   if(device.state!=='Booted')run(['simctl','boot',device.udid]);
   run(['simctl','bootstatus',device.udid,'-b'],240000);
   run(['simctl','ui',device.udid,'appearance','light']);
   run(['simctl','status_bar',device.udid,'override','--time','9:41','--batteryState','charged','--batteryLevel','100','--wifiMode','active','--wifiBars','3']);
   run(['simctl','install',device.udid,app],120000);
   run(['simctl','launch',device.udid,identity.bundle]);
   await new Promise(resolve=>setTimeout(resolve,30000));
   run(['simctl','io',device.udid,'screenshot','--type=jpeg',`screenshots/${name}-main.jpg`]);
   captured=true;
  } catch(error) {console.error(`Capture failed on ${device.name}: ${error.message}`);}
  finally {try{run(['simctl','shutdown',device.udid],30000);}catch{}}
  if(captured)break;
 }
 if(!captured)throw new Error(`No ${name} capture succeeded; inspect the per-command log.`);
}
