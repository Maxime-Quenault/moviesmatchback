import fp from 'fastify-plugin';

import {
  createSupabaseAuthClient,
  createSupabaseClient,
} from '../lib/supabase.js';

export const supabasePlugin = fp(async (app) => {
  app.decorate('supabase', createSupabaseClient(app.config));
  app.decorate('supabaseAuth', createSupabaseAuthClient(app.config));
});
