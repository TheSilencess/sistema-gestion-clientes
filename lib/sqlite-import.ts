import {DatabaseSync} from 'node:sqlite';
import type {PrismaClient} from '@prisma/client';
import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function importSQLite(args:string[],prisma:PrismaClient){
const arg=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];},source=arg('--source');
if(!source)throw Error('Uso: npm run db:import-sqlite -- --source ruta/gift.sqlite [--files ruta/files] [--commit]');
const commit=args.includes('--commit'),db=new DatabaseSync(path.resolve(source),{readOnly:true});
const tableExists=(name:string)=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
const names=['records','audit','counters','preferences','attachments','comments','migration_batches','app_users'];
const data:Record<string,Record<string,any>[]>={};
try{
 db.exec('BEGIN');
 if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('La copia SQLite no pasó la comprobación de integridad.');
 for(const name of names){if(!tableExists(name)){data[name]=[];continue;}data[name]=db.prepare(`SELECT * FROM ${name}`).all().filter(row=>name==='app_users'||(['counters','preferences'].includes(name)?String(row.key).includes(':live:'):row.space==='live'));}
 db.exec('COMMIT');
 console.log('Vista previa: solo datos reales. No se transfieren sesiones ni ejemplos.');for(const name of names)console.log(`${name}: ${data[name].length}`);
 if(!commit){console.log('No se guardaron cambios. Añade --commit tras revisar la copia y la conexión de destino.');}
 else{
  if(!process.env.DATABASE_URL)throw Error('Configura DATABASE_URL para PostgreSQL.');
  const counts=await prisma.$transaction([prisma.recordEntry.count(),prisma.audit.count(),prisma.counter.count(),prisma.preference.count(),prisma.attachment.count(),prisma.comment.count(),prisma.migrationBatch.count(),prisma.appUser.count()]);
  if(counts.some(Boolean))throw Error('El destino debe estar vacío. No se reemplazan registros existentes.');
  if(data.attachments.length&&!arg('--files'))throw Error('Hay adjuntos. Debes indicar --files con la copia de los archivos.');
  const sourceBase=path.resolve(arg('--files')||'.'),destination=path.resolve(process.env.UPLOAD_DIR||'.local/files');
  for(const a of data.attachments){const key=String(a.object_key),input=path.resolve(sourceBase,key),output=path.resolve(destination,key);if(!input.startsWith(sourceBase+path.sep)||!output.startsWith(destination+path.sep))throw Error('Ruta de adjunto inválida.');const bytes=await readFile(input);if(createHash('sha256').update(bytes).digest('hex')!==a.hash||bytes.length!==a.size)throw Error('Un adjunto no coincide con su hash o tamaño.');await mkdir(path.dirname(output),{recursive:true});try{await copyFile(input,output,constants.COPYFILE_EXCL);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||createHash('sha256').update(await readFile(output)).digest('hex')!==a.hash)throw e;}}
  await prisma.$transaction(async tx=>{
   if((await tx.recordEntry.count())||(await tx.appUser.count()))throw Error('El destino ya contiene datos.');
   for(const r of data.records)await tx.recordEntry.create({data:{id:r.id,tenant:r.tenant,space:r.space,module:r.module,code:r.code,name:r.name,data:r.data,legacy_id:r.legacy_id,legacy_module:r.legacy_module,raw:r.raw,created_at:r.created_at,updated_at:r.updated_at,version:r.version,deleted_at:r.deleted_at}});
   for(const r of data.audit)await tx.audit.create({data:r as any});
   for(const r of data.counters)await tx.counter.create({data:{key:r.key,value:BigInt(r.value)}});
   for(const r of data.preferences)await tx.preference.create({data:{key:r.key,value:r.value}});
   for(const r of data.attachments)await tx.attachment.create({data:r as any});
   for(const r of data.comments)await tx.comment.create({data:r as any});
   for(const r of data.migration_batches)await tx.migrationBatch.create({data:r as any});
   for(const r of data.app_users)await tx.appUser.create({data:{id:r.id,username:r.username,name:r.name,role:r.role,salt:r.salt,hash:r.hash,active:!!r.active}});
  },{isolationLevel:'Serializable',timeout:120000});
  console.log('Importación completada: IDs, contraseñas protegidas e históricos conservados. Debes volver a iniciar sesión.');
 }
}finally{db.close();}
}
