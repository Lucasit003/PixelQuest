// How large actors DRAW, relative to the size they used to be.
//
// The heroes are authored from high-resolution art. At the old size a hero
// stood 29px tall in town and 28px in combat, which threw away almost every
// pixel of that art — a face, a helmet slit or a belt buckle simply has nowhere
// to live in 29 rows. This bumps actors up so the detail survives.
//
// RENDER ONLY. Nothing here feeds collision, reach, interaction range or any
// combat math — those all use the unscaled world constants and must keep doing
// so. The same rule combat.js already states for its own ACTOR_SCALE.
//
// The world is deliberately NOT zoomed to achieve this. Raising the town camera
// would enlarge the environment art too, upscaling tiles that were authored for
// zoom 1.6 and softening them, and it would shrink how much of the town is
// visible. Scaling only the actors keeps every existing environment asset at
// its authored pixel density.
//
//   1.0  = the old size (hero 29px in town, 28px in combat)
//   1.95 = hero ~56px in both
//   1.59 = hero ~46px in both  <- current, set on direction
export const ACTOR_ZOOM = 1.59;

// Combat previously hard-coded 1.4. Keep that relationship so enemies, the
// boss and the player all move together rather than drifting apart.
export const COMBAT_ACTOR_SCALE = 1.4 * ACTOR_ZOOM;
