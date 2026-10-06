# dot-sync

*Live collaboration on Markdown notes in Obsidian, peer to peer: right-click a folder to share it, send the invitation, and everyone edits the same notes with live cursors. Runs through the [deepika-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync) daemon, which the plugin installs in one click (Settings → Daemon → Install; Linux and macOS), then starts and stops. Desktop only. Documentation below is in French; see « Divulgations » for network and file access.*

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

1. **Paramètres → Modules complémentaires → Parcourir** : chercher **dot-sync**, installer,
   activer.
2. Dans ses réglages, ligne **Daemon** : **Install**. Le plugin télécharge le daemon de
   votre système (Linux x86_64 ou arm64, macOS), vérifie sa somme SHA-256 et le range dans
   son dossier.

L'installation à la main, depuis les sources, et la mise à jour sont dans
[installer](docs/how-to/install.md).

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
- Desktop uniquement ; Linux validé, macOS expérimental, Windows pas encore. Une invitation vaut pour tout le
  dossier, en écriture, sans révocation. Le plugin exige une version minimale du daemon,
  donnée dans [compatibilité](docs/reference/compatibility.md).

## Divulgations

Ce que le plugin fait hors d'Obsidian, comme le demandent les règles du catalogue :

- **Programme externe** : le plugin lance le daemon [deepika-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync) (exécutable placé dans le dossier du plugin, ou chemin donné dans les réglages), et lui parle par une connexion WebSocket locale (`127.0.0.1`).
- **Téléchargement d'un exécutable, à la demande** : seulement quand vous cliquez sur **Install**, **Update** ou **Reinstall** (réglage **Daemon**, ou fenêtre proposée au démarrage d'une session sans daemon), le plugin télécharge depuis `github.com` l'archive du daemon de la [release GitHub](https://github.com/deepika-public/deepika-sync/releases) prévue par sa version, refuse toute archive dont la somme SHA-256 ne correspond pas au `SHA256SUMS` de la release, puis place l'exécutable dans son propre dossier. Les archives sont construites par la CI publique du daemon et attestées (GitHub artifact attestations). Aucun téléchargement automatique, aucune mise à jour silencieuse.
- **Réseau** : le daemon se connecte directement aux autres participants de la session (Iroh QUIC, chiffré de bout en bout) et les découvre sur le réseau local (mDNS). Avec le réglage **Use public Iroh relay**, les échanges passent par les relais publics d'Iroh quand une connexion directe est impossible ; le contenu reste chiffré de bout en bout. Le lien web d'une session pointe vers le client navigateur, publié sur GitLab Pages.
- **Fichiers** : le daemon lit et écrit les notes Markdown du dossier partagé, et y crée un dossier `.collab/` (état de la session).
- **Ni compte, ni télémétrie, ni publicité.** Code source ouvert, licence MIT.

## Documentation

[Index](docs/README.md) · [Dépanner](docs/how-to/troubleshoot.md) ·
[Architecture](docs/explanation/architecture.md) · [Tester](docs/how-to/test.md) ·
[Publier une release](docs/how-to/release.md).
