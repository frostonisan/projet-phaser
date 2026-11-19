import { getEntityBoardHex, getBoardCell, getFootprintOccupant, planEntityPlacements,
  commitEntityPlacements } from "./controller.js";
import { consumeEntityMovement, ensureMovementState } from "./deployment.js";
import { updateMovementDisplay } from "../rendering/hud.js";
import { isEntityMovementBlocked } from "../combat/control.js";
import { isCombatPaused, isCombatInteractionBlocked, notifyCombatAction } from "../combat/clock.js";
import { generateUniqueID, entites, enrichEntityStats } from "../entities/runtime.js";
import { soclesVisible } from "../ui/display.js";
import { beginDragHelperCleanup, endDragHelperCleanup } from "../ui/drag.js";
import { spawnEntiteIngame } from "../entities/spawn.js";
import { EffectMessage } from "../combat/effects.js";
import { notifyProjectileTargetMoved, configurePhaserBoardDrag, cancelPhaserBoardDrag, isPhaserBoardDragReady } from "../rendering/animations.js";
import { saveEntityMovementState, recordEntityCombatMovement, recordEntityCombatAmount, recordEntityCombatProc } from "../storage/entityStorage.js";
import { battleLogs } from "../combat/journal.js";
import { gameStarted } from "../app/state.js";
import { isAdminMode as isGameAdminMode } from "../storage/gameStorage.js";

let lastHoveredHex = null, draggedView = null;
const adminPlacement = () => isGameAdminMode() && window.levelRunning === 'admin';
const entityForBox = box => entites.find(entity => String(entity.id) === box?.id.replace('Box_Entite_', ''));
const canDrag = entity => entity && !entity.isDEAD && !entity.hasFled && !isCombatInteractionBlocked()
  && (entity.side !== 'B' || adminPlacement());

function updateDragHexHover(hex) {
  if (hex === lastHoveredHex) return;
  if (lastHoveredHex) {
    lastHoveredHex.classList.remove('hovered');
    if (!soclesVisible && !lastHoveredHex.classList.contains('occupied')) {
      const base = lastHoveredHex.querySelector('.socle'); if (base) base.style.opacity = '0';
    }
  }
  lastHoveredHex = hex;
  if (!hex) return;
  hex.classList.add('hovered');
  if (!soclesVisible) { const base = hex.querySelector('.socle'); if (base) base.style.opacity = '1'; }
}
function finishDragHexFeedback() {
  if (draggedView) endDragHelperCleanup();
  updateDragHexHover(null);
  draggedView?.sprite.classList.remove('dragged');
  draggedView?.grid.classList.remove('phaser-dragging');
  draggedView = null;
  if (!soclesVisible) document.querySelectorAll('#hexGrid .hex .socle').forEach(base => {
    base.style.opacity = base.closest('.hex').classList.contains('occupied') ? '1' : '0';
  });
}

