# Publier une release

Une release, c'est un tag `X.Y.Z` sur `main`, **sans `v`** : Obsidian exige un tag égal à la
version du manifest. Deux publications en découlent : sur **GitLab**, la source, la CI
construit le ZIP du plugin, le dépose dans le registre de paquets et crée la page de
release ; sur **GitHub**, le miroir `github.com/deepika-public/dot-sync` reçoit le tag, et
le workflow `.github/workflows/release.yml` atteste la provenance de `main.js`,
`manifest.json` et `styles.css` (attestations GitHub), puis crée la release avec ces trois
fichiers, celle que lit le catalogue des plugins Obsidian ; relancé sur un tag existant,
il remplace les fichiers au lieu d'échouer. Le daemon ne passe pas
par le catalogue : les utilisateurs l'installent depuis ses releases. Rien n'est publié
sur npm. Le daemon se publie
**avant**, selon son [guide](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/blob/main/docs/how-to/release.md) :
le pipeline du plugin teste l'intégration contre une archive publiée du daemon.

## Prérequis, une fois

- Un runner GitLab Docker Linux x86_64, le registre de paquets générique activé, et dans
  les réglages du **groupe**, **Packages and registries → Generic**, *Allow duplicates*
  désactivé. Tags `*.*.*` protégés.
- Le miroir vers GitHub (*Settings → Repository → Mirroring repositories*, direction
  *Push*, `ssh://github.com/deepika-public/dot-sync.git`, utilisateur `git`, clés d'hôte
  détectées, authentification par clé SSH), dont la clé publique est une *deploy key* en
  écriture du dépôt GitHub.
- Dans **Settings → CI/CD → Variables** de ce projet, non secrètes, disponibles aux
  pipelines de `main` et des tags (portée `*`) :

  | Variable | Valeur |
  | --- | --- |
  | `DEEPIKA_SYNC_PROJECT_ID` | `86617901`, l'identifiant du projet du daemon |
  | `DEEPIKA_SYNC_RELEASE_TAG` | Le tag exact d'un daemon publié **et au moins égal au minimum du plugin** (`MINIMUM_DAEMON` dans `src/session.ts`). Un tag plus ancien met le job `integration` en avertissement (code 78) sans le faire échouer : l'intégration n'est alors **pas** testée |

- Dans le projet du **daemon**, **Settings → CI/CD → Job token permissions** : autoriser
  `deepika-public/deepika-obsidian-toolbox/dot-sync`. Aucun jeton personnel : le job
  télécharge avec `CI_JOB_TOKEN`.

Sur une branche, le pipeline construit, teste et empaquette sans Rust, et lance
l'intégration si les variables sont renseignées : le daemon est téléchargé, vérifié par
SHA-256, extrait dans un dossier temporaire et lancé par la suite `test/integration`. Sur
un tag, **l'intégration est obligatoire** : téléchargement incorrect ou test échoué
bloquent la release.

## Le CHANGELOG

[`CHANGELOG.md`](../../CHANGELOG.md), à la racine, suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) : une section par version, des
rubriques **Ajouté**, **Modifié**, **Corrigé**, **Supprimé**, écrites pour qui utilise le
plugin, pas pour qui lit le code. Chaque merge request qui change ce que voit
l'utilisateur ajoute sa ligne sous `## [Non publié]`.

La section de la version est le texte des releases : le job `package` l'écrit dans
`dist/RELEASE_NOTES.md` (`scripts/release-notes.py`, liens relatifs rendus absolus), que
reprennent la release GitLab et le workflow GitHub. Un pied de page y ajoute ce qui ne
vaut que pour la release : version d'Obsidian requise (`versions.json`), daemon contre
lequel le pipeline l'a testée (`DEEPIKA_SYNC_RELEASE_TAG`), lien vers la mise à jour, vers
le CHANGELOG complet et vers les changements depuis la version précédente ; sur GitHub, où
se trouvent le ZIP et `SHA256SUMS`. Sans section, ou avec une section vide, le packaging
échoue : une version ne part pas sans dire ce qui change.

