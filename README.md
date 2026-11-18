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


Le démarrage se trouve dans [app/startup.js](docs/js/app/startup.js).
Les 52 fichiers auparavant isolés à la racine de `docs/js/` sont maintenant classés.
Le projet compte 117 modules au lieu de 120.

| Dossier | Ce qu'on y trouve |
| --- | --- |
| [app](docs/js/app/) | Démarrage, niveaux, carte du monde et état du jeu |
| [entities](docs/js/entities/) | Personnages, armées, progression et règles de statistiques |
| [combat](docs/js/combat/) | Attaques, dégâts, effets, tours, horloge et pause |
| [board](docs/js/board/) | Plateau, occupation des cases, placement et déploiement |
| [rendering](docs/js/rendering/) | Éléments visibles, animations, compteurs et sons |
| [ui](docs/js/ui/) | Menus, inventaire, Codex, dialogues et infobulles |
| [storage](docs/js/storage/) | Sauvegardes et stockage du simulateur |
| [events](docs/js/events/) | Événements scénarisés et leur déroulement |
| [items](docs/js/items/) | Objets, équipements, butin et essences |
| [data](docs/js/data/) | Définitions, catalogues, textes et réglages |
| [biome](docs/js/biome/) | Terrains et météo |
| [procedural](docs/js/procedural/) | Barèmes de puissance et génération |
| [debug](docs/js/debug/) | Administration, simulation et réglage des effets |

Un module doit être importé depuis son dossier propriétaire. Les anciens chemins ne
contiennent pas de fichiers relais. Les gros modules encore à séparer sont recensés
dans [ARCHITECTURE.md](ARCHITECTURE.md).
