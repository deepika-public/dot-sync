# Réglages et commandes

Identifiant du plugin : `dot-sync`. Nom affiché : **dot-sync**. Desktop
uniquement. Les réglages sont dans `data.json` du dossier du plugin.

## Réglages

| Réglage | Valeur initiale | Rôle |
| --- | --- | --- |
| Daemon | — | Pas un réglage : l'état du daemon (version installée, chemin) et un bouton. **Install** télécharge le daemon de la [release GitHub](https://github.com/deepika-public/deepika-sync/releases) prévue par cette version du plugin, pour ce système, vérifie sa somme SHA-256 et le place dans le dossier du plugin ; **Update** fait de même quand le daemon installé est plus ancien ; **Reinstall** remplace un daemon à jour. Rien n'est téléchargé sans ce clic. Pas de bouton sur un système sans binaire publié (Windows) |
| Daemon binary | `deepika-sync` | Exécutable du daemon. Laissé tel quel, le plugin prend le fichier `deepika-sync` placé **dans son propre dossier** (celui qu'installe le bouton) s'il existe, sinon celui du `PATH`. Sinon un chemin absolu, sans `~`, qui l'emporte sur le daemon installé |
| Display name | `Peer` | Étiquette de présence à côté du curseur, sans certification d'identité |
| Use public Iroh relay | Désactivé | Passe `--relay` aux daemons lancés par le plugin : nécessaire pour collaborer hors du réseau local, et pour le lien web. À régler **avant** de démarrer la session ; ne reconfigure pas un daemon déjà lancé |
| Stop the session when Obsidian closes | Activé | Une session démarrée depuis cette fenêtre s'arrête avec elle : fermeture, plantage, `kill`, module désactivé. Désactivé, le daemon continue d'héberger après la fermeture et le plugin le retrouve à la réouverture. S'applique à la prochaine session démarrée |
| Web page | `https://deepika-public.gitlab.io/deepika-obsidian-toolbox/deepika-sync` | Adresse du client navigateur, dont le plugin compose le lien web `<page>/#<invitation>`. Vide : pas de lien web |

Le dossier partagé ne se règle pas : il se choisit au moment de démarrer.

**Démarrer ou rejoindre sans daemon utilisable** (absent, ou plus ancien que le minimum de
[compatibilité](compatibility.md)) ouvre la fenêtre **Install the deepika-sync daemon?**,
qui dit d'où vient le binaire et comment il est vérifié : **Install** l'installe puis
poursuit, **Cancel** renonce sans rien changer. Un échec (réseau, somme fausse) s'affiche
dans la fenêtre, avec **Retry** ; le daemon déjà installé reste en place. Si **Daemon
binary** nomme un autre exécutable, rien n'est proposé : le plugin dit seulement qu'il ne
peut pas le lancer.

## Commandes

Dans la palette, et pour les trois premières au clic droit sur un dossier :

| Commande | Effet |
| --- | --- |
| **Start session** | Choisir un dossier (ou la racine du vault), lancer le daemon dessus, afficher l'invitation |
| **Join session** | Choisir un dossier, coller l'invitation, lire l'**aperçu** de ce qui va changer, accepter ou refuser |
| **Leave session** | Relâcher les notes ouvertes (le daemon écrit leur texte fusionné), puis arrêter le daemon |
| **Show invitation** | Réafficher la fenêtre d'invitation ; un clic sur la barre d'état fait de même |
| **Copy invite code** | Copier l'invitation seule |
| **Copy web link** | Copier `<page>/#<invitation>`, à ouvrir dans un navigateur sans rien installer |

Une seule session à la fois : pour changer de dossier, **Leave session** d'abord.

**L'invitation** donne accès à tout le dossier, en lecture et en écriture, sans révocation :
à transmettre en privé. Le lien web contient l'invitation (après le `#`, que le navigateur
n'envoie jamais au serveur de la page) et donne le même accès. Il n'est proposé que si
l'invitation nomme un relais, un navigateur ne pouvant joindre l'hôte autrement ; sinon la
fenêtre et la commande disent d'activer le relais et de redémarrer la session.

**L'aperçu** de **Join session** vient de `deepika-sync join --preview`, qui interroge la session
sans rien écrire : fichiers créés, conflits de nom (les deux versions sont gardées),
fichiers fusionnés, renommés, **supprimés**, notes locales qui seront partagées. Tant que
**Accept and join** n'est pas choisi, rien n'a été modifié : ni `.collab`, ni réglage.
**Refuse**, Échap ou la croix valent refus. Session injoignable : l'aperçu affiche l'erreur
et ne propose que de renoncer. L'aperçu est sauté si un daemon sert déjà ce dossier.

## Ce que montre l'interface

- **Barre d'état** : `○ No session` ; `◌ Starting session…` ; `● Collaborative session · <dossier>` ;
  `○ Session stopped` (daemon arrêté, relancer par **Start session**) ; `⚠ …` en cas
  d'erreur, dont un daemon incompatible. Un état déconnecté concerne le daemon local, pas
  les collaborateurs ; le nombre de pairs n'est pas affiché, le daemon ne l'expose pas.
- **Badge `shared`** sur le dossier partagé dans l'explorateur, ou dans son en-tête pour la
  racine du vault. Cette décoration repose sur la structure HTML d'Obsidian, sans API
  publique : si elle disparaît, la barre d'état reste la référence.
- **Curseurs, sélections et noms** des autres participants dans chaque note ouverte.
- **Notifications** pour les avertissements, listées dans [dépanner](../how-to/troubleshoot.md).

Seules les notes `.md` sous le dossier de la session sont reliées, une vue éditable par
note. Comment elles le restent : [architecture](../explanation/architecture.md).
