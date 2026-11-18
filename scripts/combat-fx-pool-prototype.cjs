// Benchmark response transform only. Never imported by the game.
module.exports = function poolPrototype(source) {
  source = source.replace(/\r\n/g, '\n');
  const replace = (from, to) => {
    if (!source.includes(from)) throw Error('Missing pool prototype anchor: ' + from);
    source = source.replace(from, to);
  };
  replace('function acquireMeleeImpactFx(parent) {', `
const measuredMeleeImpactPool = [];
function acquireMeleeImpactFx(parent) {
  const recycled = measuredMeleeImpactPool.pop();
  if (recycled) {
    if (globalThis.__loadProbe?.active) globalThis.__loadProbe.poolHits++;
    parent.appendChild(recycled);
    return recycled;
  }`);
  replace('  layer.remove();\n}\n\nfunction playMeleeImpactFx',
    '  layer.remove();\n  if (measuredMeleeImpactPool.length < 64 && !measuredMeleeImpactPool.includes(layer)) measuredMeleeImpactPool.push(layer);\n}\n\nfunction playMeleeImpactFx');
  replace('const measuredMeleeImpactPool = [];', `const measuredMeleeImpactPool = [];
const measuredMeleeClonePool = [];
function measuredAcquireClone() {
  const clone = measuredMeleeClonePool.pop();
  if (!clone) return document.createElement('canvas');
  if (globalThis.__loadProbe?.active) {
    globalThis.__loadProbe.poolHits++;
    globalThis.__loadProbe.clonePoolHits = (globalThis.__loadProbe.clonePoolHits || 0) + 1;
  }
  clone.removeAttribute('id'); clone.removeAttribute('class'); clone.removeAttribute('style');
  return clone;
}`);
  replace('clone = saved?.cloneId && document.getElementById(saved.cloneId) || document.createElement("canvas");',
    'clone = saved?.cloneId && document.getElementById(saved.cloneId) || measuredAcquireClone();');
  replace('        clone?.remove();\n        releaseMeleeTrail(trail, true);', `        clone?.remove();
        // Dying clones have a separate asynchronous ending: never recycle them.
        if (clone && !dead && measuredMeleeClonePool.length < 32 && !measuredMeleeClonePool.includes(clone)) {
          clone.getAnimations().forEach(animation => animation.cancel());
          measuredMeleeClonePool.push(clone);
        }
        releaseMeleeTrail(trail, true);`);
  return source;
};
