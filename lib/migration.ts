import {definitions,legacyModules,moneyCents} from './model';
import type {Module} from './model';
const common:Record<string,string>={name:'name',legacy_id:'legacy_id',id:'legacy_id',record:'legacy_id',code:'code',source:'source',createdtime:'createdAt',modifiedtime:'updatedAt',assigned_user_id:'assigned',description:'description'};
export const aliases:Record<string,Record<string,string>>={
customers:{accountname:'name',account_no:'code',phone:'phone',email1:'email',rating:'rating',emailoptout:'emailOptOut',ship_street:'address',ship_country:'nit','Nombre de Cliente':'name','Número de Cliente':'code','Dirección de Entrega':'address',NIT:'nit'},
products:{productname:'name',product_no:'code',productcode:'sku',productcategory:'category',vendor_id:'vendorId',cf_854:'size',cf_856:'usage',cf_858:'color',unit_price:'price',purchase_cost:'cost',cf_870:'bulkPrice',qtyinstock:'stock',discontinued:'active'},
invoices:{invoice_no:'code',subject:'name',invoicedate:'date',account_id:'customerId',ship_street:'address',ship_country:'nit',invoicestatus:'status',cf_906:'cancellationReason',cf_866:'paymentNumber',cf_890:'advisorId',cf_868:'tracking',cf_862:'deliveryTime',cf_886:'openingBalance',cf_864:'paymentMethod',cf_908:'delivered',cf_860:'carrier',cf_912:'company',cf_894:'series',cf_892:'dte',cf_898:'certifiedAt',cf_896:'authorization',cf_900:'felError',cf_914:'legalName',cf_902:'words',cf_904:'xml',hdnGrandTotal:'total',total:'total',received:'received',balance:'openingBalance',lines:'lines'},
payments:{asset_no:'code',assetname:'amount',datesold:'date',assetstatus:'status',invoiceid:'documentId'},
purchases:{purchaseorder_no:'code',subject:'name',vendor_id:'vendorId',contact_id:'advisorId',postatus:'status',cf_864:'paymentMethod',duedate:'dueDate',cf_886:'openingBalance',total:'total',hdnGrandTotal:'total',lines:'lines'},
vendors:{vendorname:'name',vendor_no:'code',phone:'phone',email:'email',street:'address',country:'nit',cf_852:'creditDays'},
advisors:{contact_no:'code',lastname:'name',phone:'phone',email:'email',mailingzip:'bankAccount',mailingstreet:'address'},
documents:{notes_title:'name',notes_no:'code',folderid:'folder',filelocationtype:'type',filestatus:'active',filename:'filename'},
};
export function suggestedMapping(module:Module,headers:string[]){const all={...common,...aliases[module],...Object.fromEntries(definitions[module].fields.flatMap(f=>[[f.label,f.key],[f.key,f.key]]))};return Object.fromEntries(headers.map(h=>[h,all[h]||'']));}
export function mapRow(module:Module,row:Record<string,any>,mapping:Record<string,string>){
 const d:Record<string,any>={};for(const[h,key]of Object.entries(mapping))if(key&&row[h]!==undefined)d[key]=row[h];
 if(module==='payments'&&!d.name)d.name=String(d.amount||'Pago histórico');
 for(const f of definitions[module].fields){if(f.type==='checkbox')d[f.key]=['true','1','sí','si','yes'].includes(String(d[f.key]).toLowerCase());if(f.type==='multiselect')d[f.key]=Array.isArray(d[f.key])?d[f.key]:String(d[f.key]||'').split(/\s*\|##\|\s*|\s*;\s*/).filter(Boolean);}
 if(typeof d.lines==='string'&&d.lines.trim()){try{d.lines=JSON.parse(d.lines);}catch{throw Error('Partidas: se esperaba un arreglo JSON válido.');}if(!Array.isArray(d.lines))throw Error('Partidas debe ser un arreglo.');}
 const errors:string[]=[],warnings:string[]=[];
 if(!String(d.legacy_id||'').trim())errors.push('Falta ID de origen; no se puede garantizar idempotencia.');if(!d.name)errors.push('Falta nombre o referencia.');if(module==='payments'&&(d.amount===undefined||d.amount===''))errors.push('Falta importe de pago.');
 for(const f of definitions[module].fields){if(f.required&&!String(d[f.key]??'').trim())warnings.push(`Falta ${f.label}`);if(f.type==='money'&&d[f.key]!==undefined&&d[f.key]!==''){try{moneyCents(d[f.key]);}catch{errors.push(`${f.label}: importe no numérico o con formato ambiguo.`);}}}
 if(['invoices','purchases'].includes(module)){for(const k of ['total','openingBalance'])try{moneyCents(d[k]);}catch{errors.push(`${k}: importe inválido`);}if(d.total===undefined)errors.push('Falta total histórico');if(d.openingBalance===undefined)errors.push('Falta saldo histórico');if(!d.lines?.length)warnings.push('No se proporcionaron partidas; documento histórico en consulta.');}
 d.legacyModule=legacyModules[module];return{data:d,errors,warnings};
}
