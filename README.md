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

Node.js 20.19+ ou 22.12+ est requis pour les outils de verification.

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
TMDB_ACCESS_TOKEN=your-tmdb-read-access-token
CATALOG_SYNC_TOKEN=change-me
```

La cle `service_role` ne doit jamais etre ajoutee dans l'application Flutter.

Si `SUPABASE_URL` contient une URL Postgres utilisee pour les migrations, le
backend essaie de deduire l'URL API Supabase depuis la reference projet. Tu peux
aussi la fournir explicitement avec `SUPABASE_API_URL`.

Pour enrichir le catalogue depuis les APIs externes:

- TMDB sert aux films et series;
- Jikan sert aux animes;
- `TMDB_ACCESS_TOKEN` est recommande, `TMDB_API_KEY` reste accepte;
- `CATALOG_SYNC_TOKEN` protege la route d'import. Il est optionnel en
  developpement, mais requis en production.

## Base de donnees

Les migrations sont dans `supabase/migrations`.

Pour un projet Supabase lie avec la CLI:

```bash
supabase db push
```

Sinon, appliquer les fichiers SQL dans l'ordre depuis l'editeur SQL
Supabase:

1. `20260510143000_initial_schema.sql`
2. `20260510144000_seed_initial_catalog.sql`
3. `20261003100000_media_sync_tombstones.sql`

Le seed fournit les 17 genres disponibles. Le catalogue de l'application est
resolu depuis TMDB/Jikan.

La troisieme migration doit preceder le deploiement du nouveau backend : elle
ajoute `deleted_at`, les recus de mutations et deux fonctions RPC atomiques.
Les suppressions conservent un marqueur pour bloquer les anciens choix envoyes
par un autre appareil. Les retries avec le meme `mutationId` sont sans effet.
Seul le backend service_role peut modifier ces lignes; les lectures restent
limitees au proprietaire par RLS.

## Verification email et recuperation du compte

L'inscription cree un utilisateur non confirme, initialise son profil puis
envoie un code OTP. Elle retourne `{ "email": "...", "confirmationRequired": true }`
sans session. Si le profil ou l'envoi echoue, le nouveau compte est supprime
pour permettre une nouvelle tentative. Un echec de nettoyage est remonte.
Les comptes historiques deja confirmes restent utilisables.

Dans Supabase Auth, activer **Confirm email**, configurer un service SMTP pour
la production et remplacer les templates **Confirm Signup** et **Magic Link**
par `supabase/templates/magic_link.html`, ainsi que **Reset Password**
par `supabase/templates/recovery.html`.
Ces emails affichent `{{ .Token }}` pour saisir le code dans Flutter sans lien
profond. Les demandes de renvoi utilisent `shouldCreateUser: false`.
Reference : [templates email Supabase](https://supabase.com/docs/guides/auth/auth-email-templates).

Endpoints ajoutes :

- `POST /v1/auth/verify-email` : `{ email, token }`, retourne une session.
- `POST /v1/auth/resend-email` : `{ email }`, reponse generique sans enumeration.
- `POST /v1/auth/forgot-password` : `{ email }`, meme reponse generique.
- `POST /v1/auth/reset-password` : `{ email, token, password }`, valide un code
  de recuperation puis invalide les refresh tokens des sessions existantes.
- `POST /v1/auth/delete-account` : session Bearer et `{ password }`, reauthentifie,
  supprime les avatars, puis le compte et les donnees liees par cascade.

Les routes email/code ont une limite de 5 requetes par IP et par route sur
15 minutes. Les comptes anonymes et non confirmes sont refuses. La deconnexion
ne revoque que la session courante pour conserver les autres appareils connectes.

Le script destructif `supabase/manual/reset_app_schema.sql` est reserve aux
reinitialisations manuelles. Il est exclu des migrations pour que `supabase db push`
ne supprime pas les donnees applicatives. Si l'ancienne migration
`20260515094500_drop_all_app_objects.sql` a deja ete executee, verifier l'etat
du schema et l'historique des migrations avant toute restauration.

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
- `GET /v1/titles/genres`
- `GET /v1/titles`
- `GET /v1/titles?type=movie&genre=Action`
- `GET /v1/titles/:id`
- `GET /v1/titles/discover?type=movie&limit=20&genres=Action,Drame&releaseYearMin=2000&releaseYearMax=2024`
- `GET /v1/titles/search/external?q=matrix&type=movie`
- `GET /v1/titles/external-genres?type=movie`
- `GET /v1/community/lists`
- `GET /v1/community/lists/:listId`
- `GET /v1/community/profiles/:profileId`

Authentifies avec `Authorization: Bearer <supabase_access_token>`:

Les tokens de comptes anonymes Supabase sont refuses. L'application exige
un compte cree et une session valide; les endpoints publics restent accessibles
pour le chargement des genres et du catalogue.

- `GET /v1/auth/me`
- `POST /v1/auth/logout`
- `GET /v1/me/profile`
- `PUT /v1/me/profile`
- `GET /v1/me/preferences`
- `PUT /v1/me/preferences`
- `GET /v1/me/discover`
- `GET /v1/me/selections`
- `DELETE /v1/me/selections`
- `GET /v1/me/media-actions`
- `POST /v1/me/media-actions/sync`
- `PUT /v1/me/media-actions`
- `DELETE /v1/me/media-actions`
- `DELETE /v1/me/media-actions/:mediaKey`
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

Catalogue externe:

- `GET /v1/titles/discover` recupere les films et series en direct depuis TMDB,
  sans lecture Supabase. C'est l'endpoint a utiliser pour la decouverte live.
- `GET /v1/titles/search/external` recherche des films et series en direct
  depuis TMDB pour alimenter la recherche applicative.
- `POST /v1/titles/sync`

Exemple d'import par genre:

```bash
curl -X POST http://localhost:3000/v1/titles/sync \
  -H "Content-Type: application/json" \
  -H "x-catalog-sync-token: $CATALOG_SYNC_TOKEN" \
  -d "{\"type\":\"movie\",\"genreName\":\"Action\",\"pages\":1,\"limit\":20}"
