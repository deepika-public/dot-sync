# Architecture : comment le buffer reste cohérent

Obsidian possède le texte visible, la sélection, l'undo et la sauvegarde Markdown.
deepika-sync possède l'état partagé et les échanges entre pairs. Entre les deux, le plugin
n'invente aucun protocole : chaque note ouverte tient une **réplique Yjs** (`Y.Doc`)
reliée au daemon local par son WebSocket y-sync (`y-websocket`), et
`y-codemirror.next` garde l'éditeur CodeMirror et cette réplique identiques. Le plugin
ne parle jamais aux pairs distants.

## Attacher une note

À l'ouverture d'une note `.md` du dossier partagé, le plugin se connecte à
`ws://127.0.0.1:<port>/<chemin>` et attend la première synchronisation. À cet instant
l'éditeur et la session ont pu bouger chacun de leur côté depuis le texte que l'éditeur
affichait : l'utilisateur a peut-être déjà tapé, un pair a peut-être modifié la note.
`reconcile` (`src/merge.ts`) transforme l'un contre l'autre les deux jeux de
changements avec `ChangeSet.map` de CodeMirror ; les deux côtés arrivent au même texte
sans rien perdre. Ensuite seulement l'extension collaborative est activée.

Tant que cette connexion est ouverte, le daemon n'écrit pas le fichier et n'importe pas
ses changements disque : Obsidian l'enregistre lui-même. À la fermeture de la note, le
daemon écrit le texte fusionné.

## Pendant l'édition

Les frappes locales deviennent des opérations Yjs, envoyées au daemon qui les persiste
puis les diffuse. Les changements distants arrivent par le même canal et sont appliqués
à l'éditeur **hors de l'historique d'annulation** : `Ctrl+Z` n'annule que ses propres
frappes. Deux panneaux sur la même note : un seul est relié, Obsidian tient l'autre à
jour lui-même — deux liaisons appliqueraient chaque changement deux fois.

Curseurs et sélections passent par l'awareness Yjs, que le daemon relaie sans
l'interpréter. Un curseur n'est publié que par une fenêtre qui a le focus.

## Coupures

La réplique vit dans le plugin. Si le daemon s'arrête, l'éditeur reste utilisable et ce
qui est tapé s'accumule dans la réplique ; `y-websocket` se reconnecte seul, et la
resynchronisation par vecteur d'état fusionne sans doublon. Si le daemon redémarre sur
un autre port, le plugin le lit dans `.collab/session.json` et y redirige les notes
ouvertes, qui gardent leur réplique.

Si Obsidian lui-même est tué, la réplique disparaît avec lui, mais pas le texte :
Obsidian l'avait enregistré. Par défaut le daemon lancé par cette fenêtre s'arrête avec
elle (il tient un tube vers Obsidian, que le système ferme) ; au prochain **Start session**,
il rattrape le fichier depuis le disque. Réglage désactivé, il continue de tourner et
importe le fichier dès que la connexion tombe.

## Renommages, suppressions, doublons

Le chemin d'une note est une métadonnée de son document. Une note renommée dans
Obsidian est vue par le daemon sur le disque ; l'éditeur reste relié et demandera le
nouveau chemin s'il doit se reconnecter. Une note renommée par un pair est renommée
**à travers Obsidian**, pour que l'éditeur reste ouvert. Une note supprimée par un pair
est détachée : le texte reste dans l'éditeur avec un avertissement.

Quand deux pairs avaient la même note (même chemin, même texte), la session ne garde
qu'une identité et marque l'autre `superseded_by`. L'éditeur qui tenait la note retirée
se relie de lui-même à celle qui reste.

## Le daemon

Le plugin lance le daemon lui-même (`share` ou `join`, port WebSocket libre, `--relay`
selon le réglage, `--exit-with-parent`) et le retrouve par `.collab/session.json` ; il
sonde ce fichier toutes les 1,5 s, ce qui lui fait aussi remarquer un daemon lancé depuis
un terminal, un daemon arrêté, ou un daemon d'une version précédente resté en marche après
une mise à jour, qu'il remplace. **Join session** interroge d'abord la session avec
`join --preview`, qui n'écrit rien, et ne lance le daemon qu'après **Accept and join**.

Ce que fait le daemon de l'autre côté du WebSocket — persistance, transport, collisions
de chemin, rattrapage au démarrage — est décrit dans son
[architecture](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/blob/main/docs/explanation/architecture.md).
Quand quelque chose ne va pas : [dépanner](../how-to/troubleshoot.md).
