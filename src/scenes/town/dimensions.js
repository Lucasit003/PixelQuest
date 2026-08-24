// World size and camera zoom.
//
// The map is deliberately larger than the districts need. The margin is
// expansion space and wilderness — somewhere for the town to grow into that
// still reads as a boundary rather than as an edge of the world.
const MAP_W = 3600;
const MAP_H = 4400;

// Town camera zoom: the world is drawn scaled up so the player sees roughly one
// district plus a little of its neighbours, and the character reads at a good
// size. Pure 2D — this only changes framing, not the pixel art.
const ZOOM = 1.6;

export { MAP_W, MAP_H, ZOOM };
