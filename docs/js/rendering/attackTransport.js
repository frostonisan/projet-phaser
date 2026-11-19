import { animationProjectile, animationMelee, getMeleeFlightVisual } from "./animations.js";
import { normArr } from "../combat/attackResolution.js";
import { attackEffects } from '../data/attackEffects.js';
import { clockNow, isCombatPaused } from '../combat/clock.js';
import { getBattleEntityElement } from '../entities/rules.js';

// First Phaser pilot: the ordinary physical ranged shot. Combat still owns impact.
const phaserFlights = new Map();
let phaserLayer = null, phaserReady = null;
const viewport = () => ({ width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) });
function viewCenter(element) {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect(), { width, height } = viewport();
  return { x: (rect.left + rect.width / 2) / width, y: (rect.top + rect.height / 2) / height };
}
function hideIdlePhaser() {
  if (phaserFlights.size || !phaserLayer?.game) return;
  phaserLayer.host.hidden = true;
  phaserLayer.game.loop.sleep();
}
function removePhaserFlight(entry, status = 'removed') {
  if (phaserFlights.get(entry.flight.id) !== entry) return;
  phaserFlights.delete(entry.flight.id);
  entry.graphic?.destroy();
  entry.record.status = status;
  entry.flight.attacker.projectiles = (entry.flight.attacker.projectiles || []).filter(record => record !== entry.record);
  hideIdlePhaser();
}
function clearPhaserProjectiles() {
  for (const entry of [...phaserFlights.values()]) removePhaserFlight(entry);
}
for (const event of ['projectileVisualsCleared', 'battleStopped', 'battleResolved']) window.addEventListener(event, clearPhaserProjectiles);
for (const event of ['combatResumed', 'resize']) window.addEventListener(event, () => {
  if (phaserFlights.size) phaserLayer?.game?.loop.wake();
});

