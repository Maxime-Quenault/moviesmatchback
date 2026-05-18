import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../src/config/env.js';
import { getSelections } from '../src/services/user.service.js';
import type { Database } from '../src/types/database.js';

type TableName = keyof Database['public']['Tables'] | 'titles_with_genres';
type Row = Record<string, unknown>;

class FakeQuery {
  private rows: Row[];
  private head = false;

  error = null;

  constructor(rows: Row[]) {
    this.rows = [...rows];
  }

  get data() {
    return this.head ? null : this.rows;
  }

  get count() {
    return this.head ? this.rows.length : null;
  }

  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    this.head = options?.head === true;
    return this;
  }

  eq(column: string, value: unknown) {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.rows = this.rows.filter((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    const direction = options?.ascending === false ? -1 : 1;
    this.rows.sort((a, b) =>
      String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * direction,
    );
    return this;
  }

  limit(size: number) {
    this.rows = this.rows.slice(0, size);
    return this;
  }
}

function fakeSupabase(tables: Record<TableName, Row[]>) {
  return {
    from(table: TableName) {
      return new FakeQuery(tables[table] ?? []);
    },
  } as unknown as SupabaseClient<Database>;
}

function fakeEnv(): AppEnv {
  return {
    NODE_ENV: 'test',
    APP_HOST: '127.0.0.1',
    APP_PORT: 3000,
    LOG_LEVEL: 'silent',
    CORS_ORIGIN: '*',
    TMDB_BASE_URL: 'https://api.themoviedb.org/3',
    TMDB_IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
    TMDB_LANGUAGE: 'fr-FR',
    JIKAN_BASE_URL: 'https://api.jikan.moe/v4',
    SUPABASE_AVATAR_BUCKET: 'profile-avatars',
  };
}

describe('getSelections', () => {
  it('resolves external media actions through local catalog references', async () => {
    const supabase = fakeSupabase({
      profiles: [{ id: 'user-1' }],
      user_title_actions: [
        {
          id: 'action-1',
          user_id: 'user-1',
          title_id: 'tmdb:movie:617126',
          action: 'liked',
          created_at: '2026-05-18T10:00:00.000Z',
          updated_at: '2026-05-18T10:00:00.000Z',
        },
      ],
      titles_with_genres: [
        {
          id: 'local-fantastic-four',
          type: 'movie',
          name: 'Les 4 Fantastiques : Premiers Pas',
          description: null,
          release_year: 2025,
          duration: null,
          poster_url: 'https://example.com/fantastic-four.jpg',
          rating: 7,
          external_source: 'tmdb',
          external_id: '617126',
          genres: ['Science-Fiction'],
          created_at: '2026-05-18T09:00:00.000Z',
          updated_at: '2026-05-18T09:00:00.000Z',
        },
      ],
    });

    const selections = await getSelections(supabase, fakeEnv(), 'user-1');

    expect(selections.liked).toHaveLength(1);
    expect(selections.liked[0]?.id).toBe('local-fantastic-four');
    expect(selections.totals.liked).toBe(1);
  });
});