// Both Phaser gestures and external HTML drops submit the same placement command.
// Only this command spends movement, changes occupants, logs and saves the result.
export function placeDraggedEntity(entite, dropHex) {
  if (!canDrag(entite) || !dropHex?.isConnected) return false;
  const draggedElement = document.getElementById(`Box_Entite_${entite.id}`);
  const originalParent = getEntityBoardHex(entite);
  if (!draggedElement?.isConnected || !originalParent) return false;
  const originalHexPosition = getBoardCell(originalParent)?.id;
  const isAdminMode = adminPlacement();
  if (!isAdminMode && getBoardCell(dropHex)?.side === 'SideB') return false;

  const previousRole = entite.role;
  const existingElement = getFootprintOccupant(dropHex, draggedElement);
  const swappedEntite = existingElement && entites.find(e => String(e.id) === existingElement.id.replace('Box_Entite_', ''));
  if (existingElement && (!swappedEntite || swappedEntite.side !== entite.side)) return false;
  if (swappedEntite) dropHex = getEntityBoardHex(swappedEntite);
  const targetHexPosition = getBoardCell(dropHex)?.id;
  const isEffectiveHexMove = originalHexPosition !== targetHexPosition;
  const requests = [{ entity: entite, hex: dropHex }];
  if (swappedEntite) requests.push({ entity: swappedEntite, hex: originalParent });
  const plan = planEntityPlacements(requests, { allowGroundConsumables: !isAdminMode, allowedCell: (_entity, cell) => isAdminMode || cell.side !== 'SideB' });
  if (!plan.valid) { EffectMessage(entite, 'Placement impossible !'); return false; }
  let movementCheck = null;
  if (isEffectiveHexMove && !isAdminMode) {
      if (isEntityMovementBlocked(entite)) { EffectMessage(entite, 'Immobilisé !'); return false; }
      const shift = ensureMovementState(entite);
      if (!shift || shift.current == null || Number(shift.current) < 1) {
          if (gameStarted) recordEntityCombatAmount(entite, 'blockedMovements', 1);
          EffectMessage(entite, 'Déplacement impossible !'); return false;
      }
      movementCheck = consumeEntityMovement(entite, 1);
      if (movementCheck.allowed) updateMovementDisplay(entite);
      if (!movementCheck.allowed) { EffectMessage(entite, 'Déplacement impossible !'); return false; }
      if (gameStarted && movementCheck.weightResistance?.canceled) recordEntityCombatProc(entite, movementCheck.weightResistance.kind);
  }
  if (!commitEntityPlacements(plan, { animate: Boolean(swappedEntite), persist: true })) return false;
  if (isEffectiveHexMove) {
      if (!isAdminMode) {
          if (gameStarted) recordEntityCombatMovement(entite, { marathon: movementCheck?.reason === 'marathon', negative: movementCheck?.consumed && movementCheck.movement.current < 0 });
          battleLogs(swappedEntite ? 'entity_swap_move' : 'entity_move', { entity: entite, target: swappedEntite, from: originalHexPosition, to: targetHexPosition, previousRole, newRole: entite.role, movementCheck });
          EffectMessage(entite, movementCheck?.reason === 'marathon' ? 'Marathon !' : 'Déplacement !');
          saveEntityMovementState(entite);
      }
      updateMovementDisplay(entite);
      notifyProjectileTargetMoved(entite, null, 'player');
      if (swappedEntite) {
          if (!isAdminMode && gameStarted) recordEntityCombatMovement(swappedEntite, { forced: true });
          updateMovementDisplay(swappedEntite);notifyProjectileTargetMoved(swappedEntite, null, 'player');
      }
  }


  notifyCombatAction();
  return true;
}

