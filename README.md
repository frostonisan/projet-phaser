# Projet Phaser — DarkPit

Depot independant pour rationaliser DarkPit puis integrer Phaser progressivement.

- Jeu : https://frostonisan.github.io/projet-phaser/
- Code : https://github.com/frostonisan/projet-phaser
- Branche de travail et de publication : `version-2`.
- Sources du jeu : `docs/` ; outils de verification : `scripts/`.

## Version affichée

Le jeu affiche **The Dark Pit v0.95.0-dev** en blanc, juste avant « ID de la partie »,
dans le même bloc de l’interface.
Les archives locales vont de `version - 1` (février 2024) à `version - 85`
(novembre 2026), avec des étapes intermédiaires. `0.86.0-dev` était le premier repère choisi
pour cette branche après ces archives, pas une mesure du pourcentage terminé.

La version `0.87.0-dev` crée et restaure les cases et leur occupation depuis les
données du combat, avec le même mécanisme pour le jeu et le simulateur.

La version `0.88.0-dev` range les styles par grands thèmes tout en conservant
les feuilles propres aux monstres et à leurs contours de sélection.

La version `0.89.0-dev` fait lire les positions, occupants, distances et cibles
des projectiles dans les données du plateau, communes au jeu et au simulateur.

La version est définie une seule fois dans `docs/js/ui/display.js` (`GAME_VERSION`).
`formatGameIdentity()` compose le même libellé lors de la création et de la mise
à jour de `#game-id-display`.
Incrémenter le dernier nombre pour une correction publiée (`0.90.1-dev`), et le
nombre central pour une nouvelle étape importante (`0.91.0-dev`). Le suffixe
`dev` indique que cette branche reste en développement.

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

Les règles de combat, leur exécution et leur rendu sont progressivement séparés.
Tous les projectiles utilisent Phaser depuis la version 0.91.0-dev.

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

Les barres de PV/armure sont dans `rendering/vitalFeedback.js`. Pour les déplacements,
les formules sont dans `combat/statistics.js`, l'application des charges dans
`board/deployment.js` et leur affichage dans `rendering/hud.js`.

Les priorités de ciblage restent dans `combat/roles.js`. Les badges et listes de cibles
sont regroupés dans `rendering/hud.js`, et les rôles visuels des cases dans
`rendering/boardElements.js`.

La montée de niveau suit la même organisation : les calculs et la confirmation
restent dans `entities/progression.js`, les formulaires dans `ui/codex/stats.js`,
la projection des statistiques dans `ui/statistics/components.js` et les animations
d'éveil dans `rendering/animations.js`. Ces fichiers existaient déjà.


## Styles par grands thèmes

Les feuilles du jeu se trouvent dans `docs/css/` et se chargent dans cet ordre :

| Fichier | Contenu |
| --- | --- |
| `base.css` | Police, page, dimensions globales et utilitaires communs |
| `interface.css` | Menus, carte, dialogues, Codex, inventaire, boutique et administration |
| `stats.css` | Couleurs, pictogrammes, barres, compteurs, attributs, Umbras et aides de statistiques |
| `combat.css` | Plateau, décors, affichage du combat, messages et placement des effets |
| `animation.css` | Keyframes et animations partagées ; les transitions locales restent avec leur composant |
| `monstre.css` | Réglages propres aux monstres, conservés dans leur fichier |
| `monstre-hitbox.css` | Contours de sélection des monstres, conservés dans leur fichier |

`vfx-calibrator.css` reste réservé à l'outil de réglage des effets. Il y a donc
sept feuilles pour le jeu et une pour cet outil. L'ordre de chargement fait partie
du rendu ; ne pas le remplacer par un tri alphabétique. Pour ajouter une règle,
utiliser le thème existant plutôt qu'un nouveau fichier de correctifs.

Les positions de combat sont indexées dans `board/model.js`, y compris celles des
corps qui ne réservent plus de cases. `board/targets.js` fournit la lecture commune
au ciblage. Les destinations des mouvements aléatoires et des attractions sont
calculées dans `board/placementRules.js` ; `board/controller.js` applique ensuite
le placement et actualise les vues. Le rendu d’un projectile retrouve sa case
par identifiant, sans choisir lui-même son occupant.

