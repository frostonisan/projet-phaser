import { ENTITY_SIZE_OPTIONS, entitySizeInCells, footprintCells, footprintCenter, boardOccupantsAt,
  boardCellDistance, boardFootprintDistance, nearestBoardCell } from './model.js';

// No writes to the board, entities, random state or presentation while searching.
export function planBoardPlacements(state, requests, {
  push = false, allowedCell = () => true, allowGroundConsumables = false,
} = {}) {
  const fail = reason => ({ valid: false, reason });
  if (!requests.length) return fail('Aucun placement.');
  if (!state) return fail('Terrain introuvable.');
  const data = state.geometry, moves = new Map(), fixed = new Set(), collisions = new Set();
  for (const { id: rawId, anchor, size = 1 } of requests) {
    if (!ENTITY_SIZE_OPTIONS.includes(Number(size))) return fail('Taille invalide : 1, 2, 3 ou 6 cases.');
    const members = footprintCells(data, anchor, Number(size)), id = String(rawId);
    if (members.length !== Number(size)) return fail('Le groupement entier doit rester dans les limites du terrain.');
    if (members.some(cell => fixed.has(cell) || !allowedCell(id, cell))) return fail('Les groupements se chevauchent ou traversent une zone interdite.');
    members.forEach(cell => fixed.add(cell));
    moves.set(id, { id, anchor, size: Number(size), members });
  }
  for (const cell of fixed) for (const occupant of boardOccupantsAt(state, cell)) {
    if (moves.has(occupant.id)) continue;
    if (allowGroundConsumables && !occupant.movable && occupant.groundConsumable) continue;
    if (!push || !occupant.movable) return fail('Une case du groupement est déjà occupée.');
    collisions.add(occupant.id);
  }
  if (!collisions.size) return { valid: true, moves, pushed: [], allowGroundConsumables };
  const occupants = [...state.occupants.values()];
  for (const occupant of occupants) if (!moves.has(occupant.id) && !collisions.has(occupant.id)) occupant.members.forEach(cell => fixed.add(cell));
  const displaced = occupants.filter(o => collisions.has(o.id)).sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
  const candidates = displaced.map(occupant => {
    const origin = footprintCenter(data, occupant.members);
    return data.cells.map(cell => {
      const members = footprintCells(data, cell.id, occupant.size);
      if (!members.length || members.some(member => fixed.has(member) || !allowedCell(occupant.id, member))) return null;
      const point = footprintCenter(data, members);
      return { id: occupant.id, anchor: cell.id, size: occupant.size, members,
        cost: (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2 };
    }).filter(Boolean).sort((a, b) => a.cost - b.cost);
  });
  // Same bounded, deterministic nearest-first search as the visible game.
  let nodes = 0, best = null, bestCost = Infinity;
  function search(index, reserved, chosen, cost) {
    if (++nodes > 20000 || cost >= bestCost) return;
    if (index === displaced.length) { best = new Map(chosen); bestCost = cost; return; }
    for (const candidate of candidates[index]) {
      if (nodes > 20000 || cost + candidate.cost >= bestCost) break;
      if (candidate.members.some(cell => reserved.has(cell))) continue;
      const next = new Set(reserved); candidate.members.forEach(cell => next.add(cell));
      chosen.set(displaced[index].id, candidate);
      search(index + 1, next, chosen, cost + candidate.cost);
      chosen.delete(displaced[index].id);
    }
  }
  search(0, fixed, new Map(moves), 0);
  return best ? { valid: true, moves: best, pushed: [...collisions], allowGroundConsumables }
    : fail('Aucun placement complet disponible pour repousser les voisins.');
}

// Initial deployment and terrain resizing share the same data-only allocation.
export function planBoardDeployment(state, entities, { previousCoordinates = new Map(), keepNeutral = false } = {}) {
  if (!state) return { valid: false, reason: 'Terrain introuvable.' };
  const { cells, byId } = state.geometry, moving = new Set(entities.map(entity => String(entity.id)));
  const occupied = new Set(), assignments = new Map();
  for (const record of state.occupants.values()) if (!moving.has(record.id)) record.members.forEach(id => occupied.add(id));
  const side = entity => entity.side === 'A' ? 'SideA' : entity.side === 'B' ? 'SideB' : 'Neutral';
  const allowed = (entity, cell) => cell.side === side(entity) || cell.side === 'Neutral';
  const members = (entity, cell) => footprintCells(state.geometry, cell.id, entitySizeInCells(entity));
  const fits = (entity, cell) => {
    const footprint = members(entity, cell);
    return footprint.length && footprint.every(id => !occupied.has(id) && allowed(entity, byId.get(id)));
  };
  const reserve = (entity, cell) => { assignments.set(entity, cell); members(entity, cell).forEach(id => occupied.add(id)); };
  for (const entity of entities) {
    const cell = byId.get(entity.position);
    const canKeep = cell && (cell.side === side(entity) || (cell.side === 'Neutral' &&
      (keepNeutral || previousCoordinates.get(entity.position)?.side === 'Neutral' || state.occupants.get(String(entity.id))?.anchor === cell.id)));
    if (canKeep && fits(entity, cell)) reserve(entity, cell);
  }
  for (const entity of entities) {
    if (assignments.has(entity)) continue;
    const current = byId.get(entity.position), own = cells.filter(cell => cell.side === side(entity));
    const origin = previousCoordinates.get(entity.position) || current || {
      row: own.reduce((sum, cell) => sum + cell.row, 0) / (own.length || 1),
      col: own.reduce((sum, cell) => sum + cell.col, 0) / (own.length || 1),
    };
    const distance = cell => (cell.col + (cell.row % 2) / 2 - origin.col - (origin.row % 2) / 2) ** 2 + .75 * (cell.row - origin.row) ** 2;
    const available = own.filter(cell => fits(entity, cell)).sort((a, b) => distance(a) - distance(b));
    const roles = (Array.isArray(entity.role) ? entity.role : [entity.role]).map(role => role === 'gueux' ? 'neutre' : role);
    const target = roles.map(role => available.find(cell => cell.role === role)).find(Boolean) || available[0]
      || cells.filter(cell => cell.side === 'Neutral' && fits(entity, cell)).sort((a, b) => distance(a) - distance(b))[0];
    if (!target) return { valid: false, reason: 'Aucun placement complet pour ' + (entity.name || entity.id) };
    reserve(entity, target);
  }
  const byEntity = new Map(entities.map(entity => [String(entity.id), entity]));
  return planBoardPlacements(state, [...assignments].map(([entity, cell]) => ({ id: String(entity.id), anchor: cell.id, size: entitySizeInCells(entity) })),
    { allowedCell: (id, cell) => allowed(byEntity.get(id), byId.get(cell)) });
}

// Effect movement choices share exactly the same geometry and occupancy as placement.
export function adjacentBoardDestinations(state, id) {
  const placement = state?.placements.get(String(id));
  if (!placement) return [];
  return state.geometry.cells.filter(cell => boardCellDistance(state.geometry, placement.anchor, cell.id) === 1
    && planBoardPlacements(state, [{ id: String(id), anchor: cell.id, size: placement.size }]).valid).map(cell => cell.id);
}
export function pullBoardDestination(state, targetId, attackerId, distance = 5) {
  const target = state?.placements.get(String(targetId)), attacker = state?.placements.get(String(attackerId));
  if (!target || !attacker || target.anchor === attacker.anchor) return null;
  const members = position => footprintCells(state.geometry, position.anchor, position.size);
  const attackerCells = members(attacker), separation = boardFootprintDistance(state.geometry, members(target), attackerCells);
  const candidates = state.geometry.cells.filter(cell => cell.id !== target.anchor
    && boardCellDistance(state.geometry, target.anchor, cell.id) <= Math.max(0, Math.floor(distance))
    && boardFootprintDistance(state.geometry, footprintCells(state.geometry, cell.id, target.size), attackerCells) < separation
    && planBoardPlacements(state, [{ id: String(targetId), anchor: cell.id, size: target.size }]).valid).map(cell => cell.id);
  return nearestBoardCell(state, attacker.anchor, candidates, { excludeId: String(targetId) });
}
