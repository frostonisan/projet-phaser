import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardGeometry, createBoardState, footprintCells, footprintCenter, chooseFootprintRole,
  putBoardOccupant, removeBoardOccupant, boardOccupantsAt, applyBoardPlacements, snapshotBoardState,
  offsetToAxial, axialDistance, createBoardLayout, restoreBoardState } from '../docs/js/board/model.js';
import { planBoardPlacements, planBoardDeployment } from '../docs/js/board/placementRules.js';
const geometry = (rows=5,cols=7) => createBoardGeometry(Array.from({length:rows*cols},(_,i)=>{
  const row=Math.floor(i/cols),col=i%cols;
  return {id:`${row}:${col}`,row,col,x:col*70+(row%2?35:0),y:row*60};
}));
const occupant=(state,id,anchor,size=1)=>putBoardOccupant(state,{id,anchor,size,movable:true,members:footprintCells(state.geometry,anchor,size)});
const dump=state=>JSON.stringify(snapshotBoardState(state));

test('logical board works without DOM, storage or random rolls',()=>{
  assert.equal(typeof document,'undefined');
  const original=Math.random;
  try {
    Math.random=()=>{throw Error('No random placement');};
    const state=createBoardState(geometry());occupant(state,'a','2:1');occupant(state,'b','2:2');
    const before=dump(state),plan=planBoardPlacements(state,[{id:'a',anchor:'2:2'}],{push:true});
    assert.equal(plan.valid,true);assert.deepEqual(plan.pushed,['b']);assert.equal(dump(state),before);
    assert.ok(plan.moves.get('b').anchor!=='2:2');
  } finally {Math.random=original;}
});

test('odd and even rows keep their axial footprint and distance',()=>{
  const grid=geometry();
  assert.deepEqual(footprintCells(grid,'0:1',3),['0:1','0:2','1:1']);
  assert.deepEqual(footprintCells(grid,'1:1',3),['1:1','1:2','2:2']);
  assert.deepEqual(footprintCells(grid,'4:6',6),[]);
  assert.equal(axialDistance(offsetToAxial(0,1),offsetToAxial(1,1)),1);
  assert.equal(axialDistance(offsetToAxial(1,1),offsetToAxial(2,2)),1);
  assert.deepEqual(footprintCenter(grid,['0:0','0:1']),{x:35,y:0});
});

test('invalid, overlapping and forbidden requests never reserve cells',()=>{
  const state=createBoardState(geometry()),before=dump(state);
  for(const requests of [[],[{id:'a',anchor:'0:0',size:4}], [{id:'a',anchor:'4:6',size:6}],
    [{id:'a',anchor:'0:0'},{id:'b',anchor:'0:0'}]]) {
    assert.equal(planBoardPlacements(state,requests).valid,false);assert.equal(dump(state),before);
  }
  assert.equal(planBoardPlacements(state,[{id:'a',anchor:'0:0'}],{allowedCell:()=>false}).valid,false);
  assert.equal(dump(state),before);
});

test('swaps publish a complete occupancy with no reservation left behind',()=>{
  const state=createBoardState(geometry());occupant(state,'a','0:0',2);occupant(state,'b','2:3',2);
  const plan=planBoardPlacements(state,[{id:'a',anchor:'2:3',size:2},{id:'b',anchor:'0:0',size:2}]);
  assert.equal(plan.valid,true);assert.equal(applyBoardPlacements(state,plan),true);
  assert.deepEqual(boardOccupantsAt(state,'0:1').map(o=>o.id),['b']);
  assert.deepEqual(boardOccupantsAt(state,'2:4').map(o=>o.id),['a']);
  assert.equal([...state.byCell.values()].every(ids=>ids.size===1),true);
});

test('manual movement may enter ground consumables, never solid objects',()=>{
  const state=createBoardState(geometry());
  putBoardOccupant(state,{id:'drop',anchor:'0:0',size:1,members:['0:0'],movable:false,groundConsumable:true});
  const request=[{id:'a',anchor:'0:0'}];
  assert.equal(planBoardPlacements(state,request,{push:true}).valid,false);
  assert.equal(planBoardPlacements(state,request,{allowGroundConsumables:true}).valid,true);
  putBoardOccupant(state,{id:'wall',anchor:'0:0',size:1,members:['0:0'],movable:false});
  assert.equal(planBoardPlacements(state,request,{allowGroundConsumables:true,push:true}).valid,false);
});

test('a crowded board fails as a whole and deterministic pushes respect zones',()=>{
  const full=createBoardState(geometry(1,2));occupant(full,'a','0:0');occupant(full,'b','0:1');
  const before=dump(full);
  assert.equal(planBoardPlacements(full,[{id:'new',anchor:'0:0'}],{push:true}).valid,false);
  assert.equal(dump(full),before);
  const state=createBoardState(geometry());occupant(state,'a','2:1');occupant(state,'b','2:2');
  const options={push:true,allowedCell:(id,cell)=>id!=='b'||cell==='2:3'};
  const first=planBoardPlacements(state,[{id:'a',anchor:'2:2'}],options);
  assert.equal(first.moves.get('b').anchor,'2:3');
  assert.deepEqual(planBoardPlacements(state,[{id:'a',anchor:'2:2'}],options),first);
});

