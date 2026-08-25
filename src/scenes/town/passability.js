// A road you cannot walk down is not a road.
//
// The Ancient City's walls and the road network are laid by different passes
// that do not consult each other, so where the approach to the Eldertree runs
// through the city, wall collision closes the carriageway. Measured on the
// finished map: at dy -812 the road is 22 cells wide and ONE of them is free —
// an 88-unit road with a 4-unit gap in it. Six more latitudes sit under 35%
// free. Nothing is sealed outright, which is exactly why it went unnoticed: the
// player can technically thread it, and simply reads the road as blocked.
//
// The fix carves a gate rather than deleting the wall. Each offending solid is
// replaced by the parts of itself that are NOT over road paint, so the wall
// still stops you everywhere it should and stops pretending to be a gate only
// where a road passes through it. That matches what the art already says — the
// pack ships city_wall_gap and city_wall_door, so an opening is clearly the
// intent; it is the collision box that never got the message.
//
// Deliberately narrow. It only touches solids that are already MOSTLY over
// road, so a building that merely clips a kerb keeps its full box, and it runs
// after buildTown because the roads, the city and the plaza are all built by
// separate passes and only the finished scene knows where they landed.
//
// The real fix belongs in whichever pass places those walls, by routing the
// road through a gate tile. This is a guard, not a substitute for that.

const CELL = 4;                     // road coverage granularity

export function openRoadGates(scene, opts = {}) {
  const cov = scene.roadCov;
  if (!cov || !cov.size || !scene.solids) return null;
  const minOnRoad = opts.minOnRoad != null ? opts.minOnRoad : 0.5;

  const onRoad = (x, y) => cov.has(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));

  const kept = [];
  let carved = 0, removed = 0;

  for (const s of scene.solids) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || s.w <= 0 || s.h <= 0) { kept.push(s); continue; }

    // How much of this box stands on road paint?
    let hits = 0, total = 0;
    for (let y = s.y; y < s.y + s.h; y += CELL) {
      for (let x = s.x; x < s.x + s.w; x += CELL) { total++; if (onRoad(x, y)) hits++; }
    }
    if (!total || hits / total <= minOnRoad) { kept.push(s); continue; }

    // Keep only the columns of the box that are clear of road paint. A column
    // counts as road if ANY of its rows is road, so the gate is cut the full
    // depth of the wall rather than leaving a lip to catch on.
    const runs = [];
    let run = null;
    for (let x = s.x; x < s.x + s.w; x += CELL) {
      let road = false;
      for (let y = s.y; y < s.y + s.h; y += CELL) if (onRoad(x, y)) { road = true; break; }
      if (road) { run = null; continue; }
      if (run) run.x1 = Math.min(s.x + s.w, x + CELL);
      else { run = { x0: x, x1: Math.min(s.x + s.w, x + CELL) }; runs.push(run); }
    }

    if (!runs.length) { removed++; continue; }        // wall sits wholly on the road
    carved++;
    for (const r of runs) kept.push({ x: r.x0, y: s.y, w: r.x1 - r.x0, h: s.h });
  }

  const before = scene.solids.length;
  scene.solids = kept;
  return { before, after: kept.length, carved, removed };
}
