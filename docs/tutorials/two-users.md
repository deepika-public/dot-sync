# Essai à deux : un hôte, un invité

Deux personnes **à distance**, chacune avec Obsidian. L'**hôte** partage un dossier,
l'**invité** le rejoint. Quatre étapes, dix minutes. Linux ou macOS (expérimental).

## 1. Installer le plugin — les deux

Dans Obsidian, **Paramètres → Modules complémentaires** : désactiver le mode restreint si
besoin, puis **Parcourir**, chercher **dot-sync**, **Installer** et **Activer**.

## 2. Installer le daemon et régler — les deux

Dans les réglages de dot-sync :

- **Daemon** : **Install**. Le plugin télécharge le daemon deepika-sync de votre système,
  vérifie sa somme et le range dans son dossier ; la ligne affiche ensuite
  `deepika-sync <version> is installed` ;
- **Display name** : votre prénom, affiché à côté de votre curseur ;
- **Use public Iroh relay** : **activé, des deux côtés**. C'est ce qui permet de se joindre
  à distance, d'un réseau à l'autre ; les échanges restent chiffrés de bout en bout.

La barre d'état, en bas à droite, affiche `○ No session · choose a folder to start or join`.
Sans catalogue, l'installation à la main est dans [installer](../how-to/install.md#à-la-main).

## 3. L'hôte partage

**Clic droit sur le dossier à partager → Start dot-sync session in this folder.**

Après quelques secondes une fenêtre affiche l'**invitation** : **Copy invitation**, puis
l'envoyer à l'invité par une messagerie privée — elle donne accès à tout le dossier, en
lecture et en écriture. Le dossier porte le badge `shared`.

L'hôte garde **Obsidian ouvert** et la machine éveillée : fermer Obsidian arrête le partage.

> **Sans rien installer côté invité.** La même fenêtre propose un **lien web** (**Copy web
> link**) : qui l'ouvre dans son navigateur édite le dossier depuis une page, sans Obsidian ni
> daemon. Même prudence que pour l'invitation, qu'il contient.

## 4. L'invité rejoint

**Clic droit sur un dossier (vide, ou le sien) → Join dot-sync session in this folder**,
coller l'invitation, **Join**.

Une fenêtre annonce **ce qui va changer dans ce dossier** — fichiers créés, notes de même
nom gardées côte à côte, notes envoyées à l'hôte. Rien n'est modifié avant
**Accept and join** ; **Refuse** abandonne sans laisser de trace.

Le badge `shared` apparaît et les notes de l'hôte arrivent.

## C'est parti

Ouvrir la **même note** des deux côtés, en mode édition, et écrire : le texte et le curseur
de l'autre apparaissent en direct. `Ctrl+Z` n'annule que ses propres frappes. Créer,
renommer ou déplacer une note d'un côté se répercute de l'autre. Après une coupure réseau,
tout se resynchronise seul dans la minute.

Pour arrêter : palette de commandes → **dot-sync: Leave session**, ou simplement fermer Obsidian. Les fichiers restent du
Markdown ordinaire.

## Ça ne marche pas ?

| Symptôme | À vérifier |
| --- | --- |
| `Cannot start daemon` | Le fichier `deepika-sync` est-il bien dans `.obsidian/plugins/dot-sync/` (étape 1) ? |
| `Incompatible deepika-sync daemon` | Le fichier `deepika-sync` installé est trop ancien pour ce plugin : refaire l'étape 1 avec les dernières versions des deux |
| L'aperçu affiche `inviter_unreachable` | L'hôte a toujours le badge `shared` ? **Relay** activé des deux côtés, et **avant** que l'hôte ait démarré ? Invitation collée en entier ? Pas de VPN ? |
| Rien n'arrive après avoir rejoint | Même chose ; puis [dépanner](../how-to/troubleshoot.md) |

Une invitation créée avant d'avoir activé le relais ne vaut rien à distance : l'hôte fait
**Leave session**, active le relais, **Start session**, et renvoie la nouvelle.

Pour aller plus loin : [dépanner, recouper les journaux des deux côtés](../how-to/troubleshoot.md)
· [construire depuis les sources](../how-to/install.md) · [réglages](../reference/settings.md).
