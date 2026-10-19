import {randomBytes,randomUUID,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import type {PrismaClient,Prisma,AppUser} from '@prisma/client';
import {prisma} from './prisma';
import {allowedOrigin,sessionCookie} from './http';
const derive=promisify(scrypt),digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export type AuthenticatedUser={id:string;username:string;name:string;role:'admin'|'ventas';active:boolean;userId:string;tenantId:string;displayName:string;email:string};
const publicUser=(u:AppUser)=>({id:u.id,username:u.username,name:u.name,role:u.role,active:u.active});
function tokenOf(req:Request){return(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('gift_session='))?.slice(13);}
export async function userFor(db:PrismaClient,req:Request):Promise<AuthenticatedUser|null>{const token=tokenOf(req);if(!token)return null;const session=await db.appSession.findUnique({where:{token:digest(token)}});if(!session||session.expires<=BigInt(Date.now()))return null;const u=await db.appUser.findUnique({where:{id:session.user_id}});if(!u?.active||!['admin','ventas'].includes(u.role))return null;return{...publicUser(u),role:u.role as 'admin'|'ventas',userId:u.id,tenantId:'local-owner',displayName:u.name,email:u.username};}
export const getUser=(req:Request)=>userFor(prisma,req);
export async function credentials(b:Record<string,unknown>){const username=String(b.username||'').trim().toLowerCase(),name=String(b.name||'').trim(),password=String(b.password||'');if(!/^[a-z0-9._@-]{3,80}$/.test(username)||!name||name.length>100||password.length<10||password.length>128)throw Error('Usa un usuario de 3–80 caracteres, nombre y contraseña de 10–128 caracteres.');const salt=randomBytes(16).toString('hex'),hash=(await derive(password,salt,64) as Buffer).toString('hex');return{username,name,salt,hash};}
// Serializable transactions protect first setup and the last active administrator across instances.
export async function serial<T>(db:PrismaClient,run:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{for(let i=0;;i++){try{return await db.$transaction(run,{isolationLevel:'Serializable'});}catch(e){if((e as {code?:string}).code!=='P2034'||i>=3)throw e;}}}
export function createAuthHandlers(db:PrismaClient){return async function handle(req:Request){const reply=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});try{
 const path=new URL(req.url).pathname,u=await userFor(db,req),setup=!(await db.appUser.findFirst({select:{id:true}}));
 if(req.method==='GET'&&path==='/api/auth/session')return reply({user:u,needsSetup:setup});
 if(req.method==='GET'&&path==='/api/users'){if(u?.role!=='admin')return reply({error:'Solo administradores.'},403);return reply({users:(await db.appUser.findMany({orderBy:{name:'asc'}})).map(publicUser)});}
 if(req.method!=='POST')return reply({error:'Método no permitido'},405);
 if(req.headers.get('origin')!==allowedOrigin(req))return reply({error:'Origen no permitido'},403);
 const raw=await req.text();if(raw.length>16000)return reply({error:'Solicitud demasiado grande'},413);const b=JSON.parse(raw||'{}');
 if(path==='/api/auth/logout'){const token=tokenOf(req);if(token)await db.appSession.deleteMany({where:{token:digest(token)}});return reply({ok:true},200,{'Set-Cookie':sessionCookie('',0)});}
 if(path==='/api/auth/setup'){
  if(!setup)return reply({error:'El administrador ya está configurado'},409);
  if(process.env.NODE_ENV==='production'&&process.env.ALLOW_INITIAL_SETUP!=='true')return reply({error:'El administrador inicial debe configurarse antes de abrir el servicio al equipo.'},403);
  const c=await credentials(b);await serial(db,async tx=>{if(await tx.appUser.count())throw Error('El administrador ya está configurado');await tx.appUser.create({data:{id:randomUUID(),...c,role:'admin'}});});return reply({ok:true});
 }
 if(path==='/api/auth/login'){
  const key='login:'+createHash('sha256').update(String(b.username||'').trim().toLowerCase()).digest('hex');const rate=await db.loginAttempt.findUnique({where:{key}});if(rate&&rate.until>BigInt(Date.now()))return reply({error:'Demasiados intentos. Espera 5 minutos.'},429);
  const account=await db.appUser.findUnique({where:{username:String(b.username||'').trim().toLowerCase()}}),given=await derive(String(b.password||'').slice(0,128),account?.salt||'invalid',64) as Buffer,expected=account?Buffer.from(account.hash,'hex'):Buffer.alloc(64);
  if(!account?.active||!timingSafeEqual(given,expected)){await serial(db,async tx=>{const previous=await tx.loginAttempt.findUnique({where:{key}}),count=(previous?.until&&previous.until<=BigInt(Date.now())?0:previous?.count||0)+1,blocked=count>=8;await tx.loginAttempt.upsert({where:{key},create:{key,count:blocked?0:count,until:blocked?BigInt(Date.now()+300000):0n},update:{count:blocked?0:count,until:blocked?BigInt(Date.now()+300000):0n}});});return reply({error:'Usuario o contraseña incorrectos'},401);}
  await db.loginAttempt.deleteMany({where:{key}});const token=randomBytes(32).toString('hex');await db.appSession.create({data:{token:digest(token),user_id:account.id,expires:BigInt(Date.now()+28800000)}});return reply({ok:true},200,{'Set-Cookie':sessionCookie(token,28800)});
 }
 if(path==='/api/users'){
  if(u?.role!=='admin')return reply({error:'Solo administradores.'},403);
  if(b.action==='create'){if(!['admin','ventas'].includes(b.role))throw Error('Rol inválido');const c=await credentials(b);await db.appUser.create({data:{id:randomUUID(),...c,role:b.role}});}
  else{const target=await db.appUser.findUnique({where:{id:String(b.id)}});if(!target)throw Error('Usuario no encontrado');if(b.action==='reset'){const c=await credentials({...target,password:b.password});await db.$transaction([db.appUser.update({where:{id:target.id},data:{salt:c.salt,hash:c.hash}}),db.appSession.deleteMany({where:{user_id:target.id}})]);}
   else if(b.action==='update'){if(!['admin','ventas'].includes(b.role)||typeof b.active!=='boolean')throw Error('Datos inválidos');await serial(db,async tx=>{const current=await tx.appUser.findUniqueOrThrow({where:{id:target.id}});if(current.role==='admin'&&current.active&&(!b.active||b.role!=='admin')&&await tx.appUser.count({where:{role:'admin',active:true}})<=1)throw Error('Debe quedar al menos un administrador activo.');await tx.appUser.update({where:{id:target.id},data:{role:b.role,active:b.active}});await tx.appSession.deleteMany({where:{user_id:target.id}});});}else throw Error('Acción inválida');}
  return reply({ok:true});
 }
 return reply({error:'No encontrado'},404);
 }catch(e){const error=e as {code?:string;message:string};return reply({error:error.code==='P2002'?'El usuario ya existe.':error.code?'No se pudo completar la operación.':error.message},400);}};}
export const authHandler=createAuthHandlers(prisma);
