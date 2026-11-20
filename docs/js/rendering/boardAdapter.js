// Stable view references survive reconstruction from combat data. Child indexes
// only distinguish siblings with the same tag/class, not unrelated HUD/effect nodes.
export function combatViewReference(node, root = document.body) {
  if (!node || !root.contains(node)) return null;
  const path = [];
  for (let current = node; current && current !== root; current = current.parentElement) {
    if (current.id) return { id: current.id, path };
    if (current.matches('.hex[data-position]')) return { cell: current.dataset.position, path };
    const selector = current.localName + (current.classList[0] ? '.' + CSS.escape(current.classList[0]) : '');
    path.unshift({ selector, index: [...current.parentElement.children].filter(n => n.matches(selector)).indexOf(current) });
  }
  return { path };
}
export function resolveCombatView(reference, root = document.body) {
  if (!reference) return null;
  let node = reference.id ? document.getElementById(reference.id)
    : reference.cell ? document.querySelector(`#hexGrid .hex[data-position="${CSS.escape(reference.cell)}"]`) : root;
  for (const part of reference.path) node = [...(node?.children || [])].filter(n => n.matches(part.selector))[part.index];
  return node || null;
}

// The current HTML board is one adapter for the logical grid and its coordinates.
import { createBoardGeometry, footprintCells, footprintCenter } from '../board/model.js';
const geometryCache = new WeakMap(), cellGeometry = new WeakMap();
let boardScreenGeometry=new WeakMap();
export function invalidateBoardScreenGeometry(grid) {
  if(grid)boardScreenGeometry.delete(grid);else boardScreenGeometry=new WeakMap();
}
// One layout sample per board change, shared by every actor and input adapter.
export function readBoardScreenGeometry(grid) {
  if(grid?._canvasBoardView?.screenCells)return grid._canvasBoardView.screenCells;
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


// The canvas board samples CSS geometry only at layout boundaries. A plane is
// projected from four calibration points, including the existing CSS perspective.
function canvasHomographyFromPoints([p0,p1,p2,p3]) {
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y,den=dx1*dy2-dx2*dy1;
  const g=Math.abs(den)>1e-9?(dx3*dy2-dx2*dy3)/den:0,h=Math.abs(den)>1e-9?(dx1*dy3-dx3*dy1)/den:0;
  return canvasHomography([(p1.x-p0.x+g*p1.x)/128,(p3.x-p0.x+h*p3.x)/128,p0.x,(p1.y-p0.y+g*p1.y)/128,(p3.y-p0.y+h*p3.y)/128,p0.y,g/128,h/128,1]);
}
function canvasHomography(m) {
  const apply=(matrix,x,y)=>{const w=matrix[6]*x+matrix[7]*y+matrix[8];return {x:(matrix[0]*x+matrix[1]*y+matrix[2])/w,y:(matrix[3]*x+matrix[4]*y+matrix[5])/w,w};};
  const [a,b,c,d,e,f,g,h,i]=m,inv=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const project=(x,y)=>apply(m,x,y);project.inverse=(x,y)=>apply(inv,x,y);return project;
}
export function sampleCanvasPlane(node) {
  if(node.matches('img,canvas,svg')){
    const parent=sampleCanvasPlane(node.parentElement),css=getComputedStyle(node),m=new DOMMatrixReadOnly(css.transform==='none'?undefined:css.transform);
    const [ox,oy]=css.transformOrigin.split(' ').map(parseFloat),left=node.offsetLeft||0,top=node.offsetTop||0;
    return (x,y)=>{const p=new DOMPoint(x-ox,y-oy,0,1).matrixTransform(m);return parent(left+ox+p.x/p.w,top+oy+p.y/p.w);};
  }
  const span=128,points=[];
  const markers=[[0,0],[span,0],[span,span],[0,span]].map(([x,y])=>{
    const mark=document.createElement('i');mark.dataset.phaserTheme='';
    mark.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:0;height:0;visibility:hidden;pointer-events:none;transform:none;`;
    node.append(mark);return mark;
  });
  for(const mark of markers){const r=mark.getBoundingClientRect();points.push({x:r.left,y:r.top});}
  markers.forEach(mark=>mark.remove());
  const [p0,p1,p2,p3]=points,dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y,den=dx1*dy2-dx2*dy1;
  const g=Math.abs(den)>1e-9?(dx3*dy2-dx2*dy3)/den:0,h=Math.abs(den)>1e-9?(dx1*dy3-dx3*dy1)/den:0;
  const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x,d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y;
  return canvasHomography([a/span,b/span,p0.x,d/span,e/span,p0.y,g/span,h/span,1]);
}

export async function createCanvasBoard(scene,grid,paint) {
  const roots=new Map(),textures=new Map(),owned=new Set(),dirty=new Set(),restored=new Map();
  const container=grid.closest('#game-container');
  let disposed=false,layoutDirty=true,scanDirty=true,cameraDirty=false,cameraRebase=false,sequence=0;
  const nodeKey=node=>{
    if(node.id)return `id:${node.id}`;
    if(node.matches('.socle'))return `cell:${node.closest('.hex').dataset.position}`;
    if(node.dataset.chestId)return `chest:${node.dataset.chestId}`;
    const surface=['background','ground','foreground-img','foreground-color','swampFog','swampFog2','entity-footprint-overlay'].find(name=>node.classList.contains(name));
    if(surface)return `surface:${surface}`;
    return node.dataset.canvasKey ||= `prop:${paint.now()}:${++sequence}`;
  };
  const capture=()=>[...roots.values()].filter(entry=>entry.node.isConnected).map(entry=>({key:nodeKey(entry.node),epoch:entry.epoch,component:entry.recipe?.capture?.(),assets:entry.recipe?.parts.map(p=>p.asset?performance.now()-p.epoch:null)}));
  const restore=saved=>{for(const value of saved||[])restored.set(value.key,value);for(const entry of roots.values())restoreEntry(entry);};
  const restoreEntry=entry=>{const value=restored.get(nodeKey(entry.node));if(!value)return;entry.epoch=value.epoch;if(entry.recipe){entry.recipe.restore?.(value.component);entry.recipe.parts.forEach((p,i)=>{if(p.asset&&value.assets?.[i]!=null)p.epoch=performance.now()-value.assets[i];});}restored.delete(nodeKey(entry.node));};
  const resizeObserver=new ResizeObserver(()=>{layoutDirty=true;cameraDirty=true;});
  const now=paint.now,clamp=v=>Math.max(0,Math.min(1,v));
  const geometry=new Map(),anchors=new Map(),cameraTransitions=new Set();
  const anchorFor=node=>node.closest('#hexGrid')||node.closest('.foreground')||node.closest('.board')||node.closest('#meteo-fx')||node;
  const plane=node=>{
    if(geometry.has(node))return geometry.get(node);
    const anchor=anchorFor(node);if(!anchors.has(anchor))anchors.set(anchor,{project:sampleCanvasPlane(anchor)});
    const base=anchors.get(anchor),sample=sampleCanvasPlane(node),initial=base.project;
    const local=canvasHomographyFromPoints([[0,0],[128,0],[128,128],[0,128]].map(([x,y])=>{const p=sample(x,y);return initial.inverse(p.x,p.y);}));
    const project=(x,y)=>{const p=local(x,y);return base.project(p.x,p.y);};geometry.set(node,project);return project;
  };
  const screenCells=readBoardScreenGeometry(grid);
  const refreshCamera=()=>{
    for(const [node,anchor] of anchors)if(node.isConnected)anchor.project=sampleCanvasPlane(node);
    const project=anchors.get(grid)?.project;if(!project)return;
    for(const cell of getBoardGeometry(grid).model.cells){const old=screenCells.get(cell.id);if(!old)continue;
      const points=[[0,0],[old.localW,0],[old.localW,old.localH],[0,old.localH]].map(([x,y])=>project(cell.x+x,cell.y+y));
      const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));screenCells.set(cell.id,{...old,x,y,w:Math.max(...points.map(p=>p.x))-x,h:Math.max(...points.map(p=>p.y))-y});
    }
  };
  const cameraEvent=event=>{
    if(!event.target.matches?.('#hexGrid,.board,.board-global,.foreground,#game-container,#game-windows'))return;
    const key=`${event.target.id||event.target.className}:${event.propertyName}`;
    if(event.type==='transitionrun')cameraTransitions.add(key);else {cameraTransitions.delete(key);cameraRebase=true;}cameraDirty=true;
  };
  for(const type of ['transitionrun','transitionend','transitioncancel'])document.addEventListener(type,cameraEvent);

  const imageTexture=async source=>{
    if(!textures.has(source))textures.set(source,(async()=>{
      const image=await paint.media(source);if(disposed)return null;
      const key=`board-image-${++sequence}-${scene.sys.game.getFrame()}`;
      scene.textures.addImage(key,image);owned.add(key);return {key,width:image.naturalWidth,height:image.naturalHeight};
    })());return textures.get(source);
  };
  const length=(value,total,fallback=0)=>value?.endsWith('%')?parseFloat(value)*total/100:Number.isFinite(parseFloat(value))?parseFloat(value):fallback;
  const addMesh=(entry,key,rect,uv=[0,0,1,1],alpha=1,subdivide=false)=>{
    const vertices=[],uvs=[],alphas=[],local=[],project=entry.project;
    const nx=subdivide?Math.max(1,Math.ceil(rect.w/128)):1,ny=subdivide?Math.max(1,Math.ceil(rect.h/128)):1;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const corners=[[i/nx,j/ny],[(i+1)/nx,j/ny],[(i+1)/nx,(j+1)/ny],[i/nx,(j+1)/ny]];
      const points=corners.map(([u,v])=>project(rect.x+u*rect.w,rect.y+v*rect.h));
      if(points.some(p=>p.w<=0)||Math.max(...points.map(p=>p.x))<0||Math.min(...points.map(p=>p.x))>innerWidth
        ||Math.max(...points.map(p=>p.y))<0||Math.min(...points.map(p=>p.y))>innerHeight)continue;
      for(const index of [0,1,2,0,2,3]){const p=points[index],[u,v]=corners[index];vertices.push(p.x,-p.y);local.push(rect.x+u*rect.w,rect.y+v*rect.h);
        uvs.push(uv[0]+u*(uv[2]-uv[0]),uv[1]+v*(uv[3]-uv[1]));
        alphas.push(alpha*(entry.groundMask?clamp((rect.y+v*rect.h)/50):1));}
    }
    if(!vertices.length)return;
    if(entry.batch){entry.batch.vertices.push(...vertices);entry.batch.uvs.push(...uvs);entry.batch.alphas.push(...alphas);entry.batch.local.push(...local);return;}
    const mesh=scene.add.mesh(0,0,key).setDepth(entry.depth).setOrtho(scene.scale.width,scene.scale.height);
    mesh._boardLocal=local;mesh.hideCCW=false;mesh.addVertices(vertices,uvs,null,false,null,0xffffff,alphas);entry.objects.push(mesh);return mesh;
  };
  const clearObjects=entry=>{for(const part of entry.recipe?.parts||[])part.node._canvasNative=false;for(const object of entry.objects)object.destroy();entry.objects=[];for(const sprite of entry.drops?.values()||[]){const key=sprite.texture.key;sprite.destroy();scene.textures.remove(key);owned.delete(key);}entry.drops?.clear();};
  const paintTiles=(entry,time)=>{
    const {image,css,width:w,height:h}=entry;if(!image)return;
    entry.batch={vertices:[],uvs:[],alphas:[],local:[]};
    const size=css.backgroundSize.split(' '),pos=css.backgroundPosition.split(' ');
    let tw=image.width,th=image.height;
    if(size[0]==='cover'||size[0]==='contain'){const ratio=(size[0]==='cover'?Math.max:Math.min)(w/tw,h/th);tw*=ratio;th*=ratio;}
    else if(size[0]!=='auto'){tw=length(size[0],w,tw);th=size[1]&&size[1]!=='auto'?length(size[1],h,th):tw*image.height/image.width;}
    tw=Math.max(1,tw);th=Math.max(1,th);
    let px=length(pos[0],w-tw),py=length(pos[1]||'50%',h-th);
    if(entry.fogDuration){const t=((time-entry.epoch)%entry.fogDuration)/entry.fogDuration;px=-(w-tw)*t;py=-(h-th)*t;}
    const repeatX=css.backgroundRepeat==='repeat'||css.backgroundRepeat==='repeat-x',repeatY=css.backgroundRepeat==='repeat'||css.backgroundRepeat==='repeat-y';
    const x0=repeatX?px-Math.ceil(px/tw)*tw:px,y0=repeatY?py-Math.ceil(py/th)*th:py;
    for(let y=y0;y<h;y+=th){for(let x=x0;x<w;x+=tw){
      const l=Math.max(0,x),t=Math.max(0,y),r=Math.min(w,x+tw),b=Math.min(h,y+th);
      if(r>l&&b>t)addMesh(entry,image.key,{x:l,y:t,w:r-l,h:b-t},[(l-x)/tw,(t-y)/th,(r-x)/tw,(b-y)/th],entry.opacity,true);
      if(!repeatX)break;
    }if(!repeatY)break;}
    const batch=entry.batch;entry.batch=null;
    if(!entry.tileMesh){entry.tileMesh=scene.add.mesh(0,0,image.key).setDepth(entry.depth).setOrtho(scene.scale.width,scene.scale.height);entry.tileMesh.hideCCW=false;entry.objects.push(entry.tileMesh);}
    entry.tileMesh._boardLocal=batch.local;entry.tileMesh.setTexture(image.key).setSize(scene.scale.width,scene.scale.height).setOrtho(scene.scale.width,scene.scale.height).clear();if(batch.vertices.length)entry.tileMesh.addVertices(batch.vertices,batch.uvs,null,false,null,0xffffff,batch.alphas);
    entry.lastPaint=time;
  };
  const sample=async entry=>{
    const node=entry.node,css=getComputedStyle(node);entry.css={backgroundSize:css.backgroundSize,backgroundPosition:css.backgroundPosition,backgroundRepeat:css.backgroundRepeat};
    entry.width=node.offsetWidth;entry.height=node.offsetHeight;entry.opacity=Number(css.opacity);entry.project=plane(node);entry.groundMask=!!node.closest('#ground-fx');
    if(entry.kind==='tiles'){
      const source=css.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
      entry.fogDuration=node.classList.contains('swampFog')?700000:node.classList.contains('swampFog2')?800000:0;
      if(source)entry.image=await imageTexture(source);if(disposed||entry.cancelled)return;paintTiles(entry,now());
    }else if(entry.kind==='footprints'){
      clearObjects(entry);const graphics=scene.add.graphics().setDepth(entry.depth);entry.objects=[graphics];entry.paths=[...node.querySelectorAll('path')].map(path=>({color:parseInt(path.getAttribute('stroke').slice(1),16),points:[...path.getAttribute('d').matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map(m=>m.slice(1).map(Number))}));
    }else if(entry.kind==='weather'){
      if(!entry.weather){entry.weather=scene.add.graphics().setDepth(entry.depth);entry.objects.push(entry.weather);}
    }else if(entry.kind==='image'){
      const image=await imageTexture(node.currentSrc||node.src);if(disposed||entry.cancelled)return;
      entry.width=node.offsetWidth;entry.height=node.offsetHeight;geometry.delete(node);entry.project=plane(node);
      clearObjects(entry);if(image)addMesh(entry,image.key,{x:0,y:0,w:entry.width,h:entry.height},undefined,entry.opacity);
    }else{
      const recipe=await paint.component(node);if(disposed||entry.cancelled){paint.release(recipe);return;}
      paint.release(entry.recipe);entry.recipe=recipe;clearObjects(entry);
      for(const part of recipe.parts){const tex=part.decoration||part.textEntry,asset=part.asset;if(!tex&&!asset)continue;
        const pad=tex?.padding||asset?.padding||0,key=tex?.texture||asset.name;
        const owner={...entry,project:plane(part.node),objects:entry.objects},frame=asset?scene.textures.get(key).get(asset.frameNames?.[0]??0):tex.frame?scene.textures.get(key).get(tex.frame):null;
        part.node._canvasNative=true;part.project=owner.project;part.mesh=addMesh(owner,key,{x:part.x-pad,y:part.y-pad,w:part.w+pad*2,h:part.h+pad*2},frame?[frame.u0,frame.v0,frame.u1,frame.v1]:undefined,1);
      }
    }
    restoreEntry(entry);if(!disposed&&!entry.cancelled)node.dataset.canvasPainted='';
  };
  // Weather keeps its original simulation and RNG. Only the drawing backend
  // changes: particles/ripples are emitted directly into this WebGL scene.
  const paintWeather=entry=>{
    const state=entry.node._combatWeather,g=entry.weather;if(!state||!g)return;
    g.clear();const data=state.snapshot?.()||state,project=entry.project;
    const point=(x,y)=>project(x*entry.width/entry.node.width,y*entry.height/entry.node.height);
    const ellipse=(x,y,rx,ry,color,alpha,stroke=false)=>{
      if(alpha<=0)return;const center=point(x,y);if(center.w<=0)return;
      const edge=point(x+rx,y+ry);const radius=Math.max(Math.abs(edge.x-center.x),Math.abs(edge.y-center.y));
      if(center.x+radius<0||center.x-radius>innerWidth||center.y+radius<0||center.y-radius>innerHeight)return;
      const points=Array.from({length:stroke?40:12},(_,i)=>{const t=i/(stroke?40:12)*Math.PI*2;return point(x+Math.cos(t)*rx,y+Math.sin(t)*ry);});
      const a=clamp(alpha)*(entry.groundMask?clamp(y/50):1)*entry.opacity;
      if(stroke){g.lineStyle(Math.max(.5,Math.abs(point(x+1,y).x-center.x)),color,a);g.strokePoints(points,true);}
      else {g.fillStyle(color,a);g.fillPoints(points,true);}
    };
    if(state.kind==='snowstorm')for(const p of data.elements)ellipse(p.x,p.y,p.size,p.size,0xffffff,p.alpha*.8);
    else if(state.kind==='droplet')for(const p of data.circles)ellipse(p.x,p.y,p.radius,p.radius,0xffffff,p.opacity,true);
    else if(state.kind==='waterDrop')for(const p of data.drops){
      // Cache each blurred droplet once; no canvas upload in the frame loop.
      if(!entry.drops)entry.drops=new Map();let sprite=entry.drops.get(p);
      if(!sprite){const pad=Math.ceil(p.blur*3+2),w=Math.ceil(p.size*2+pad*2),h=Math.ceil(p.size*4+pad*2);
        const canvas=document.createElement('canvas');canvas.width=w*2;canvas.height=h*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.filter=`blur(${p.blur}px)`;ctx.fillStyle=p.color;ctx.beginPath();ctx.ellipse(w/2,h/2,p.size,p.size*2,0,0,Math.PI*2);ctx.fill();
        const key=`board-drop-${++sequence}`;scene.textures.addImage(key,canvas);owned.add(key);sprite=scene.add.image(0,0,key).setDepth(entry.depth);sprite.dropWidth=w;sprite.dropHeight=h;entry.drops.set(p,sprite);
      }
      const c=point(p.x,p.y),r=point(p.x+sprite.dropWidth/2,p.y+sprite.dropHeight/2);sprite.setPosition(c.x,c.y).setDisplaySize(Math.abs(r.x-c.x)*2,Math.abs(r.y-c.y)*2).setAlpha(p.opacity*entry.opacity);
    }
    else if(state.kind==='sunray'){
      if(!entry.rays){entry.rays=scene.add.mesh(0,0,'__WHITE').setDepth(entry.depth).setOrtho(scene.scale.width,scene.scale.height);entry.rays.hideCCW=false;entry.objects.push(entry.rays);}
      const vertices=[],uvs=[],alpha=[];
      for(const p of data.elements){const angle=Math.PI/6,cos=Math.cos(angle),sin=Math.sin(angle);
        for(const [a,b,aa,ab] of [[0,.7,p.opacity,.1],[.7,1,.1,0]]){
          const coords=[[0,a],[1,a],[1,b],[0,b]],points=coords.map(([u,v])=>point(p.x+u*p.width*cos-v*p.length*sin,p.y+u*p.width*sin+v*p.length*cos));
          for(const i of [0,1,2,0,2,3]){vertices.push(points[i].x,-points[i].y);uvs.push(0,0);alpha.push((i<2?aa:ab)*p.opacity*entry.opacity);}
        }
      }
      entry.rays.setSize(scene.scale.width,scene.scale.height).setOrtho(scene.scale.width,scene.scale.height).clear();if(vertices.length)entry.rays.addVertices(vertices,uvs,null,false,null,0xffffff,alpha);
    }
    if(entry.drops)for(const [drop,sprite] of entry.drops)if(!data.drops.includes(drop)){const key=sprite.texture.key;sprite.destroy();scene.textures.remove(key);owned.delete(key);entry.drops.delete(drop);}
  };
  const insert=(node,kind,depth)=>{
    if(roots.has(node))return;
    const entry={node,kind,depth,epoch:now(),objects:[],cancelled:false};roots.set(node,entry);resizeObserver.observe(node);dirty.add(entry);
  };
  const scan=()=>{
    const board=grid.closest('.board'),root=grid.closest('#game-windows')||grid.parentElement;
    for(const node of board?.querySelectorAll(':scope > .background')||[])insert(node,'tiles',-1000);
    for(const node of grid.querySelectorAll(':scope > .ground'))insert(node,'tiles',-900);
    for(const node of grid.querySelectorAll('.entity-footprint-smoke,.battle-element-visual'))if(!node.closest('.entite-box'))insert(node,'component',-80);
    for(const node of grid.querySelectorAll('.entity-footprint-overlay'))insert(node,'footprints',-790);
    for(const node of grid.querySelectorAll('.chest-container,.consommable-container,.ground-loot-remnant'))if(!node.parentElement.closest('.chest-container,.consommable-container,.ground-loot-remnant'))insert(node,'component',-90);
    for(const node of grid.querySelectorAll('.hex > .socle'))insert(node,'component',-800);
    for(const node of grid.querySelectorAll('#ground-fx .swampFog,#ground-fx .swampFog2'))if(node.style.backgroundImage)insert(node,'tiles',-150);
    for(const node of root.querySelectorAll('#meteo-fx canvas,#ground-fx canvas'))insert(node,'weather',node.closest('#ground-fx')?-140:1100);
    for(const node of root.querySelectorAll('.foreground-img'))insert(node,'image',1000);
    for(const node of root.querySelectorAll('.foreground-color'))insert(node,'component',1001);
    for(const [node,entry] of roots)if(!node.isConnected){entry.cancelled=true;resizeObserver.unobserve(node);clearObjects(entry);paint.release(entry.recipe);roots.delete(node);dirty.delete(entry);}
    scanDirty=false;
  };
  const observer=new MutationObserver(records=>{
    for(const record of records){
      const node=record.target.nodeType===1?record.target:record.target.parentElement;
      if(node?.dataset.phaserTheme!==undefined||node?.closest('.entite-box'))continue;
      if(record.type==='childList'){
        if([...record.addedNodes,...record.removedNodes].every(n=>n.nodeType!==1||n.dataset.phaserTheme!==undefined))continue;
        if(!node.closest('.entite-box'))scanDirty=true;
        if(node===grid&&[...record.addedNodes,...record.removedNodes].some(n=>n.nodeType===1&&n.matches('.hex')))layoutDirty=true;
      }
      if(record.type==='attributes'&&['data-canvas-painted','data-canvas-board'].includes(record.attributeName))continue;
      const entry=roots.get(node)||[...roots.values()].find(e=>e.node.contains(node)||node===e.node.parentElement);
      if(entry){dirty.add(entry);geometry.delete(entry.node);for(const part of entry.recipe?.parts||[])geometry.delete(part.node);}
      if(node===grid||node.matches?.('.board,.board-global,.foreground,#game-container,#game-windows'))cameraDirty=true;
    }
  });
  const hover=event=>{for(const entry of roots.values())if(entry.node.contains(event.target)){dirty.add(entry);geometry.delete(entry.node);for(const part of entry.recipe?.parts||[])geometry.delete(part.node);break;}};
  for(const type of ['pointerover','pointerout','focusin','focusout'])grid.addEventListener(type,hover);
  const invalidate=()=>{layoutDirty=true;cameraDirty=true;};
  const update=()=>{
    if(disposed)return;if(!grid.isConnected){destroy();return;}
    if(scanDirty)scan();
    if(layoutDirty){
      const cells=getBoardGeometry(grid).cells,positions=new Set();
      for(const cell of cells){const rect=cell.getBoundingClientRect(),id=cell.dataset.position;positions.add(id);screenCells.set(id,{x:rect.left,y:rect.top,w:rect.width,h:rect.height,localW:cell.offsetWidth||1,localH:cell.offsetHeight||1});}
      for(const id of screenCells.keys())if(!positions.has(id))screenCells.delete(id);
      geometry.clear();anchors.clear();for(const e of roots.values())dirty.add(e);layoutDirty=false;cameraDirty=true;paint.cameraSettled?.();
    }
    for(const entry of [...dirty]){if(entry.busy)continue;dirty.delete(entry);entry.busy=true;
      void sample(entry).catch(error=>console.warn('[CanvasBoard]',error)).finally(()=>entry.busy=false);}
    if(cameraDirty||cameraTransitions.size){
      refreshCamera();
      if(cameraRebase){geometry.clear();anchors.clear();for(const entry of roots.values()){entry.project=plane(entry.node);for(const part of entry.recipe?.parts||[])part.project=plane(part.node);}refreshCamera();cameraRebase=false;paint.cameraSettled?.();}
      for(const entry of roots.values())if(entry.kind==='tiles'&&entry.image)paintTiles(entry,now());
      for(const entry of roots.values())if(!entry.recipe)for(const mesh of entry.objects)if(mesh._boardLocal){
        for(let i=0;i<mesh.vertices.length;i++){const p=entry.project(mesh._boardLocal[i*2],mesh._boardLocal[i*2+1]);mesh.vertices[i].x=p.x;mesh.vertices[i].y=-p.y;}mesh.dirtyCache[9]=-1;
      }
      cameraDirty=false;
    }
    for(const entry of roots.values())if(entry.paths){const g=entry.objects[0];g.clear();for(const path of entry.paths){g.lineStyle(1.5,path.color,1);for(const [x,y,x1,y1] of path.points){const a=entry.project(x,y),b=entry.project(x1,y1);g.lineBetween(a.x,a.y,b.x,b.y);}}}
    for(const entry of roots.values())if(entry.kind==='weather')paintWeather(entry);
    for(const entry of roots.values())if(entry.recipe)for(const part of entry.recipe.parts){
      const mesh=part.mesh;if(!mesh)continue;const motion=entry.recipe.motion(part,now());mesh.setAlpha(motion.alpha).setVisible(motion.visible&&motion.alpha>0);if(!mesh.visible){part.tint?.setVisible(false);continue;}
      const asset=part.asset;if(asset){let elapsed=(performance.now()-part.epoch)%asset.total,index=0;while(index<asset.count-1&&elapsed>=asset.nativeDurations[index])elapsed-=asset.nativeDurations[index++];
        if(part.frame!==index){part.frame=index;const frame=scene.textures.get(asset.name).get(asset.frameNames?.[index]??index);for(let i=0;i<mesh.vertices.length;i++){const [u,v]=[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]][i%6];mesh.vertices[i].setUVs(frame.u0+u*(frame.u1-frame.u0),frame.v0+v*(frame.v1-frame.v0));}}
      }
      const tint=part.node._canvasTint;
      if(tint&&!part.tint){part.tint=scene.add.image(0,0,mesh.texture.key).setDepth(entry.depth+.00001);entry.objects.push(part.tint);}
      if(part.tint){const a=motion.point(part.project(part.x,part.y)),b=motion.point(part.project(part.x+part.w,part.y+part.h));const rgb=tint?.color.split(',').map(Number)||[255,255,255];part.tint.setFrame(part.asset?.frameNames?.[part.frame]??part.frame??'__BASE').setPosition((a.x+b.x)/2,(a.y+b.y)/2).setDisplaySize(Math.abs(b.x-a.x),Math.abs(b.y-a.y)).setTintFill((rgb[0]<<16)|(rgb[1]<<8)|rgb[2]).setAlpha((tint?.opacity||0)*motion.alpha).setVisible(motion.visible&&!!tint);}
      for(let i=0;i<mesh.vertices.length;i++){const p=motion.point(part.project(mesh._boardLocal[i*2],mesh._boardLocal[i*2+1]));mesh.vertices[i].x=p.x;mesh.vertices[i].y=-p.y;}mesh.dirtyCache[9]=-1;
    }
    for(const entry of roots.values())if(entry.fogDuration&&entry.image&&now()-entry.lastPaint>=33)paintTiles(entry,now());
  };
  const destroy=()=>{if(disposed)return;disposed=true;observer.disconnect();resizeObserver.disconnect();for(const type of ['pointerover','pointerout','focusin','focusout'])grid.removeEventListener(type,hover);for(const type of ['transitionrun','transitionend','transitioncancel'])document.removeEventListener(type,cameraEvent);for(const [node,e] of roots){e.cancelled=true;delete node.dataset.canvasPainted;clearObjects(e);paint.release(e.recipe);}roots.clear();for(const key of owned)scene.textures.remove(key);delete grid.dataset.canvasBoard;container?.classList.remove('canvas-board-active');paint.dispose();};
  scan();await Promise.all([...dirty].map(entry=>sample(entry)));dirty.clear();
  grid.dataset.canvasBoard='ready';container?.classList.add('canvas-board-active');
  observer.observe(grid.closest('#game-windows')||grid.parentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','src','d','stroke'],characterData:true});
  return {update,destroy,invalidate,capture,restore,screenCells,connected:()=>!disposed&&grid.isConnected,inspect:()=>({surfaces:roots.size,meshes:[...roots.values()].reduce((n,e)=>n+e.objects.length,0)})};
}
