# Agent context - moviesmatchback

Lis ce fichier au debut d'une nouvelle discussion pour eviter de reparcourir
tout le backend. Actualise-le si l'architecture, les routes ou les contrats
API changent.

## Role du projet

`moviesmatchback` est le backend applicatif de Movie Match / Moma. Il expose une
API HTTP stable pour l'app Flutter, garde les secrets Supabase cote serveur,
verifie les tokens Supabase Auth, centralise les actions utilisateur sur les
titres, prepare les profils/listes sociales/recommandations, et peut importer
ou decouvrir du contenu depuis TMDB et Jikan.

Ce dossier est un repo Git separe de `moviesmatchapp`.

## Stack et commandes

- Runtime: Node.js >= 20, TypeScript, modules ESM.
- HTTP: Fastify 5 avec `@fastify/cors`, `helmet`, `rate-limit`.
- Uploads: `@fastify/multipart` pour les images de profil.
- Validation: Zod aux frontieres des routes.
- Data/auth: Supabase JS v2, PostgreSQL/Supabase migrations.
- Tests: Vitest.

Commandes principales:

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev` lance `tsx watch src/server.ts`. Le build compile vers `dist`.
Vercel utilise `api/index.js`, qui exporte `dist/vercel.js`.

## Variables d'environnement

Voir `.env.example`.

- `APP_HOST`, `APP_PORT`, `LOG_LEVEL`, `CORS_ORIGIN`.
- `SUPABASE_URL` ou `SUPABASE_API_URL`.
- `SUPABASE_ANON_KEY` pour les appels auth utilisateur.
- `SUPABASE_SERVICE_ROLE_KEY` uniquement cote backend.
- `TMDB_ACCESS_TOKEN` recommande, `TMDB_API_KEY` encore accepte.
- `TMDB_BASE_URL`, `TMDB_IMAGE_BASE_URL`, `TMDB_LANGUAGE`.
- `JIKAN_BASE_URL`.
- `SUPABASE_AVATAR_BUCKET`, defaut `profile-avatars`, bucket Storage public
  utilise pour les photos de profil.
- `CATALOG_SYNC_TOKEN` protege `POST /v1/titles/sync`; requis en production.

Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` dans Flutter.

## Architecture serveur

- `src/app.ts`: construit l'app Fastify, charge l'env, enregistre plugins et
  routes.
- `src/server.ts`: entrypoint local.
- `src/vercel.ts`: handler Vercel qui reutilise une instance Fastify prete.
- `api/index.js`: pont Vercel vers le build compile.
- `src/config/env.ts`: schema Zod de config, helpers Supabase/TMDB/CORS.
- `src/plugins/supabase.ts`: decore `app.supabase` et `app.supabaseAuth`.
- `src/plugins/auth.ts`: `app.requireAuth` et `app.authenticateOptional`.
- `src/plugins/error-handler.ts`: format d'erreur API uniforme.
- `src/lib/api-error.ts`: erreurs metier `ApiError`.
- `src/lib/supabase.ts`: creation/verification clients Supabase.
- `src/lib/supabase-error.ts`: conversion erreurs DB en `DATABASE_ERROR`.
- `src/types/database.ts`: types manuels de tables/views/enums Supabase.
- `src/types/fastify.d.ts`: decorations Fastify typees.

Convention importante: routes = parsing/validation HTTP, services = logique
metier/data. Les DTO retournes a Flutter sont en camelCase; la DB reste en
snake_case.

## Routes principales

Routes publiques:

- `GET /health`
- `POST /v1/auth/signup`
- `POST /v1/auth/signin`
- `POST /v1/auth/refresh`
- `GET /v1/titles/genres`
- `GET /v1/titles`
- `GET /v1/titles/:id`
- `GET /v1/titles/discover`
- `GET /v1/titles/search/external`
- `GET /v1/titles/external-genres`
- `GET /v1/community/lists`
- `GET /v1/community/lists/:listId`
- `GET /v1/community/profiles/:profileId`
- `GET /v1/community/profiles/:profileId/selections`

Routes authentifiees avec `Authorization: Bearer <access_token>`:

- `GET /v1/auth/me`, `POST /v1/auth/logout`
- `GET|PUT /v1/me/profile`
- `POST /v1/me/profile/avatar`
- `GET|PUT /v1/me/preferences`
- `GET|DELETE /v1/me/selections`
- `GET /v1/me/media-actions`
- `POST /v1/me/media-actions/sync`
- `PUT /v1/me/media-actions`
- `DELETE /v1/me/media-actions`
- `DELETE /v1/me/media-actions/:mediaKey`
- `GET /v1/me/discover`
- `GET /v1/me/recommendations`
- `PUT|DELETE /v1/me/titles/:titleId/action`
- CRUD listes: `/v1/me/lists` et `/v1/me/lists/:listId/items`
- Follows: `/v1/me/follows`, `/v1/me/follows/by-email`,
  `/v1/me/follows/:profileId`

