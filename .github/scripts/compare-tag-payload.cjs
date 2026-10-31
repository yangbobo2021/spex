const fs=require('node:fs'),assert=require('node:assert/strict');
const source=JSON.parse(fs.readFileSync('source-proof/source-package-manifest.json')),tag=JSON.parse(fs.readFileSync('tag-package-manifest.json'));
assert.equal(source.platform,tag.platform);assert.deepEqual(source.packages,tag.packages,'Packaged dependency names and versions changed');
// Native compilation can embed build identities. Keep all shipped sources,
// scripts, prompts, SDK executables and links exact; report native build
// products separately and exercise their installed APIs in the preceding step.
const buildProduct=p=>/^node_modules\/(?:better-sqlite3|@vscode\/windows-process-tree)\/build\//.test(p);
const nativeModule=p=>/\.node$/.test(p)&&/^node_modules\/(?:better-sqlite3|@vscode\/windows-process-tree)\//.test(p);
const expected=Object.fromEntries(Object.entries(source.files).filter(([p])=>!buildProduct(p)&&!nativeModule(p)));
const actual=Object.fromEntries(Object.entries(tag.files).filter(([p])=>!buildProduct(p)&&!nativeModule(p)));
const changed=Object.keys(expected).filter(p=>!actual[p]||(expected[p].lfSha256||expected[p].sha256||expected[p].link)!==(actual[p].lfSha256||actual[p].sha256||actual[p].link)||expected[p].executable!==actual[p].executable);
const added=Object.keys(actual).filter(p=>!(p in expected));
const differences=Object.keys(source.files).filter(p=>tag.files[p]&&source.files[p].sha256!==tag.files[p].sha256);
const native=Object.keys(source.files).filter(p=>/\.node$/.test(p)&&tag.files[p]&&source.files[p].sha256!==tag.files[p].sha256);
const outsideChanged=JSON.stringify(source.outside)!==JSON.stringify(tag.outside);
const proof={platform:tag.platform,sourceAsar:source.asarSha256,tagAsar:tag.asarSha256,comparedRuntimeFiles:Object.keys(expected).length,changed,added,nativeBinaryDifferences:native,allByteDifferences:differences,outsideChanged};
fs.writeFileSync('tag-payload-comparison.json',JSON.stringify(proof,null,2));
assert.deepEqual(changed,[],'Tested source and published Tag runtime payload differs');assert.deepEqual(added,[],'Tag has unreviewed runtime files');
if(source.platform==='darwin')assert.deepEqual(source.outside.electronFramework,tag.outside.electronFramework,'Electron Framework changed');
if(source.platform==='win32'){
 assert.equal(source.outside.electronExecutable.machine,tag.outside.electronExecutable.machine);
 const executionSections=x=>Object.fromEntries(Object.entries(x.sections).filter(([name])=>name!=='.rsrc'));
 assert.deepEqual(executionSections(source.outside.electronExecutable),executionSections(tag.outside.electronExecutable),'Electron execution sections changed');
}
console.log(JSON.stringify(proof));
