# Installer, mettre à jour

Le plugin a besoin du daemon deepika-sync sur le même poste ; il le lance et l'arrête
lui-même, et **l'installe d'un clic**. Prérequis : Obsidian Desktop 1.8 ou plus, sur Linux
(x86_64 ou arm64) ou macOS (Apple Silicon ou Intel, expérimental, voir
[compatibilité](../reference/compatibility.md#plateformes)). Windows n'est pas encore pris
en charge.

## Depuis le catalogue Obsidian

1. **Paramètres → Modules complémentaires → Parcourir**, chercher **dot-sync**, **Installer**
   puis **Activer**.
2. Dans les réglages de dot-sync, ligne **Daemon** : **Install**. Le plugin télécharge le
   daemon de son système depuis la [release GitHub](https://github.com/deepika-public/deepika-sync/releases), vérifie sa somme SHA-256 et le
   place dans son dossier ; la ligne affiche ensuite `deepika-sync <version> is installed`.

Sans cette étape, le premier **Start session** ou **Join session** propose la même
installation dans une fenêtre. Rien n'est téléchargé sans un clic.

## À la main

Pour installer sans le catalogue, ou sans laisser le plugin télécharger le daemon. Dans deux
dossiers distincts (les deux fichiers de sommes portent le même nom) :

| Dossier | Page | Fichiers |
| --- | --- | --- |
| `~/Téléchargements/deepika-sync-plugin` | [Releases de dot-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/releases) | `dot-sync-<version>.zip`, `SHA256SUMS` |
| `~/Téléchargements/deepika-sync-daemon` | [Releases GitHub de deepika-sync](https://github.com/deepika-public/deepika-sync/releases) | l'archive de son système, par exemple `deepika-sync-<version>-x86_64-unknown-linux-musl.tar.gz` (Linux x86_64) ou `…-aarch64-apple-darwin.tar.gz` (macOS Apple Silicon), et `SHA256SUMS` |

Puis, **Obsidian fermé**, en adaptant seulement le chemin du vault :

```bash
MY_VAULT="$HOME/mon-vault"
(
  set -e
  test -d "$MY_VAULT"
  mkdir -p "$MY_VAULT/.obsidian/plugins"      # absent d'un vault sans aucun module
  cd ~/Téléchargements/deepika-sync-plugin && sha256sum -c SHA256SUMS
  unzip -o dot-sync-*.zip -d "$MY_VAULT/.obsidian/plugins"
  cd ~/Téléchargements/deepika-sync-daemon && sha256sum --ignore-missing -c SHA256SUMS
  tar -xzf deepika-sync-v*.tar.gz
  install -m 755 deepika-sync-v*/deepika-sync "$MY_VAULT/.obsidian/plugins/dot-sync/deepika-sync"
  "$MY_VAULT/.obsidian/plugins/dot-sync/deepika-sync" --version
)
```

Résultat attendu : deux fois **OK**, puis `deepika-sync <version>`. Le bloc s'arrête si une
vérification échoue. Sur macOS, remplacer `sha256sum` par `shasum -a 256` ; un binaire
téléchargé par le navigateur porte l'attribut de quarantaine, que
`xattr -d com.apple.quarantine "$MY_VAULT/.obsidian/plugins/dot-sync/deepika-sync"` retire
(le bouton **Install**, lui, n'en pose pas).

## Depuis les sources

Avec Node.js 24+ et npm, depuis la racine de ce dépôt :

```bash
npm ci && npm run build
```

Copier `main.js`, `manifest.json` et `styles.css` dans `<vault>/.obsidian/plugins/dot-sync/`
(créer le dossier), puis installer le daemon par le bouton **Install**, ou y placer le
binaire `deepika-sync` construit selon
[l'installation du daemon](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/blob/main/docs/how-to/install.md).

## Activer et régler

Ouvrir le vault, puis **Paramètres → Modules complémentaires** : autoriser les modules
communautaires et activer **dot-sync**. Dans ses réglages, trois choses à
faire : **Daemon** → **Install** si ce n'est pas fait, **Display name**, votre nom à côté
de votre curseur, et **Use public Iroh relay**, à activer **des deux côtés** pour collaborer
à distance. Le reste est décrit dans [réglages et commandes](../reference/settings.md). Le
dossier à partager ne se règle pas ici : il se choisit par clic droit au moment de démarrer.

Pour garder le daemon ailleurs que dans le dossier du plugin, indiquer son chemin absolu
dans **Daemon binary**, sans `~` ni `$HOME`.

Sur macOS, autoriser l'accès au réseau local si le système le demande, pour que les
participants d'un même réseau se trouvent.

## Mettre à jour

- **Le plugin** : depuis le catalogue (**Paramètres → Modules complémentaires → Vérifier
  les mises à jour**), ou à la main en refaisant l'installation : `data.json` (vos
  réglages) est conservé.
- **Le daemon** : réglages de dot-sync → **Daemon** → **Update**, proposé quand le daemon
  installé est plus ancien que celui que prévoit le plugin. Une session en cours garde
  l'ancien daemon jusqu'à son redémarrage.

Le plugin refuse un daemon plus ancien que celui qu'il exige, et propose alors de le mettre
à jour. Les autres participants peuvent se mettre à jour l'un après l'autre tant que le
protocole réseau du daemon ne change pas. Si un daemon d'une version incompatible tourne
encore, le plugin l'arrête et relance celui qui vient d'être installé, avec une notification.

Ensuite : [essai à deux](../tutorials/two-users.md).

## Depuis SyncParty for Obsidian

Avant son renommage (voir [compatibilité](../reference/compatibility.md)), le plugin
s'appelait **SyncParty for Obsidian** (identifiant `syncparty`) et le daemon **SyncParty**.
Obsidian voit dot-sync comme un autre plugin, et le protocole entre pairs a changé :

1. Tous les participants installent dot-sync et le daemon deepika-sync, comme ci-dessus.
2. Pour garder ses réglages : copier `<vault>/.obsidian/plugins/syncparty/data.json` dans
   `<vault>/.obsidian/plugins/dot-sync/`, puis remettre **Daemon binary** et **Web page** à
   leur valeur par défaut : le client web a changé d'adresse.
3. Désactiver puis supprimer SyncParty for Obsidian.

Le dossier `.collab/` d'un dossier déjà partagé est repris tel quel.
