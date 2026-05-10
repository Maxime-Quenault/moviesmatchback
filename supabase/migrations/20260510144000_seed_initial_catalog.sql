insert into public.genres (name)
values
  ('Action'),
  ('Science-fiction'),
  ('Super-heros'),
  ('Aventure'),
  ('Drame'),
  ('Historique'),
  ('Thriller'),
  ('Crime'),
  ('Animation')
on conflict (name) do nothing;

insert into public.titles (
  id,
  type,
  name,
  description,
  release_year,
  duration,
  poster_url,
  rating,
  external_source,
  external_id
)
values
  (
    'avengers-endgame',
    'movie',
    'Avengers: Endgame',
    'Les Avengers restants tentent une derniere mission pour inverser les consequences du claquement de Thanos.',
    2019,
    '3h 01',
    'assets/images/affiches_films/avengers_endgame.jpg',
    8.4,
    'local_flutter_seed',
    'avengers-endgame'
  ),
  (
    'avengers-infinity-war',
    'movie',
    'Avengers: Infinity War',
    'Les heros Marvel s unissent face a Thanos, decide a reunir les Pierres d Infinite.',
    2018,
    '2h 29',
    'assets/images/affiches_films/avengers_infinity_war.jpg',
    8.4,
    'local_flutter_seed',
    'avengers-infinity-war'
  ),
  (
    'le-comte-de-monte-cristo',
    'movie',
    'Le Comte de Monte Cristo',
    'Trahi et emprisonne, Edmond Dantes revient sous une nouvelle identite pour orchestrer sa vengeance.',
    2024,
    '2h 58',
    'assets/images/affiches_films/compte_de_montecristo.jpg',
    7.7,
    'local_flutter_seed',
    'le-comte-de-monte-cristo'
  ),
  (
    'joker',
    'movie',
    'Joker',
    'Arthur Fleck, humoriste isole a Gotham, glisse peu a peu vers une identite dangereuse.',
    2019,
    '2h 02',
    'assets/images/affiches_films/joker.jpg',
    8.3,
    'local_flutter_seed',
    'joker'
  ),
  (
    'spider-man-across-the-spider-verse',
    'movie',
    'Spider-Man: Across the Spider-Verse',
    'Miles Morales traverse le multivers et rencontre une equipe de Spider-heros aux regles bien etablies.',
    2023,
    '2h 20',
    'assets/images/affiches_films/spiderman_across_the_spiderverse.jpg',
    8.6,
    'local_flutter_seed',
    'spider-man-across-the-spider-verse'
  ),
  (
    'the-amazing-spider-man',
    'movie',
    'The Amazing Spider-Man',
    'Peter Parker decouvre ses pouvoirs et enquete sur le passe de ses parents.',
    2012,
    '2h 16',
    'assets/images/affiches_films/the_amazing_spiderman.jpg',
    6.9,
    'local_flutter_seed',
    'the-amazing-spider-man'
  ),
  (
    'the-marvels',
    'movie',
    'The Marvels',
    'Carol Danvers, Monica Rambeau et Kamala Khan voient leurs pouvoirs se lier lors de changements de place incontroles.',
    2023,
    '1h 45',
    'assets/images/affiches_films/the_marvels.jpeg',
    5.5,
    'local_flutter_seed',
    'the-marvels'
  ),
  (
    'les-trois-mousquetaires-dartagnan',
    'movie',
    'Les Trois Mousquetaires: D''Artagnan',
    'D Artagnan rejoint Athos, Porthos et Aramis dans une France traversee par complots et duels.',
    2023,
    '2h 01',
    'assets/images/affiches_films/trois_mousquetaires_dartagnan.jpg',
    6.7,
    'local_flutter_seed',
    'les-trois-mousquetaires-dartagnan'
  )
on conflict (id) do update set
  type = excluded.type,
  name = excluded.name,
  description = excluded.description,
  release_year = excluded.release_year,
  duration = excluded.duration,
  poster_url = excluded.poster_url,
  rating = excluded.rating,
  external_source = excluded.external_source,
  external_id = excluded.external_id,
  updated_at = now();

delete from public.title_genres
where title_id in (
  'avengers-endgame',
  'avengers-infinity-war',
  'le-comte-de-monte-cristo',
  'joker',
  'spider-man-across-the-spider-verse',
  'the-amazing-spider-man',
  'the-marvels',
  'les-trois-mousquetaires-dartagnan'
);

insert into public.title_genres (title_id, genre_id)
select seed.title_id, g.id
from (
  values
    ('avengers-endgame', 'Action'),
    ('avengers-endgame', 'Science-fiction'),
    ('avengers-endgame', 'Super-heros'),
    ('avengers-infinity-war', 'Action'),
    ('avengers-infinity-war', 'Science-fiction'),
    ('avengers-infinity-war', 'Super-heros'),
    ('le-comte-de-monte-cristo', 'Aventure'),
    ('le-comte-de-monte-cristo', 'Drame'),
    ('le-comte-de-monte-cristo', 'Historique'),
    ('joker', 'Drame'),
    ('joker', 'Thriller'),
    ('joker', 'Crime'),
    ('spider-man-across-the-spider-verse', 'Animation'),
    ('spider-man-across-the-spider-verse', 'Action'),
    ('spider-man-across-the-spider-verse', 'Super-heros'),
    ('the-amazing-spider-man', 'Action'),
    ('the-amazing-spider-man', 'Aventure'),
    ('the-amazing-spider-man', 'Super-heros'),
    ('the-marvels', 'Action'),
    ('the-marvels', 'Science-fiction'),
    ('the-marvels', 'Super-heros'),
    ('les-trois-mousquetaires-dartagnan', 'Aventure'),
    ('les-trois-mousquetaires-dartagnan', 'Historique'),
    ('les-trois-mousquetaires-dartagnan', 'Action')
) as seed(title_id, genre_name)
join public.genres g on g.name = seed.genre_name
on conflict do nothing;
