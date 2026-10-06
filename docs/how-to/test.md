# Tester

Depuis ce dépôt, avec Node.js 24+ et npm, sans Rust ni daemon :

```bash
python3 scripts/check-docs.py     # la doc : pas de version ni de lien figé, pas de lien mort
npm ci
npm run build
npm test
```

Les tests `test/unit` couvrent la logique pure : lecture et validation de
`session.json` (version trop ancienne, autre racine, daemon mort), encodage des chemins
de notes, confinement au dossier partagé, et la fusion d'un éditeur avec la session à
l'attachement — frappes avant la première synchronisation, changements des deux côtés,
paires de substitution UTF-16.

## Intégration avec deepika-sync

Construire ou installer séparément le daemon, à la version que le plugin exige
([compatibilité](../reference/compatibility.md)). Fournir le chemin **absolu** du binaire :

```bash
DEEPIKA_SYNC_BINARY=/chemin/absolu/deepika-sync npm run test:integration
```

`test/integration` lance un vrai daemon et y relie de vrais éditeurs CodeMirror (jsdom) :
fusion de frappes simultanées avec accents et emoji, présence, undo limité à ses propres
frappes, fichier laissé intact tant que la note est ouverte puis écrit à la fermeture,
éditeur ouvert sur un texte périmé, création d'une note dans un dossier avec espaces,
renommage sur disque d'une note ouverte. Sans `DEEPIKA_SYNC_BINARY` la suite est ignorée ;
`npm test` ne la lance pas.

## Application Obsidian réelle

Sous Linux, avec Obsidian installé et un affichage :

```bash
DEEPIKA_SYNC_BINARY=/chemin/absolu/deepika-sync npm run test:desktop
```

Le harness utilise `/usr/bin/obsidian`, remplaçable par `OBSIDIAN_BINARY`.
Il ouvre deux profils et vaults temporaires indépendants. Il vérifie textes,
labels et sélections distants, collage Unicode/undo, partition simulée,
crash/reconnexion et égalité des Markdown. Ses captures sont conservées dans le
dossier temporaire affiché. Il ne se connecte pas à vos profils existants.
Il vérifie également le sélecteur de dossier, le menu contextuel, le badge, une session à
la racine du vault, l'invitation automatique, l'ouverture/fermeture rapide de notes, le
changement de dossier et l'erreur explicite d'un binaire introuvable ; qu'un daemon
périmé resté en marche est remplacé ; et que tuer Obsidian arrête le daemon qu'il a lancé. Il rejoint une session
avec un dossier contenant une note de même nom : l'aperçu doit lister le conflit et la note
à partager, **Refuse** ne doit laisser aucune trace (`.collab` absent, réglage vide), puis
**Accept and join** doit aboutir aux deux versions de la note chez les deux pairs. Il renomme une note
ouverte, la déplace dans un dossier, renomme ce dossier, renomme la note pendant que le
daemon de Bob est suspendu avec des éditions des deux côtés, et vérifie par
`deepika-sync documents` que l'UUID est conservé sur les deux pairs. Il renomme une pièce
jointe binaire, puis crée une note, la renomme aussitôt depuis son titre et l'édite des
deux côtés : aucun avertissement ne doit apparaître.

Les deux coffres du harnais partent de la même note : l'un des deux éditeurs tient donc
la copie que la session retire comme doublon, et doit se relier seul à l'autre. Lequel
des deux dépend d'UUID aléatoires ; lancer le harnais plusieurs fois couvre les deux cas.

Ces essais locaux ne valident ni la connectivité entre deux réseaux physiques, ni macOS.

## Contrôles de distribution

Avec Python 3, `curl`, `tar` et `sha256sum` :

```bash
python3 test/release/test_download.py
```

Le test utilise un registre HTTP local et vérifie qu’un téléchargement absent,
une archive corrompue, une somme portant sur un autre fichier, une liste de sommes
vide/dupliquée ou un binaire de mauvaise version ne déclenche pas l’intégration. Il vérifie
aussi qu'une release du daemon **plus ancienne que le minimum du plugin** (`MINIMUM_DAEMON`
dans `src/session.ts`) arrête le script avec le code `78`, sans lancer la suite : le job CI
`integration` apparaît alors en avertissement, avec la marche à suivre dans son journal.
Il est lancé par la CI ; il ne remplace pas le test avec un vrai daemon.