Route d'import catalogue:

- `POST /v1/titles/sync`, protegee par `x-catalog-sync-token` quand configure.

## Services

- `auth.service.ts`: signup/signin/refresh/logout via Supabase Auth; cree ou
  assure le profil; normalise email; retourne `{ user, profile, session }`.
  Le signin ne cree jamais d'utilisateur et renvoie toujours
  `Mot de passe ou adresse mail incorrect` si le compte ou le mot de passe est
  invalide.
- `title.service.ts`: liste/recherche locale via `titles_with_genres`,
  mapping `TitleDto`, calcul `seenPercentage`.
- `tmdb-discovery.service.ts`: decouverte et recherche live TMDB pour films et
  series; filtres de genre et d'annee pour le swipe; pas d'anime ici.
- `preference.service.ts`: options de genres, preferences de profil
  (`preferredGenres`, `releaseYearMin`, `releaseYearMax`) et validation min 3
  genres.
- `catalog-sync.service.ts`: importe TMDB films/series et Jikan anime dans
  `titles`, `genres`, `title_genres`.
- `user.service.ts`: profils, selections, actions utilisateur, decouverte
  locale, recommandations, upload avatar vers Supabase Storage.
- `recommendation.service.ts`: scoring simple par genres positifs
  (`liked`, `to_watch`), fallback par note.
- `external-title-resolver.service.ts`: resout les cles legeres
  `tmdb:movie:id`, `tmdb:tv:id`, `jikan:anime:id` en metadonnees via TMDB/Jikan.
  Les actions media locales/anciennes sont aussi rattachees aux titres du
  catalogue depuis `user.service.ts` pendant la synchro.
- `list.service.ts`: listes utilisateur, items, visibilite, follows.

## Modele de donnees attendu

Enums TypeScript:

- `TitleType`: `movie`, `anime`, `series`.
- `UserTitleAction`: `liked`, `to_watch`, `rejected`, `watched`.
- `ListVisibility`: `private`, `public`, `followers`.

Tables attendues par le code:

- `profiles`
  - inclut `preferred_genres`, `release_year_min`, `release_year_max`.
  - `avatar_url` contient l'URL publique de l'image uploadee dans Supabase
    Storage.
- `titles`
- `genres`
- `title_genres`
- `user_title_actions`
- `user_lists`
- `user_list_items`
- `follows`
- `recommendations`

Vue attendue:

- `titles_with_genres`, avec les colonnes de `titles` plus `genres: string[]`.

RLS: les migrations activent les policies sur profils/actions/listes/follows.
Le backend utilise la service role key pour les operations serveur.

## Contrats avec l'app Flutter

Types contenus cote app:

- `PosterType.movie` -> backend `movie`.
- `PosterType.anime` -> backend `anime`.
- `PosterType.series` -> backend `series` (TMDB utilise `tv` cote API externe).

Actions:

- `viewed` cote app correspond a `liked` cote backend.
- `toWatch` cote app correspond a `to_watch` cote backend.
- `notInterested` devrait correspondre a `rejected` cote backend.
- `watched` est prevu cote backend mais peu/pas utilise cote app.

Synchronisation legere:

- L'app stocke en DB uniquement `user_title_actions.title_id` comme `mediaKey`.
- Exemples: `tmdb:movie:299534`, `tmdb:tv:1399`, `jikan:anime:5114`.
- `POST /v1/me/media-actions/sync` upsert les actions locales, recharge toutes
  les actions du profil et renvoie les titres resolus pour le cache local.
  Les cles externes sont resolues via TMDB/Jikan; les cles `local:*` et anciens
  ids de catalogue sont resolus via `titles_with_genres`.

Preferences de swipe:

- Les genres disponibles viennent de la table `genres` via `GET /v1/titles/genres`.
- A l'inscription, `preferredGenres` est requis avec au moins 3 genres.
- Les preferences utilisateur sont exposees via `GET|PUT /v1/me/preferences`.
- La decouverte TMDB accepte `genres`, `releaseYearMin`, `releaseYearMax`.

Les erreurs HTTP doivent garder le format:

```json
{ "error": { "code": "...", "message": "...", "details": null } }
```

## Deploiement

Sur Vercel:

- Root Directory: `moviesmatchback`.
- Build Command: `npm run build` via `vercel.json`.
- `vercel.json` rewrite toutes les routes vers `/api`.
- Les URLs publiques restent sans prefixe `/api`: `/health`, `/v1/...`.

## Points d'attention actuels

- Verifier les migrations avant tout changement DB: le code TypeScript attend
  `titles`, `title_genres`, `titles_with_genres` et l'enum `title_type`.
- `notInterested` doit rester mappe a `rejected` pour le backend. L'app accepte
  encore `disliked` seulement en compatibilite locale ancienne.
- Ne pas modifier les fichiers generes (`dist`, `node_modules`) sauf besoin
  explicite.
- Preferer ajouter des tests Vitest pour toute logique de scoring, mapping ou
  service partage.
