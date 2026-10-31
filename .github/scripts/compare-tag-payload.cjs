const fs=require('node:fs'),assert=require('node:assert/strict');
const a=JSON.parse(fs.readFileSync('source-proof/source-package-manifest.json')),b=JSON.parse(fs.readFileSync('tag-package-manifest.json'));
assert.equal(a.platform,b.platform);assert.deepEqual(a.packages,b.packages,'Packaged dependency names and versions changed');
// Actual execution code and declared metadata must be identical. Native build
// outputs are compared separately and exercised by the installed executable.
const selected=x=>Object.fromEntries(Object.entries(x.files).filter(([,v])=>v.lfSha256!==undefined).map(([p,v])=>[p,v.lfSha256]));
const expected=selected(a),actual=selected(b);const changed=Object.keys(expected).filter(p=>actual[p]!==expected[p]);const added=Object.keys(actual).filter(p=>!(p in expected));
const native=[];for(const[p,v]of Object.entries(a.files))if(/\.node$/.test(p)&&b.files[p]&&v.sha256!==b.files[p].sha256)native.push(p);
const proof={platform:b.platform,sourceAsar:a.asarSha256,tagAsar:b.asarSha256,comparedExecutionFiles:Object.keys(expected).length,changed,added,nativeBinaryDifferences:native,outsideIdentical:JSON.stringify(a.outside)===JSON.stringify(b.outside)};
fs.writeFileSync('tag-payload-comparison.json',JSON.stringify(proof,null,2));assert.deepEqual(changed,[],'Source and Tag execution payload differs');assert.deepEqual(added,[],'Tag has unreviewed execution files');console.log(JSON.stringify(proof));
