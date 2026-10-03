# Audit Movie Match — 3 octobre 2026

## Perimetre

Lecture des deux README et revue de l'application Flutter, des services
d'authentification et de synchronisation, des routes Fastify, de la configuration
et des migrations Supabase. Les deux dossiers sont des depots Git distincts.
Les corrections sont locales, sans deploiement ni modification de la base distante.

## Corrections realisees

| Probleme | Correction |
| --- | --- |
| L'introduction terminee ouvrait l'application sans session | Une session est obligatoire avant d'afficher HomePage, y compris apres « Passer » et aux lancements suivants. |
| Deux boutons proposaient de continuer sans compte | Suppression dans l'introduction et le formulaire d'authentification. |
| Une deconnexion laissait l'application accessible | Le changement de session renvoie a l'authentification et ferme les routes ouvertes lors de son invalidation. |
| Un echec reseau pendant la deconnexion remontait une exception | La deconnexion locale termine meme si le serveur est inaccessible. |
| Tout echec API de rafraichissement effacait la session | Seuls les refus 401/403 l'invalident; les autres erreurs permettent de reessayer sans perdre la session. |
| Plusieurs vues pouvaient rafraichir le meme token simultanement | Les demandes de rafraichissement concurrentes partagent une seule requete. |
| Le cache n'identifiait pas son proprietaire | Association au compte; purge lors d'un changement d'utilisateur, preservation d'un compte existant, suppression des anciens choix invites au premier login. |
| L'expiration de session n'etait pas geree a l'entree de l'application | Controle au lancement, au retour au premier plan et rafraichissement programme avant expiration. |
| Le chargement des genres pouvait produire une exception non geree sur l'ecran de connexion | Gestion de l'erreur et action « Reessayer » pour l'inscription. |
| L'historique complet pouvait depasser les 500 actions admises par l'API | Envoi par lots de 500 maximum, puis fusion de la reponse finale. |
| Les tokens anonymes Supabase etaient acceptes | Refus dans les deux gestionnaires d'authentification du backend. |
| Une migration ulterieure supprimait toutes les tables applicatives | Deplacement dans `supabase/manual/reset_app_schema.sql`, hors du parcours `supabase db push`. |
| Des dependances Node presentaient des vulnerabilites signalees | Mise a jour du verrouillage et passage a Vitest 4.1.11; aucun signalement restant par npm audit. |
| L'amorcage Flutter web utilisait des API depreciees | Utilisation de `flutter_bootstrap.js`. |

Les README expliquent maintenant l'acces obligatoire par compte, le comportement
du cache et le script SQL manuel. Le minimum Node des outils a ete ajuste a
20.19 ou 22.12 et versions compatibles suivantes.

## Verification

- `flutter analyze` : aucune erreur ou avertissement.
- `flutter test` : 12 tests passent, couvrant notamment le blocage sans compte,
  la migration du cache, le changement de compte, les erreurs de rafraichissement,
  les rafraichissements concurrents, la deconnexion hors reseau et 501 actions.
- `flutter build web` : compilation reussie.
- `npm run typecheck`, `npm test`, `npm run build` : reussis, 10 tests backend.
- `npm audit` : aucune vulnerabilite signalee.
- Verification des differences Git : pas d'erreurs d'espacement.

Les appels Supabase reels, les migrations sur une base de test, le parcours
complet avec TMDB/Jikan, et les compilations Android/iOS n'ont pas ete valides.
Les tests d'authentification utilisent des reponses simulees. L'absence de
signalement npm ne constitue pas une garantie d'absence de failles.

Si la migration destructive a deja ete appliquee dans Supabase, son deplacement
ne restaure pas les tables ou les donnees. Verifier le schema, les sauvegardes
et l'historique avant toute intervention sur cette base.

## Ameliorations proposees lors de l'audit initial

Les constats ci-dessous decrivent l'etat avant leur mise en œuvre.

1. **Stockage des tokens** : `AuthService` sauvegarde actuellement les tokens
   dans SharedPreferences. Utiliser le stockage securise des plateformes mobiles,
   et definir une strategie adaptee au web, avec migration des sessions existantes.
