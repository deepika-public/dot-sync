# Changelog

Les changements de chaque version de dot-sync, de la plus récente à la plus ancienne. Le
format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; la numérotation et
le daemon requis par chaque version sont décrits dans
[compatibilité](docs/reference/compatibility.md). La section d'une version devient le texte
de sa release, sur GitLab et sur GitHub.

## [Non publié]

## [0.8.0] - 2026-11-23

### Ajouté

- **Menu de la barre d'état** : un clic sur l'état ouvre l'invitation, la copie de
  l'invitation ou du lien web et **Leave session** pendant une session ; **Start session**
  et **Join session** sinon.
- **Session arrêtée avec son dossier** : supprimer ou déplacer le dossier partagé (ou un
  dossier parent), dans Obsidian ou par un autre programme, arrête la session, oublie le
  dossier et l'annonce par une notification. Pour le partager à son nouvel emplacement,
  relancer **Start session**.

### Modifié

- **Barre d'état courte** : un symbole et un mot (`● Shared`, `○ No session`,
  `◌ Starting…`, `○ Stopped`, `⚠ Error`…). Le dossier partagé et le message d'erreur
  complet s'affichent au survol.

### Corrigé

- Un dossier partagé supprimé laissait une erreur `ENOENT` dans la barre d'état et une
  session qu'aucun menu ne permettait plus de quitter.
- `BUILD.json`, dans le ZIP du plugin, annonce le bon daemon minimal.

## [0.7.0] - 2026-10-06

### Ajouté

- **Le daemon s'installe d'un clic** : réglage **Daemon** (état, bouton **Install**,
  **Update** ou **Reinstall**) et, au démarrage d'une session sans daemon utilisable, une
  fenêtre qui propose de l'installer. Le plugin télécharge l'archive de son système depuis
  la release GitHub du daemon, vérifie sa somme SHA-256 et la place dans son dossier ;
  Linux x86_64 et arm64, macOS (expérimental). Le bouton installe le daemon 0.6.1.

### Modifié

- Message clair quand le daemon manque, au lieu d'une erreur de lancement.

## [0.6.0] - 2026-10-06

### Modifié

- **Nouveau nom** : SyncParty for Obsidian devient dot-sync (identifiant `dot-sync`), le
  daemon SyncParty devient deepika-sync (exécutable `deepika-sync`). Obsidian y voit un
  nouveau plugin : voir [la migration](docs/how-to/install.md#depuis-syncparty-for-obsidian).
- Protocole entre pairs renommé, incompatible avec 0.5 : tous les participants passent à
  0.6, avec le daemon 0.6.0 ou plus.
- Client web à l'adresse `https://deepika-public.gitlab.io/deepika-obsidian-toolbox/deepika-sync`
  (réglage **Web page** par défaut).
- Licence MIT, tags sans `v`, publication au catalogue Obsidian (miroir GitHub
  `deepika-public/dot-sync`).

## 0.5.2 - 2026-09-21

### Corrigé

- Un daemon d'une version précédente resté en marche après une mise à jour est remplacé
  par celui qui est installé.
- **Leave session** arrête un daemon quelle que soit sa version.

## 0.5.1 - 2026-09-21

### Ajouté

- Lien web dans la fenêtre d'invitation (**Copy web link**, réglage **Web page**).
- Réglage **Stop the session when Obsidian closes** : une session démarrée depuis Obsidian
  s'arrête avec lui. Requiert le daemon 0.5.1.

### Modifié

- Les noms et curseurs des participants déjà présents apparaissent tout de suite.

## 0.5.0 - 2026-09-21

### Modifié

- Passage aux standards Yjs : `yjs`, `y-websocket` et `y-codemirror.next` remplacent le
  protocole IPC maison. Requiert le daemon 0.5.0.
- **Join session** montre ce qui va changer et demande confirmation.
- `Ctrl+Z` n'annule que ses propres frappes.
- Port WebSocket choisi par le système.

### Supprimé

- « Buffer conflict » : éditeur et session sont fusionnés.
- Le compteur de pairs du badge `shared`.

## 0.4.0 - 2026-09-20

### Modifié

- Requiert le daemon SyncParty 0.3.0 ou plus (capacité `lease_contested`) : mettre à jour
  les deux composants sur chaque poste.
- Un fichier modifié sur le disque pendant qu'il était ouvert est signalé, au lieu de
  ressortir plus tard comme un conflit opaque.
- Une file de renommages bloquée ne gèle plus que les chemins qu'elle touche, au lieu de
  suspendre l'ouverture de toutes les notes du coffre.

### Corrigé

- Après une reconnexion, les réservations qu'aucun éditeur ne détient sont libérées une
  fois les panneaux locaux rouverts.

## 0.3.1 - 2026-09-18

Avec le daemon SyncParty 0.2.1.

### Corrigé

- Une note renommée aussitôt depuis son titre est créée sans conflit, et les pièces
  jointes se renomment.
- Un renommage en attente ne bloque plus le suivi des éditeurs : seule leur ouverture
  auprès du daemon attend.
- Une note enregistrée par Obsidian et importée par le daemon avant l'ouverture de
  l'éditeur ne voit plus ses éditions rejouées.
- Les erreurs transitoires (`unknown_document`, `rename_source_pending`) ne s'affichent
  que si elles durent plus de 20 secondes.

## 0.3.0 - 2026-09-18

### Ajouté

- Les notes et dossiers renommés dans le vault gardent leur identité dans la session. Les
  renommages en attente sont conservés dans `data.json` jusqu'à confirmation du daemon.

### Modifié

- Requiert le daemon SyncParty 0.2.0 ou plus (capacité `filesystem_rename`) : mettre à
  jour les deux composants sur chaque poste. La mise à jour ne répare pas les identités
  dupliquées ou les conflits créés par une version précédente.

## 0.2.1 - 2026-09-18

### Ajouté

- L'invitation s'affiche au démarrage d'une session.
- Badge de session dans l'en-tête de l'explorateur quand le dossier partagé est le vault
  entier.

### Corrigé

- Fermeture des liaisons des vues gardées en cache par Obsidian.

## 0.2.0 - 2026-09-18

### Ajouté

- Choix du dossier partagé dans une liste, et actions dans le menu contextuel des
  dossiers, à la place du réglage *Shared root* (chemin absolu).

## 0.1.0 - 2026-09-18

- Première version, **SyncParty for Obsidian** : relie les notes ouvertes au daemon
  SyncParty par son protocole IPC 2, affiche les curseurs et sélections distants. Linux
  testé avec Obsidian réel ; Desktop uniquement.

[Non publié]: https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/compare/0.8.0...main
[0.8.0]: https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/releases/0.8.0
[0.7.0]: https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/releases/0.7.0
[0.6.0]: https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/releases/0.6.0
