const fs=require('node:fs'),p=require('node:path'),{spawnSync}=require('node:child_process');
const out='native-probe-evidence';fs.mkdirSync(out,{recursive:true});
const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.NODE_OPTIONS;
const result=spawnSync(process.env.SPEX_INSTALLED_EXECUTABLE,[p.resolve('.github/scripts/fork-native-runtime-probe.mjs')],{env,encoding:'utf8',timeout:480000,maxBuffer:8*1024*1024});
fs.writeFileSync(p.join(out,'stdout.log'),result.stdout||'');fs.writeFileSync(p.join(out,'stderr.log'),result.stderr||'');
console.log(result.stdout||'');console.error(result.stderr||'');if(result.status!==0)throw Error('Packaged native runtime probes failed: '+result.status+' '+(result.error||''));
