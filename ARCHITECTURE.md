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

## Deuxième lot : calcul des dégâts et affichage

Le module combat/statistics.js passe d'environ 6 400 à 3 700 lignes. Trois propriétaires
portent désormais des responsabilités distinctes :

| Responsabilité | Module propriétaire |
| --- | --- |
| Composition des sources, répartition par nature, arrondis, dégâts secondaires et critiques | docs/js/combat/damageRules.js |
| Détails des statistiques, contributions présentées et aides HTML | docs/js/ui/statistics/details.js |
| Messages et effets des esquives, protections, exécutions, sorts brisés, ambidextrie et régénération | docs/js/rendering/damageFeedback.js |

Le module damageRules.js n'a aucun import. Il reçoit les valeurs déjà résolues et,
pour un critique, le jet déjà tiré. Il ne lit ni les entités, ni le DOM, ni l'horloge,
et n'appelle pas Math.random. Il retourne des données sans modifier ses entrées.
Les règles de répartition, les seuils critiques et les arrondis sont conservés.

calculateAttackDamagePreview reste l'adaptateur des statistiques courantes et du
registre des modificateurs. L'attaque visible, le simulateur et les aperçus utilisent
ce même chemin. Les aides d'interface importent leurs calculs ; les calculs n'importent
pas ui/statistics/details.js. Les données de provenance des statistiques restent partagées
avec statSystem.js et ne sont pas remplacées par du HTML.

Les fonctions de présentation reçoivent les résultats déjà déterminés. Les tirages,
les règles d'éligibilité et la consommation du bonus critique restent dans le chemin
de combat. Les délais des animations utilisent toujours l'horloge de combat.
Les consommateurs importent directement le nouveau propriétaire des fonctions ;
aucune réexportation de compatibilité n'est ajoutée dans combat/statistics.js.

Ce lot ne termine pas toute l'extraction : combat/statistics.js contient encore les
états et animations de déplacement, d'occultisme, d'astralité et de transe. La résolution
des PV et de l'armure dans combat/vitals.js mélange encore calculs, application,
effets et journaux. Ces frontières restent à séparer avant d'introduire Phaser.

Validation propre à ce lot :

- Huit tests Node vérifient les règles de dégâts sans navigateur, les frontières
  d'arrondi, la conservation du total et l'absence de mutation.
- Une comparaison locale avec le calcul du commit c5bf0a4 vérifie 648 cas identiques,
  avec différentes natures, valeurs, ratios et modificateurs de dégâts.
- Les scénarios navigateur couvrent DPS, critiques, dégâts affichés, aides de calcul,
  projectiles, impacts simultanés, pause/rechargement et mort des cibles en vol.
- Le test des messages de dégâts vérifie également les VFX extraits et la conservation
  des PV, de l'armure et du résultat reçu par l'affichage.
- Le simulateur valide ses scénarios de reproductibilité, annulation et export,
  ainsi que deux lots de 20 combats.

Les rapports sont dans outputs/refactor-damage/. Avant modification, deux audits
Node (verify-critical.mjs et verify-resilience.mjs) échouaient au chargement car
leur environnement de test simule app/state.js sans exporter refreshStageAccess.
Le scénario verify-resilience-browser.mjs échouait aussi sur « Friendly swap is not
a harmful displacement ». Ces échecs de référence sont conservés dans les rapports ;
les assertions concernées ne sont pas affaiblies pour valider ce lot.

## Troisième lot : PV, armure, application et affichage

La résolution des impacts utilise maintenant quatre modules spécialisés :

| Responsabilité | Module propriétaire |
| --- | --- |
| Consommation des couches d'armure, réserves précises des équipements et total d'armure | docs/js/combat/armorRules.js |
| Passage de l'armure, réductions, PV perdus, soins et dégâts crédités | docs/js/combat/vitalRules.js |
| Écriture des PV, consommation et sauvegarde de l'armure, comptabilisation des soins et journal de résolution | docs/js/combat/vitalApplication.js |
| Barres, messages de dégâts et soins, animations d'impact et diagnostics visuels | docs/js/rendering/vitalFeedback.js |

