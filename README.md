# Projet Phaser — DarkPit

Depot independant pour rationaliser DarkPit puis integrer Phaser progressivement.

- Jeu : https://frostonisan.github.io/projet-phaser/
- Code : https://github.com/frostonisan/projet-phaser
- Branche de travail et de publication : `version-2`.
- Sources du jeu : `docs/` ; outils de verification : `scripts/`.

## Publication

Chaque push sur `origin/version-2` publie automatiquement `docs/` via GitHub Actions.
Attendre que le workflow Pages reussisse, puis actualiser l'URL du jeu.

## Verification locale

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
node scripts/serve-docs.mjs
```

## Point de depart

Copie de l'etat de travail de `codex-2-v2` au 18 novembre 2026, incluant les
modifications locales et les nouveaux fichiers de `docs/` et `scripts/`.
Le commit de base du depot d'origine etait `5e3dab5` ; cette copie inclut aussi
les modifications non commitees qui lui succedent.
Les anciens historiques restent dans `frostonisan/DarkPit` et dans le dossier
local d'origine. Ce nouveau depot commence par un instantane independant.

Le premier chantier est la separation des regles de combat, de leur execution
et du rendu. Phaser sera integre apres validation de ces frontieres.

## Architecture

Le decoupage en cours, les responsabilites et les prochains lots sont decrits dans [ARCHITECTURE.md](ARCHITECTURE.md).


Le démarrage se trouve dans `docs/js/app/startup.js` (ancien `GameInit.js`).
Les écrans sont regroupés dans `docs/js/ui/`, avec deux sous-dossiers :
`codex/` pour les fiches d'entités et `statistics/` pour leur présentation.
Ce périmètre comporte 14 fichiers, contre 17 auparavant ; le plan détaillé figure
ci-dessus dans ARCHITECTURE.md.
