# Installer, mettre à jour

Le plugin a besoin du daemon deepika-sync sur le même poste ; il le lance et l'arrête
lui-même. Le plus simple est de placer le binaire du daemon **dans le dossier du plugin**,
où il est trouvé sans aucun réglage. Prérequis : Obsidian Desktop 1.8 ou plus, Linux x86_64
(glibc 2.34+). macOS n'est pas encore validé, voir [compatibilité](../reference/compatibility.md).

## Depuis les dernières releases

Télécharger, dans deux dossiers distincts (les deux fichiers de sommes portent le même nom),
l'archive et son `SHA256SUMS` de chaque projet — il faut avoir accès aux projets :

| Dossier | Page | Fichiers |
| --- | --- | --- |
| `~/Téléchargements/deepika-sync-daemon` | [Releases de deepika-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/releases) | `deepika-sync-<version>-x86_64-unknown-linux-gnu.tar.gz`, `SHA256SUMS` |
| `~/Téléchargements/deepika-sync-plugin` | [Releases de dot-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/releases) | `dot-sync-<version>.zip`, `SHA256SUMS` |

Le daemon requis est indiqué dans [compatibilité](../reference/compatibility.md) ; prendre
les dernières versions des deux. Puis, **Obsidian fermé**, en adaptant seulement le chemin
du vault :

```bash
MY_VAULT="$HOME/mon-vault"
(
  set -e
  test -d "$MY_VAULT"
  mkdir -p "$MY_VAULT/.obsidian/plugins"      # absent d'un vault sans aucun module
  cd ~/Téléchargements/deepika-sync-plugin && sha256sum -c SHA256SUMS
  unzip -o dot-sync-*.zip -d "$MY_VAULT/.obsidian/plugins"
  cd ~/Téléchargements/deepika-sync-daemon && sha256sum -c SHA256SUMS
  tar -xzf deepika-sync-v*-x86_64-unknown-linux-gnu.tar.gz --strip-components=1 \
      -C "$MY_VAULT/.obsidian/plugins/dot-sync" --wildcards '*/deepika-sync'
  "$MY_VAULT/.obsidian/plugins/dot-sync/deepika-sync" --version
)
```

Résultat attendu : deux fois **OK**, puis `deepika-sync <version>`. Le bloc s'arrête si une
vérification échoue.

## Depuis les sources

Avec Node.js 24+ et npm, depuis la racine de ce dépôt :

```bash
npm ci && npm run build
```

Copier `main.js`, `manifest.json` et `styles.css` dans `<vault>/.obsidian/plugins/dot-sync/`
(créer le dossier), et y placer le binaire `deepika-sync` construit ou téléchargé selon
[l'installation du daemon](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/blob/main/docs/how-to/install.md).

## Activer et régler

Ouvrir le vault, puis **Paramètres → Modules complémentaires** : autoriser les modules
communautaires et activer **dot-sync**. Dans ses réglages, deux choses à
faire : **Display name**, votre nom à côté de votre curseur, et **Use public Iroh relay**,
à activer **des deux côtés** pour collaborer à distance. Le reste est décrit dans
[réglages et commandes](../reference/settings.md). Le dossier à partager ne se règle pas
ici : il se choisit par clic droit au moment de démarrer.

Pour garder le daemon ailleurs que dans le dossier du plugin, indiquer son chemin absolu
dans **Daemon binary**, sans `~` ni `$HOME`.

Sur macOS, autoriser l'accès au réseau local si le système le demande ; rien d'autre ne
diffère, mais rien n'y a encore été validé.

## Mettre à jour

Obsidian fermé, refaire l'installation depuis les releases : les archives se décompressent
par-dessus, et `data.json` (vos réglages) est conservé. Mettre à jour **le plugin et le
daemon ensemble** : le plugin refuse un daemon plus ancien que celui qu'il exige. Les autres
participants peuvent se mettre à jour l'un après l'autre tant que le protocole réseau du
daemon ne change pas.

Si un daemon de l'ancienne version tourne encore au redémarrage, le plugin l'arrête et
relance celui qui vient d'être installé, avec une notification.

Ensuite : [essai à deux](../tutorials/two-users.md).

## Depuis le catalogue Obsidian

Une fois le plugin accepté au catalogue : **Paramètres → Modules complémentaires →
Parcourir**, chercher **dot-sync**, installer, puis placer le daemon dans le dossier du
plugin comme ci-dessus (le catalogue ne distribue que le plugin).

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