Les deux modules de règles ne dépendent ni du DOM, ni du stockage, ni du hasard.
armorRules.js ne possède aucun import ; vitalRules.js utilise seulement damageRules.js.
Ils calculent un résultat sans modifier les données reçues. items/armor.js applique
le résultat aux réserves courantes et conserve l'identité des pools consommables et sorts.
L'ordre consommable → équipements équipés → sorts → armure naturelle → robustesse,
les fractions d'armure renforcée et les arrondis par source restent identiques.

combat/vitals.js conserve la coordination temporelle du combat et son API applyDamage.
Les PV provisoires sont appliqués avant la tentative d'astralité ; la survie éventuelle
à 1 PV est ensuite prise en compte dans les pertes et les statistiques. Le calcul des
soins reste dans leur callback différé, afin d'utiliser les PV réellement présents
au moment du soin. Les effets, scores, morts et vies supplémentaires conservent leur ordre.
La journalisation persistante est séparée des diagnostics de présentation.

updateHealthBar ne calcule plus de dégâts : son ancien argument incomingDamage n'était
jamais utilisé avec une valeur non nulle. Elle affiche les ressources déjà appliquées.
Le test navigateur vérifie qu'une application n'affiche rien avant l'appel du rendu,
puis que des affichages répétés ne changent ni les PV, ni l'armure, ni le stockage.

Validation du lot, conservée dans outputs/refactor-vitals/ :

- Onze tests Node supplémentaires couvrent plafonnement des soins, overkill, crédit
  critique, survie, ordre des armures, réserves fractionnaires et reports des altérations.
- Comparaison avec le code précédent : 896 vérifications d'armure, 540 passages de
  l'armure, 150 calculs de PV et 1 296 recalculs de défense donnent les mêmes résultats.
- Les scénarios navigateur couvrent les statistiques, vies, astralité, robustesse,
  ressources, messages et impacts simultanés. La pause et sa restauration sont vérifiées.
  Les 40 scénarios de mort d’une cible après lancement passent dans le jeu et le simulateur.
- La simulation passe ses scénarios de reproductibilité, annulation et export,
  ainsi que deux lots de 20 combats.
- Le contrôle habituel vérifie syntaxe, imports, ressources et 42 tests Node au total.

Les audits Node verify-astrality.mjs et verify-robustness.mjs rencontrent le même défaut
que les audits critique/résilience : leur simulation de app/state.js ne fournit pas
refreshStageAccess. Le défaut est reproduit avec les sources du commit précédent
2ee00e8 ; les scénarios navigateur correspondants passent sans modifier leurs assertions.

Les effets de régénération, de vol de vie et de résurrection possèdent encore leurs
propres chemins historiques. Ce lot isole les règles de la résolution des impacts ;
il ne termine pas la séparation de tous les effets et du cycle de vie des entités.

## Quatrième lot : plateau logique — P3 du plan

| Responsabilité | Module propriétaire |
| --- | --- |
| Géométrie hexagonale, empreintes, état d'occupation, application des positions et instantanés | docs/js/board/model.js |
| Validation des placements, zones autorisées et recherche de poussées | docs/js/board/placementRules.js |
| Lecture des coordonnées HTML, projection et correspondance entre identifiants et éléments | docs/js/rendering/boardAdapter.js |

Les clés de l'état d'occupation sont désormais des identifiants de cases et d'entités.
Le modèle ne contient ni élément HTML, ni instance d'entité du combat. Ses instantanés
sont des données simples, copiées et sérialisables. Les règles de placement fonctionnent
sans navigateur, stockage ou tirage aléatoire et ne modifient pas l'état examiné.
La recherche conserve son ordre déterministe, ses coûts et sa limite de 20 000 nœuds.

board/controller.js coordonne le plateau existant. Il traduit les demandes HTML en identifiants,
revalide le plan contre l'occupation courante, applique toutes les réservations logiques,
puis met à jour les vues et envoie les notifications au combat. Un objet apparu entre
la préparation et l'application continue donc de bloquer un ancien plan. Les réservations
des consommables gardent leur exception pour les déplacements manuels.