function updatePhaserFlight(entry, scene, Phaser) {
  if (entry.flight.expired()) { removePhaserFlight(entry); return; }
  const visual = entry.record.visual, { width, height } = viewport();
  if (!isCombatPaused()) {
    const target = viewCenter(entry.flight.cellView(entry.flight.aimedHex));
    if (!target) { removePhaserFlight(entry); return; }
    const progress = Phaser.Math.Clamp((clockNow() - visual.startTime) / visual.duration, 0, 1);
    visual.progress = progress;
    visual.x = Phaser.Math.Linear(visual.from.x, target.x, progress);
    visual.y = Phaser.Math.Linear(visual.from.y, target.y, progress);
    visual.angle = Math.atan2((target.y - visual.from.y) * height, (target.x - visual.from.x) * width);
  }
  const graphic = entry.graphic ||= scene.add.graphics().setName(entry.flight.id);
  const color = entry.aura === 'ambidextry' ? 0xedff00 : entry.mysticism ? 0xd2ebff : 0xff3028;
  graphic.clear().setPosition(visual.x * width, visual.y * height).setRotation(visual.angle);
  graphic.lineStyle(6, color, .18).lineBetween(-26, 0, 0, 0);
  graphic.lineStyle(2, color, .75).lineBetween(-20, 0, 0, 0);
  graphic.fillStyle(color, .12).fillCircle(0, 0, 12);
  graphic.fillStyle(color, .3).fillCircle(0, 0, 8);
  graphic.fillStyle(color, 1).fillCircle(0, 0, 5);
  graphic.fillStyle(0xfff2dd, 1).fillCircle(1, -1, 2);
}
async function ensurePhaserLayer() {
  if (phaserReady) return phaserReady;
  phaserReady = (async () => {
    // Local, pinned dependency; neither menus nor simulation download or boot it.
    const Phaser = await import('../../vendor/phaser-3.90.0.esm.min.js');
    const host = document.createElement('div');
    host.id = 'phaser-projectiles'; host.setAttribute('aria-hidden', 'true'); host.hidden = true;
    document.body.append(host);
    const layer = phaserLayer = { host, game: null, scene: null };
    await new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => reject(new Error('Initialisation Phaser trop longue.')), 10000);
      try {
        layer.game = new Phaser.Game({
          type: Phaser.AUTO, parent: host, ...viewport(), transparent: true, banner: false, autoFocus: false,
          audio: { noAudio: true }, input: { keyboard: false, mouse: false, touch: false, gamepad: false },
          scale: { mode: Phaser.Scale.NONE }, render: { antialias: true },
          seed: ['dark-pit-projectiles'],
          scene: {
            create() {
              layer.scene = this;
              layer.game = this.game;
              this.game.canvas.setAttribute('aria-hidden', 'true');
              globalThis.clearTimeout(timeout); resolve();
              hideIdlePhaser();
            },
            update() {
              const { width, height } = viewport();
              if (this.scale.width !== width || this.scale.height !== height) this.scale.resize(width, height);
              for (const entry of [...phaserFlights.values()]) updatePhaserFlight(entry, this, Phaser);
              if (isCombatPaused()) this.game.loop.sleep();
            },
          },
        });
      } catch (error) { globalThis.clearTimeout(timeout); reject(error); }
    });
    return layer;
  })().catch(error => {
    if (phaserLayer) {
      phaserLayer.game?.destroy(true); phaserLayer.game?.loop.wake(); phaserLayer.host.remove();
    }
    phaserLayer = null; phaserReady = null;
    throw error;
  });
  return phaserReady;
}
export function prepareAttackTransport(attack) {
  if (!globalThis.__combatSimulation && attack.functionName === 'shot-p-r')
    void ensurePhaserLayer().catch(error => console.warn('[PhaserProjectile]', error));
}
function isPhaserShot(flight, effectClasses) {
  return flight.attack.functionName === 'shot-p-r' && flight.mode === 'physical'
    && !effectClasses.length;
}
function presentPhaserShot(flight, impact, { duration, options, restored }) {
  if (globalThis.__combatSimulation) return;
  const saved = restored?.visual;
  const from = saved?.from || viewCenter(getBattleEntityElement(flight.attacker));
  if (!from) return;
  const visual = saved || { renderer: 'phaser', from, x: from.x, y: from.y,
    angle: 0, progress: 0, startTime: clockNow(), duration };
  const record = { id: flight.id, attackerId: flight.attacker.id, targetId: flight.target.id,
    attackId: flight.attack.attackId, status: 'in-flight', flightMode: flight.mode, visual };
  flight.attacker.projectiles ||= [];
  flight.attacker.projectiles = flight.attacker.projectiles.filter(record => record.id !== flight.id);
  flight.attacker.projectiles.push(record);
  const entry = { flight, record, aura: options.secondHit ? 'ambidextry' : null,
    mysticism: Boolean(flight.attack.isLaunchedUnderMysticism) };
  phaserFlights.set(flight.id, entry);
  // Boot and drawing never delay the scheduled hit, even on a cold/slow device.
  impact.then(status => removePhaserFlight(entry, status), () => removePhaserFlight(entry, 'error'));
  void ensurePhaserLayer().then(layer => {
    if (phaserFlights.get(flight.id) !== entry) return;
    layer.host.hidden = false; layer.game.loop.wake();
  }).catch(error => { removePhaserFlight(entry, 'error'); console.warn('[PhaserProjectile]', error); });
}


function getProjectileEffectClasses(attack = {}) {
  return normArr(attack?.effets)
    .map(effectName => attackEffects.find(effect => effect.effectName === effectName)?.effectProjectile)
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value || "").trim())
    .filter(value => value && value !== "none");
}

// The combat scheduler supplies the impact promise. Rendering only observes it.
export async function presentAttackTransport(flight, impact, { duration, isRange, options, restored }) {
  const { attacker, target, attack } = flight;
  if (isRange) {
    const effectClasses = getProjectileEffectClasses(attack);
    if (isPhaserShot(flight, effectClasses)) {
      presentPhaserShot(flight, impact, { duration, options, restored });
      return impact;
    }
    // The visual follows the scheduled impact, never the other way round.
    void animationProjectile(attacker, target, () => impact, {
      id: flight.id, attackId: attack.attackId, attacknature: attack.attacknature,
      executionTime: duration, effectProjectileClasses: effectClasses,
      isLaunchedUnderMysticism: Boolean(attack.isLaunchedUnderMysticism),
      aura: options.secondHit ? 'ambidextry' : undefined,
      flight, impactPromise: impact, restoredVisual: restored?.visual,
    }).catch(error => console.error('[ProjectileVisual]', error));
    return impact;
  }
  const controller = (restored && getMeleeFlightVisual(flight.id))
    || animationMelee(attacker, target, Boolean(options.secondHit), { duration, flightId: flight.id });
  const status = await impact;
  // Display completion must not delay the next gameplay phase.
  void controller?.resolveImpact?.(status === 'hit');
  return status;
}
