import { setInterval, clearInterval, clockNow, isCombatPaused } from '../combatClock.js';
import { bindHelperEntity, refreshStatHelper, escape } from './statHelpers.js';
import { cachedResourceUrl } from '../data/loaderList.js';
import { EFFECT_VISUALS } from '../data/effectVisuals.js';

const entries = new Map(), columns = new Map();
let pulse = null;
const fmt = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
const seconds = deadline => Math.max(0, deadline - clockNow()) / 1000;
const duration = value => `${value.toFixed(1).replace('.', ',')} s`;
const actualTick = tick => tick ? `${fmt(tick.hp)} HP · ${fmt(tick.armor)} armure` : '—';
const helperFor = node => document.querySelector(`.stat-hover[data-helper-key="${CSS.escape(node.dataset.helperKey)}"]`);

function sourceMarkup(source) {
  const portrait = source.portrait ? `<img class="effect-source-portrait" src="${escape(cachedResourceUrl(source.portrait))}" alt="">` : '';
  return `${portrait}<span>${escape(source.sourceLabel || 'Source inconnue')}</span>`;
}

function helperHtml(group, now) {
  const sorted = group.entries.slice().sort((a,b) => a.endAt() - b.endAt() || a.key.localeCompare(b.key));
  const read = sorted.map(entry => ({ ...entry.read(), remaining: Math.max(0, entry.endAt() - now) / 1000 }));
  const remaining = Math.max(...read.map(source => source.remaining));
  if (group.kind === 'poison') {
    return `<div class="effect-source-heading">${read.length} source${read.length > 1 ? 's' : ''} active${read.length > 1 ? 's' : ''} · Dernière fin : <strong>${duration(remaining)}</strong></div>`
      + `<table class="effect-source-table"><thead><tr><th>Source</th><th>Reste</th><th>Dernier tick subi</th></tr></thead><tbody>`
      + read.map(source => `<tr><td><div class="effect-source-name">${sourceMarkup(source)}</div><small>${fmt(source.dps)} dégâts/s après Résistance aux altérations · tick de ${fmt(source.interval)} s</small></td><td>${duration(source.remaining)}</td><td>${actualTick(source.lastTick)}</td></tr>`).join('')
      + `</tbody></table><div class="effect-helper-note">Chaque source conserve sa durée et sa cadence. Les dégâts subis distinguent HP et armure.</div>`;
  }
  if (group.kind === 'brulure') {
    const fire = read[0], sources = fire.sources || [];
    return `<div class="effect-source-heading">Feu commun · ${fire.count} apports · ${new Set(sources.map(source => source.attacker)).size} lanceur(s)</div>`
      + `<div class="effect-last-tick">Dernier tick subi : <strong>${actualTick(fire.lastTick)}</strong></div>`
      + `<div>${fmt(fire.dps)} dégâts/s après Résistance aux altérations · tick de ${fmt(fire.interval)} s</div>`
      + `<div class="effect-maintenance">Prochaine baisse : <strong>${duration(seconds(fire.maintenanceAt))}</strong><progress max="1" value="${Math.max(0, Math.min(1, seconds(fire.maintenanceAt) / fire.maintenanceSeconds))}"></progress></div>`
      + `<div>Sans nouvel apport : −${fmt(fire.lossPercent)} % par cycle.<br>Extinction estimée : <strong>${duration(remaining)}</strong></div>`
      + `<table class="effect-source-table"><thead><tr><th>Contributeur</th><th>Apports</th></tr></thead><tbody>`
      + sources.map(source => `<tr><td><div class="effect-source-name">${sourceMarkup(source)}</div></td><td>${source.count}</td></tr>`).join('')
      + `</tbody></table><div class="effect-helper-note">Un apport réussi entretient le feu, sans décaler le prochain tick.</div>`;
  }
  return `<div>Durée restante : <strong>${duration(remaining)}</strong></div>`
    + read.map(source => `<div class="effect-control-source">${read.length > 1 ? `<div class="effect-source-name">${sourceMarkup(source)}<span>${duration(source.remaining)}</span></div>` : ''}${source.html || ''}</div>`).join('');
}

function removeRow(row) { helperFor(row)?.remove(); row.remove(); }

function makeRow(column, group) {
  const row = document.createElement('div');
  row.className = 'attack-nature-effect entity-effect-row';
  row.dataset.stat = 'active-effect'; row.dataset.hover = 'true'; row.dataset.entityEffect = group.kind;
  row.dataset.helperKey = `${column.target.id}-effect-${group.kind}`;
  row.dataset.entityId = String(column.target.id);
  row.dataset.activeEffect = group.label;
  row.dataset.helperClass = 'active-effect-hover entity-effect-hover';
  row.tabIndex = 0; row.setAttribute('role', 'button');
  const visual = EFFECT_VISUALS[group.kind];
  const icon = visual
    ? `<img class="entity-effect-icon" src="${escape(cachedResourceUrl(visual.src))}" alt="" draggable="false">`
    : '<span class="entity-effect-icon" aria-hidden="true"></span>';
  row.innerHTML = `${icon}<span class="entity-effect-count" aria-hidden="true"></span><small class="entity-effect-time"></small>`;
  if (!EFFECT_VISUALS[group.kind]) row.querySelector('.entity-effect-icon').classList.add('picto-stat', group.entries[0].stat || 'neutral');
  row._refreshActiveEffect = () => {
    const current = column.groups.get(group.kind);
    if (!current) return;
    row.dataset.helperText = helperHtml(current, clockNow());
    const helper = helperFor(row);
    if (helper) refreshStatHelper(helper, row, column.target);
  };
  for (const event of ['mouseover', 'focusin']) row.addEventListener(event, row._refreshActiveEffect);
  for (const event of ['click', 'dblclick', 'pointerdown', 'dragstart']) row.addEventListener(event, eventObject => {
    eventObject.stopPropagation();
    if (event === 'dragstart') eventObject.preventDefault();
  });
  bindHelperEntity(row, column.target);
  return row;
}