Le plateau visible et celui du simulateur utilisent ces mêmes règles. Le DOM actuel
reste l'adaptateur d'initialisation et de restauration ; ce lot ne supprime pas le plateau
HTML du simulateur et ne change pas les sauvegardes. Les décors, notifications et rôles
visuels restent coordonnés par board/controller.js. La prochaine étape P4 peut s'appuyer sur le
modèle logique sans recréer les règles de placement dans un autre moteur.

Validation dans outputs/refactor-board/ :

- Neuf tests Node couvrent limites, parité des lignes, échanges atomiques, poussées,
  obstacles, consommables, zones interdites et reconstruction depuis un instantané.
- 572 empreintes et 1 200 plans comparés au code précédent donnent les mêmes résultats.
- Les tests de tailles vérifient l'accord entre modèle et rendu après chaque placement,
  ainsi que l'absence de références DOM et d'entités dans les instantanés.
- Placement, inventaire, ciblage avant exécution, 40 scénarios de mort en vol et simulation
  passent dans le navigateur. Le contrôle habituel comprend désormais 51 tests Node.

Le premier passage du test de pause échoue sur la précision de sérialisation d'une matrice
CSS (écart de 0,00001). La relance isolée passe sans changement des assertions, de même
que les tests de placement et de taille relancés avec les vérifications du modèle logique.
Le rapport du premier échec est conservé pour le suivi de cette sensibilité du test.

## Cinquième lot : démarrage et interface regroupés

Le périmètre de GameInit et de ses écrans passe de **17 à 14 fichiers**.
Le démarrage est dans `docs/js/app/startup.js` ; tous les écrans sont dans `docs/js/ui/`.
Les consommateurs importent le propriétaire de la fonction, sans catalogue de réexportations
ni fichiers relais aux anciens chemins.

```text
docs/js/
  app/
    startup.js                 démarrage, chargement et ordre d'initialisation
  ui/
    application.js             menus du joueur, première partie et paramètres
    navigation.js              placement des fenêtres et mémoire de navigation
    drag.js                    état du glisser-déposer et nettoyage des aides
    display.js                 fenêtres, affichage général et conteneur de jeu
    inventory.js               inventaire, boutique et sacoche de combat
    attacks.js                 présentation et commandes des attaques
    essences.js                interface des essences
    codex/
      index.js                 ouverture du Codex et navigation dans une entité
      profile.js               fiche de l'entité, équipements et emplacements
      stats.js                 panneaux de statistiques du Codex
    statistics/
      components.js            éléments visuels, puissance, Umbra et effets
      helpers.js               interactions des aides et infobulles
      details.js               détail des calculs présenté au joueur
```

Les petits modules de navigation et de glisser-déposer restent indépendants des écrans :
leur fusion avec les menus ou l'inventaire créerait des cycles. Les équipements sont
regroupés avec la fiche du Codex. Les composants de statistiques, de puissance et d'effets
partagent un seul module. Le Codex conserve trois fichiers pour éviter un fichier géant.
Le helper du conteneur de jeu appartient à display.js, utilisé directement par board/controller.js.

Les neuf initialisations gardent leur ordre et leurs protections contre les doubles
écouteurs. L'équipement et la fiche conservent chacun leur propre protection.
Le simulateur charge explicitement le démarrage, puis les menus dont il a besoin.
Les deux pages HTML et les scénarios de test utilisent les nouveaux chemins.

Validation dans `outputs/refactor-interface/` :

- Le contrôle habituel passe : syntaxe, imports, ressources et 51 tests Node.
- Dix-sept scénarios navigateur passent, dont démarrage sur quatre profils, diagnostic
  mobile, aides de statistiques, boutique, essences, pause et deux lots de 20 simulations.
- Comparaison structurelle des **473 fonctions déplacées** : mêmes traitements,
  après normalisation des chemins d'import et des noms de protections d'initialisation.
