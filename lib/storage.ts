import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
function filePath(key:string){const base=path.resolve(process.env.UPLOAD_DIR||'.local/files');const file=path.resolve(base,key);if(!file.startsWith(base+path.sep))throw Error('Ruta no permitida.');return file;}
export const storage={
 async put(key:string,bytes:ArrayBuffer){const file=filePath(key);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.from(bytes));},
 async get(key:string){try{return{body:new Uint8Array(await readFile(filePath(key)))}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}},
 async delete(key:string){try{await unlink(filePath(key));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
};
