# Dépanner

D'abord ce que dit Obsidian, puis les journaux des deux côtés. Tout ce qui concerne le
daemon lui-même — ses codes, ses journaux, la sauvegarde d'une session — est dans son
propre guide : [dépanner le daemon](https://gitlab.com/deepika-public/deepika-obsidian-toolbox/deepika-sync/-/blob/main/docs/how-to/troubleshoot.md).

## Ce que dit Obsidian

**`○ Session stopped`.** Le daemon s'est arrêté. Garder Obsidian ouvert, les notes restent
éditables ; relancer par **Start session** sur le même dossier. Les notes ouvertes se
reconnectent seules et ce qui a été tapé entre-temps est fusionné.

**`⚠ Incompatible deepika-sync daemon`.** Le binaire `deepika-sync` trouvé est plus ancien que
celui que le plugin exige : refaire l'[installation](install.md) des deux. Si c'est un
daemon de l'ancienne version resté en marche après une mise à jour, le plugin le remplace
de lui-même. Les notes ne sont pas touchées.

**`Cannot start daemon`.** Le fichier `deepika-sync` n'est pas dans
`.obsidian/plugins/dot-sync/`, ou le chemin de **Daemon binary** est faux ; le message
donne la raison (`ENOENT` : introuvable).

**« … was deleted by a collaborator ».** La note a été supprimée dans la session pendant
que vous l'aviez ouverte. Son texte reste dans l'éditeur, détaché : le copier dans une
nouvelle note pour le garder. La fermer sans rien faire accepte la suppression.

**« Could not align … with the session ».** Le texte de l'éditeur n'a pas pu être amené à
celui de la session ; la note est laissée non partagée plutôt que risquer un mélange.
Copier le texte visible hors du dossier partagé, fermer la note, la rouvrir. Si cela se
reproduit, joindre le journal du daemon à un rapport.

**L'aperçu affiche `inviter_unreachable`.** L'hôte a toujours le badge `shared` ?
**Relay** activé des deux côtés, et **avant** que l'hôte ait démarré ? Invitation collée
en entier ? Pas de VPN ? Une invitation créée avant d'activer le relais ne vaut rien à
distance : l'hôte fait **Leave session**, active le relais, **Start session**, et renvoie
la nouvelle.

**Un fichier `nom (conflit xxxxxxxx).md` est apparu.** En rejoignant, votre note et celle
de la session portaient le même nom avec des textes différents ; les deux sont gardées,
partout. Comparer, reporter dans `nom.md` ce qu'il faut garder, supprimer l'autre.

**Une modification faite hors d'Obsidian a disparu.** Tant qu'une note est ouverte dans
Obsidian, l'éditeur fait autorité et le daemon ignore les changements disque de ce
fichier. Fermer la note avant de la modifier avec un autre outil.

## Un essai à deux qui ne marche pas

Un problème se comprend en **recoupant les deux journaux**. Chacun note l'heure, ce qu'il
a fait et le texte exact de la notification ou de la barre d'état, puis produit son
rapport — le daemon écrit `Partage/.collab/daemon.log` même lancé par Obsidian :

```bash
VAULT=~/Documents/MonVault ; MON_NOM=Alice
DEEPIKA_SYNC="$VAULT/.obsidian/plugins/dot-sync/deepika-sync"
python3 /chemin/vers/deepika-sync/scripts/diagnose.py "$VAULT/Partage" --timeline --bundle ~/rapport-$MON_NOM.txt
"$DEEPIKA_SYNC" documents --root "$VAULT/Partage" >> ~/rapport-$MON_NOM.txt
```

`diagnose.py` vient du dépôt du daemon (un clone, ou son archive de release). Sans lui,
envoyer `daemon.log` après l'avoir relu : il contient les noms de vos fichiers, jamais
leur texte ni l'invitation.

Puis aligner les deux rapports sur l'heure notée :

- `peer_connected` **des deux côtés** : les daemons se parlent ; le problème est entre
  Obsidian et son daemon, voir ci-dessous.
- **D'un seul côté, ou d'aucun** : les daemons ne se joignent pas. À distance : relais
  activé d'un seul côté, invitation créée avant l'activation du relais, VPN ou pare-feu,
  hôte arrêté ou en veille. Tester l'accès au relais des deux côtés :
  `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 https://euc1-1.relay.n0.iroh.link/`
  — un code HTTP, quel qu'il soit, veut dire joignable ; un délai dépassé, que le réseau
  bloque.
- `peer_disconnected error=…` isolé après une coupure ou une veille : normal, un
  `peer_connected` doit suivre dans la minute.

**Entre Obsidian et son daemon.** Le plugin n'écrit aucun fichier ; ses erreurs sont dans
la console (`Ctrl+Maj+I`, `Cmd+Option+I` sur Mac), à filtrer sur `deepika-sync` ou
`WebSocket` ; clic droit → **Save as…** pour la joindre. Vérifier que le plugin voit le
daemon : `Partage/.collab/session.json` existe et son `pid` apparaît dans
`pgrep -fa 'deepika-sync (share|join)'`. Sans fichier, aucun daemon ne sert ce dossier :
refaire **Start session** ou **Join session**. **Ne pas partager `session.json`** : il
contient l'invitation.

**Reproduire avec des journaux détaillés.** Lancer le daemon soi-même, le plugin s'y
rattache tout seul. D'abord **Leave session**, puis, en gardant `--relay` si le réglage
l'était :

```bash
DEEPIKA_SYNC_LOG=deepika_sync=trace RUST_LOG=deepika_sync=debug "$DEEPIKA_SYNC" share "$VAULT/Partage" --ws-port 0 --relay
```

L'invité fait de même avec `join '<INVITATION>' --root … --ws-port 0 --relay`, qui affiche
le même aperçu que le plugin. `Ctrl+C` arrête le daemon.

## Repartir de zéro sur un poste

**Leave session**, puis, daemon arrêté, mettre de côté le dossier `.collab` du dossier
partagé (`mv Partage/.collab ~/collab-$(date +%H%M)`). Les notes ne sont pas touchées ; le
dossier oublie seulement la session. Rejoindre à nouveau avec l'invitation : l'aperçu dit
ce qui est identique, ce qui diffère et ce qui sera créé. Garder le dossier mis de côté
pour le diagnostic.
