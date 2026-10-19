import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const toolchain=process.env.GIFT_LOCAL_TOOLCHAIN;
const require=createRequire(import.meta.url);
const esbuild=toolchain?require(path.join(toolchain,'esbuild')):require('esbuild');
mkdirSync('local-dist',{recursive:true});
// Resolve only the application's files and the explicitly selected local tools.
// This also avoids unrelated parent-directory package and workspace discovery.
const localResolver=toolchain?[{name:'gift-local-source',setup(build){
 build.onResolve({filter:/.*/},args=>{
  let file;if(args.path==='gift:entry')file=path.resolve('local-entry.tsx');
  else if(args.path.startsWith('.')){const base=path.resolve(path.dirname(args.importer),args.path);file=[base,base+'.tsx',base+'.ts',base+'.js'].find(existsSync);}
  else{const aliases={'react':'react/index.js','react/jsx-runtime':'react/jsx-runtime.js','react/jsx-dev-runtime':'react/jsx-dev-runtime.js','react-dom':'react-dom/index.js','react-dom/client':'react-dom/client.js','scheduler':'scheduler/index.js'};file=aliases[args.path]&&path.join(toolchain,aliases[args.path]);}
  if(!file)throw Error('Importación local no resuelta: '+args.path);return{path:file,namespace:'gift-source'};
 });
 build.onLoad({filter:/.*/,namespace:'gift-source'},args=>({contents:readFileSync(args.path,'utf8'),loader:args.path.endsWith('.tsx')?'tsx':args.path.endsWith('.ts')?'ts':'js'}));
}}]:[];
const result=await esbuild.build({absWorkingDir:process.cwd(),tsconfigRaw:{compilerOptions:{target:'ES2022'}},entryPoints:toolchain?['gift:entry']:['./local-entry.tsx'],bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic',target:'es2022',minify:true,plugins:localResolver,define:{'process.env.NODE_ENV':'"production"'}});
writeFileSync('local-dist/app.js',result.outputFiles[0].contents);
writeFileSync('local-dist/style.css',readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";',''));
writeFileSync('local-dist/index.html','<!doctype html><html lang="es-GT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Gift · Gestión local</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
console.log('Interfaz local compilada en local-dist/.');
