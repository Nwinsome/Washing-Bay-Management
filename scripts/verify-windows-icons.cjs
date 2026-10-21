const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const PE=require('pe-library');
const {Resource}=require('resedit');
const root=path.resolve(__dirname,'..');
function verifyWindowsIcons(filename){
 const icon=fs.readFileSync(path.join(root,'assets/washing-bay-logo.ico'));
 const sizes=[16,24,32,48,64,128,256];
 if(icon.readUInt16LE(0)!==0||icon.readUInt16LE(2)!==1||icon.readUInt16LE(4)!==sizes.length)throw Error('Invalid Washing Bay ICO header.');
 const frames=sizes.map((size,index)=>{
  const entry=6+16*index,offset=icon.readUInt32LE(entry+12),length=icon.readUInt32LE(entry+8);
  if((icon[entry]||256)!==size||(icon[entry+1]||256)!==size||offset+length>icon.length)throw Error('Invalid Washing Bay ICO frame.');
  return {size,bytes:icon.subarray(offset,offset+length)};
 });
 const bytes=fs.readFileSync(filename);
 const resources=PE.NtExecutableResource.from(PE.NtExecutable.from(bytes,{ignoreCert:true}));
 const groups=Resource.IconGroupEntry.fromEntries(resources.entries);
 if(!groups.length)throw Error('Executable has no Windows icon group: '+filename);
 for(const group of groups){
  if(group.icons.length!==frames.length)throw Error('Unexpected icon sizes: '+filename);
  for(const frame of frames){
   const item=group.icons.find(i=>(i.width||256)===frame.size&&(i.height||256)===frame.size);
   const resource=item&&resources.entries.find(r=>r.type===3&&r.id===item.iconID&&r.lang===group.lang);
   if(!resource||!Buffer.from(resource.bin).equals(frame.bytes))throw Error(`Wrong ${frame.size}px Windows icon resource: ${filename}`);
  }
 }
 return {filename:path.basename(filename),sha256:createHash('sha256').update(bytes).digest('hex'),sizes,groups:groups.map(g=>({id:g.id,language:g.lang}))};
}
if(require.main===module){
 const filename=process.argv[2];if(!filename)throw Error('Provide the generated uninstaller path.');
 const report=verifyWindowsIcons(filename);
 if(process.argv[3]==='--capture-uninstaller'){
  const version=require('../package.json').version;
  const folder=path.join(root,'release-verification',version);fs.mkdirSync(folder,{recursive:true});
  fs.copyFileSync(filename,path.join(folder,'generated-uninstaller.exe'));
  fs.writeFileSync(path.join(folder,'uninstaller-icons.json'),JSON.stringify({...report,version},null,2)+'\n');
 }
 console.log(`Verified Washing Bay Windows icon resources (${report.sizes.join(', ')}px): ${report.filename}`);
}
module.exports={verifyWindowsIcons};
