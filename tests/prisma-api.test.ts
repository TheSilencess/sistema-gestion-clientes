import {test as nodeTest,after} from 'node:test';
import assert from 'node:assert/strict';
import {prisma} from '../lib/prisma';
import {createWorkspaceHandlers} from '../lib/workspace-service';
import {createAuthHandlers,userFor} from '../lib/auth';
const enabled=process.env.GIFT_TEST_DATABASE==='1';
const test:typeof nodeTest=(...args:any[])=>enabled?(nodeTest as any)(...args):(nodeTest as any)(args[0],{skip:'Configura una base PostgreSQL vacía y GIFT_TEST_DATABASE=1.'},args[args.length-1]);
if(enabled&&await prisma.recordEntry.count())throw Error('Las pruebas necesitan una base de datos vacía y exclusiva de pruebas.');
process.env.APP_URL='https://example.test';
let identity:any={userId:'owner',displayName:'Propietaria de prueba',email:'example@example.test',role:'admin'};
const files=new Map<string,ArrayBuffer>();
const bucket={async put(key:string,b:ArrayBuffer){files.set(key,b);},async get(key:string){const b=files.get(key);return b?{body:new Uint8Array(b)}:null;},async delete(key:string){files.delete(key);}};
const route=createWorkspaceHandlers({db:prisma,getUser:async()=>identity,bucket});
after(async()=>{await prisma.$disconnect();await (globalThis as any).giftTestClose?.();});
const url='https://example.test/api/workspace?space=live';
async function call(body,origin='https://example.test'){const r=await route.POST(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}));return{status:r.status,...await r.json()};}
async function get(space='live'){return(await route.GET(new Request('https://example.test/api/workspace?space='+space))).json();}
const customer={name:'Cliente de prueba',nit:'CF',assigned:'Propietaria',address:'Dirección ficticia'};
test('flujo completo, saldos, control de versiones e historial',async()=>{
 const c=await call({action:'save',module:'customers',data:customer});assert.equal(c.status,200);
 const p=await call({action:'save',module:'products',data:{name:'Producto',sku:'LUNA',category:'ZAPATOS',usage:['MUJER'],size:'37.5',color:'NEGRO',price:'215',stock:'5',assigned:'Propietaria'}});assert.equal(p.status,200);
 const inv=await call({action:'save',module:'invoices',data:{name:'Nuevo Envio',date:'2026-10-18',customerId:c.id,address:'Dirección',nit:'CF',status:'Creado',cancellationReason:'No anulada',assigned:'Propietaria',paymentMethod:'Deposito',carrier:'Forza',company:'Gift',lines:[{productId:p.id,quantity:'1',price:'215'}]}});assert.equal(inv.status,200);
 const abono=await call({action:'save',module:'payments',data:{name:'Abono',date:'2026-10-18',documentId:inv.id,amount:'100',status:'Realizado',assigned:'Propietaria'}});assert.equal(abono.status,200);
 let all=await get();assert.equal(all.entries.find(r=>r.id===inv.id).data.balance,'115.00');assert.equal(all.entries.find(r=>r.id===p.id).data.stock,'5');
 const payment=all.entries.find(r=>r.id===abono.id),upd=await call({action:'save',module:'payments',id:payment.id,version:payment.version,data:{...payment.data,status:'Anulado'}});assert.equal(upd.status,200);all=await get();assert.equal(all.entries.find(r=>r.id===inv.id).data.balance,'215.00');
 const conflict=await call({action:'save',module:'payments',id:payment.id,version:payment.version,data:{...payment.data,status:'Realizado'}});assert.equal(conflict.status,409);assert.equal((await call({action:'save',module:'payments',id:payment.id,data:payment.data})).status,400);
 const history=await(await route.GET(new Request(url+'&record='+payment.id))).json();assert.equal(history.events.length,2);
 const reject=await call({action:'save',module:'invoices',data:{...all.entries.find(r=>r.id===inv.id).data,status:'Electronica'}});assert.equal(reject.status,400);assert.match(reject.error,/FEL/);
 assert.equal((await call({action:'archive',id:inv.id})).status,200);assert.ok((await get()).entries.find(r=>r.id===inv.id).deletedAt);assert.equal((await call({action:'restore',id:inv.id})).status,200);
});
test('aislamiento entre identidades, espacios y protección de origen',async()=>{
 const before=await get();assert.ok(before.entries.length>0);assert.match((await get('demo')).error,/datos reales/);
 identity={userId:'other-user',displayName:'Otra persona',email:'other@example.test'};assert.equal((await get()).entries.length,0);assert.equal((await call({action:'save',module:'customers',data:customer},'https://attacker.test')).status,401);
 identity=null;assert.equal((await route.GET(new Request(url))).status,401);identity={userId:'owner',displayName:'Propietaria',email:'example@example.test'};
});
test('migración atómica, idempotencia e históricos protegidos',async()=>{
 const body={action:'migration',module:'customers',rows:[{old:'100',name:'Histórico',nit:'CF',assigned:'Antigua'}],mapping:{old:'legacy_id',name:'name',nit:'nit',assigned:'assigned'},filename:'clientes.csv'};
 const preview=await call(body);assert.equal(preview.preview[0].errors.length,0);assert.equal((await get()).entries.filter(r=>r.legacyId==='100').length,0);
 const imported=await call({...body,commit:true});assert.equal(imported.summary.inserted,1);const repeated=await call({...body,commit:true});assert.equal(repeated.summary.skipped,1);const old=(await get()).entries.find(r=>r.legacyId==='100');assert.ok(old.raw);
 assert.equal((await call({action:'save',module:'customers',id:old.id,version:1,data:{...old.data,name:'Cambio'}})).status,400);
 const conflict={...body,rows:[{old:'200',name:'Uno',code:'DUP'},{old:'201',name:'Dos',code:'DUP'}],mapping:{old:'legacy_id',name:'name',code:'code'},commit:true};assert.equal((await call(conflict)).status,400);assert.equal((await get()).entries.filter(r=>['200','201'].includes(r.legacyId)).length,0);
});
test('saldos migrados no descuentan dos veces pagos históricos',async()=>{
 const existing=(await get()).entries.find(r=>r.module==='customers');
 const inv={action:'migration',module:'invoices',rows:[{id:'inv-old',name:'F antiguo',total:'250',balance:'150',customer:existing.id}],mapping:{id:'legacy_id',name:'name',total:'total',balance:'openingBalance',customer:'customerId'},commit:true};assert.equal((await call(inv)).status,200);
 const old=(await get()).entries.find(r=>r.legacyId==='inv-old');const payment={action:'migration',module:'payments',rows:[{id:'payment-old',name:'Pago antiguo',amount:'100',document:old.id,status:'Realizado'}],mapping:{id:'legacy_id',name:'name',amount:'amount',document:'documentId',status:'status'},commit:true};assert.equal((await call(payment)).status,200);assert.equal((await get()).entries.find(r=>r.id===old.id).data.balance,'150.00');
 const abono=await call({action:'save',module:'payments',data:{name:'Abono nuevo',date:'2026-10-18',documentId:old.id,amount:'50',status:'Realizado',assigned:'Propietaria'}});assert.equal(abono.status,200);assert.equal((await get()).entries.find(r=>r.id===old.id).data.balance,'100.00');
});
test('un correlativo importado reserva los siguientes números nuevos',async()=>{
 const batch={action:'migration',module:'customers',rows:[{id:'sequence-old',name:'Cliente histórico',code:'ACC00050'}],mapping:{id:'legacy_id',name:'name',code:'code'},commit:true};assert.equal((await call(batch)).status,200);
 const created=await call({action:'save',module:'customers',data:{name:'Cliente posterior',nit:'CF',assigned:'Propietaria'}});assert.equal(created.status,200);assert.equal((await get()).entries.find(r=>r.id===created.id).code,'ACC00051');
});