## Projectiles Phaser — v0.91.0-dev

Tous les tirs à distance partagent un canvas Phaser transparent : physiques,
magiques, hybrides, triples, soins, résurrection, poison, brûlure, Jarret,
Profanation et Dead-shot. Leurs médias existants et les images des GIF sont réutilisés.

`rendering/attackTransport.js` relie le combat à l’affichage ; la scène et les
animations sont regroupées dans `rendering/animations.js`. `data/loaderList.js`
précharge les médias et prépare leurs textures partagées. Aucun nouveau module de jeu.
Les anciens styles propres aux projectiles HTML ont été retirés de `css/combat.css`.

Le combat conserve les dégâts, le guidage logique, les cases visées et l’échéance
d’impact. Phaser dessine le trajet, la dispersion magique, les restes physiques
et les effets à l’arrivée. Un chargement lent du rendu ne retarde pas les dégâts.
La pause, F5 et le redimensionnement reprennent les données visuelles sauvegardées.

Le simulateur utilise les mêmes règles sans charger Phaser. La dépendance locale
reste Phaser 3.90.0 avec sa licence MIT dans `docs/vendor/`, sans CDN à l’exécution.
Cette étape n’introduit pas de collisions physiques ni de changement des formules
et ne revendique pas de gain de FPS.

## Première mêlée Phaser — v0.92.0-dev

L’attaque physique **Tir cp** (`shot-p-c`), utilisée par **TEST Porc physic cac**
(serial 7), affiche sa charge et son impact dans la même scène que les projectiles.
Le sprite existant est réutilisé ; le retour de l’original conserve le fondu actuel.
Les autres mêlées et le second coup d’ambidextrie gardent leur animation existante.

Les dégâts, les délais, la cible et l’occupation du plateau restent décidés par
le combat. Pause et F5 conservent le trajet, l’impact et le retour du sprite.
Les fichiers de transport, d’animations et de tests existants sont réutilisés,
sans nouveau module, média, dépendance ou moteur de collisions.

## Toutes les mêlées Phaser — v0.93.0-dev

Les attaques de corps à corps physiques, magiques, hybrides et perforantes,
les seconds coups d’ambidextrie et les animations de mêlée des événements
utilisent maintenant la même scène Phaser que les projectiles. Les sprites
et le GIF de sang existants sont réutilisés ; les coups secondaires gardent
leur aura jaune. Les attaques dirigées vers une case utilisent sa vue actuelle.

Les calculs, cibles, délais, dégâts et effets de combat restent dans leur moteur
actuel. Les événements conservent leurs dégâts programmés ; une confirmation
d’impact anticipée attend l’arrivée visuelle, et une confirmation tardive ne
rejoue pas une animation expirée. Pause/F5 conserve les deux coups, la charge,
l’impact, le retour de l’original et la disparition de la copie à la mort.

L’ancienne animation de mêlée HTML et ses helpers privés ont été retirés.
Aucun nouveau fichier de jeu, média ou dépendance.


## Glisser-déposer Phaser — v0.94.0-dev

Les monstres du plateau se déplacent à la souris ou au doigt avec un aperçu
Phaser. Le glissement commence après 8 pixels ; un simple clic conserve
l’inspection. La case et les charges ne changent qu’au dépôt accepté.
Les coûts, immobilisations, échanges, camps et empreintes utilisent les règles
existantes. Le glissement fonctionne pendant la pause tactique, sans faire
avancer le combat ; la pause absolue bloque les déplacements.

Échap, une interruption tactile, un second doigt, la sortie de fenêtre, le
redimensionnement ou la disparition du monstre annulent l’aperçu sans coût.
F5 conserve les placements validés. Les hitboxes HTML, menus et dépôts depuis
l’inventaire/admin restent utilisables. Les fichiers existants sont réutilisés,
sans nouvelle dépendance ni nouveau fichier de jeu. Le gain de FPS n’est pas mesuré.