// During a touch gesture the Phaser canvas temporarily captures its surface.
// The first HTML element underneath still decides which hitbox/cell is pointed at.
const boardHitAt = (x, y) => document.elementsFromPoint(x, y).find(node => !node.closest('#phaser-projectiles'));
function pickDragView(x, y) {
  if (globalThis.__combatSimulation || isCombatInteractionBlocked()) return null;
  const hit = boardHitAt(x, y);
  if (hit?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return null;
  const sprite = hit?.closest('#hexGrid .sprite');
  const box = sprite?.closest('[id^="Box_Entite_"]'), entity = entityForBox(box);
  const source = entity && document.getElementById(`spriteCanvas_${entity.id}`);
  if (!canDrag(entity) || !source) return null;
  return { entity, sprite, box, source, grid: box.closest('#hexGrid'), origin: getBoardCell(getEntityBoardHex(entity))?.id };
}
const dragHooks = {
  pick: pickDragView,
  valid: view => canDrag(view.entity) && entityForBox(view.box) === view.entity && view.box.isConnected && view.source.isConnected
    && getBoardCell(getEntityBoardHex(view.entity))?.id === view.origin,
  begin(view) {
    if (!this.valid(view)) return false;
    draggedView = view; beginDragHelperCleanup();
    view.sprite.classList.add('dragged'); view.grid.classList.add('phaser-dragging');
    // End the existing long-press inspection without synthesizing a native drag.
    view.sprite.dispatchEvent(new Event('entityDragStarted', { bubbles: true }));
    if (!soclesVisible && !isCombatPaused()) view.grid.querySelectorAll('.hex:not(.occupied) .socle')
      .forEach(base => { base.style.opacity = '1'; });
    return true;
  },
  move(_view, x, y) { updateDragHexHover(boardHitAt(x, y)?.closest('#hexGrid .hex') || null); },
  drop(view, x, y) {
    if (this.valid(view)) placeDraggedEntity(view.entity, boardHitAt(x, y)?.closest('#hexGrid .hex'));
  },
  end: finishDragHexFeedback,
};

// HTML inventory and admin panels keep their native payloads. They share the
// placement command, while gestures originating on a ready board belong to Phaser.
// Disable the browser's competing drag before its mousedown/touchstart. New
// event-spawned monsters are covered without rebinding their individual nodes.
document.addEventListener('pointerdown', event => {
  if (!isPhaserBoardDragReady()) return;
  const box = event.target.closest?.('#hexGrid .drag-box');
  if (!box) return;
  box.draggable = false;
  box.querySelectorAll('[draggable="true"]').forEach(node => { node.draggable = false; });
}, true);
document.addEventListener('dragstart', event => {
  const sprite = event.target.closest?.('#hexGrid .sprite, #hexGrid .drag-box');
  if (!sprite) return;
  const box = sprite.closest('[id^="Box_Entite_"]'), entity = entityForBox(box);
  if (!canDrag(entity) || isPhaserBoardDragReady()) {
    event.preventDefault();
    if (!draggedView) endDragHelperCleanup();
    return;
  }
  event.dataTransfer?.setData('text', box.id);
}, true);
document.addEventListener('dragover', event => {
  if (isCombatInteractionBlocked()) return;
  const hex = event.target.closest?.('#hexGrid .hex');
  if (hex) event.preventDefault();
  updateDragHexHover(hex || null);
});
document.addEventListener('dragend', finishDragHexFeedback);
document.addEventListener('drop', event => {
  const hex = event.target.closest?.('#hexGrid .hex');
  if (!hex || isCombatInteractionBlocked() || !event.dataTransfer) return;
  event.preventDefault();
  try {
    const json = event.dataTransfer.getData('application/json');
    if (json) {
      if (!adminPlacement()) return;
      const data = JSON.parse(json);
      const entity = enrichEntityStats({ ...data, id: generateUniqueID(), side: 'B', level: data.level || 1, position: hex.dataset.position });
      void spawnEntiteIngame(entity).catch(error => console.warn(error.message));
    } else {
      placeDraggedEntity(entityForBox(document.getElementById(event.dataTransfer.getData('text'))), hex);
    }
  } finally { finishDragHexFeedback(); }
});

function prepareBoardDrag() {
  if (globalThis.__combatSimulation || !document.getElementById('hexGrid')) return;
  void configurePhaserBoardDrag(dragHooks).catch(error => console.warn('[BoardDrag]', error));
}
// Stage rebuilds and event summons need no individual drag listeners.
new MutationObserver(records => {
  if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1
    && (node.id === 'hexGrid' || node.querySelector?.('#hexGrid'))))) prepareBoardDrag();
  if (draggedView && !dragHooks.valid(draggedView)) cancelPhaserBoardDrag();
}).observe(document.body, { childList: true, subtree: true });

export function restoreEntityDragAndDrop() {
  cancelPhaserBoardDrag(); finishDragHexFeedback(); endDragHelperCleanup();
  document.querySelectorAll('#hexGrid.phaser-dragging, #hexGrid .dragged').forEach(node => node.classList.remove('phaser-dragging', 'dragged'));
  prepareBoardDrag();
}
queueMicrotask(prepareBoardDrag);