test('ventas comparte datos, registra operaciones y no administra configuraci�n ni migraciones',async()=>{
 identity={userId:'sales-user',tenantId:'owner',role:'ventas',displayName:'Vendedora de prueba',email:'sales@example.test'};
 assert.ok((await get()).entries.length>0);
 assert.equal((await call({action:'settings',settings:{}})).status,403);
 assert.equal((await call({action:'migration',module:'customers',rows:[]})).status,403);
 const c=await call({action:'save',module:'customers',data:{...customer,name:'Cliente de ventas'}});assert.equal(c.status,200);
 const history=await(await route.GET(new Request(url+'&record='+c.id))).json();assert.equal(history.events[0].actor,'Vendedora de prueba');
 assert.equal((await call({action:'demo'})).status,400);
 identity={userId:'owner',role:'admin',displayName:'Admin',email:'admin@example.test'};assert.ok((await get()).entries.some(r=>r.id===c.id));
});

test('estados de pagos y papelera de ventas conservan los saldos',async()=>{
 const invoice=(await get()).entries.find((r:any)=>r.module==='invoices'&&!r.legacyId),base=invoice.data.balance;
 const pending=await call({action:'save',module:'payments',data:{name:'Abono en revisión',date:'2026-10-20',documentId:invoice.id,amount:base,status:'Pendiente',assigned:'Ventas'}});assert.equal(pending.status,200);
 let all=await get();assert.equal(all.entries.find((r:any)=>r.id===invoice.id).data.balance,base);assert.equal(all.entries.find((r:any)=>r.id===invoice.id).data.paymentStatus,'Pendiente');
 assert.equal((await call({action:'archive',id:invoice.id})).status,400);
 let payment=all.entries.find((r:any)=>r.id===pending.id);assert.equal((await call({action:'save',module:'payments',id:payment.id,version:payment.version,data:{...payment.data,status:'Realizado'}})).status,200);
 all=await get();assert.equal(all.entries.find((r:any)=>r.id===invoice.id).data.balance,'0.00');assert.equal(all.entries.find((r:any)=>r.id===invoice.id).data.paymentStatus,'Completado');assert.equal((await call({action:'archive',id:invoice.id})).status,400);
 payment=all.entries.find((r:any)=>r.id===pending.id);assert.equal((await call({action:'save',module:'payments',id:payment.id,version:payment.version,data:{...payment.data,status:'Anulado'}})).status,200);
 assert.equal((await get()).entries.find((r:any)=>r.id===invoice.id).data.balance,base);assert.equal((await call({action:'archive',id:invoice.id})).status,200);
 assert.equal((await call({action:'save',module:'payments',data:{...payment.data,status:'Realizado'}})).status,400);
 const archived=(await get()).entries.find((r:any)=>r.id===invoice.id);assert.ok(archived.deletedAt);
 const history=await(await route.GET(new Request(url+'&record='+invoice.id))).json();assert.ok(history.events.some((r:any)=>r.action==='Archivado'));
 assert.equal((await call({action:'restore',id:invoice.id})).status,200);assert.equal((await get()).entries.find((r:any)=>r.id===invoice.id).data.balance,base);
 const original=await prisma.recordEntry.findUniqueOrThrow({where:{id:invoice.id}}),data=JSON.parse(original.data);await prisma.recordEntry.update({where:{id:invoice.id},data:{data:JSON.stringify({...data,dte:'TEST-DTE'})}});assert.equal((await call({action:'archive',id:invoice.id})).status,400);await prisma.recordEntry.update({where:{id:invoice.id},data:{data:original.data}});
});
test('cuentas reales, contraseñas protegidas, permisos, archivos y revocación de sesiones',async()=>{
 const auth=createAuthHandlers(prisma);let cookie='';
 async function authCall(path:string,body?:any,session=cookie,origin='https://example.test'){const r=await auth(new Request('https://example.test'+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:session,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 assert.equal((await authCall('/api/auth/session')).data.needsSetup,true);
 const account={username:'admin.test',name:'Admin de pruebas',password:'testing-only-strong-password'};
 assert.equal((await authCall('/api/auth/setup',account,'','https://attacker.test')).status,403);
 assert.equal((await authCall('/api/auth/setup',account)).status,200);
 assert.equal((await authCall('/api/auth/setup',account)).status,409);
 assert.equal((await authCall('/api/auth/login',{...account,password:'incorrecta'})).status,401);
 cookie=(await authCall('/api/auth/login',account)).cookie!;
 assert.ok(cookie);const owner=await userFor(prisma,new Request('https://example.test',{headers:{Cookie:cookie}}));assert.equal(owner!.role,'admin');
 assert.equal((await authCall('/api/users',{action:'update',id:owner!.id,role:'ventas',active:true})).status,400);
 assert.equal((await authCall('/api/users',{action:'create',username:'sales.test',name:'Ventas de pruebas',password:'testing-only-sales-password',role:'ventas'})).status,200);
 const salesCookie=(await authCall('/api/auth/login',{username:'sales.test',password:'testing-only-sales-password'})).cookie!;
 assert.equal((await authCall('/api/users',undefined,salesCookie)).status,403);
 const actual=createWorkspaceHandlers({db:prisma,getUser:req=>userFor(prisma,req),bucket});
 const salesRequest=(body:any)=>new Request(url,{method:'POST',headers:{Origin:'https://example.test',Cookie:salesCookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await actual.POST(salesRequest({action:'settings',settings:{}}))).status,403);
 const res=await actual.POST(salesRequest({action:'save',module:'documents',data:{name:'Documento de prueba',folder:'Default',type:'Interno',active:true,assigned:'Ventas'}}));assert.equal(res.status,200);const doc=await res.json();
 const form=new FormData();form.append('recordId',doc.id);form.append('file',new File(['Prueba de integridad.'],'prueba.txt'));
 const upload=await actual.POST(new Request(url,{method:'POST',headers:{Origin:'https://example.test',Cookie:salesCookie},body:form}));assert.equal(upload.status,200);const file=await upload.json();
 const download=await actual.GET(new Request(url+'&file='+file.id,{headers:{Cookie:cookie}}));assert.equal(await download.text(),'Prueba de integridad.');
 const users=(await authCall('/api/users')).data.users,sales=users.find((u:any)=>u.role==='ventas');
 assert.equal((await authCall('/api/users',{action:'reset',id:sales.id,password:'testing-only-reset-password'})).status,200);
 assert.equal(await userFor(prisma,new Request(url,{headers:{Cookie:salesCookie}})),null);
 const row=await prisma.appUser.findUniqueOrThrow({where:{id:sales.id}});assert.notEqual(row.hash,'testing-only-reset-password');
 assert.equal((await authCall('/api/auth/logout',{})).status,200);assert.equal(await userFor(prisma,new Request(url,{headers:{Cookie:cookie}})),null);
});
test('limitación persistente de intentos de inicio de sesión',async()=>{const auth=createAuthHandlers(prisma);let status=0;for(let i=0;i<9;i++)status=(await auth(new Request('https://example.test/api/auth/login',{method:'POST',headers:{Origin:'https://example.test'},body:JSON.stringify({username:'inexistente',password:'incorrecta'})}))).status;assert.equal(status,429);});
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {importSQLite} from '../lib/sqlite-import';
import {credentials} from '../lib/auth';
test('traslado SQLite a PostgreSQL conserva datos reales, cuentas y adjuntos',async()=>{
 await prisma.$transaction([prisma.recordEntry.deleteMany(),prisma.audit.deleteMany(),prisma.counter.deleteMany(),prisma.preference.deleteMany(),prisma.attachment.deleteMany(),prisma.comment.deleteMany(),prisma.migrationBatch.deleteMany(),prisma.appUser.deleteMany(),prisma.appSession.deleteMany(),prisma.loginAttempt.deleteMany()]);
 const dir=await mkdtemp(path.join(tmpdir(),'gift-prisma-test-')),file=path.join(dir,'source.sqlite'),sqlite=new DatabaseSync(file),at='2026-10-19T00:00:00.000Z';
 sqlite.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,tenant TEXT,space TEXT,module TEXT,code TEXT,name TEXT,data TEXT,legacy_id TEXT,legacy_module TEXT,raw TEXT,created_at TEXT,updated_at TEXT,version INTEGER,deleted_at TEXT);CREATE TABLE app_users(id TEXT PRIMARY KEY,username TEXT,name TEXT,role TEXT,salt TEXT,hash TEXT,active INTEGER);CREATE TABLE counters(key TEXT PRIMARY KEY,value INTEGER);CREATE TABLE attachments(id TEXT PRIMARY KEY,tenant TEXT,space TEXT,record_id TEXT,name TEXT,mime TEXT,size INTEGER,hash TEXT,object_key TEXT,created_at TEXT);`);
 sqlite.exec(`CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE audit(id TEXT PRIMARY KEY,tenant TEXT,space TEXT,record_id TEXT,actor TEXT,action TEXT,before TEXT,after TEXT,created_at TEXT);CREATE TABLE comments(id TEXT PRIMARY KEY,tenant TEXT,space TEXT,record_id TEXT,body TEXT,actor TEXT,created_at TEXT);CREATE TABLE migration_batches(id TEXT PRIMARY KEY,tenant TEXT,space TEXT,module TEXT,filename TEXT,hash TEXT,summary TEXT,created_at TEXT);`);
 sqlite.prepare('INSERT INTO preferences VALUES (?,?)').run('local-owner:live:settings',JSON.stringify({catalogs:{productcategory:['Original']}}));
 sqlite.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?,?)').run('old-audit','local-owner','live','kept','Original','Creado',null,'{}',at);
 sqlite.prepare('INSERT INTO comments VALUES (?,?,?,?,?,?,?)').run('old-comment','local-owner','live','kept','Comentario original','Original',at);
 sqlite.prepare('INSERT INTO migration_batches VALUES (?,?,?,?,?,?,?,?)').run('old-batch','local-owner','live','customers','original.csv','oldhash','{}',at);
 const insert=sqlite.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 insert.run('kept','local-owner','live','customers','ACC00050','Cliente real',JSON.stringify({name:'Cliente real',nit:'CF',assigned:'Original'}),'50','Accounts',JSON.stringify({original:true}),at,at,7,null);
 insert.run('demo','local-owner','demo','customers','ACC-DEMO','Ejemplo','{}',null,null,null,at,at,1,null);
 const account=await credentials({username:'migrated.admin',name:'Administrador original',password:'original-testing-password'});
 sqlite.prepare('INSERT INTO app_users VALUES (?,?,?,?,?,?,?)').run('original-user',account.username,account.name,'admin',account.salt,account.hash,1);
 sqlite.prepare('INSERT INTO counters VALUES (?,?)').run('local-owner:live:customers',50);
 const bytes=Buffer.from('Adjunto migrado.'),key='local-owner/live/attachment';await mkdir(path.join(dir,'files/local-owner/live'),{recursive:true});await writeFile(path.join(dir,'files',key),bytes);
 sqlite.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?,?)').run('original-file','local-owner','live','kept','original.txt','text/plain',bytes.length,createHash('sha256').update(bytes).digest('hex'),key,at);sqlite.close();
 const before=await readFile(file),oldUpload=process.env.UPLOAD_DIR;process.env.UPLOAD_DIR=path.join(dir,'destination');
 try{
  await importSQLite(['--source',file],prisma);assert.equal(await prisma.recordEntry.count(),0);
  await importSQLite(['--source',file,'--files',path.join(dir,'files'),'--commit'],prisma);
  assert.equal(await prisma.recordEntry.count(),1);const row=await prisma.recordEntry.findUniqueOrThrow({where:{id:'kept'}});assert.equal(row.version,7);assert.equal(row.legacy_id,'50');assert.equal(row.raw,JSON.stringify({original:true}));assert.equal(await prisma.audit.count(),1);assert.equal(await prisma.comment.count(),1);assert.equal(await prisma.migrationBatch.count(),1);assert.equal(JSON.parse((await prisma.preference.findUniqueOrThrow({where:{key:'local-owner:live:settings'}})).value).catalogs.productcategory[0],'Original');
  assert.equal((await prisma.counter.findUniqueOrThrow({where:{key:'local-owner:live:customers'}})).value,50n);
  assert.deepEqual(await readFile(path.join(dir,'destination',key)),bytes);assert.deepEqual(await readFile(file),before);
  const auth=createAuthHandlers(prisma),r=await auth(new Request('https://example.test/api/auth/login',{method:'POST',headers:{Origin:'https://example.test'},body:JSON.stringify({username:account.username,password:'original-testing-password'})}));assert.equal(r.status,200);
  await assert.rejects(()=>importSQLite(['--source',file,'--commit'],prisma),/vacío/);
 }finally{if(oldUpload===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=oldUpload;}
});

test('diagnóstico de conexión y tablas sin revelar credenciales',async()=>{for(const code of ['P1000','P1001','P2021','P2022']){const db={appUser:{async findFirst(){throw Object.assign(Error('sensitive connection details'),{code});}}};const r=await createAuthHandlers(db as any)(new Request('https://example.test/api/auth/session'));assert.equal(r.status,503);const d=await r.json();assert.equal(d.code,code);assert.ok(!d.error.includes('sensitive'));}});
