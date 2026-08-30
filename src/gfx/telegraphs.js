// Attack telegraphs — PixelQuest's one warning language.
//
// Colour carries TIME: yellow while the attack is winding up, orange as it
// approaches, and a very brief red edge right before impact. Shape carries
// GEOMETRY: an arc for a melee sweep, a circle for ground AoE, a rectangle
// for a charge or thrust, a thin line for a precision shot. Everything is
// drawn thin and translucent on the ground plane (squashed like the
// engine's shadows) so the enemy's own animation stays the primary tell —
// this layer only annotates it.
//
// A telegraph is { shape, x, y, t, ttl, ... } in world space; the combat
// scene owns the list, ticks it with updateTelegraphs, and draws it under
// the actors.

export function updateTelegraphs(list, dt) {
  for (const t of list) t.t += dt;
  return list.filter((t) => t.t < t.ttl);
}

const SQUASH = 0.55; // ground-plane foreshortening, same family as shadow()

export function drawTelegraphs(g, list) {
  for (const t of list) {
    const frac = t.t / t.ttl;                  // 0 fresh -> 1 impact
    let col, a;
    if (frac < 0.55) { col = '232,200,90'; a = 0.26; }
    else if (frac < 0.86) { col = '235,150,60'; a = 0.34; }
    else { col = '240,72,50'; a = 0.5; }
    if (t.support) { col = '110,190,150'; a = 0.3; } // heals/buffs
    g.save();
    g.translate(Math.round(t.x), Math.round(t.y));
    g.scale(1, SQUASH);
    g.strokeStyle = `rgba(${col},${Math.min(1, a + 0.28)})`;
    g.fillStyle = `rgba(${col},${a * 0.4})`;
    g.lineWidth = 1;
    if (t.shape === 'arc') {
      const flip = t.facing < 0 ? Math.PI : 0;
      g.rotate(flip);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, t.r, -0.8, 0.8);
      g.closePath();
      g.fill();
      g.stroke();
    } else if (t.shape === 'circle') {
      g.beginPath();
      g.arc(0, 0, t.r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else if (t.shape === 'rect') {
      g.rotate(t.ang ?? (t.facing < 0 ? Math.PI : 0));
      g.fillRect(0, -(t.w ?? 8) / 2, t.len, t.w ?? 8);
      g.strokeRect(0, -(t.w ?? 8) / 2, t.len, t.w ?? 8);
    } else if (t.shape === 'line') {
      g.rotate(t.ang ?? 0);
      g.fillRect(0, -0.75, t.len, 1.5);
    }
    g.restore();
  }
}
