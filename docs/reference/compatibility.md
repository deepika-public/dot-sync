# Versions, compatibilité, plateformes

La version du plugin est celle de `manifest.json` (et de `package.json`, le build refuse
une divergence). Le daemon minimal est `MINIMUM_DAEMON` dans `src/session.ts`. Cette page
est, avec le [CHANGELOG](../../CHANGELOG.md), **le seul endroit** de la documentation où des
numéros de version sont écrits.

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

## Numérotation

Tags `X.Y.Z` (`vX.Y.Z` jusqu'à 0.5.2), indépendants de ceux du daemon, qui gardent le `v`.
PATCH corrige sans rupture, MINOR ajoute une fonctionnalité compatible ; avant `1.0`, une
rupture demande un changement de MINOR et une migration documentée, décrite dans le
[CHANGELOG](../../CHANGELOG.md) avec tout ce que change chaque version.

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
