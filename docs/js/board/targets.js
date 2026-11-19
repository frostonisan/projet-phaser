import { getEntityBoardPosition, getEntityBoardHex, getBoardCell, getBoardCellOccupants } from "./controller.js";

// HTML is accepted at the interaction boundary; spatial facts come from combat data.
export const isHexTarget = target => target?.nodeType === 1 && Boolean(getBoardCell(target));
export const getTargetPosition = target => target?.nodeType === 1
  ? getBoardCell(target)?.id ?? null : getEntityBoardPosition(target);

// Current renderer adapter. Combat decisions use getTargetPosition instead.
export function getEntityHex(entity) {
  return isHexTarget(entity) ? entity : getEntityBoardHex(entity);
}
export function getHexEntity(hex, entities, grid) {
  const occupant = getBoardCellOccupants(hex, grid).find(record => record.movable);
  return occupant ? entities.find(entity => String(entity.id) === occupant.id) || null : null;
}
