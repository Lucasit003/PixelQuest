// Actor sprite catalog — placeholder so main boots.
//
// main.js imports this module for its side effects, but the real catalog
// (registrations for the hero sheets and the registry they feed) is still
// in flight on the actor/combat side and has not been committed yet. Until
// it lands, the goblin and the slime family render through the small
// self-contained player in gfx/actorSheets.js instead, and this file
// deliberately registers nothing.
export {};