test('removing an occupant frees its entire group but preserves other reservations',()=>{
  const state=createBoardState(geometry());occupant(state,'a','1:1',6);
  putBoardOccupant(state,{id:'drop',anchor:'1:1',members:['1:1'],movable:false,groundConsumable:true});
  removeBoardOccupant(state,'a');
  assert.deepEqual(boardOccupantsAt(state,'1:1').map(o=>o.id),['drop']);
  assert.equal(state.byCell.size,1);removeBoardOccupant(state,'drop');assert.equal(state.byCell.size,0);
});

test('snapshots are detached plain values and rebuild the same logical decisions',()=>{
  const state=createBoardState(geometry());occupant(state,'a','2:1',3);
  const snapshot=snapshotBoardState(state),roundtrip=JSON.parse(JSON.stringify(snapshot));
  const restored=restoreBoardState(roundtrip);
  const request=[{id:'new',anchor:'2:1'}];
  assert.deepEqual(planBoardPlacements(restored,request,{push:true}),planBoardPlacements(state,request,{push:true}));
  snapshot.occupants[0].members.length=0;snapshot.cells[0].x=-999;
  assert.equal(state.occupants.get('a').members.length,3);assert.equal(state.geometry.cells[0].x,0);
});

test('role ties preserve the previous role and otherwise use the original stable order',()=>{
  assert.equal(chooseFootprintRole(['tank','mage'],'mage'),'mage');
  assert.equal(chooseFootprintRole(['tank','mage'],'gueux'),'tank');
  assert.equal(chooseFootprintRole(['mage','mage','tank'],'tank'),'mage');
});

test('combat data builds terrain and deploys both camps without a renderer', () => {
  const state = createBoardState(createBoardLayout({ rows: 7, cols: 15, hexWidth: 70, staggeredRowHeight: 60 }));
  const entities = [{ id: 'a', side: 'A', position: 'hex_1', sizeInCells: 6, role: 'tank' },
    { id: 'b', side: 'B', position: 'hex_1', sizeInCells: 3, role: 'mage' },
    { id: 'c', side: 'A', position: 'absent', sizeInCells: 2, role: ['fantassin'] }];
  const before = dump(state), inputs = JSON.stringify(entities), plan = planBoardDeployment(state, entities);
  assert.equal(plan.valid, true); assert.equal(plan.moves.get('a').anchor, 'hex_1');
  assert.equal(dump(state), before); assert.equal(JSON.stringify(entities), inputs);
  for (const entity of entities) for (const id of plan.moves.get(entity.id).members) {
    assert.ok([`Side${entity.side}`, 'Neutral'].includes(state.geometry.byId.get(id).side));
  }
  applyBoardPlacements(state, plan);
  const restored = restoreBoardState(JSON.parse(dump(state)));
  assert.equal(dump(restored), dump(state));
  assert.deepEqual(planBoardDeployment(restored, entities), planBoardDeployment(state, entities));
  assert.equal(state.geometry.byId.get('hex_16').coordinate, 'A2');
  assert.equal(state.geometry.byId.get('hex_16').x, 35);
  assert.equal(state.geometry.byId.get('hex_35').role, 'tank');
});

test('restoration rejects incomplete footprints, duplicate IDs and solid overlaps', () => {
  const state = createBoardState(geometry()); occupant(state, 'a', '1:1', 6);
  const original = dump(state);
  for (const corrupt of [
    data => data.cells.push({ ...data.cells[0] }),
    data => data.cells[0].x = null,
    data => data.cells[0].row = 'wrong',
    data => data.cells[0].side = 'unknown',
    data => data.cells[0].role = 'unknown',
    data => data.occupants.push({ ...data.occupants[0] }),
    data => data.occupants.push({ ...data.occupants[0], id: 'b' }),
    data => data.occupants[0].members.pop(),
    data => data.occupants[0].anchor = 'absent',
    data => data.occupants[0].size = 4,
  ]) {
    const data = JSON.parse(original); corrupt(data);
    assert.throws(() => restoreBoardState(data), /plateau invalides/); assert.equal(dump(state), original);
  }
});

test('restoration retains drops and solid objects, including beneath a released body', () => {
  const state = createBoardState(geometry()); occupant(state, 'a', '1:1', 6);
  putBoardOccupant(state, { id: 'drop', anchor: '1:1', size: 1, members: ['1:1'], groundConsumable: true });
  putBoardOccupant(state, { id: 'wall', anchor: '4:5', size: 1, members: ['4:5'] });
  assert.equal(dump(restoreBoardState(JSON.parse(dump(state)))), dump(state));
  removeBoardOccupant(state, 'a');
  const restored = restoreBoardState(JSON.parse(dump(state)));
  assert.deepEqual(boardOccupantsAt(restored, '1:1').map(o => o.id), ['drop']);
  assert.equal(boardOccupantsAt(restored, '1:2').length, 0);
  assert.equal(planBoardPlacements(restored, [{ id: 'new', anchor: '4:5' }], { push: true }).valid, false);
});
