const fs=require('node:fs');const path=require('node:path');
function validateLogo(bytes,mimeType){
 if(!(bytes instanceof Uint8Array)||!['image/png','image/jpeg','image/webp'].includes(mimeType)||!bytes.byteLength||bytes.byteLength>5*1024*1024)throw Error('Logo must be a PNG, JPEG or WebP image of at most 5 MB.');
 const b=Buffer.from(bytes);const valid=mimeType==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mimeType==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
 if(!valid)throw Error('The logo file does not match its image format.');return b;
}
function readLegacyLogo(filename,logoRoot,io=fs){
 if(!logoRoot)throw Error('Legacy logo storage is unavailable.');
 const root=io.realpathSync(logoRoot),resolved=io.realpathSync(filename),relative=path.relative(root,resolved);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||io.lstatSync(filename).isSymbolicLink())throw Error('Legacy logo must be inside the application logo directory.');
 const stat=io.statSync(resolved);if(!stat.isFile()||stat.size>5*1024*1024)throw Error('Legacy logo is missing or too large.');
 const bytes=io.readFileSync(resolved);const mimeType=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':'image/webp';
 return {bytes:validateLogo(bytes,mimeType),mimeType};
}
module.exports={validateLogo,readLegacyLogo};
