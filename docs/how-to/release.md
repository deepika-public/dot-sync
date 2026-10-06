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

## Publier

1. Sur une branche : passer la version dans `package.json`, `package-lock.json` et
   `manifest.json` (le build refuse une divergence) ; garder l'identifiant `dot-sync` ;
   relever `minAppVersion` si les API utilisées l'exigent ; si le daemon minimal change,
   `MINIMUM_DAEMON` et la [page de compatibilité](../reference/compatibility.md), qui
   reçoit aussi l'entrée de version.
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
   n'est pas le plugin). Télécharger et refaire [l'installation](install.md) sur un vault
   neuf : `sha256sum -c`, version dans le manifest, `BUILD.json` avec le bon commit.

Le packaging refuse un tag divergent et un checkout modifié. Une release existante n'est
jamais modifiée : en cas d'erreur, publier la version suivante. Ce que la CI ne fait pas
et qu'une release mérite : le test dans de vraies fenêtres Obsidian et l'essai sur deux
machines, décrits dans [tester](test.md).

## Construire le ZIP localement

```bash
npm ci && npm test && npm run package
(cd dist && sha256sum -c SHA256SUMS)
```

Le ZIP contient `main.js`, `manifest.json`, `styles.css`, la documentation et
`BUILD.json` (commit, version, arbre propre ou non, daemon minimal). Ni daemon, ni
`node_modules`, ni `data.json`.

Références GitLab : [paquets génériques](https://docs.gitlab.com/user/packages/generic_packages/),
[accès par job token](https://docs.gitlab.com/ci/jobs/ci_job_token/),
[releases CI](https://docs.gitlab.com/ci/yaml/#release).
