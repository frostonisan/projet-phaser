# Projet Phaser

Ce dossier est le depot independant `frostonisan/projet-phaser`.
Le travail demande dans ce chat se poursuit ici.

- Travailler sur `version-2` et publier uniquement vers `origin/version-2` de ce depot.
- Le dossier `codex-2-v2` et le depot `frostonisan/DarkPit` restent la reference d'origine.
- Le jeu publie est le contenu de `docs/` ; `.github/workflows/pages.yml` gere GitHub Pages.
- Respecter les regles de `docs/AGENTS.md` pour le code du jeu.
- Avant un commit, verifier les fichiers concernes, le diff et les controles pertinents.
- Garder les sorties de tests et diagnostics dans `outputs/`, qui est ignore par Git.

## Priorité absolue : intégrité du roguelike

Exigence explicite du joueur, prioritaire sur les gains de fluidité :

- Conserver les règles et résultats de dégâts, caractéristiques, ciblage,
  progression et montée de niveau. Les statistiques restent dynamiques et les
  changements liés aux événements prennent effet aux mêmes échéances.
- Chaque action validée est définitive : PV et armure perdus, ressources dépensées,
  objets consommés, morts, gains, expérience et tirages déjà résolus doivent être
  conservés après rechargement, sans annulation, duplication ni nouveau tirage.
- Restaurer aussi les actions en cours, effets, délais et états nécessaires : un
  impact déjà appliqué ne doit jamais être appliqué une seconde fois.
- Toute optimisation doit être contrôlée par comparaison déterministe avec la
  référence, et par des rechargements pendant les transitions critiques.
- Vérifier tous les chemins de rechargement pertinents. Le F5 clavier est déjà
  intercepté par une pause/sauvegarde ; cela ne démontre pas à lui seul la sûreté
  du bouton navigateur, des autres raccourcis ou d'une interruption brutale.
  Ne pas annoncer une protection complète tant que ces cas ne sont pas validés.
- Le point de retour Git concerne les versions du projet pour le développement ;
  il n'autorise aucun retour en arrière de la partie du joueur.
