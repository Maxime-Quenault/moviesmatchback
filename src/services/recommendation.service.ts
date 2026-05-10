import type { UserTitleAction } from '../types/database.js';
import type { TitleDto } from './title.service.js';

export interface TitleActionContext {
  action: UserTitleAction;
  title: TitleDto;
}

export interface RecommendationDto {
  title: TitleDto;
  score: number;
  reason: string;
}

const positiveActions = new Set<UserTitleAction>(['liked', 'to_watch']);

export function rankRecommendations(
  availableTitles: TitleDto[],
  actionContexts: TitleActionContext[],
  limit: number,
): RecommendationDto[] {
  const positiveTitles = actionContexts
    .filter((context) => positiveActions.has(context.action))
    .map((context) => context.title);

  if (positiveTitles.length === 0) {
    return [...availableTitles]
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, limit)
      .map((title) => ({
        title,
        score: title.rating ?? 0,
        reason: 'Meilleure note disponible',
      }));
  }

  const genreScores = new Map<string, number>();
  for (const title of positiveTitles) {
    for (const genre of title.genres) {
      genreScores.set(genre, (genreScores.get(genre) ?? 0) + 1);
    }
  }

  return [...availableTitles]
    .map((title) => {
      const matchedGenres = title.genres.filter((genre) => genreScores.has(genre));
      const score = matchedGenres.reduce(
        (total, genre) => total + (genreScores.get(genre) ?? 0),
        0,
      );

      return {
        title,
        score,
        reason:
          matchedGenres.length > 0
            ? `Genres en commun: ${matchedGenres.join(', ')}`
            : 'Titre restant dans le catalogue',
      };
    })
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      return (b.title.rating ?? 0) - (a.title.rating ?? 0);
    })
    .slice(0, limit);
}
