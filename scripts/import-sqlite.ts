import 'dotenv/config';
import {prisma} from '../lib/prisma';
import {importSQLite} from '../lib/sqlite-import';
try{await importSQLite(process.argv.slice(2),prisma);}finally{await prisma.$disconnect();}
