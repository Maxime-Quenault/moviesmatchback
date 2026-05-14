import { describe, expect, it } from 'vitest';

import { rankRecommendations } from '../src/services/recommendation.service.js';
import type { TitleDto } from '../src/services/title.service.js';

function title(input: Partial<TitleDto> & Pick<TitleDto, 'id' | 'genres'>): TitleDto {
  return {
    id: input.id,
    type: input.type ?? 'movie',
    name: input.name ?? input.id,
    description: input.description ?? null,
    releaseYear: input.releaseYear ?? 2024,
    duration: input.duration ?? null,
    posterUrl: input.posterUrl ?? null,
    rating: input.rating ?? 0,
    seenPercentage: input.seenPercentage ?? null,
    externalSource: input.externalSource ?? null,
    externalId: input.externalId ?? null,
    genres: input.genres,
    createdAt: input.createdAt ?? '2026-05-10T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-05-10T00:00:00.000Z',
  };
}

describe('rankRecommendations', () => {
  it('falls back to rating when the user has no positive choices', () => {
    const recommendations = rankRecommendations(
      [
        title({ id: 'low', genres: ['Drama'], rating: 6 }),
        title({ id: 'high', genres: ['Action'], rating: 9 }),
      ],
      [],
      1,
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.title.id).toBe('high');
    expect(recommendations[0]?.reason).toBe('Meilleure note disponible');
  });

  it('prioritizes titles sharing genres with liked and to-watch titles', () => {
    const recommendations = rankRecommendations(
      [
        title({ id: 'spider', genres: ['Action', 'Super-heros'], rating: 7 }),
        title({ id: 'quiet', genres: ['Drama'], rating: 10 }),
      ],
      [
        {
          action: 'liked',
          title: title({ id: 'avengers', genres: ['Action', 'Super-heros'], rating: 8 }),
        },
        {
          action: 'to_watch',
          title: title({ id: 'marvels', genres: ['Action'], rating: 5 }),
        },
      ],
      2,
    );

    expect(recommendations[0]?.title.id).toBe('spider');
    expect(recommendations[0]?.score).toBe(3);
  });
});
