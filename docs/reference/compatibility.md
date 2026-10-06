# Versions, compatibilité, plateformes

La version du plugin est celle de `manifest.json` (et de `package.json`, le build refuse
une divergence). Le daemon minimal est `MINIMUM_DAEMON` dans `src/session.ts`. Cette page
est **le seul endroit** de la documentation où des numéros de version sont écrits.

## Daemon requis

| Plugin | Daemon requis | Pourquoi |
| --- | --- | --- |
| 0.6.0 et suivants | **0.6.0** ou plus | Nouveau nom et protocole entre pairs `deepika-sync/yrs/2`. Le bouton d'installation de 0.7.0 installe le daemon 0.6.1 |
| 0.5.1 à 0.5.2 | 0.5.1 ou plus | `--exit-with-parent`, que le plugin passe au daemon ; présence immédiate |
| 0.5.0 | 0.5.0 ou plus | WebSocket y-sync et `session.json` |
| 0.4 et antérieurs | Daemons de leur époque | Protocole IPC disparu en 0.5.0 : ne fonctionnent avec aucun daemon 0.5 |

Un daemon trop ancien est refusé avant tout lancement (« Incompatible deepika-sync daemon »
dans la barre d'état) ; les notes ne sont pas touchées. Un daemon plus récent que le
minimum est accepté tant que le daemon garde ses contrats (`session.json`, WebSocket
y-sync) : c'est [sa page de compatibilité](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/blob/main/docs/reference/compatibility.md)
qui dit quand deux daemons peuvent, ou non, être mis à jour l'un après l'autre.

Comment le plugin trouve le daemon : toutes les 1,5 s, il lit `<dossier>/.collab/session.json`
(version, pid, port WebSocket, invitation), écrit par le daemon au démarrage et retiré à
l'arrêt. Il s'attache ainsi de la même façon à un daemon qu'il a lancé et à un daemon
lancé depuis un terminal, et remarque un daemon qui s'arrête ou redémarre. Ceux qu'il
lance prennent un port libre (`--ws-port 0`) : plusieurs vaults ne se gênent pas.

## Journal des versions

| Version | Changements | Daemon |
| --- | --- | --- |
| 0.7.0 | **Le daemon s'installe d'un clic** : réglage *Daemon* (état, bouton *Install*, *Update* ou *Reinstall*) et, au démarrage d'une session sans daemon utilisable, une fenêtre qui propose de l'installer. Le plugin télécharge l'archive de son système depuis la release GitHub du daemon, vérifie sa somme SHA-256 et la place dans son dossier ; Linux x86_64 et arm64, macOS (expérimental). Message clair si le daemon manque | 0.6.0 (installe 0.6.1) |
| 0.6.0 | **Nouveau nom** : SyncParty for Obsidian devient dot-sync (identifiant `dot-sync`), le daemon SyncParty devient deepika-sync (exécutable `deepika-sync`). Obsidian y voit un nouveau plugin : voir [la migration](../how-to/install.md#depuis-syncparty-for-obsidian). Protocole entre pairs renommé, incompatible avec 0.5 : tous les participants passent à 0.6. Client web à l'adresse `https://deepika-public.gitlab.io/deepika-obsidian-toolbox/deepika-sync` (réglage **Web page** par défaut). Licence MIT, tags sans `v`, publication au catalogue Obsidian (miroir GitHub `deepika-public/dot-sync`) | 0.6.0 |
| 0.5.2 | Un daemon d'une version précédente resté en marche après une mise à jour est remplacé par celui qui est installé ; **Leave session** arrête un daemon quelle que soit sa version | 0.5.1 |
| 0.5.1 | Lien web dans la fenêtre d'invitation (**Copy web link**, réglage *Web page*) ; noms et curseurs des participants déjà présents apparaissent tout de suite ; une session démarrée depuis Obsidian s'arrête avec lui (réglage *Stop the session when Obsidian closes*) | 0.5.1 |
| 0.5.0 | Passage aux standards Yjs : `yjs`, `y-websocket`, `y-codemirror.next` remplacent le protocole IPC maison. **Join session** montre ce qui va changer et demande ; plus de « Buffer conflict », éditeur et session sont fusionnés ; `Ctrl+Z` n'annule que ses propres frappes ; badge `shared` sans compteur de pairs ; port WebSocket choisi par le système | 0.5.0 |

Règles de numérotation : tags `X.Y.Z` (`vX.Y.Z` jusqu'à 0.5.2), indépendants de ceux du daemon, qui gardent le `v`. PATCH corrige sans
rupture, MINOR ajoute une fonctionnalité compatible ; avant `1.0`, une rupture demande un
changement de MINOR et une migration documentée ici.

## Plateformes

| Plateforme | État |
| --- | --- |
| Linux x86_64, Obsidian Desktop 1.8+ | Validé : tests dans de vraies fenêtres Obsidian (`npm run test:desktop`), essai réel à distance |
| Linux arm64 | Daemon construit et testé par la CI ; plugin identique |
| macOS (Apple Silicon, Intel) | **Expérimental.** Le plugin est du code Electron portable ; le daemon est construit (et testé sur Apple Silicon) par la CI. Reste un essai réel, et ce que le daemon liste dans sa page de compatibilité (watcher, casse des chemins) |
| Windows | Non supporté : le daemon ne l'est pas encore ; le réglage *Daemon* le dit et ne propose pas d'installation |
| Obsidian mobile | Non supporté (`isDesktopOnly`) : pas de daemon possible |

Le transport entre pairs, l'invitation et le stockage appartiennent au daemon ; le plugin
ne les implémente pas et ne parle jamais aux pairs.