- Les 13 modules d'interface ont un graphe d'imports statiques sans cycle entre eux.
  Réinitialiser les écrans n'ajoute aucun écouteur ni conteneur supplémentaire.
- Inventaire : **94 vérifications**, dont équipements, concurrence d'utilisation,
  objets au sol, rechargement et affichage ordinateur/tablette/mobile.
- Les montages de plateau des tests d'inventaire et de navigation administrateur
  enregistrent désormais leurs ajouts et retraits dans l'index d'occupation.
  Leurs défauts étaient reproduits avant ce lot, y compris avant P3.
- La sonde d'ouverture du Codex vise maintenant le propriétaire de calculateStatsDisplay ;
  la sonde du diagnostic mobile vise le nouveau point d'entrée.

L'audit d'import de chaque sous-système isolément continue à détecter dix échecs
historiques liés à BOOSTABLE_POOL_STAT_KEYS ou gameStarted. Ils sont reproduits avec
les sources antérieures au regroupement, avec la même liste de sous-systèmes et les
mêmes erreurs. Le test conserve ses assertions et exécute aussi les vérifications des
écrans avant de signaler ces échecs. Le démarrage normal du jeu n'utilise pas ces entrées
isolées. Le graphe global conserve un cycle de 68 modules, contre 73 auparavant :
ce rangement ne termine pas la suppression des dépendances circulaires du jeu.
Le scénario administrateur verify-admin-codex-controls-browser.mjs conserve aussi
un délai dépassé dans runCombatCheck, reproduit avec les sources antérieures.
Les autres contrôles de navigation, d'ouverture et d'attaques du Codex passent.

## Sixième lot : classement global des sources