```

Exemple pour plusieurs types:

```bash
curl -X POST http://localhost:3000/v1/titles/sync \
  -H "Content-Type: application/json" \
  -H "x-catalog-sync-token: $CATALOG_SYNC_TOKEN" \
  -d "{\"genreNames\":{\"movie\":[\"Action\"],\"series\":[\"Drame\"],\"anime\":[\"Adventure\"]},\"pages\":1,\"limit\":20}"
```

Pour importer tous les genres officiels, passer `{"allGenres":true}` avec
prudence: cela declenche beaucoup d'appels externes.

Exemple d'action:

```bash
curl -X PUT http://localhost:3000/v1/me/titles/avengers-endgame/action \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"liked\"}"
```

Exemple de preferences de swipe:

```bash
curl -X PUT http://localhost:3000/v1/me/preferences \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"preferredGenres\":[\"Action\",\"Drame\",\"Thriller\"],\"releaseYearMin\":2000,\"releaseYearMax\":2024}"
```

## Synchronisation legere des listes Flutter

L'app Flutter ne stocke pas toutes les metadonnees media dans Supabase. Elle
stocke uniquement une cle media legere dans `user_title_actions.title_id`, par
exemple:

- `tmdb:movie:299534`
- `tmdb:tv:1399`
- `jikan:anime:5114`

Au login ou au refresh des listes, l'app appelle:

```bash
curl -X POST http://localhost:3000/v1/me/media-actions/sync \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"mediaKey\":\"tmdb:movie:299534\",\"action\":\"liked\"}]}"
```

Le backend upsert les ids/action, recharge toutes les actions du profil, puis
resolve les metadonnees depuis TMDB/Jikan pour que le client les recache en
local. Les suppressions peuvent etre envoyees avec:

```bash
curl -X DELETE http://localhost:3000/v1/me/media-actions/tmdb%3Amovie%3A299534 \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Les deux depots ont chacun une workflow GitHub Actions. Le backend lance en
plus une instance Supabase locale isolee, applique les migrations et verifie
RLS, suppressions persistantes, verification d'email, recuperation du mot de
passe et suppression du compte. Les emails des tests vont dans Inbucket local.

Pour lancer ce parcours localement (Docker et CLI Supabase requis) :

```bash
supabase start
supabase db reset --local
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f tests/database/media-sync.sql
# Charger API_URL, ANON_KEY et SERVICE_ROLE_KEY depuis supabase status -o env
# dans les variables SUPABASE_* correspondantes, sans utiliser une base distante.
RUN_SUPABASE_INTEGRATION=1 npx vitest run tests/integration/account-sync.test.ts
supabase stop --no-backup
```

Le test d'integration refuse toute URL non locale. Il est ignore lors de
`npm test` tant que `RUN_SUPABASE_INTEGRATION` n'est pas active.

Le protocole `/v1/me/media-actions/sync` accepte aussi les suppressions :

```json
{"items":[{"mediaKey":"tmdb:movie:42","deleted":true,"mutationId":"30000000-0000-0000-0000-000000000001","updatedAt":"2026-10-03T08:00:00Z"}]}
```

Un ajout utilise `action` au lieu de `deleted`. Conserver le meme `mutationId`
pour une nouvelle tentative du meme changement. La reponse contient les actions
et les marqueurs de suppression (`deletedAt`), pour reconstruire le cache.
Les clients ne doivent plus renvoyer tous les choix deja synchronises.

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
