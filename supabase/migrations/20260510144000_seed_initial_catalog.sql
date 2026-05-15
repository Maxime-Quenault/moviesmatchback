insert into public.genres (name)
values
  ('Action'),
  ('Science-fiction'),
  ('Super-heros'),
  ('Aventure'),
  ('Comedie'),
  ('Drame'),
  ('Fantastique'),
  ('Historique'),
  ('Horreur'),
  ('Mystere'),
  ('Romance'),
  ('Thriller'),
  ('Crime'),
  ('Animation'),
  ('Famille'),
  ('Guerre'),
  ('Western')
on conflict (name) do nothing;
