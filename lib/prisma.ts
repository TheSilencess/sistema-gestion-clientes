import {PrismaClient} from '@prisma/client';
const shared=globalThis as unknown as {giftPrisma?:PrismaClient};
export const prisma=shared.giftPrisma??new PrismaClient();
if(process.env.NODE_ENV!=='production')shared.giftPrisma=prisma;