2. **Cycle de vie du compte** : ajouter la reinitialisation du mot de passe,
   la suppression du compte et la verification de l'email. Le backend cree
   actuellement les utilisateurs avec `email_confirm: true`.
3. **Synchronisation entre appareils** : envoyer uniquement les mutations en
   attente et conserver des marqueurs de suppression cote serveur. Le renvoi
   de tout l'historique actuel peut recreer un choix supprime sur un autre appareil.
   Afficher aussi un statut visible des changements en attente et des echecs.
4. **Robustesse de l'inscription** : traiter l'echec de creation du profil apres
   la creation de l'utilisateur Auth pour eviter les inscriptions partiellement
   terminees. Ajouter un test d'integration de ce scenario.
5. **Integration continue** : executer les verifications Flutter/Node sur chaque
   changement, avec une base Supabase de test pour verifier RLS, migrations et
   parcours inscription → connexion → choix → deconnexion → autre compte.
6. **Recommandations et semantique des listes** : clarifier « Vus », actuellement
   mappe a `liked` alors que l'API prevoit aussi `watched`. Les recommandations
   locales reposent sur les affiches en cache; prevoir un catalogue de candidats
   pour eviter une liste vide quand tous les titres caches sont deja selectionnes.

## Mise en œuvre des ameliorations

Les six propositions ont ete implementees dans les deux depots :

1. **Tokens proteges** : coffre du systeme avec `flutter_secure_storage` sur les
   plateformes natives, migration puis suppression de l'ancienne copie, stockage
   uniquement en memoire sur le web. Android 6 minimum, sauvegarde Android
   desactivee, droits Keychain configures pour iOS/macOS.
2. **Gestion du compte** : verification par code email, renvoi de code,
   recuperation du mot de passe, suppression definitive avec reauthentification
   et nettoyage des avatars. Le logout ne ferme que la session courante.
   Les refresh en cours ne peuvent plus restaurer une session apres logout.
3. **Synchronisation** : file de mutations persistante par compte, gardee apres
   logout; marqueurs de suppression cote serveur; identifiants de mutations
   pour des retries idempotents; RPC atomiques; lecture paginee au-dela de
   1000 choix; reconstruction du cache au lieu du renvoi de l'historique complet.
   Un bandeau expose l'attente, la synchronisation et les erreurs avec retry.
4. **Inscription robuste** : compensation par suppression du nouvel utilisateur
   lorsque le profil ou l'envoi du code echoue; pas de suppression d'un compte
   existant lors d'une tentative d'inscription en doublon. Echec de nettoyage
   explicitement remonte.
5. **CI** : workflows propres a chacun des depots pour les checks Flutter/Node,
   et un job Supabase local avec emails Inbucket pour le parcours complet.
   Tests SQL de migrations/RLS/synchronisation et tests API prepares.
6. **Listes/recommandations** : « Vus » renomme « Aimes », tout en conservant
   l'ancienne cle `viewed` et son mapping `liked` pour les donnees existantes.
   Ajout de candidats TMDB/Jikan au cache de recommandations; exclusion des
   choix existants. `watched` reste reserve a un futur suivi de visionnage.

Validation de cette iteration : analyse Flutter, 17 tests Flutter, 16 tests
backend, compilation TypeScript et web, et zero signalement npm audit.
Les migrations et les assertions SQL de suppressions, idempotence, RLS et
cascade ont ete executees avec succes sur une instance PostgreSQL 17 isolee,
ensuite arretee. La base distante n'a pas ete modifiee.

Le test API complet avec Supabase Auth/Inbucket est ignore localement car
Docker n'est pas demarre sur cette machine. Le job CI est prepare pour
l'executer. Le coffre natif et les builds iOS/Android restent a verifier sur
leurs plateformes; aucune execution CI distante ou aucun deploiement n'a eu lieu.

Avant de deployer : appliquer `20261003100000_media_sync_tombstones.sql`,
activer Confirm email dans Supabase Auth, configurer SMTP et installer les
templates Confirm Signup/Magic Link/Reset Password fournis. Le README backend contient
le protocole, les routes et les commandes. Les anciens comptes deja confirmes
ne sont pas forces a refaire une verification.
