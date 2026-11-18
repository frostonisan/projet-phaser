// Logical hex geometry and occupancy. Values and IDs only: no elements or entity instances.
export const ENTITY_SIZE_OPTIONS = Object.freeze([1, 2, 3, 6]);
const SHAPES = { 1: [[0, 0]], 2: [[0, 0], [1, 0]], 3: [[0, 0], [1, 0], [0, 1]],
  6: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] };
const key = (q, r) => `${q},${r}`;
export const entitySizeInCells = entity => ENTITY_SIZE_OPTIONS.includes(Number(entity?.sizeInCells)) ? Number(entity.sizeInCells) : 1;
export const offsetToAxial = (row, col) => ({ q: col - (row - (row & 1)) / 2, r: row });
export const axialDistance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

export function createBoardGeometry(input) {
  const cells = input.map(cell => ({ id: String(cell.id), row: Number.isFinite(cell.row) ? cell.row : undefined, col: Number.isFinite(cell.col) ? cell.col : undefined,
    ...(Number.isFinite(cell.row) && Number.isFinite(cell.col) ? offsetToAxial(cell.row, cell.col) : { q: undefined, r: undefined }),
    x: cell.x, y: cell.y,
    side: cell.side, role: cell.role, coordinate: cell.coordinate }));
  const byId = new Map(cells.map(cell => [cell.id, cell]));
  const byAxial = new Map(cells.filter(cell => Number.isFinite(cell.q) && Number.isFinite(cell.r))
    .map(cell => [key(cell.q, cell.r), cell.id]));
  // Build footprints once; planning only reads this cache, including on a restored board.
  const footprints = new Map();
  for (const cell of cells) for (const size of ENTITY_SIZE_OPTIONS) {
    const members = SHAPES[size].map(([q, r]) => byAxial.get(key(cell.q + q, cell.r + r)));
    footprints.set(`${cell.id}:${size}`, size === 1 ? [cell.id] : members.every(Boolean) ? members : []);
  }
  return { cells, byId, footprints };
}

export function footprintCells(geometry, anchor, size = 1) {
  return geometry?.footprints.get(`${anchor}:${size}`) || [];
}

export function footprintCenter(geometry, members) {
  return members.reduce((point, id) => {
    const cell = geometry.byId.get(id);
    return { x: point.x + cell.x / members.length, y: point.y + cell.y / members.length };
  }, { x: 0, y: 0 });
}

export function chooseFootprintRole(roles, previous = 'gueux') {
  const order = ['gueux', 'tank', 'fantassin', 'mage'], counts = new Map(order.map(role => [role, 0]));
  for (const role of roles) counts.set(role, counts.get(role) + 1);
  const winners = order.filter(role => counts.get(role) === Math.max(...counts.values()));
  return winners.includes(String(previous)) ? String(previous) : winners[0];
}

export function createBoardState(geometry) {
  return { geometry, occupants: new Map(), byCell: new Map() };
}

export function removeBoardOccupant(state, id) {
  const record = state.occupants.get(String(id));
  if (!record) return;
  state.occupants.delete(record.id);
  for (const cell of record.members) {
    const ids = state.byCell.get(cell);
    ids?.delete(record.id);
    if (!ids?.size) state.byCell.delete(cell);
  }
}

export function putBoardOccupant(state, input) {
  const record = { id: String(input.id), anchor: input.anchor, size: input.size,
    members: [...input.members], movable: input.movable === true,
    groundConsumable: input.groundConsumable === true };
  removeBoardOccupant(state, record.id);
  state.occupants.set(record.id, record);
  for (const cell of record.members) {
    if (!state.byCell.has(cell)) state.byCell.set(cell, new Set());
    state.byCell.get(cell).add(record.id);
  }
  return record;
}

export function boardOccupantsAt(state, cell) {
  return [...(state?.byCell.get(cell) || [])].map(id => state.occupants.get(id));
}

// Commit the entire validated group before any renderer or gameplay notification runs.
export function applyBoardPlacements(state, plan) {
  if (!plan?.valid) return false;
  for (const move of plan.moves.values()) removeBoardOccupant(state, move.id);
  for (const move of plan.moves.values()) putBoardOccupant(state, { ...move, movable: true });
  return true;
}

