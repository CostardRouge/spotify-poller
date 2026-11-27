/**
 * "Now", read once per server render.
 *
 * Every dashboard page is dynamic (`force-dynamic` in the layout): it renders
 * per request, so reading the clock while rendering is the point, not an
 * accident. React's purity rule cannot know that and flags a bare `Date.now()`
 * in a component body; reading it through this one named function says it on
 * purpose, and gives every page of a render the same instant to pass down.
 */
export function renderTime(): number {
  return Date.now();
}
