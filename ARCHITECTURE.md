# Architecture de Projet Phaser

## Premier lot : noyau des attaques

Le premier lot remplace le module unique events/attackEntites.js par des responsabilités
identifiées. Il prépare l'intégration du moteur physique sans ajouter Phaser.

| Responsabilité | Module propriétaire |
| --- | --- |
| Préparation, exécution, échéances d'impact et récupération | docs/js/combat/attackExecution.js |
| Contexte de lancement, statistiques figées, état du vol et restauration | docs/js/combat/attackFlight.js |
| Choix du mode de vol, perte du guidage, annulation et dégâts résiduels | docs/js/combat/flightRules.js |
| Validité d'une cible à la sélection, à l'exécution et à l'impact | docs/js/combat/targeting.js |
| Copie des données de lancement et de simulation | docs/js/combat/snapshot.js |
| Accès aux cases et à leurs occupants dans le plateau actuel | docs/js/board/targets.js |
| Affichage du projectile ou de l'attaque de mêlée | docs/js/rendering/attackTransport.js |
| API publique du domaine pour les intégrations et scénarios de test | docs/js/combat/attacks.js |

Les modules du jeu importent directement le propriétaire de chaque fonction. L'API publique
ne doit pas être importée par ses propres modules internes. L'ancien chemin est supprimé ;
les tests et leurs points d'instrumentation utilisent les nouveaux chemins.

flightRules.js ne dépend d'aucun module, du navigateur, de l'horloge ou du registre des
entités. Ses entrées sont l'état du vol et les faits observés à un instant donné.
Les cases y sont des références opaques : les tests utilisent des identifiants textuels,
et l'adaptateur actuel fournit encore des éléments du plateau.

snapshot.js ne charge aucun autre module du jeu. La simulation et les invocations peuvent
copier leurs données sans importer l'exécution des attaques. Le filtrage des références
DOM reste identique au comportement initial.

## Temps et présentation

combatClock.js reste l'horloge de combat ; combatTimeline.js ordonne les échéances et les
impacts simultanés. attackExecution.js planifie l'impact et transmet sa promesse au rendu.
Le rendu suit ce résultat. Les soins et vies supplémentaires peuvent sauver un lanceur
avant que sa mort soit confirmée ; les règles de guidage conservent ce comportement.

Le contexte de vol garde la structure de ses instantanés et les noms des sections de
restauration existantes. Aucune migration de sauvegarde n'est ajoutée.

## Placement et consommables au sol

La référence initiale échouait sur le déplacement pendant la pause tactique : un
consommable était enregistré comme une case réservée et empêchait le joueur de le ramasser.

Le placement ordinaire et le changement de taille conservent cette réservation.
Le déplacement manuel du joueur demande explicitement allowGroundConsumables.
Cette option est conservée jusqu'à la validation finale du plan ; elle ne permet jamais
de traverser une créature ou un objet solide ajouté entre la préparation et l'application.

## Cartographie reproductible

Depuis la racine du dépôt :

    node scripts/analyze-module-graph.mjs --output=outputs/architecture/modules.json

Le rapport contient les dépendances locales, les tailles de modules et les composantes
fortement connexes, en incluant les imports dynamiques dont le chemin est littéral.
Il s'appuie sur le parseur déjà utilisé par le vérificateur des ressources.
PLAYWRIGHT_PATH permet de préciser l'installation locale de cette dépendance.

Avant extraction : 106 modules, 859 dépendances locales et une composante cyclique
de 65 modules. Après extraction : 113 modules, 889 dépendances et une composante cyclique
de 69 modules. Le découpage augmente le nombre de sommets du graphe ; les cycles généraux
ne sont donc pas encore supprimés. Le résultat de ce lot est l'extraction de deux modules
sans dépendances et la séparation explicite du rendu des trajectoires.

## Validation

Les rapports locaux sont placés dans outputs/refactor-combat/ et ignorés par Git.
Le lot utilise les scénarios existants de projectiles, changement de cible, mort en vol,
impacts simultanés, pause/rechargement, continuité des tours, placement et simulation.
Les assertions métier des scénarios existants sont conservées.

Les contrôles de syntaxe, des imports et des ressources passent, de même que les
sept tests des règles extraites. Deux échecs de la suite élargie sont également
reproduits sur le commit initial 322ae5f : verify-adresse-browser.mjs
(range/piercing: impact outcome) et verify-attack-mastery-browser.mjs
(soin désactivé sur une cible à pleine vie : maîtrise attendue non accordée).
Ils restent à traiter dans un lot distinct ; ce changement ne les masque pas.

La vérification habituelle inclut désormais les tests des règles de vol :

    powershell -ExecutionPolicy Bypass -File scripts/verify.ps1

Les tests sans navigateur s'exécutent avec :

    node --test scripts/verify-flight-rules.test.mjs

Ils couvrent notamment la mort provisoire du lanceur, la perte définitive du guidage,
le retour d'une cible à sa case initiale et la conservation de la part physique d'une
attaque hybride.

## Lots suivants, avant Phaser

1. Extraire les calculs de dégâts et de durée de leur présentation HTML/VFX.
2. Extraire les mises à jour de barres et d'effets encore présentes dans les phases
   d'attaque ; préciser le contrat entre l'exécution et la présentation.
3. Donner au plateau un état logique indépendant du DOM. Centraliser les conversions
   de coordonnées dans l'adaptateur de rendu.
4. Raccorder le jeu visible et le simulateur au même état et aux mêmes règles.
5. Réduire les cycles restants, puis poursuivre le découpage de events.js,
   UpgradeEntity.js et admin.js par fonction métier.
6. Intégrer un premier projectile Phaser lorsque ces frontières sont validées.

L'exécution et le ciblage utilisent encore des modules historiques, notamment
damagesCalcul.js, entityControl.js et le plateau DOM. Ce premier lot ne constitue
pas une séparation complète du moteur de jeu.