## Gros combats — v0.94.1-dev

Les copies de mêlée gardent leurs pixels en mémoire et ne les encodent en PNG
qu'au moment de capturer la sauvegarde. Les textures statiques de mêlée, de
projectile et de glisser-déposer évitent la copie CPU de tous les pixels effectuée
par `CanvasTexture`. La définition des images, les couleurs et les effets restent
identiques. Les lectures de géométrie partagent un cache limité à une seule mise
à jour Phaser, pour conserver le suivi des cibles mobiles et du redimensionnement.
Les compteurs de déplacement conservent leurs éléments et ne réécrivent plus les
valeurs inchangées. Les règles de combat et le format des sauvegardes restent les mêmes.

Le banc existant `scripts/verify-combat-load-browser.mjs` utilise les chemins
actuels et mesure par défaut 20, 40 et 80 monstres. Les comparaisons utilisent
les mêmes configurations et graines, dans un seul navigateur à la fois, en
alternant les versions avant/après. Les traces CPU sont séparées des mesures
de fluidité ; `LOAD_PROFILE=1` active le profilage et `LOAD_TRACE=1` ajoute la
trace détaillée. `LOAD_ARCHIVE_SOURCES=1` conserve les sources mesurées ;
`LOAD_BASELINE` désigne leur dossier pour une comparaison ultérieure.
Les résultats et captures de cette correction sont dans `outputs/combat-performance/`.

Mesure de cette correction : Chrome sans interface, viewport 1920 × 1080,
combats synthétiques rapides avec mêlée, projectiles et contrôles, deux passages
de 12 secondes par taille et par version, ordre alterné. Moyennes des deux passages :

| Monstres au total | Image moyenne avant (ms) | Après (ms) | P95 avant (ms) | Après (ms) |
| --- | --- | --- | --- | --- |
| 20 | 125 | 103 | 483 | 225 |
| 40 | 237 | 207 | 1158 | 508 |
| 80 | 487 | 372 | 2582 | 983 |

Le P95 est le délai sous lequel se trouvent 95 % des images. Il baisse de 53 à
62 %, et le délai moyen par image de 13 à 24 %. Le cas à 80 reste très chargé :
ces chiffres ne constituent pas une promesse de 60 FPS ni une mesure sur téléphone.
Le nombre d'impacts effectivement traités est également conservé dans le rapport ;
la version optimisée en traite davantage pendant les 12 secondes. Les résultats
logiques sont comparés séparément à temps simulé identique.

Validation : 57 tests Node, huit suites navigateur (attaques, pause/F5, souris et
tactile, déplacements, ressources, compteurs et nettoyage), six comparaisons
logiques identiques avant/après, et captures figées de mêlée identiques pixel à
pixel en trajet, à l'impact et après annulation. Le profil après correction ne
contient plus d'encodage PNG ni de lecture CPU des pixels pendant les attaques.


## Grabs et déplacements forcés — v0.95.0-dev

La scène Phaser commune pilote maintenant les trajets des grabs, de la confusion,
des échanges et des poussées dues à l’agrandissement. Le monstre HTML, ses barres
et sa hitbox se déplacent ensemble ; leur rendu reste celui du jeu actuel.
La destination, les résistances et les charges restent décidées par le combat.

Les trajets suivent l’horloge du combat : pause, F5 et reprise conservent leur
avancement. Leur nettoyage ne se déclenche plus pendant la pause. Un nouveau
grab reprend au point visible ; un déplacement forcé annule un drag en cours
sans facturer le geste. La souris, le tactile et les dépôts externes conservent
la même commande de placement. Aucun fichier de jeu ni dépendance ajouté.

Les vérifications sont regroupées dans les suites existantes de pause tactique,
de placement, d’attaques et de simulation. Les captures sont dans
`outputs/tactical-pause/` et les journaux dans `outputs/phaser-movement/`.

Validation : 57 tests Node et sept suites navigateur réussis, dont les gestes
souris/tactile, les tailles, la pause/F5, les attaques et le simulateur.
