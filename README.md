# Movie Match Backend

Backend applicatif Node.js/TypeScript pour Movie Match, base sur Fastify,
Zod et Supabase.

## Role du backend

Ce service applique la strategie suivante :

- exposer une API stable pour Flutter;
- garder la cle service Supabase cote serveur;
- verifier les tokens Supabase Auth;
- centraliser les choix utilisateur sur les titres;
- preparer les profils, listes publiques, abonnements et recommandations;
- fournir une base SQL relationnelle avec Row Level Security.

## Stack

- Fastify
- TypeScript
- Zod
- Supabase JS
- PostgreSQL/Supabase migrations
- Vitest

## Installation

```bash
npm install
cp .env.example .env
npm run dev
```

Renseigner dans `.env`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_API_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

La cle `service_role` ne doit jamais etre ajoutee dans l'application Flutter.

Si `SUPABASE_URL` contient une URL Postgres utilisee pour les migrations, le
backend essaie de deduire l'URL API Supabase depuis la reference projet. Tu peux
aussi la fournir explicitement avec `SUPABASE_API_URL`.

## Base de donnees

Les migrations sont dans `supabase/migrations`.

Pour un projet Supabase lie avec la CLI:

```bash
supabase db push
```

Sinon, appliquer les deux fichiers SQL dans l'ordre depuis l'editeur SQL
Supabase:

1. `20260510143000_initial_schema.sql`
2. `20260510144000_seed_initial_catalog.sql`

Le seed reprend les 8 titres presents dans `moviesmatchapp/lib/services/movie_service.dart`.

## Correspondance avec l'app Flutter

Les listes locales actuelles sont mappees ainsi:

- `viewed` -> `liked`
- `toWatch` -> `to_watch`
- `notInterested` -> `rejected`
- `watched` est prevu pour la suite

Les types de contenus correspondent a `PosterType`:

- `movie`
- `anime`
- `series`

## Endpoints principaux

Public:

- `GET /health`
- `POST /v1/auth/signup`
- `POST /v1/auth/signin`
- `POST /v1/auth/refresh`
- `GET /v1/titles`
- `GET /v1/titles/:id`
- `GET /v1/community/lists`
- `GET /v1/community/lists/:listId`
- `GET /v1/community/profiles/:profileId`

Authentifies avec `Authorization: Bearer <supabase_access_token>`:

- `GET /v1/auth/me`
- `POST /v1/auth/logout`
- `GET /v1/me/profile`
- `PUT /v1/me/profile`
- `GET /v1/me/discover`
- `GET /v1/me/selections`
- `DELETE /v1/me/selections`
- `GET /v1/me/recommendations`
- `PUT /v1/me/titles/:titleId/action`
- `DELETE /v1/me/titles/:titleId/action`
- `GET /v1/me/lists`
- `POST /v1/me/lists`
- `PATCH /v1/me/lists/:listId`
- `DELETE /v1/me/lists/:listId`
- `POST /v1/me/lists/:listId/items`
- `DELETE /v1/me/lists/:listId/items/:titleId`
- `GET /v1/me/follows`
- `POST /v1/me/follows/:profileId`
- `DELETE /v1/me/follows/:profileId`

Exemple d'action:

```bash
curl -X PUT http://localhost:3000/v1/me/titles/avengers-endgame/action \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"liked\"}"
```

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## Deploiement Vercel

Le backend Fastify est expose a Vercel via `api/index.js`, qui charge le handler
compile `dist/vercel.js`. Le fichier `vercel.json` redirige toutes les routes
vers cette fonction unique.

Dans les settings Vercel:

- Root Directory: `moviesmatchback`
- Build Command: laisse Vercel utiliser `npm run build` depuis `vercel.json`
- Environment Variables:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_API_URL` si `SUPABASE_URL` n'est pas l'URL API HTTPS

Les routes comme `/health`, `/v1/auth/signup` et `/v1/titles` doivent rester
appelees sans prefixe `/api`.