export function snapshotBoardState(state) {
  return { cells: state.geometry.cells.map(cell => ({ ...cell })),
    occupants: [...state.occupants.values()].map(record => ({ ...record, members: [...record.members] })) };
}

// Terrain layout is combat data; renderers only project these cells onto a surface.
export const projectBoardCell = (row, col, width = 1, rowHeight = .75) => ({
  x: col * width + (Math.round(row) % 2 ? width / 2 : 0), y: row * rowHeight,
});
export function boardCellRole(row, col, rows, cols) {
  const distance = Math.abs(row - Math.floor(rows / 2));
  const left = Math.floor(cols / 3), right = Math.floor(cols * 2 / 3);
  if (distance <= 2 && (col === left - 1 || col === right)) return 'tank';
  if (distance <= 2 && (col === left - 2 || col === right + 1)) return 'fantassin';
  if (distance <= 1 && (col === left - 3 || col === right + 2)) return 'mage';
  return 'neutre';
}
export function createBoardLayout({ rows, cols, totalHexagons = rows * cols, hexWidth = 1, staggeredRowHeight = .75 }) {
  if (![rows, cols, totalHexagons].every(n => Number.isInteger(n) && n > 0)
    || ![hexWidth, staggeredRowHeight].every(n => Number.isFinite(n) && n > 0)) throw new Error('Dimensions du plateau invalides.');
  const cells = [], sideAWidth = Math.floor(cols * .4), neutralWidth = Math.floor(cols * .2);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols && cells.length < totalHexagons; col++) {
    cells.push({ id: `hex_${cells.length + 1}`, row, col, coordinate: `${String.fromCharCode(65 + col)}${row + 1}`,
      side: col < sideAWidth ? 'SideA' : col < sideAWidth + neutralWidth ? 'Neutral' : 'SideB',
      role: boardCellRole(row, col, rows, cols), ...projectBoardCell(row, col, hexWidth, staggeredRowHeight) });
  }
  return createBoardGeometry(cells);
}

// Rebuild indexes from values, never from a view or serialized runtime Maps.
// Validate before publishing anything: a broken snapshot cannot partially replace a board.
export function restoreBoardState(snapshot) {
  const invalid = () => { throw new Error('Données du plateau invalides.'); };
  if (!Array.isArray(snapshot?.cells) || !snapshot.cells.length || !Array.isArray(snapshot.occupants)) invalid();
  const ids = new Set(), coordinates = new Set();
  for (const cell of snapshot.cells) {
    if (typeof cell.id !== 'string' || !cell.id || ids.has(cell.id)
      || !Number.isFinite(cell.x) || !Number.isFinite(cell.y)) invalid();
    if ((cell.row != null || cell.col != null) && (![cell.row, cell.col].every(n => Number.isInteger(n) && n >= 0))) invalid();
    if (cell.side != null && !['SideA', 'Neutral', 'SideB'].includes(cell.side)) invalid();
    if (cell.role != null && !['neutre', 'gueux', 'tank', 'fantassin', 'mage'].includes(cell.role)) invalid();
    ids.add(cell.id);
    if (Number.isFinite(cell.row) && Number.isFinite(cell.col)) {
      const coordinate = key(cell.row, cell.col);
      if (coordinates.has(coordinate)) invalid();
      coordinates.add(coordinate);
    }
  }
  const state = createBoardState(createBoardGeometry(snapshot.cells.map(cell => ({ ...cell,
    row: cell.row == null ? undefined : cell.row, col: cell.col == null ? undefined : cell.col }))));
  for (const record of snapshot.occupants) {
    if (typeof record.id !== 'string' || !record.id || state.occupants.has(record.id)
      || !ENTITY_SIZE_OPTIONS.includes(record.size) || !ids.has(record.anchor)
      || (record.movable && record.groundConsumable)) invalid();
    const members = footprintCells(state.geometry, record.anchor, record.size);
    if (members.length !== record.size || !Array.isArray(record.members)
      || members.length !== record.members.length || members.some((id, i) => id !== record.members[i])) invalid();
    // A unit may stand on a ground consumable; two solid occupants may not overlap.
    if (!record.groundConsumable && members.some(id => boardOccupantsAt(state, id).some(other => !other.groundConsumable))) invalid();
    putBoardOccupant(state, { ...record, members });
  }
  return state;
}
