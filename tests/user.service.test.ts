import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../src/config/env.js';
import {
  getSelections,
  syncMediaActions,
} from '../src/services/user.service.js';
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
    this.rows.sort(
      (a, b) =>
        String(a[column] ?? '').localeCompare(String(b[column] ?? '')) *
        direction,
    );
    return this;
  }

  limit(size: number) {
    this.rows = this.rows.slice(0, size);
    return this;
  }
}

function fakeSupabase(tables: Partial<Record<TableName, Row[]>>) {
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
    TMDB_ACCESS_TOKEN: 'test-token',
    TMDB_BASE_URL: 'https://tmdb.test/3',
    TMDB_IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
    TMDB_LANGUAGE: 'fr-FR',
    JIKAN_BASE_URL: 'https://jikan.test/v4',
    SUPABASE_AVATAR_BUCKET: 'profile-avatars',
  };
}

function actionRows(): Row[] {
  return [
    {
      id: 'action-1',
      user_id: 'user-1',
      title_id: 'tmdb:movie:123',
      action: 'liked',
      created_at: '2026-05-18T10:00:00.000Z',
      updated_at: '2026-05-18T10:03:00.000Z',
    },
    {
      id: 'action-2',
      user_id: 'user-1',
      title_id: 'jikan:anime:456',
      action: 'to_watch',
      created_at: '2026-05-18T10:01:00.000Z',
      updated_at: '2026-05-18T10:02:00.000Z',
    },
    {
      id: 'action-3',
      user_id: 'user-1',
      title_id: 'tmdb:movie:999',
      action: 'rejected',
      created_at: '2026-05-18T10:02:00.000Z',
      updated_at: '2026-05-18T10:01:00.000Z',
    },
  ];
}

function installFetchMock() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input.toString());

    if (url.pathname === '/3/movie/123') {
      return Response.json({
        id: 123,
        title: 'Resolved movie',
        overview: 'A movie resolved from TMDB.',
        release_date: '2025-01-02',
        runtime: 101,
        poster_path: '/movie.jpg',
        vote_average: 7.4,
        genres: [{ id: 28, name: 'Action' }],
      });
    }

    if (url.pathname === '/v4/anime/456') {
      return Response.json({
        data: {
          mal_id: 456,
          title: 'Resolved anime',
          synopsis: 'An anime resolved from Jikan.',
          year: 2024,
          duration: '24 min',
          score: 8.1,
          images: {
            jpg: {
              image_url: 'https://cdn.test/anime.jpg',
              large_image_url: 'https://cdn.test/anime-large.jpg',
            },
          },
          genres: [{ mal_id: 1, name: 'Adventure' }],
        },
      });
    }

    return Response.json({}, { status: 404 });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('user media selections', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('syncs actions while resolving only visible list titles', async () => {
    const fetchMock = installFetchMock();
    const supabase = fakeSupabase({
      profiles: [{ id: 'user-1' }],
      user_title_actions: actionRows(),
      titles_with_genres: [],
    });

    const result = await syncMediaActions(supabase, fakeEnv(), 'user-1', []);

    expect(result.items).toHaveLength(3);
    expect(result.items.find((item) => item.action === 'liked')?.title?.name)
      .toBe('Resolved movie');
    expect(result.items.find((item) => item.action === 'to_watch')?.title?.name)
      .toBe('Resolved anime');
    expect(result.items.find((item) => item.action === 'rejected')?.title)
      .toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url.toString()).join('\n'))
      .not.toContain('/movie/999');
  });

  it('builds viewed and to-watch lists from external media keys', async () => {
    installFetchMock();
    const supabase = fakeSupabase({
      profiles: [{ id: 'user-1' }],
      user_title_actions: actionRows(),
      titles_with_genres: [],
    });

    const selections = await getSelections(supabase, fakeEnv(), 'user-1');

    expect(selections.liked).toHaveLength(1);
    expect(selections.liked[0]?.name).toBe('Resolved movie');
    expect(selections.toWatch).toHaveLength(1);
    expect(selections.toWatch[0]?.name).toBe('Resolved anime');
    expect(selections.rejected).toHaveLength(0);
    expect(selections.totals.liked).toBe(1);
    expect(selections.totals.toWatch).toBe(1);
  });
});
