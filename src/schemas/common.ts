import { z } from 'zod';

export const titleTypeSchema = z.enum(['movie', 'anime', 'series']);
export const actionSchema = z.enum(['liked', 'to_watch', 'rejected', 'watched']);
export const visibilitySchema = z.enum(['private', 'public', 'followers']);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const titleIdParamSchema = z.object({
  titleId: z.string().min(1),
});

export const listIdParamSchema = z.object({
  listId: z.string().uuid(),
});

export const profileIdParamSchema = z.object({
  profileId: z.string().uuid(),
});

export const listItemParamSchema = z.object({
  listId: z.string().uuid(),
  titleId: z.string().min(1),
});
