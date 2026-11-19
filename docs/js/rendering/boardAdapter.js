// The current HTML board is one adapter for the logical grid and its coordinates.
import { createBoardGeometry, footprintCells, footprintCenter } from '../board/model.js';
const geometryCache = new WeakMap(), cellGeometry = new WeakMap();
let boardScreenGeometry=new WeakMap();
export function invalidateBoardScreenGeometry(grid) {
  if(grid)boardScreenGeometry.delete(grid);else boardScreenGeometry=new WeakMap();
}
// One layout sample per board change, shared by every actor and input adapter.
export function readBoardScreenGeometry(grid) {
  let screen=boardScreenGeometry.get(grid);if(screen)return screen;
  screen=new Map(getBoardGeometry(grid).cells.map(cell=>{
    const rect=cell.getBoundingClientRect();return [cell.dataset.position,{x:rect.left,y:rect.top,w:rect.width,h:rect.height,localW:cell.offsetWidth||1,localH:cell.offsetHeight||1}];
  }));boardScreenGeometry.set(grid,screen);return screen;
}
function cacheGeometry(grid, data) {
  invalidateBoardScreenGeometry(grid);
  geometryCache.set(grid, data);
  for (const hex of data.cells) cellGeometry.set(hex, { grid, data });
  return data;
}
export function getBoundBoardCell(hex) {
  const binding = cellGeometry.get(hex);
  return binding && geometryCache.get(binding.grid) === binding.data ? binding.data.points.get(hex) || null : null;
}
export function getBoardCellView(position, grid = document.getElementById('hexGrid')) {
  return getBoardGeometry(grid)?.byPosition.get(position) || null;
}
export const gridForHex = hex => hex?.closest('.hex-grid, #hexGrid') || hex?.parentElement;
export const readHexCoordinates = hex => ({ row: Number(hex?.dataset.row), col: Number(hex?.dataset.col) });
export { projectBoardCell } from '../board/model.js';
export function invalidateBoardGeometry(grid) { if (grid) geometryCache.delete(grid); }
export function getBoardGeometry(grid) {
  if (!grid) return null;
  let data = geometryCache.get(grid);
  if (data) return data;
  const cells = [...grid.querySelectorAll('.hex[data-position]')];
  const model = createBoardGeometry(cells.map(hex => ({ id: hex.dataset.position,
    ...readHexCoordinates(hex), x: parseFloat(hex.style.left) || 0, y: parseFloat(hex.style.top) || 0,
    coordinate: hex.dataset.coordinate, role: hex.dataset.role || ['tank', 'fantassin', 'mage']
      .find(role => hex.classList.contains(`${role}-role`) || hex.querySelector('.socle')?.classList.contains(role)) || 'gueux',
    side: ['SideA', 'Neutral', 'SideB'].find(side => hex.classList.contains(side)) })));
  data = { cells, model, first: cells[0], byPosition: new Map(cells.map(hex => [hex.dataset.position, hex])),
    points: new Map(cells.map(hex => [hex, model.byId.get(hex.dataset.position)])) };
  return cacheGeometry(grid, data);
}
export function getFootprintElements(anchor, size = 1) {
  if (!anchor?.isConnected) return [];
  const data = getBoardGeometry(gridForHex(anchor));
  return footprintCells(data.model, data.points.get(anchor)?.id, size).map(id => data.byPosition.get(id));
}
export function getFootprintCenter(members) {
  const data = getBoardGeometry(gridForHex(members[0]));
  return footprintCenter(data?.model, members.map(hex => data.points.get(hex)?.id));
}
// A view binds IDs to live entities/DOM only at the renderer boundary.
export function getOccupantView(registry, id) {
  const record = registry.model.occupants.get(String(id));
  if (!record) return null;
  return { ...record, ...registry.views.get(record.id),
    anchor: registry.geometry.byPosition.get(record.anchor),
    members: record.members.map(cell => registry.geometry.byPosition.get(cell)) };
}
export function getPlacementViews(registry, plan, entities) {
  return new Map([...plan.moves].map(([id, move]) => [id, {
    entity: entities.get(id), hex: registry.geometry.byPosition.get(move.anchor), size: move.size,
    members: move.members.map(cell => registry.geometry.byPosition.get(cell)),
    ...('cost' in move ? { cost: move.cost } : {}),
  }]));
}

// Keep existing nodes (canvases, animation keys and listeners), but overwrite their
// spatial metadata from combat data. Missing cells are constructed from that data.
export function renderBoardGeometry(grid, model) {
  const existing = new Map([...grid.querySelectorAll('.hex[data-position]')].map(hex => [hex.dataset.position, hex]));
  const cells = model.cells.map((cell, index) => {
    let hex = existing.get(cell.id);
    if (!hex) {
      hex = document.createElement('div');
      hex.innerHTML = '<div class="socle"><div class="image-role-hex-info"></div><div class="hex-details"><span class="hex-role-detail"></span><span class="hex-number"></span> - <span class="hex-coordinate"></span></div></div>';
    }
    hex.classList.add('hex');
    hex.dataset.position = cell.id;
    for (const key of ['row', 'col', 'coordinate', 'role']) {
      if (cell[key] == null) delete hex.dataset[key]; else hex.dataset[key] = cell[key];
    }
    hex.classList.remove('SideA', 'Neutral', 'SideB', 'tank-role', 'fantassin-role', 'mage-role', 'occupied', 'consommable-summoned');
    delete hex.dataset.occupiedBy; delete hex.dataset.footprintOwner;
    if (cell.side) hex.classList.add(cell.side);
    if (cell.role && cell.role !== 'neutre') hex.classList.add(`${cell.role}-role`);
    const base = hex.querySelector('.socle');
    if (base) { base.classList.remove('tank', 'fantassin', 'mage', 'neutre', 'gueux'); if (cell.role) base.classList.add(cell.role); }
    const label = (selector, value) => { const node = hex.querySelector(selector); if (node) node.textContent = value; };
    label('.hex-role-detail', cell.role && cell.role !== 'neutre' ? cell.role.toUpperCase() : '');
    label('.hex-number', index + 1); label('.hex-coordinate', cell.coordinate || '');
    hex.style.position = 'absolute'; hex.style.left = `${cell.x}px`; hex.style.top = `${cell.y}px`;
    grid.append(hex);
    return hex;
  });
  for (const [id, hex] of existing) if (!model.byId.has(id)) hex.remove();
  const data = { cells, model, first: cells[0], byPosition: new Map(cells.map(hex => [hex.dataset.position, hex])),
    points: new Map(cells.map(hex => [hex, model.byId.get(hex.dataset.position)])) };
  return cacheGeometry(grid, data);
}
