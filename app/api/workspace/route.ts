import {prisma} from '../../../lib/prisma';
import {getUser} from '../../../lib/auth';
import {storage} from '../../../lib/storage';
import {createWorkspaceHandlers} from '../../../lib/workspace-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handlers=createWorkspaceHandlers({db:prisma,getUser,bucket:storage});
export const GET=handlers.GET;
export const POST=handlers.POST;