Le CHANGELOG fait foi : le texte d'une release ne s'édite pas à la main. Sur GitHub, le
workflow `.github/workflows/release-notes.yml` réécrit le texte de toutes les releases
quand `main` change le CHANGELOG, `versions.json` ou le script (et à la demande, onglet
**Actions**). Sur GitLab, la release prend son texte à sa création ; pour en corriger une
existante :

```bash
python3 scripts/release-notes.py X.Y.Z > dist/notes.md
glab api -X PUT "projects/deepika-public%2Fdeepika-obsidian-toolbox%2Fdot-sync/releases/X.Y.Z" \
  -F "description=@$PWD/dist/notes.md"
```

```bash
python3 scripts/release-notes.py          # texte de la version du manifest
python3 scripts/release-notes.py X.Y.Z    # d'une autre version
```

## Publier

1. Sur une branche : passer la version dans `package.json`, `package-lock.json` et
   `manifest.json` (le build refuse une divergence) ; garder l'identifiant `dot-sync` ;
   relever `minAppVersion` si les API utilisées l'exigent, et ajouter la paire version →
   `minAppVersion` dans `versions.json` ; si le daemon minimal change, `MINIMUM_DAEMON` et
   le tableau du daemon requis de la [page de compatibilité](../reference/compatibility.md).
   Dans le CHANGELOG, renommer `## [Non publié]` en `## [X.Y.Z] - AAAA-MM-JJ`, remettre un
   `## [Non publié]` vide au-dessus et mettre à jour les liens du bas (`[Non publié]`
   compare depuis `X.Y.Z`, nouveau lien `[X.Y.Z]`).
2. Si le daemon vient d'être publié, mettre `DEEPIKA_SYNC_RELEASE_TAG` à jour, puis relancer
   le job `integration` de la merge request pour qu'il tourne contre ce daemon.
3. Merge request, pipeline vert **intégration comprise**, fusion. **Attendre que le
   pipeline de `main` soit vert** avant de taguer.
4. Poser le tag sur ce commit de `main`, jamais réutilisé ni déplacé :

   ```bash
   git fetch origin && git switch --detach origin/main
   git tag -a X.Y.Z -m 'dot-sync X.Y.Z'
   git push origin X.Y.Z
   ```

5. Attendre le job `release`, puis vérifier sur la
   [page des releases](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync/-/releases)
   la présence de `dot-sync-X.Y.Z.zip` et de `SHA256SUMS` (« Source code »
   n'est pas le plugin), et le texte de la section du CHANGELOG. Télécharger et refaire
   [l'installation](install.md) sur un vault neuf : `sha256sum -c`, version dans le
   manifest, `BUILD.json` avec le bon commit.
6. Vérifier sur [GitHub](https://github.com/deepika-public/dot-sync/releases) la release
   `X.Y.Z`, ses trois fichiers et le même texte : le catalogue Obsidian la proposera sous
   quelques heures.

Le packaging refuse un tag divergent et un checkout modifié. Les fichiers d'une release
existante ne sont jamais modifiés, seul son texte suit le CHANGELOG : en cas d'erreur dans
le plugin, publier la version suivante. Ce que la CI ne fait pas
et qu'une release mérite : le test dans de vraies fenêtres Obsidian et l'essai sur deux
machines, décrits dans [tester](test.md).

## Construire le ZIP localement

```bash
npm ci && npm test && npm run package
(cd dist && sha256sum -c SHA256SUMS)
```

Le ZIP contient `main.js`, `manifest.json`, `styles.css`, le README, le CHANGELOG, la
documentation et `BUILD.json` (commit, version, arbre propre ou non, daemon minimal). Ni
daemon, ni `node_modules`, ni `data.json`. À côté, `dist/RELEASE_NOTES.md` est le texte de
la release.

Références GitLab : [paquets génériques](https://docs.gitlab.com/user/packages/generic_packages/),
[accès par job token](https://docs.gitlab.com/ci/jobs/ci_job_token/),
[releases CI](https://docs.gitlab.com/ci/yaml/#release).
