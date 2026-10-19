export function allowedOrigin(req:Request){return process.env.APP_URL?new URL(process.env.APP_URL).origin:new URL(req.url).origin;}
export function sessionCookie(token:string,maxAge:number){const secure=process.env.NODE_ENV==='production'||process.env.APP_URL?.startsWith('https://');return `gift_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;}
