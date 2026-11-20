# Projet Phaser — DarkPit

Depot independant pour rationaliser DarkPit puis integrer Phaser progressivement.

- Jeu : https://frostonisan.github.io/projet-phaser/
- Code : https://github.com/frostonisan/projet-phaser
- Branche de travail et de publication : `version-2`.
- Sources du jeu : `docs/` ; outils de verification : `scripts/`.

## Point de retour — avant optimisation des calculs

Repère demandé par le joueur : **The Dark Pit v0.98.0-dev**, avant le lot
« caractéristiques, attaques et ciblage ». Le code de référence est le commit
[`c685f9f8ef5fd4547b217098c9928286ef9d0736`](https://github.com/frostonisan/projet-phaser/tree/c685f9f8ef5fd4547b217098c9928286ef9d0736),
publié sur `origin/version-2`. L'arbre de travail était propre à sa capture.
Le tag local annoté `checkpoint-0.98.0-avant-optimisation-calculs` pointe sur ce
commit. Ce SHA, conservé dans le dépôt distant, est la référence durable.

- Plateau visible dans le canvas Phaser/WebGL avec `?monsters=webgl` ; menus
  et adaptateurs invisibles d'interaction en HTML. Règles de combat conservées.
- À 40 monstres : 26,59 ms/image en moyenne, P95 74,95 ms ; à 80 : 41,50 ms,
  P95 141,65 ms. Les saccades persistent. Conditions détaillées plus bas.
- Contrôles validés : règles/imports/assets, quatre biomes, panneaux PV/armure,
  souris/tactile, échanges de places, grab, attaques, pause/F5 et mobile.
  Quatre comparaisons déterministes 40/80 conservent résultats et journaux.
- Les nouvelles optimisations de caractéristiques, attaques et ciblage discutées
  après cette version n'ont pas été appliquées à ce point de retour.

Sur demande « Reviens à l'état avant l'optimisation des calculs », rétablir le
contenu du projet à partir de ce commit, vérifier puis republier via un nouveau
commit sur `version-2`, en conservant l'historique. Préserver préalablement les
éventuelles modifications locales non enregistrées. Aucun retour automatique.
Ce repère couvre les fichiers suivis par Git ; les sauvegardes du navigateur et
les diagnostics locaux ignorés dans `outputs/` ne font pas partie du snapshot Git.

## Version affichée

Le jeu affiche **The Dark Pit v0.98.0-dev** en blanc, juste avant « ID de la partie »,
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


## Mesures après les déplacements Phaser — v0.95.1-dev

Les compteurs de mouvement et les pulsations ATB ne forcent plus une mise en page
pour démarrer une nouvelle animation. Un redémarrage encore actif garde une seule
lecture commune aux vues du monstre. Les couleurs, durées et animations CSS restent
identiques ; les lectures associées à deux classes sans animation CSS sont retirées.

Le module existant `debug/logger.js` est de nouveau chargé au démarrage. Les logs,
groupes et tableaux de diagnostic sont désactivés par défaut ; avertissements,
erreurs et journal du combat restent disponibles. `?debugLogs=1` ou
`DarkPitLogs.enable()` réactivent le diagnostic, `DarkPitLogs.disable()` le coupe.

Comparaison avec 0.95.0-dev : Chrome sans interface, 1920 × 1080, mêmes combats
synthétiques rapides, deux passages de 12 secondes par taille et version, ordre
avant/après alterné. Aucun profilage ni autre navigateur de test pendant les mesures.

| Monstres au total | Image moyenne avant / après (ms) | P95 avant / après (ms) | Impacts traités avant / après |
| --- | --- | --- | --- |
| 20 | 94 / 86 | 183 / 183 | 203.0 / 210.0 |
| 40 | 168 / 173 | 391 / 350 | 196.5 / 223.0 |
| 80 | 332 / 320 | 775 / 800 | 167.0 / 227.5 |

Le P95 est le délai sous lequel se trouvent 95 % des images. Le résultat est
modeste : moyenne améliorée à 20 monstres, pics réduits à 40, mais pas de réduction
nette des pics à 80. À 40, le délai moyen augmente légèrement. Davantage d'impacts
sont traités, surtout à 80 ; cela ne prouve pas une amélioration générale des FPS.
Le rendu des grands combats reste le chantier principal, sans promesse de 60 FPS.

Six comparaisons du simulateur, avec deux graines par taille et 5 secondes de temps
simulé, conservent exactement les résultats, phases et journaux complets, y compris
les valeurs intermédiaires des ressources. Les sources figées, profils, mesures et
captures sont conservés dans `outputs/combat-performance-095/`. Aucun fichier de
jeu, média ou dépendance ajouté.

Validation : 57 tests Node et sept suites navigateur réussis. Le scénario de
pause a été relancé après une attente intermittente ; ses attentes sont désormais
bornées. Les tests vérifient aussi les vraies animations CSS, le redémarrage des
compteurs, le contrôle des logs, les ressources, le drag souris/tactile et F5.


## Textures des monstres et effets récurrents — v0.95.2-dev

Les copies de corps à corps d'un même monstre partagent les pixels neutres et leur
texture Phaser pendant leur chevauchement. La dernière copie libère la texture.
Le monstre touché conserve ses teintes ; les copies gardent leur image neutre,
leurs trajectoires et leurs durées. Les instantanés PNG restent réservés à la sauvegarde.

Les petits GIF utilisés par `rendering/animations.js` (impacts, récupération, fumée
et mysticisme) réutilisent des images PNG sans perte, décodées une fois par ressource.
Ces images sont préparées pendant le chargement du niveau, avant le combat.
Chaque effet conserve son propre début et peut redémarrer indépendamment. Les
éléments HTML, tailles, filtres, couches et couleurs CSS restent les mêmes. Les
images continuent à boucler pendant la pause, comme les GIF natifs précédents ;
leur durée de présence reste gérée par l'horloge du combat. Les effets HTML ne
sont donc pas encore tous des sprites Phaser.

Le cache est borné par effet (dimensions maximales 512 × 512, un million de
pixels cumulés). Les ressources trop grandes ou indisponibles gardent leur
affichage natif. Le suivi s'arrête au retrait des éléments ; les images partagées
sont libérées par l'éviction des ressources existante. Le format de sauvegarde
reste inchangé : les URL temporaires sont remplacées par les chemins des GIF.

Validation : 110 images provenant de dix GIF comparées pixel par pixel au décodeur
GIF indépendant de Chromium, quatre salves de 100 copies simultanées avec une
seule texture par salve, 80 effets à démarrages indépendants, redémarrage,
remplacement pendant le décodage, retrait à froid, éviction et protection du cache
actif. Aucun fichier de jeu, média ni dépendance ajouté.

Les contrôles statiques et les 57 tests Node passent. Les suites navigateur couvrent
projectiles, tailles, drag souris/tactile, pause tactique, HUD et ressources.
La série de pause complète a atteint son délai maximal sur le scénario de double
attaque ; ce scénario et tous les contrôles supplémentaires de restauration ont
ensuite passé lors d'une exécution isolée, sans modification des règles du jeu.
Les diagnostics et journaux sont conservés dans `outputs/monster-rendering/`.

Comparaison avec 0.95.1-dev : Chrome sans interface, 1920 × 1080, deux passages de
12 secondes par taille et version, ordre avant/après alterné, sans profilage ni
autre navigateur de test concurrent. Les deux côtés passent par le chargeur de niveau existant
pour les dix effets mesurés ; la nouvelle version y prépare aussi les images
partagées. Ce préchargement ajoute environ 9 Mio de pixels décodés partagés.

| Monstres au total | Image moyenne avant / après (ms) | P95 avant / après (ms) | Impacts traités avant / après |
| --- | --- | --- | --- |
| 40 | 227 / 209 | 508 / 450 | 187.0 / 205.5 |
| 80 | 343 / 322 | 974 / 783 | 192.0 / 224.5 |

La moyenne diminue d'environ 8 % à 40 monstres et 6 % à 80 ; le P95 diminue
respectivement de 11 % et 20 %. Le P95 est le délai sous lequel se trouvent 95 %
des images, pas le pire délai absolu. Les deux répétitions restent un échantillon
limité. À 80 monstres, le combat reste fortement saccadé : cette optimisation
ne suffit pas encore à atteindre l'objectif de fluidité des grands combats.

Les premières mesures à froid montraient moins d'impacts traités, ce qui a motivé
la préparation des images au chargement. Les chiffres ci-dessus sont ceux du
parcours avec chargement, conservés dans `outputs/monster-rendering/prepared-final/`.
Les mesures à froid et quatre comparaisons déterministes (40/80 monstres, graines
1701/1702, cinq secondes simulées) figurent dans `outputs/monster-rendering/final/` :
résultats, phases et journaux complets y sont identiques. Les ajustements suivants
concernent le préchargement du cache et son activation pour la fumée et le
mysticisme : leur rendu et leur nettoyage sont couverts par les tests de pixels,
de ressources et de drag/pause/F5 relancés sur la version finale. Les règles
de combat n'ont pas été modifiées.


## Prototype de monstre WebGL — v0.96.0-dev

Activer avec [le lien expérimental](https://frostonisan.github.io/projet-phaser/?monsters=webgl).
Seul le **Grouille-doigt** utilise cette voie sur le plateau. Sans ce paramètre,
le rendu existant reste actif. Les corps, jauges, textes, icônes et effets de cette
espèce sont peints dans la scène Phaser/WebGL déjà utilisée pour les attaques.
Aucun fichier de jeu, média ni dépendance ajouté ; les changements restent dans
`rendering/entities.js`, `rendering/animations.js` et le chargeur existant.

Ce prototype conserve encore le HTML comme adaptateur de disposition, de poses
CSS et de hitboxes. Les pixels sont masqués une fois les textures prêtes. Les
menus retrouvent temporairement l'affichage HTML afin de conserver leurs couches.
Un échec de chargement restaure aussi cet affichage. Les textures partagées sont
libérées lorsque le dernier acteur WebGL quitte le plateau. Les règles, le
simulateur et le format des sauvegardes restent inchangés.

Les graphismes existants servent de sources aux textures. La reproduction n'est
pas encore parfaite : les rotations sont projetées depuis les rectangles HTML
et certains filtres/pulsations sont échantillonnés lors de la création de la texture.
Le corps est préparé au plus à 256 pixels de large, les effets à 512. Les filtres
s'appliquent à une image extraite avant assemblage de l'atlas : filtrer l'atlas
entier par image provoquait un blocage de plusieurs secondes après F5.

Comparaison avec 0.95.2-dev sur Chrome, WebGL matériel AMD Radeon, 1920 × 1080 :
deux combats de 12 secondes par taille et version, ordre alterné, sources figées,
chargeur de ressources exécuté des deux côtés et aucun autre navigateur de test
concurrent. Le temps d'initialisation précède la mesure ; les premières créations
de textures d'effets pendant le combat en font partie.

| Monstres au total | Image moyenne HTML / prototype (ms) | P95 HTML / prototype (ms) | Impacts HTML / prototype |
| --- | --- | --- | --- |
| 40 | 149 / 78 | 275 / 258 | 274.0 / 64.0 |
| 80 | 283 / 117 | 575 / 316 | 252.5 / 64.5 |

**Cette version ne valide pas un gain de fluidité du combat.** Certaines images
arrivent plus régulièrement, mais environ quatre fois moins d'impacts sont traités
pendant la même durée. Une animation plus fréquente accompagnée d'un combat qui
avance moins vite n'est pas un succès. Le prototype reste donc désactivé par défaut.
La prochaine étape technique consiste à piloter les sprites et jauges directement
avec l'état du combat, en supprimant les lectures HTML par image et les conversions
de panneaux pendant les échanges. Il ne faut pas généraliser cet adaptateur aux
autres espèces.

Mesures, sources figées, captures et journaux : `outputs/webgl-monster/final/`.
Les contrôles du prototype couvrent la souris, le tactile, les swaps, grabs,
déplacements forcés, la pause, F5, les morts et le rendu indisponible. La création
des textes ne consomme aucun tirage du hasard des combats.

Validation complémentaire : quatre comparaisons déterministes à 40/80 monstres,
graines 1701/1702, cinq secondes simulées ; résultats et journaux complets identiques
avant/après, y compris les valeurs intermédiaires. Le premier calcul à 80 a dépassé
120 secondes avec l'aperçu animé encore actif. Le harnais retire désormais cet
aperçu avant le calcul isolé ; les comparaisons à 80 ont été reprises avec les mêmes
sources et les huit mesures de combats visibles conservées. Contrôles statiques,
imports, ressources et tests Node réussis.


## Grouille-doigt piloté par le combat — v0.96.1-dev

Le [mode expérimental](https://frostonisan.github.io/projet-phaser/?monsters=webgl)
reste réservé au Grouille-doigt. Sa boucle Phaser lit maintenant la position,
les PV, l’armure, les déplacements et les temps d’attaque dans les données du
combat. Les commandes d’animation et de jauge existantes transmettent aussi
leurs valeurs au rendu, avec l’horloge de combat qui gère la pause.

Les dimensions et les styles sont compilés à la création, lors des changements
de structure ou de visibilité, et au redimensionnement. La boucle d’image ne
consulte plus les rectangles, les styles calculés ni les textes HTML. Les
créations de textures demandées pendant un même intervalle sont regroupées.
Les sprites, icônes et styles existants restent les sources graphiques ; aucun
fichier de jeu, média ou dépendance supplémentaire n’est ajouté.

Le HTML reste utilisé pour les hitboxes et pour préparer certains panneaux et
effets. Les menus et les transitions de perspective du plateau retrouvent le
rendu HTML pendant leur animation, puis Phaser reprend avec la géométrie mise
à jour. Cette étape conserve les limites visuelles du prototype, notamment la
projection des transformations 3D et certains halos capturés dans les textures.
Elle ne supprime pas encore les conversions de panneaux pendant les combats.

Les tests existants vérifient désormais que modifier les PV, l’armure et la
position dans les données change le rendu sans modifier le HTML ; ils comptent
aussi les lectures HTML dans la boucle Phaser et vérifient le gel des corps,
jauges et textes pendant la pause. Souris, tactile, swaps, grabs, déplacements
forcés, redimensionnement, F5 et nettoyage des textures passent leurs contrôles.
Le rendu habituel passe également les tests de projectiles et de ressources FX.

Quatre comparaisons déterministes (40/80 monstres, graines 1701/1702, cinq secondes
simulées) conservent les résultats, les phases et les journaux complets. Les
retouches finales de préparation des textures et de perspective concernent
uniquement le rendu WebGL, désactivé dans le simulateur. Le format des sauvegardes
et les règles de combat restent inchangés.

Comparaison finale avec le prototype 0.96.0-dev : Chrome, WebGL matériel AMD,
1920 × 1080, ressources préparées, deux combats de 12 secondes par taille et
version, ordre alterné, aucun autre navigateur de test concurrent. Les sources
sont figées pendant les mesures et correspondent aux fichiers livrés.

| Monstres | Image moyenne avant / après (ms) | P95 avant / après (ms) | Impacts avant / après | Lectures HTML dans les images avant / après |
| --- | --- | --- | --- | --- |
| 40 | 89 / 84 | 300 / 292 | 42.0 / 42.5 | 156249 / 0 |
| 80 | 157 / 186 | 508 / 858 | 60.0 / 59.5 | 183264 / 0 |

Les lectures comptées sont celles de la boucle des monstres pendant les douze
secondes mesurées : rectangles, dimensions, styles, recherches de nœuds et textes.
Zéro lecture dans cette boucle ne signifie pas que tout le jeu est indépendant
du HTML : les autres interfaces et la préparation des éléments en utilisent encore.

**Le gain global de fluidité n’est pas validé.** À 80 monstres, le P95 régresse
nettement malgré un nombre d’impacts comparable. Deux répétitions ne suffisent
pas à estimer une tendance fine, mais elles montrent que cette séparation ne
résout pas les gros à-coups. Le prototype reste désactivé par défaut. Il faut
encore réduire la préparation des panneaux/effets et le travail HTML conservé
avant de généraliser le rendu WebGL aux autres espèces.

Traces : `outputs/webgl-state/paired-final-v2/` pour les huit mesures finales et
leurs sources ; `outputs/webgl-state/final/` pour les quatre comparaisons de
simulation. Contrôles d’interaction et de pause : `functional-final/` ; contrôles
du rendu habituel : `native-final/`, dans le même répertoire de sorties.

## Panneaux Phaser et essai d’atlas — v0.96.2-dev

Le mode `?monsters=webgl` reste réservé au Grouille-doigt et désactivé par défaut.
Les panneaux du monstre (HUD, jauges, compteurs, messages et indicateurs) sont
maintenant assemblés en conteneurs, images et textes Phaser. Les fonds, icônes,
ombres et dégradés sont des textures élémentaires partagées : il n’y a plus de
copie de sous-arbre HTML, de sérialisation SVG `foreignObject`, ni de capture
complète de panneau à chaque nouveau message. Les contours et ombres multiples
des chiffres sont repris, ainsi que l’apparition des icônes de rôle.

Cette étape réutilise `rendering/entities.js` et `data/loaderList.js`. Les styles
et les dimensions sont encore lus à la création ou au changement d’un composant,
et le HTML conserve les interactions et la restauration. La boucle d’image reste
pilotée par l’état et les commandes du combat. Les menus conservent le repli
HTML du prototype. Il reste donc du travail HTML et des limites de projection
3D ; ce n’est pas encore une interface entièrement indépendante du DOM.

L’essai de spritesheet concerne uniquement l’ambidextrie. Phaser charge le PNG
1024 × 512 et son JSON fournis dans `media/assets/spritesheets/png/` et `json/`,
avec 33 découpes, leurs décalages de recadrage et une texture commune. Le JSON
ne contient pas les durées : elles sont lues dans les métadonnées du GIF existant
(33 × 30 ms, boucle de 990 ms). Les autres effets gardent leurs médias actuels.
Le paramètre `&ambidextry=gif` permet de comparer avec la source GIF précédente.

Les 33 silhouettes et transparences de l’atlas sont identiques au GIF, et les
cadences sont vérifiées image par image. La palette du PNG fourni diffère du GIF
(écart maximal observé : 48 sur un canal RGB de 0 à 255) ; le fichier fourni reste
intact. Le halo est composé par Phaser. Cet essai ne prétend donc pas reproduire
chaque pixel du filtre CSS. Les tests vérifient le partage entre 80 demandes,
les départs indépendants, la pause de la durée de vie et le nettoyage des objets.

Les contrôles de souris/tactile, grabs, déplacements forcés, pause, F5, projectiles,
ressources et imports passent. Les mesures avant/après et leurs sources figées
sont conservées dans `outputs/phaser-panels/final/` ; les contrôles fonctionnels
et captures dans `outputs/phaser-panels/`.

Comparaison avec 0.96.1-dev : Chrome, WebGL matériel AMD, 1920 × 1080,
ressources préparées, deux combats de 12 secondes par taille et par version,
ordre alterné, sans autre navigateur de test concurrent. Moyennes des passages :

| Monstres | Image moyenne avant / après (ms) | P95 avant / après (ms) | Impacts avant / après |
| --- | --- | --- | --- |
| 40 | 86 / 54 | 317 / 192 | 47 / 86 |
| 80 | 190 / 116 | 750 / 408 | 59,5 / 64,5 |

Les délais d’image baissent d’environ 38 % en moyenne. Le P95 baisse d’environ
39 % à 40 monstres et 46 % à 80. Le combat exécute davantage d’impacts dans la
même fenêtre : le gain ne vient pas d’une réduction de l’activité mesurée.
Ces deux passages par configuration indiquent une amélioration, sans établir
une garantie pour tous les combats. À 80 monstres, 116 ms par image en moyenne
et un P95 de 408 ms restent saccadés : l’objectif de fluidité n’est pas atteint,
et le mode expérimental n’est pas généralisé aux autres monstres.

Quatre comparaisons déterministes (40 et 80 monstres, graines 1701 et 1702,
cinq secondes simulées) conservent exactement les journaux, les phases et les
résultats. Aucun code de règle, de placement ou de sauvegarde n’est modifié.
Le compteur des conversions HTML est vérifié séparément contre l’ancien chemin
de sérialisation dans `outputs/phaser-panels/conversion-check/` ; les huit
mesures de performance ci-dessus restent celles de `final/`.
Sur ce contrôle dédié à 40 monstres : 82 sérialisations de panneaux HTML avant,
zéro après, avec une activité de combat effective des deux côtés.


## Acteurs et effets sur le canvas commun - v0.97.0-dev

Le mode `?monsters=webgl` utilise maintenant le même rendu pour toutes les
espèces, au lieu de limiter le prototype au Grouille-doigt. Huit autres espèces
sont couvertes par le test navigateur. Il reste expérimental et s'active avec
[l'URL de test](https://frostonisan.github.io/projet-phaser/?monsters=webgl&v=0.97.0).
Les menus, le Codex et l'inventaire restent en HTML au-dessus du canvas.

Les impacts, soins, messages, altérations, préparations et récupérations
transmettent des données au rendu Phaser. Ils ne construisent plus un panneau
HTML par occurrence. Les objets visuels et les textures de texte sont réutilisés,
avec des limites pour les messages et les objets inutilisés. L'ambidextrie continue
d'utiliser le PNG/JSON fourni ; les autres médias existants restent disponibles.

Les oscillations de préparation/récupération et le halo d'armure sont pilotés
par la boucle commune. Les autres callbacks d'animation partagent une seule
requête d'image navigateur, avec annulation, ordre et pause conservés. Les
délais des attaques, les calculs de dégâts, le ciblage et les coûts ne changent
pas. La géométrie du plateau est partagée entre acteurs ; les transformations
des parents sont calculées une seule fois par image. Les changements de style
et de structure sont regroupés, et les animations CSS cachées sont suspendues.

La sauvegarde inclut les commandes, poses et effets natifs dans la section
`phaserPresentation`, puis les recrée après F5. Le canvas WebGL lui-même n'est
ni copié en PNG ni dupliqué dans le HTML sauvegardé. La rotation d'écran en
pause conserve les poses natives. Le canvas reste sous les menus et l'interface
de pause. Aucun fichier de jeu, média ou dépendance supplémentaire n'est ajouté.

**Ce n'est pas encore un plateau entièrement sans HTML.** Les cases, décors,
météo, hitboxes et une partie de l'initialisation/restauration en dépendent.
Certains effets secondaires utilisent encore l'adaptateur des composants HTML.
Les styles sont lus aux changements de présentation, pas dans la boucle d'image
des monstres. Les limites du prototype concernant la perspective 3D et certains
halos restent applicables : aucune identité pixel par pixel n'est annoncée.

La cible reste un plateau Phaser autonome, alimenté par les données du combat,
avec le HTML réservé aux interfaces. Les prochains postes à supprimer sont les
reconstructions de composants et les lectures de mise en page lors des changements
d'état, puis l'adaptateur des cases/décors et la copie HTML de la scène en pause.
Transformer uniquement le fond du plateau en canvas ne supprime pas ces coûts.

Les contrôles souris/tactile, swaps, grabs, déplacements forcés, taille,
pause/F5, rotation d'écran, annulation et nettoyage sont conservés. Les tests
vérifient aussi la file d'animation commune, les effets natifs sauvegardés, les
limites de messages, le partage de l'atlas et la superposition des menus.
Le rendu habituel passe ses contrôles de projectiles et de ressources FX.

Comparaison finale avec v0.96.2-dev : Chrome 157, WebGL matériel AMD,
1920 x 1080, ressources préparées, deux combats de 12 secondes par taille et
version, ordre alterné, sans autre navigateur de test concurrent. Moyennes :

| Monstres | Image moyenne avant / après (ms) | P95 avant / après (ms) | Impacts avant / après |
| --- | --- | --- | --- |
| 40 | 54,4 / 33,3 | 191,6 / 116,5 | 89 / 145 |
| 80 | 116,3 / 56,5 | 399,8 / 233,2 | 64,5 / 150,5 |

Le délai moyen baisse de 39 % à 40 monstres et de 51 % à 80. Le P95 baisse
respectivement de 39 % et 42 %. L'activité de combat augmente dans la même fenêtre ;
aucune erreur ni reprise forcée d'un acteur sain n'est relevée. Ce sont des
mesures sur un scénario et une machine, pas une garantie pour tous les combats.
**L'objectif de fluidité à 80 monstres reste ouvert** : 56,5 ms correspond à
18 images/s environ, avec encore des pointes importantes. Le mode reste donc
expérimental. Le compteur de lectures HTML dans la boucle des monstres reste
nul, mais les compilations de composants hors de cette boucle en font encore.

Les sources figées et les huit mesures finales sont dans
`outputs/canvas-combat/paired-final/` et correspondent aux fichiers livrés.
Quatre comparaisons déterministes (40/80 monstres, graines 1701/1702, cinq
secondes simulées) conservent exactement les résultats, les phases et les
journaux complets : `outputs/canvas-combat/final/`. La correction finale du
redimensionnement concerne exclusivement le rendu WebGL, inactif dans le
simulateur. Les contrôles de pause/interactions après cette correction sont
dans `functional-resize-final/`, ceux du rendu habituel dans `html-final/`,
et les contrôles de syntaxe, imports, assets et règles dans `static-final.log`,
sous `outputs/canvas-combat/`.


## Plateau visible dans le canvas commun — v0.98.0-dev

Le mode `?monsters=webgl` dessine maintenant le fond, le sol, les socles,
les empreintes, le premier plan, la météo et les objets au sol dans le même
canvas Phaser que les monstres, projectiles, panneaux et effets. Les tuiles
sont regroupées en maillages réutilisés, limités à la zone visible. La neige,
les rayons, les gouttes et les remous conservent leurs données et leur horloge ;
leurs anciens canvas 2D cachés ne sont plus redessinés. Les GIF partagent les
textures décodées existantes. Aucune nouvelle dépendance ni fichier de jeu.

Les barres de PV et d'armure lisent directement l'état des combattants. Les
écritures HTML des combattants sont évitées ; seuls les panneaux ouverts
(HUD, pilotage, inspection) reçoivent leur projection HTML. Les panneaux de cible
identiques ne sont plus reconstruits. Une armure
initialement absente peut apparaître et réagir aux impacts sans reconstruire
le HTML du combattant. Le clignotement des PV faibles et le flash d'armure
utilisent l'horloge sauvegardée. Les valeurs d'animation et les transformations
immobiles sont réutilisées entre images ; une commande, une animation ou un
changement de géométrie invalide la pose concernée.

Les menus et les contrôles restent en HTML. Des éléments invisibles conservent
les formes de hitbox, les événements et l'adaptateur de sauvegarde existants :
**un canvas visible ne signifie pas suppression complète du DOM**. Les thèmes
et géométries sont encore compilés lors de la création, des changements d'état,
du chargement d'images et des redimensionnements. Pendant les transitions de
caméra, quelques plans communs sont recalés ; les acteurs restent dans Phaser.
Leur boucle d'image ne lit toujours pas les positions et PV dans le HTML.

La section de sauvegarde `canvasBoard` conserve les animations par identifiants
stables de cases, surfaces et objets, indépendamment de l'ordre des nœuds après
F5. Le suivi tactile passe par le pointeur et le glisser-déposer de Phaser sans
faire passer le canvas opaque devant les menus ou le voile de pause. Les règles
de ciblage, dégâts, placement, coûts et chronologie des attaques sont conservées.
Les limites déjà documentées sur certains halos et transformations 3D des
composants restent applicables ; aucune identité pixel par pixel n'est promise.

Les tests du plateau complet sont intégrés au script de pause existant :
`CANVAS_BOARD_ONLY=1 MONSTER_WEBGL=1`. Ils couvrent les quatre biomes, l'absence
de redessin 2D de la météo, l'échelle des maillages, les transitions de caméra,
les coffres et objets, la pause/F5, le mobile et le changement de taille du plateau.
Le banc de charge existant accepte `LOAD_BIOME=prison` (ou un autre biome) pour
comparer le même combat avec son décor et sa météo.


Mesures finales face à `0.97.0-dev`, Chrome 157 avec WebGL matériel AMD Radeon,
scénario de Grouille-doigts mêlant tirs, mêlée, soins et contrôles, biome prison :
deux répétitions de 12 secondes par version/effectif, ordre alterné, sans autre
navigateur de test concurrent. Moyennes des deux essais (moins est mieux) :

| Monstres | Image moyenne avant → après | P95 avant → après |
| --- | --- | --- |
| 40 | 27,46 → 26,59 ms | 75,00 → 74,95 ms |
| 80 | 42,38 → 41,50 ms | 166,60 → 141,65 ms |

Le coût cumulé de mise en page et de recalcul CSS recule de 1 276 à 1 039 ms
sur les essais à 40, et de 1 121 à 942 ms à 80. Le gain moyen reste faible ;
le P95 à 80 recule d'environ 15 %, mais des saccades importantes subsistent.
Ce passage du plateau en canvas ne suffit donc pas à garantir 60 images/s.
Les boucles des acteurs enregistrent zéro lecture HTML et zéro conversion de
panneau HTML ; la compilation des thèmes lors des changements reste présente.
Le profil CPU conserve des coûts de poses/rendu, de contrôles/ciblage, de calcul
de caractéristiques et de compilation déclenchée par les événements. Aucun
lissage artificiel ni changement des règles ne masque ces coûts.

Sources figées, captures, mesures et empreintes des fichiers livrés :
`outputs/canvas-board/delivery-load/` (8 combats, aucune erreur ni relance de
combattant sain). Les quatre comparaisons exactes du simulateur — 40/80,
graines 1701/1702, cinq secondes simulées, résultats/phases/journaux identiques —
sont dans `outputs/canvas-board/paired-final/`. Les derniers ajustements de
clignotement, de cache de poses et de recherche de panneaux sont uniquement
visuels ; les fichiers de règles n'ont pas changé. Les validations finales
sont dans `delivery-validation/`, `board-optimized.log` et `static-delivery.log`,
sous `outputs/canvas-board/`. Les tests du rendu HTML habituel restent dans
`html-validated/` au même endroit.
