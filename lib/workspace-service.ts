import type {PrismaClient,Prisma} from '@prisma/client';
import type {AuthenticatedUser} from './auth';
import {allowedOrigin} from './http';
import {calculate,decimal,definitions,legacyModules,modules,moneyCents} from './model';
import type {Entry,Module} from './model';
import {mapRow} from './migration';
type Store=PrismaClient|Prisma.TransactionClient;
type Bucket={put:(key:string,bytes:ArrayBuffer)=>Promise<void>;get:(key:string)=>Promise<{body:Uint8Array}|null>;delete:(key:string)=>Promise<void>};
export function createWorkspaceHandlers({db:database,getUser,bucket}:{db:PrismaClient;getUser:(req:Request)=>Promise<AuthenticatedUser|null>;bucket:Bucket}){
const json=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
const failure=(e:any)=>json({error:e.code?(e.code==='P2002'?'El lote encontró una identidad/correlativo existente. Consulta el historial y concilia antes de continuar.':'No se pudo completar la operación de datos.'):e.message},e.status||(e.code==='P2034'?409:e.message.startsWith('AUTH:')?401:400));
const unpack=(r:any):Entry=>({...r,data:JSON.parse(r.data),legacyId:r.legacy_id,legacyModule:r.legacy_module,createdAt:r.created_at,updatedAt:r.updated_at,deletedAt:r.deleted_at});
const uuid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
async function hash(text:string|ArrayBuffer){const b=typeof text==='string'?new TextEncoder().encode(text):text;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function context(req:Request,write=false){
 const user=await getUser(req);if(!user)throw Error('AUTH:Inicia sesión para continuar.');
 if(write){const origin=req.headers.get('origin');if(!origin||origin!==allowedOrigin(req))throw Error('AUTH:Origen de solicitud no permitido.');}
 const url=new URL(req.url);if(url.searchParams.get('space')==='demo')throw Error('Solo se admiten datos reales.');const space='live';return{db:database,user,tenant:user.tenantId||user.userId,space};
}
async function all(db:Store,tenant:string,space:string){return(await db.recordEntry.findMany({where:{tenant,space},orderBy:{updated_at:'desc'}})).map(unpack);}
function balanced(entries:Entry[]){return entries.map(r=>{
 if(!['invoices','purchases'].includes(r.module))return r;let paid=0n;for(const p of entries)if(p.module==='payments'&&!p.deletedAt&&!p.legacyId&&p.data.status==='Realizado'&&p.data.documentId===r.id){try{paid+=moneyCents(p.data.amount);}catch{}}
 try{const base=moneyCents(r.legacyId?r.data.openingBalance:r.data.total);return{...r,data:{...r.data,balance:decimal(base-paid),newPayments:decimal(paid),paymentStatus:base-paid<=0n?'Completado':base-paid<moneyCents(r.data.total)?'Parcial':'Pendiente'}};}catch{return{...r,data:{...r.data,balance:null,reconciliationError:true}};}
 });}
function log(db:Store,c:any,id:string|null,action:string,before:any,after:any){return db.audit.create({data:{id:uuid(),tenant:c.tenant,space:c.space,record_id:id,actor:c.user.displayName,action,before:before?JSON.stringify(before):null,after:after?JSON.stringify(after):null,created_at:now()}});}
async function lockPaymentTarget(tx:Prisma.TransactionClient,id:string,tenant:string,space:string){await tx.$queryRaw`SELECT id FROM records WHERE id=${id} AND tenant=${tenant} AND space=${space} FOR UPDATE`;const target=await tx.recordEntry.findFirst({where:{id,tenant,space,deleted_at:null,module:{in:['invoices','purchases']}}});if(!target)throw Error('El documento ya no está disponible para registrar pagos.');}
async function nextCode(db:PrismaClient,c:any,module:Module){
 const key=`${c.tenant}:${c.space}:${module}`,prefix=definitions[module].prefix;
 const existing=await db.recordEntry.findMany({where:{tenant:c.tenant,space:c.space,module},select:{code:true}});
 let max=0;for(const r of existing){const tail=r.code.startsWith(prefix)?r.code.slice(prefix.length):'';if(/^\d+$/.test(tail)){const n=Number(tail);if(!Number.isSafeInteger(n))throw Error('Correlativo fuera del rango seguro. Configura la secuencia antes de continuar.');max=Math.max(max,n);}}
 // The PostgreSQL upsert reserves a number atomically across application instances.
 const rows=await db.$queryRaw<{value:bigint}[]>`INSERT INTO counters (key,value) VALUES (${key},${max+1}) ON CONFLICT(key) DO UPDATE SET value=GREATEST(counters.value,${max})+1 RETURNING value`;
 return prefix+String(rows[0].value).padStart(5,'0');
}
async function GET(req:Request){try{
 const c=await context(req),{db,tenant,space}=c;const url=new URL(req.url),id=url.searchParams.get('record');
 if(url.searchParams.get('file')){if(!bucket)throw Error('Almacenamiento no configurado.');const a=await db.attachment.findFirst({where:{id:url.searchParams.get('file')!,tenant,space}});if(!a)return json({error:'Archivo no encontrado'},404);const o=await bucket.get(a.object_key);if(!o)return json({error:'Contenido no encontrado'},404);return new Response(new Uint8Array(o.body),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});}
 if(id){const found=await db.recordEntry.findFirst({where:{id,tenant,space},select:{id:true}});if(!found)return json({error:'Registro no encontrado'},404);const [events,comments,files]=await Promise.all([db.audit.findMany({where:{record_id:id,tenant,space},orderBy:{created_at:'desc'},take:100,select:{actor:true,action:true,before:true,after:true,created_at:true}}),db.comment.findMany({where:{record_id:id,tenant,space},orderBy:{created_at:'desc'}}),db.attachment.findMany({where:{record_id:id,tenant,space},select:{id:true,name:true,mime:true,size:true,hash:true,created_at:true}})]);return json({events,comments,files});}
 const [entries,prefs,batches]=await Promise.all([all(db,tenant,space),db.preference.findUnique({where:{key:`${tenant}:${space}:settings`}}),db.migrationBatch.findMany({where:{tenant,space},orderBy:{created_at:'desc'}})]);return json({entries:balanced(entries),settings:prefs?JSON.parse(prefs.value):{},batches,user:{name:c.user.displayName,email:c.user.email,role:c.user.role||'admin'},space});
}catch(e:any){return failure(e);}}
async function POST(req:Request){try{
 const c=await context(req,true),{db,tenant,space}=c;
 if(req.headers.get('content-type')?.includes('multipart/form-data')){if(!bucket)throw Error('Almacenamiento no configurado.');const form=await req.formData(),file=form.get('file') as File,recordId=String(form.get('recordId')||'');if(!file||typeof file.arrayBuffer!=='function')throw Error('Selecciona un archivo.');if(file.size>10*1024*1024)throw Error('Máximo 10 MB por archivo.');if(!await db.recordEntry.findFirst({where:{id:recordId,tenant,space,deleted_at:null},select:{id:true}}))throw Error('Registro no encontrado.');const id=uuid(),key=`${tenant}/${space}/${id}`,bytes=await file.arrayBuffer(),digest=await hash(bytes);await bucket.put(key,bytes);try{await db.$transaction([db.attachment.create({data:{id,tenant,space,record_id:recordId,name:file.name,mime:file.type||'application/octet-stream',size:file.size,hash:digest,object_key:key,created_at:now()}}),log(db,c,recordId,'Archivo adjunto',null,{name:file.name,hash:digest})]);}catch(e){await bucket.delete(key);throw e;}return json({ok:true,id});}
 const text=await req.text();if(text.length>2000000)throw Error('La solicitud supera 2 MB. Divide el lote.');const b=JSON.parse(text),action=b.action;if(['settings','migration'].includes(action)&&c.user.role==='ventas')return json({error:'Solo administradores pueden configurar o migrar datos.'},403);
 if(action==='save'){
 const module=b.module as Module;if(!modules.includes(module))throw Error('Módulo no válido.');let data={...b.data};delete data._writeToken;const old=b.id?await db.recordEntry.findFirst({where:{id:b.id,tenant,space,deleted_at:null}}):null;if(b.id&&!old)throw Error('Registro no encontrado.');if(old&&(!Number.isInteger(b.version)||b.version<1))throw Error('Actualiza la ficha antes de guardar.');if(old&&old.module!==module)throw Error('El módulo no coincide.');if(old?.legacy_id)throw Error('El registro migrado se conserva en consulta hasta conciliar las reglas del origen.');
 for(const f of definitions[module].fields){if(f.required&&(data[f.key]===undefined||String(data[f.key]).trim()===''))throw Error(`Completa ${f.label}.`);if(f.type==='money'&&data[f.key]!==undefined&&data[f.key]!=='')moneyCents(data[f.key]);if(f.options&&data[f.key]&&f.type!=='multiselect'&&!f.options.includes(data[f.key]))throw Error(`${f.label}: opción inválida.`);if(f.type==='multiselect'&&(!Array.isArray(data[f.key])||data[f.key].some((x:string)=>!f.options!.includes(x))))throw Error(`${f.label}: selección inválida.`);if(f.type==='email'&&data[f.key]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[f.key]))throw Error('Correo electrónico inválido.');if(f.type==='date'&&data[f.key]&&!/^\d{4}-\d{2}-\d{2}$/.test(data[f.key]))throw Error('Fecha inválida.');if(f.ref&&data[f.key]){if(!await db.recordEntry.findFirst({where:{id:data[f.key],tenant,space,module:f.ref,deleted_at:null},select:{id:true}}))throw Error(`${f.label}: relación no encontrada.`);}}
 if(module==='invoices'&&['Electronica','Cancelar','Devolucion'].includes(data.status))throw Error('La emisión FEL, cancelación y devolución requieren validar la integración del origen. Por ahora registra ventas en estado Creado.');
 if(['invoices','purchases'].includes(module)){data=calculate(data);for(const line of data.lines){if(!await db.recordEntry.findFirst({where:{id:line.productId,tenant,space,module:'products',deleted_at:null},select:{id:true}}))throw Error('Producto de línea no encontrado.');}const fiscal=JSON.parse(old?.data||'{}');for(const key of ['dte','authorization','xml','series','certifiedAt'])if(data[key]&&data[key]!==fiscal[key])throw Error('Los datos fiscales históricos se cargan mediante migración, no manualmente.');}
 if(module==='payments'){if(moneyCents(data.amount)<=0n)throw Error('El pago debe ser mayor que cero.');const doc=await db.recordEntry.findFirst({where:{id:data.documentId,tenant,space,deleted_at:null},select:{module:true}});if(!doc||!['invoices','purchases'].includes(doc.module))throw Error('Selecciona una venta o compra válida.');}
 if(module==='products'){const prev=JSON.parse(old?.data||'{}');if(data.bulkPrice!==undefined&&data.bulkPrice!==''&&String(data.bulkPrice)!==String(prev.bulkPrice??''))data.price=data.bulkPrice;if(data.sku&&data.category&&!String(data.name).includes('Envio'))data.name=`${data.sku}-${data.category}-${(data.usage||[]).join(' | ')} ${data.color||''} ${data.size||''}`.trim();if(data.stock&&!/^-?\d+(\.\d{1,3})?$/.test(String(data.stock)))throw Error('Stock inválido. Conserva hasta 3 decimales.');}
 const id=old?.id||uuid(),code=old?.code||await nextCode(db,c,module),at=now();if(module==='invoices'&&data.name==='Nuevo Envio')data.name=code;data._writeToken=uuid();
 if(old){await db.$transaction(async tx=>{if(module==='payments')await lockPaymentTarget(tx,data.documentId,tenant,space);const changed=await tx.recordEntry.updateMany({where:{id,tenant,space,version:b.version},data:{name:data.name,data:JSON.stringify(data),updated_at:at,version:{increment:1}}});if(!changed.count)throw Object.assign(Error('Otro cambio se guardó antes. Actualiza la ficha y vuelve a intentarlo.'),{status:409});await log(tx,c,id,'Actualizado',JSON.parse(old.data),data);});
 }else await db.$transaction(async tx=>{if(module==='payments')await lockPaymentTarget(tx,data.documentId,tenant,space);await tx.recordEntry.create({data:{id,tenant,space,module,code,name:data.name,data:JSON.stringify(data),created_at:at,updated_at:at,version:1}});await log(tx,c,id,'Creado',null,data);});return json({ok:true,id});
 }
 if(action==='archive'||action==='restore'){
 await db.$transaction(async tx=>{
  // Serialize deletion against payment creation or edits for this document.
  await tx.$queryRaw`SELECT id FROM records WHERE id=${b.id} AND tenant=${tenant} AND space=${space} FOR UPDATE`;
  const r=await tx.recordEntry.findFirst({where:{id:b.id,tenant,space}});if(!r)throw Error('Registro no encontrado.');
  if(['purchases','payments'].includes(r.module))throw Error('Los documentos y pagos se conservan; usa el estado correspondiente.');
  if(r.module==='invoices'){
   const data=JSON.parse(r.data);if(r.legacy_id||data.dte||data.authorization||data.xml||data.status==='Electronica')throw Error('Los documentos fiscales o históricos no se eliminan desde esta opción.');
   if(action==='archive'){const payments=await tx.recordEntry.findMany({where:{tenant,space,module:'payments',deleted_at:null}});if(payments.some(p=>{const d=JSON.parse(p.data);return d.documentId===r.id&&d.status!=='Anulado';}))throw Error('Primero anula los pagos pendientes o realizados relacionados con esta venta.');}
  }
  await tx.recordEntry.update({where:{id:b.id,tenant,space},data:{deleted_at:action==='archive'?now():null,updated_at:now(),version:{increment:1}}});await log(tx,c,b.id,action==='archive'?'Archivado':'Restaurado',JSON.parse(r.data),null);
 });return json({ok:true});}
 if(action==='comment'){const body=String(b.body||'').trim();if(!body||body.length>5000)throw Error('Escribe un comentario de hasta 5000 caracteres.');if(!await db.recordEntry.findFirst({where:{id:b.id,tenant,space},select:{id:true}}))throw Error('Registro no encontrado.');await db.$transaction([db.comment.create({data:{id:uuid(),tenant,space,record_id:b.id,body,actor:c.user.displayName,created_at:now()}}),log(db,c,b.id,'Comentario',null,{body})]);return json({ok:true});}
 if(action==='settings'){const settings=b.settings||{};if(JSON.stringify(settings).length>150000)throw Error('Configuración demasiado grande.');await db.$transaction([db.preference.upsert({where:{key:`${tenant}:${space}:settings`},create:{key:`${tenant}:${space}:settings`,value:JSON.stringify(settings)},update:{value:JSON.stringify(settings)}}),log(db,c,null,'Configuración actualizada',null,settings)]);return json({ok:true});}
 if(action==='migration'){
 const module=b.module as Module;if(!modules.includes(module)||!Array.isArray(b.rows)||b.rows.length>100)throw Error('Selecciona un módulo y un lote de hasta 100 filas.');const entries=await all(db,tenant,space),mapped=[];
 for(let i=0;i<b.rows.length;i++){let result:{data:Record<string,any>;errors:string[];warnings:string[]};try{result=mapRow(module,b.rows[i],b.mapping||{});}catch(e:any){result={data:{},errors:[e.message],warnings:[]};}const{data,errors,warnings}=result;
 for(const f of definitions[module].fields.filter(x=>x.ref||x.type==='document'))if(data[f.key]){const candidate=entries.find(r=>!r.deletedAt&&(f.ref?r.module===f.ref:['invoices','purchases'].includes(r.module))&&(r.legacyId===String(data[f.key])||r.id===data[f.key]||r.code===data[f.key]));if(candidate)data[f.key]=candidate.id;else errors.push(`No se resolvió ${f.label} por ID/correlativo.`);}
 if(data.lines)for(const l of data.lines){const product=entries.find(r=>r.module==='products'&&(r.id===l.productId||r.legacyId===String(l.productId)||r.code===l.productId));if(product)l.productId=product.id;else errors.push('Producto de partida no resuelto.');}
 const exists=entries.find(r=>r.module===module&&r.legacyId===String(data.legacy_id)&&r.legacyModule===legacyModules[module]);mapped.push({row:i+2,data,errors,warnings,exists:!!exists});}
 if(!b.commit)return json({preview:mapped});if(mapped.some(r=>r.errors.length))throw Error('Hay errores. Resuélvelos antes de importar.');
 const batchId=uuid(),at=now(),statements=[];let inserted=0,skipped=0;
 for(const row of mapped){if(row.exists){skipped++;continue;}const d=row.data,legacyId=String(d.legacy_id),id=(await hash(`${tenant}:${space}:${module}:${legacyModules[module]}:${legacyId}`)).slice(0,32),code=String(d.code||`LEG-${legacyId}`);delete d.legacy_id;d.migrationBatch=batchId;d.reconciliationPending=!!row.warnings.length;statements.push(db.recordEntry.create({data:{id,tenant,space,module,code,name:String(d.name),data:JSON.stringify(d),legacy_id:legacyId,legacy_module:legacyModules[module],raw:JSON.stringify(b.rows[row.row-2]),created_at:d.createdAt||at,updated_at:d.updatedAt||at,version:1}}));inserted++;}
 const summary={inserted,skipped,warnings:mapped.filter(r=>r.warnings.length).length,total:mapped.length,mode:'Sin automatizaciones; registros históricos en consulta'};statements.push(db.migrationBatch.create({data:{id:batchId,tenant,space,module,filename:String(b.filename||'archivo.csv'),hash:await hash(JSON.stringify(b.rows)),summary:JSON.stringify(summary),created_at:at}}),log(db,c,null,'Importación histórica',null,summary));await db.$transaction(statements);return json({ok:true,summary});
 }
 throw Error('Acción no válida.');
}catch(e:any){return failure(e);}}

return {GET,POST};
}