function renderColumn(column) {
  const { target } = column;
  const host = document.getElementById(`effectsContainer_${target.id}`);
  if (!host) return;
  if (!column.node?.isConnected) {
    column.node = host.querySelector(':scope > .entity-effect-column') || document.createElement('div');
    // Restored scene markup is rebound from effect snapshots, never from saved listeners.
    column.node.replaceChildren(); column.rows = new Map(); column.signature = '';
    column.node.className = 'entity-effect-column';
    column.node.dataset.entityId = String(target.id);
    column.node.setAttribute('aria-label', 'Effets actifs');
    host.append(column.node);
  }
  column.node.dataset.side = target.side === 'B' ? 'B' : 'A';
  const groups = new Map();
  for (const [key, entry] of entries) {
    if (String(entry.target.id) !== String(target.id) || entry.endAt() <= clockNow() || target.isDEAD || target.stats?.HP?.current <= 0) continue;
    const group = groups.get(entry.kind) || { kind: entry.kind, label: entry.label, entries: [], expiresAt: 0, count: 0 };
    group.entries.push({ ...entry, key }); group.expiresAt = Math.max(group.expiresAt, entry.endAt());
    group.count += entry.count?.() ?? 1; groups.set(entry.kind, group);
  }
  column.groups = groups;
  for (const [kind, row] of column.rows) if (!groups.has(kind)) { removeRow(row); column.rows.delete(kind); }
  const ordered = [...groups.values()].sort((a,b) => a.expiresAt - b.expiresAt || a.kind.localeCompare(b.kind));
  const signature = ordered.map(group => group.kind).join('|');
  const positions = signature !== column.signature ? new Map([...column.rows].map(([key,row]) => [key,row.getBoundingClientRect().top])) : null;
  for (const group of ordered) {
    let row = column.rows.get(group.kind);
    if (!row) { row = makeRow(column, group); column.rows.set(group.kind, row); }
    const type = group.entries[0].type;
    if (type === 'dot') row.dataset.dotEffect = group.kind;
    if (type === 'control') row.dataset.controlEffect = group.kind;
    if (type === 'nature') row.dataset.natureEffect = group.kind;
    row.style.setProperty('--effect-color', EFFECT_VISUALS[group.kind]?.color || '#e4d2a6');
    row.dataset.expiresAt = String(group.expiresAt);
    row.dataset.effectCount = String(group.count);
    const count = row.querySelector('.entity-effect-count'); count.hidden = group.count <= 1; count.textContent = group.count;
    const countLabel = group.kind === 'brulure' ? 'apports' : type === 'nature' ? 'cumuls' : 'sources';
    const label = `${group.label}${group.count > 1 ? ` · ${group.count} ${countLabel}` : ''} · ${duration(seconds(group.expiresAt))}${group.kind === 'brulure' ? ' sans nouvel apport' : ''}`;
    row.setAttribute('aria-label', label);
    row.querySelector('small').textContent = duration(seconds(group.expiresAt));
    row.classList.toggle('is-decaying', group.entries.some(entry => entry.decaying?.()));
    if (signature !== column.signature || row.parentElement !== column.node) column.node.append(row);
    if (helperFor(row)) row._refreshActiveEffect();
  }
  if (positions && column.signature && !isCombatPaused() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const [key,row] of column.rows) {
      const offset = positions.get(key) - row.getBoundingClientRect().top;
      if (Number.isFinite(offset) && Math.abs(offset) > 1) row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 140 });
    }
  }
  column.signature = signature;
  if (!ordered.length) { column.node.remove(); columns.delete(String(target.id)); }
}

export function refreshEntityEffectViews(target = null) {
  for (const column of columns.values()) if (!target || String(column.target.id) === String(target.id)) renderColumn(column);
}

export function setEntityEffectView(target, key, entry) {
  entries.set(key, { ...entry, target });
  let column = columns.get(String(target.id));
  if (!column) { column = { target, rows: new Map(), groups: new Map() }; columns.set(String(target.id), column); }
  column.target = target; renderColumn(column);
  if (pulse === null) pulse = setInterval(() => refreshEntityEffectViews(), 250);
}

export function removeEntityEffectView(key) {
  const entry = entries.get(key); entries.delete(key);
  if (entry) refreshEntityEffectViews(entry.target);
  if (!entries.size && pulse !== null) { clearInterval(pulse); pulse = null; }
}

export function clearEntityEffectViews() {
  for (const column of columns.values()) { for (const row of column.rows.values()) removeRow(row); column.node?.remove(); }
  entries.clear(); columns.clear(); clearInterval(pulse); pulse = null;
}
window.addEventListener('entityCombatSideChanged', ({ detail }) => refreshEntityEffectViews(detail.entity));
for (const event of ['battleEnding', 'battleStopped', 'battleResolved', 'stageInterfaceClosing']) window.addEventListener(event, clearEntityEffectViews);
