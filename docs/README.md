# Documentation de dot-sync

Le plugin relie les notes ouvertes dans Obsidian au daemon deepika-sync du même poste, par
WebSocket y-sync, et affiche la présence des autres. Il ne parle jamais aux pairs. Le
[README](../README.md) résume le projet ; cette page indexe le reste.

| | Pages |
| --- | --- |
| **Tutoriel** | [Essai à deux : un hôte, un invité](tutorials/two-users.md) |
| **Guides** | [Installer, mettre à jour](how-to/install.md) · [Dépanner](how-to/troubleshoot.md) · [Tester](how-to/test.md) · [Publier une release](how-to/release.md) |
| **Référence** | [Réglages et commandes](reference/settings.md) · [Versions, compatibilité, plateformes](reference/compatibility.md) |
| **Explication** | [Architecture : comment le buffer reste cohérent](explanation/architecture.md) |

Le daemon a sa propre documentation, de même structure :
[deepika-sync](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/blob/main/README.md).
Tout ce qui le concerne — ligne de commande, protocoles, stockage, sécurité, journaux,
plateformes — y vit, et n'est jamais recopié ici.

Règles de cette documentation : un sujet vit dans un seul fichier ; aucun numéro de version
ni lien figé en dehors de [compatibilité](reference/compatibility.md).