Les **52 fichiers JavaScript à la racine de docs/js/** sont maintenant classés par rôle.
Le dossier français `entite/` rejoint `entities/` ; les modèles et textes des personnages
rejoignent `data/`. Le projet passe de **120 à 117 modules**, sans fichier relais à l'ancien
emplacement. Le tableau du README sert de point d'entrée dans les répertoires.

Les fabriques utilisées des armées A et B sont réunies dans `entities/armies.js` :
recrutement, constitution de l'armée du joueur, génération aléatoire et armées scénarisées.
Les anciens doublons ArmyPlayerFactory.js et ArmyEnemyFactory.js n'avaient aucun
consommateur dans le code, les pages ou les tests et sont supprimés. Les fonctions actives,
les identifiants, les règles de recrutement et l'ordre des tirages restent identiques.

Le classement distingue notamment :

- `app/` : lancement, changement de niveau, carte du monde et état courant.
- `entities/` : registre, création, armées, progression et règles des personnages.
- `combat/` : boucle de combat, attaques, effets, statistiques, horloge et pause.
- `board/` : modèle du plateau, placements, déploiement et interactions.
- `rendering/` : création des éléments visibles, animations, compteurs, messages et son.
- `storage/` : sauvegardes du jeu et des personnages, stockage isolé du simulateur.
- `events/` : événements scénarisés et leur déroulement.
- `items/` : objets, équipement, butin et données des essences.
- `ui/` : écrans du joueur, Codex, statistiques et dialogues.
- `debug/` : administration, simulation, réglage des effets et journal de diagnostic.

Les imports directs et différés, les doubles de test, les sondes navigateur et les trois
pages HTML concernées utilisent les nouveaux chemins. Les ressources relatives au module
(nuage de pause, fumée de déplacement et document du simulateur) conservent leur URL finale.
Les formats de sauvegarde et les clés de stockage ne changent pas.

Validation conservée dans `outputs/refactor-layout/` :

- Les corps exécutables et les imports des **117 modules**, dont **3 398 fonctions**,
  sont comparés à leur version précédente après normalisation des chemins.
- Les 13 scénarios de référence passent avant et après le déplacement. Avec le
  diagnostic mobile, le Codex et le banc de réglage des effets, 16 scénarios passent,
  dont deux lots de 20 simulations de combat.
- L'audit d'import isolé conserve exactement les dix échecs historiques, après traduction
  des noms de modules. Les 14 modules d'interface restent sans cycle statique entre eux ;
  l'initialisation répétée n'ajoute ni écouteur ni conteneur.
- Le contrôle habituel vérifie syntaxe, imports, ressources et 51 tests Node.

Ce lot classe les propriétaires et retire les doublons inutilisés. Les gros modules
`debug/admin.js`, `events/runtime.js` et `entities/progression.js` gardent encore des
responsabilités internes à séparer. Le classement ne rend pas automatiquement pures les
fonctions historiques qui mélangent calcul, état et affichage ; cette séparation continue
par étapes avant Phaser.

## Septième lot : affichage des ressources et déplacements

Ce lot réutilise les fichiers existants : **117 modules avant et après**.
Les consommateurs importent les fonctions depuis leur propriétaire ; les anciens
modules ne réexportent pas les fonctions déplacées.

| Responsabilité | Propriétaire |
| --- | --- |
| Barres de PV et d'armure, textes des réserves et compteurs de vies supplémentaires | rendering/vitalFeedback.js |
| Formules de capacité, charges initiales et chances des passifs de déplacement | combat/statistics.js |
| Initialisation, recharge et consommation des charges de déplacement | board/deployment.js |
| Compteurs de déplacement, couleurs, rebonds et surbrillance Traînard | rendering/hud.js |
| Consommation précise des réserves d'équipement, consommables et sorts | items/resourceStocks.js, inchangé |

Onze fonctions d'affichage quittent entities/progression.js et combat/vitals.js.
Les fabriques de barres et de compteurs restent dans rendering/entities.js.
La progression et le combat demandent explicitement une mise à jour du rendu après
avoir appliqué leurs ressources ; le rendu ne calcule ni ne sauvegarde les dégâts.

Douze fonctions de déplacement quittent combat/statistics.js. La recharge et la
consommation modifient les réserves puis rendent leur résultat, sans actualiser les
compteurs. La boucle de combat et les commandes de placement appellent ensuite le HUD.
Les règles de dette, de surcapacité, de poids, d'immobilisation et les tirages des
passifs gardent leur ordre. La recharge naturelle ne remplit pas les stocks d'objets.

L'affichage ne réécrit plus current/max pour les arrondir. Il peut afficher des valeurs
fractionnaires gelées sans les modifier. La création d'un compteur ne crée plus de
réserve : les écrans initialisent explicitement celle-ci avant de construire leur vue.
La mémoire des animations est conservée dans une WeakMap, sans ajouter de champ au
personnage sauvegardé. Le message de recharge est journalisé lors de son application,
une fois par recharge effective ; il ne dépend plus du nombre de compteurs visibles.

Validation dans outputs/refactor-resource-ui/ :

- Les cinq scénarios de référence passent avant les modifications.
- Dix-huit fonctions déplacées sont identiques ; les trois fonctions d'application
  des déplacements conservent calculs, gardes et tirages après retrait de leur affichage.
- Des assertions ajoutées aux tests existants vérifient que plusieurs affichages des
  PV/armure/vies ne changent ni les ressources ni le stockage ; elles vérifient également
  des déplacements gelés, l'absence de mutation lors du rendu et l'affichage explicite
  après recharge ou consommation.
- Les scénarios de ressources couvrent les équipements, leurs réserves fractionnaires,
  les changements de propriétaire, la dette et la recharge avec ou sans Traînard.
- Quinze scénarios navigateur passent, dont les effets, la pause, la simulation de combat
  et le démarrage sur quatre profils PC/mobile.
- Les 51 tests Node, la syntaxe, les imports et les références de ressources passent.
- L'audit d'import isolé conserve neuf échecs historiques, sans nouvel échec. L'entrée
  combat/loop.js qui échouait auparavant peut maintenant être chargée isolément.

Les aperçus généraux de montée de niveau et plusieurs effets historiques gardent
leurs liens avec l'interface. board/deployment.js conserve aussi la projection visuelle
du placement. Ce lot sépare les fonctions des ressources ; il ne rend pas encore tous
les modules du jeu indépendants du navigateur.

## Huitième lot : rôles et affichage du ciblage

Ce lot réutilise les modules existants : **117 modules avant et après**.
Treize fonctions et la mémoire du choix affiché sont regroupées par responsabilité.
Les consommateurs importent directement leur propriétaire, sans fichier relais.

| Responsabilité | Propriétaire |
| --- | --- |
| Priorités tactiques des attaquants et des soutiens | combat/roles.js |
| Badges, portraits de rôles, choix affiché et listes de cibles | rendering/hud.js |
| Lecture et décoration des rôles des cases | rendering/boardElements.js |
| Placement, index des combattants et charges de déplacement | board/deployment.js |

combat/roles.js ne contient plus de manipulation du DOM et peut être importé sans
navigateur. Le HUD possède sa WeakMap de choix affichés et son abonnement aux
changements de profil ; une prévision de cible ne remplace toujours pas le choix
confirmé. Le changement de camp remet toujours cet affichage à zéro.

Deux helpers sans appel sont supprimés : getEntityPortraitFromDiv et le doublon
hexRoles de board/interaction.js. La fonction utilisée pour construire les cases
reste unique dans rendering/boardElements.js. Les tableaux de priorités, les zones,
le choix des rôles et le comportement des listes sont conservés.

Validation dans outputs/refactor-role-views/ :

- Les treize fonctions déplacées, leur cache et leur abonnement sont identiques
  dans l'arbre syntaxique ; les 559 autres fonctions des modules touchés sont inchangées.
- Les 51 tests Node, la syntaxe et les références de ressources passent.
- Sept scénarios navigateur passent : placement, tailles, déplacements, changements
  de camp, listes de cibles et dépôts d'objets, pause/reprise et démarrage PC/mobile.
- Le test de profil valide les badges et changements de cible, puis retrouve son
  échec préexistant sur l'expiration des flammes d'une brûlure. Ce lot ne modifie pas
  cet effet ni ne retire son assertion.
- L'audit des imports isolés retrouve exactement les neuf erreurs de la référence.
  L'ordre des dépendances existantes est conservé : les cycles historiques rendent
  leur initialisation sensible à un simple déplacement d'import.
- Le graphe compte 914 dépendances et conserve sa composante cyclique de 67 modules.

Le placement et son observateur DOM restent dans board/deployment.js. Le champ
historique targetZone reste actualisé par le HUD pour les consommateurs existants.
Le prochain tri concerne les formulaires de progression et les opérations de jeu
encore placées dans le stockage ; les grands blocs d'événements restent à séparer.

## Neuvième lot : montée de niveau, formulaires et animations

Le projet conserve ses 117 modules. La montée de niveau réutilise quatre propriétaires
existants ; aucun petit fichier supplémentaire ni module relais n'est ajouté.

| Responsabilité | Propriétaire |
| --- | --- |
| Coûts en XP, prévisions, points, progression des archétypes et confirmation | entities/progression.js |
| Formulaires, boutons, confirmations, purification et présentation du Codex | ui/codex/stats.js |
| Projection des statistiques permanentes et prévues dans les vues et compteurs | ui/statistics/components.js |
| Graphe des attributs, âme et effets d'éveil | rendering/animations.js |

Soixante-dix-sept fonctions et sept déclarations d'état ou de configuration quittent
entities/progression.js. Le contrôleur de formulaire délègue désormais les opérations
de brouillon, de coût, d'annulation, de récompense et de confirmation aux fonctions
regroupées dans la progression. Les autres consommateurs importent directement le
propriétaire du rendu dont ils ont besoin.

Les calculs du brouillon peuvent être appelés sans formulaire. La confirmation applique
les points et le paiement, puis le formulaire orchestre la sauvegarde et son actualisation.
L'éveil est toujours confirmé avant les délais de présentation : fermer le Codex ou
recharger pendant l'animation ne perd pas le dernier point ni le paiement.
Les effets d'éveil utilisent explicitement les minuteurs du navigateur dans le module
d'animations ; la pause du combat ne suspend pas cette présentation.

Validation dans outputs/refactor-levelup/ :

- Les 76 fonctions simplement déplacées et leurs sept déclarations conservent leur
  arbre syntaxique, après normalisation des chemins et des minuteurs. Les 80 autres
  fonctions du cœur historique sont inchangées ; le contrôleur et le point de
  rafraîchissement après sauvegarde sont les changements intentionnels.
- Seize opérations de progression sont séparées du formulaire. Le test existant de
  montée de niveau ajoute seize assertions avec les accès DOM bloqués : coûts,
  refus, point ajouté, étape d'archétype, annulation et statistiques permanentes.
- Les 51 tests Node, la syntaxe et les références de ressources passent.
- Douze scénarios navigateur couvrent montée de niveau, annulation, confirmation,
  éveil, purification, ressources, statistiques, infobulles et démarrage PC/mobile.
  Le test de performance conserve au maximum deux calculs de prévision, aucune
  génération d'infobulle fermée et une notification de sauvegarde par point.
- La sonde de performance suit le propriétaire actuel de calculateStatsDisplay.
  Le scénario de statistiques initialise le stockage avant les panneaux, comme
  app/startup.js, au lieu de laisser leurs imports concurrents choisir l'entrée.
  Aucune assertion métier n'est retirée ; ses 7 880 contrôles passent.
- L'audit séparé des imports isolés retrouve exactement les neuf erreurs initiales.
  Les 14 modules d'interface restent sans cycle entre eux. Le graphe global compte
  916 dépendances et conserve sa composante cyclique de 67 modules.

La progression conserve encore des dépendances historiques au stockage, aux
notifications d'XP et à la purification, ainsi que l'ancien formulaire de surnom.
Ce lot sépare les responsabilités de montée de niveau ; il ne rend pas encore tout
le module importable indépendamment du navigateur. Les grands contrôleurs
événementiels et les opérations de jeu placées dans le stockage restent à trier.

## Temps et présentation

combat/clock.js reste l'horloge de combat ; combat/timeline.js ordonne les échéances et les
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

Après le deuxième lot : 116 modules, 917 dépendances locales et une composante
cyclique de 71 modules. damageRules.js ajoute un troisième module sans dépendances.
Les cycles historiques restent à réduire ; ce lot ne prétend pas les éliminer.

Après le troisième lot : 120 modules, 930 dépendances et une composante cyclique
de 73 modules. Les règles PV/armure sont hors de cette composante ; les adaptateurs
d’application et d’affichage utilisent encore les modules historiques.

Après P3 : 123 modules et 935 dépendances. La composante cyclique reste à 73 modules ;
les trois nouveaux modules du plateau sont hors de cette composante.

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

    node --test scripts/verify-flight-rules.test.mjs scripts/verify-damage-rules.test.mjs scripts/verify-vital-rules.test.mjs scripts/verify-board-rules.test.mjs

Ils couvrent notamment la mort provisoire du lanceur, la perte définitive du guidage,
le retour d'une cible à sa case initiale et la conservation de la part physique d'une
attaque hybride.

## Suite du plan, avant Phaser

1. Étendre les mêmes frontières aux effets de soin, régénération, vol de vie et
   résurrection, en conservant leurs échéances et leur comptabilisation.
2. Extraire les mises à jour de barres et d'effets encore présentes dans les phases
   d'attaque ; préciser le contrat entre l'exécution et la présentation.
3. **P3 livrée** : état logique du plateau, occupation et placements indépendants du DOM,
   avec un adaptateur de coordonnées et de rendu pour le jeu actuel.
4. Raccorder le jeu visible et le simulateur au même état et aux mêmes règles.
5. Réduire les cycles restants, puis poursuivre le découpage de events/runtime.js,
   entities/progression.js et debug/admin.js par fonction métier.
6. Intégrer un premier projectile Phaser lorsque ces frontières sont validées.

L'exécution et le ciblage utilisent encore des modules historiques, notamment
combat/statistics.js, combat/control.js et le plateau DOM. Ces neuf premiers lots ne constituent
pas une séparation complète du moteur de jeu.
