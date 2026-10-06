# dot-sync

*Live collaboration on Markdown notes in Obsidian, peer to peer: right-click a folder to share it, send the invitation, and everyone edits the same notes with live cursors. Requires the separately installed [deepika-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync) daemon, which the plugin starts and stops. Desktop only. Documentation below is in French; see « Divulgations » for network and file access.*

Édition collaborative de notes dans Obsidian, sans serveur : un clic droit sur un dossier
pour le partager, une invitation à envoyer, et les participants écrivent dans les mêmes
notes avec leurs curseurs en direct. Les fichiers restent du Markdown ordinaire.

Le plugin s'appuie sur le daemon [deepika-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync),
qu'il lance et arrête lui-même : c'est le daemon qui garde l'état partagé, l'écrit sur
le disque et se synchronise de pair à pair, chiffré de bout en bout. Le plugin relie
chaque note ouverte à ce daemon par le protocole standard y-sync (`yjs`, `y-websocket`,
`y-codemirror.next`) et ne parle jamais aux pairs. Une session peut aussi être rejointe
depuis un navigateur, sans rien installer, par le lien web que le plugin compose.

## Installer

Depuis les [releases du plugin](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/releases)
et [du daemon](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/releases), Obsidian
fermé, le daemon allant **dans le dossier du plugin** :

```bash
VAULT=~/Documents/MonVault
mkdir -p "$VAULT/.obsidian/plugins"
unzip -o dot-sync-*.zip -d "$VAULT/.obsidian/plugins"
tar -xzf deepika-sync-v*-x86_64-unknown-linux-gnu.tar.gz --strip-components=1 \
    -C "$VAULT/.obsidian/plugins/dot-sync" --wildcards '*/deepika-sync'
```

Puis activer **dot-sync** dans les modules complémentaires. Le détail, avec
vérification des sommes et mise à jour, est dans [installer](docs/how-to/install.md) ;
depuis les sources, `npm ci && npm run build`.

## Utiliser

1. **Réglages** : votre nom, et **Use public Iroh relay** pour collaborer à distance.
2. **L'hôte** : clic droit sur un dossier → **Start dot-sync session in this folder**,
   puis **Copy invitation** ou **Copy web link**, à envoyer en privé.
3. **L'invité** : clic droit sur un dossier → **Join dot-sync session in this folder**, coller,
   lire ce qui va changer dans le dossier, **Accept and join**.

L'[essai à deux](docs/tutorials/two-users.md) déroule ces étapes ; les [réglages et
commandes](docs/reference/settings.md) décrivent le reste.

## Ce qu'il garantit, et ce qu'il ne fait pas

- Chaque frappe est fusionnée avec celles des autres ; `Ctrl+Z` n'annule que les siennes.
- Rien n'est écrit dans un dossier avant d'avoir accepté l'aperçu de **Join session**.
- Une session démarrée depuis Obsidian s'arrête avec lui : un dossier ne reste pas partagé
  à votre insu (réglage).
- Desktop uniquement ; Linux validé, macOS pas encore. Une invitation vaut pour tout le
  dossier, en écriture, sans révocation. Le plugin exige une version minimale du daemon,
  donnée dans [compatibilité](docs/reference/compatibility.md).

## Divulgations

Ce que le plugin fait hors d'Obsidian, comme le demandent les règles du catalogue :

- **Programme externe** : le plugin lance le daemon [deepika-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync), à installer à part (exécutable placé dans le dossier du plugin, ou chemin donné dans les réglages), et lui parle par une connexion WebSocket locale (`127.0.0.1`).
- **Réseau** : le daemon se connecte directement aux autres participants de la session (Iroh QUIC, chiffré de bout en bout) et les découvre sur le réseau local (mDNS). Avec le réglage **Use public Iroh relay**, les échanges passent par les relais publics d'Iroh quand une connexion directe est impossible ; le contenu reste chiffré de bout en bout. Le lien web d'une session pointe vers le client navigateur, publié sur GitLab Pages.
- **Fichiers** : le daemon lit et écrit les notes Markdown du dossier partagé, et y crée un dossier `.collab/` (état de la session).
- **Ni compte, ni télémétrie, ni publicité.** Code source ouvert, licence MIT.

## Documentation

[Index](docs/README.md) · [Dépanner](docs/how-to/troubleshoot.md) ·
[Architecture](docs/explanation/architecture.md) · [Tester](docs/how-to/test.md) ·
[Publier une release](docs/how-to/release.md).
