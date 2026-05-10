import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppEnv } from '../config/env.js';
import type { AuthenticatedUser, Database } from './database.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppEnv;
    supabase: SupabaseClient<Database> | null;
    supabaseAuth: SupabaseClient<Database> | null;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}