## Deux Obsidian vivants, pour tester à la main

```bash
DEEPIKA_SYNC_BINARY=/chemin/absolu/deepika-sync node scripts/live-session.mjs
```

Monte deux coffres jetables avec profils isolés, lance deux daemons et deux
fenêtres Obsidian déjà connectées, puis **rend la main** : les fenêtres restent
ouvertes. Le script affiche les chemins, les scénarios à essayer dans l'ordre le
plus révélateur, la commande de diagnostic des journaux et celle pour tout arrêter.

Il ne touche jamais à votre Obsidian ni à vos coffres. Contrairement à
`test:desktop`, il n'affirme rien : c'est vous qui observez.

## À la main, sur deux machines

Ce que les harnais ne couvrent pas : deux postes réels, à distance, avec les archives
publiées. Chacun installe depuis les releases ([installer](install.md)), note les versions
d'OS, d'Obsidian, du daemon et du plugin, puis suit l'[essai à deux](../tutorials/two-users.md)
sur un vault d'essai neuf contenant une seule note. Ensuite, dans l'ordre :

| Essai | Action | Résultat attendu |
| --- | --- | --- |
| Coédition | Alice insère au début du paragraphe pendant que Bob ajoute à la fin | Deux contributions visibles ; `sha256sum` de la note identique des deux côtés après sauvegarde |
| Présence | Chacun déplace son curseur et sélectionne quelques mots | Curseur, sélection et nom distants visibles, sans attendre |
| Unicode | Bob ajoute `Été, café, 😀` ; Alice édite autour | Texte et positions corrects sur les deux postes |
| Hors ligne | Couper le réseau de Bob **sans arrêter Obsidian** ; chacun insère un marqueur dans le même paragraphe ; rétablir | Les deux marqueurs, une seule fois ; convergence dans la minute |
| Reconnexion répétée | Deux coupures de plus, marqueurs numérotés | Ni doublon ni perte |
| Modification externe, note fermée | Alice ferme la note, puis `printf '\nligne externe\n' >> …/note.md` dans un terminal | La ligne apparaît chez Bob. Note **ouverte**, l'éditeur fait autorité : la modification est ignorée puis écrasée |
| Annulation | Chacun tape une ligne, Alice fait `Ctrl+Z` | Seule la ligne d'Alice disparaît, des deux côtés |
| Renommage d'une note ouverte | Bob renomme une note ouverte des deux côtés | Chez Alice la note suit, éditeur ouvert ; `deepika-sync documents` montre le même UUID |
| Déplacement de dossier | Alice déplace un dossier pendant que Bob y édite une note | Identité conservée, texte de Bob présent, ancien chemin disparu, aucune note en double |
| Aperçu puis refus | Bob rejoint avec un dossier contenant une note divergente, lit l'aperçu, **Refuse** | L'aperçu nomme le conflit ; le dossier est intact, sans `.collab` |
| Rejoindre avec une note divergente | Même scénario, **Accept and join** | `nom.md` et `nom (conflit xxxxxxxx).md` des deux côtés |
| Rejoindre avec les mêmes notes | Bob rejoint avec la même note, identique, **ouverte** | Aucun doublon, aucun avertissement, éditeur toujours relié |
| Redémarrage du daemon | Alice fait **Leave session** puis **Start session** ; Bob attend | Bob se reconnecte seul ; les marqueurs acceptés sont toujours là |
| Obsidian tué | Bob force la fermeture d'Obsidian avec une note ouverte, puis le relance | Le daemon s'est arrêté avec Obsidian ; **Start session** reprend la session, rien n'est perdu |
| Navigateur | Alice ouvre le **Copy web link** dans un navigateur | La note s'édite à trois, curseurs compris |
| Markdown autonome | Après convergence, **Leave session** des deux côtés, plugin désactivé | Les fichiers restent lisibles avec un éditeur ordinaire |

Pour chaque essai, noter **réussi**, **échoué** ou **non exécuté**, avec les versions et
les empreintes finales, en retirant invitations et données privées d'un compte rendu. Un
essai non exécuté reste à valider ; les harnais automatisés ne permettent pas de le
déclarer réussi. Sur un problème, [dépanner](troubleshoot.md) dit comment recouper les
journaux des deux côtés.
