export const CANCEL_ACTIVE_INTERACTION_EVENT = 'malipdf:cancel-active-interaction';

/**
 * Gives the active page interaction layer the first chance to consume Escape.
 * Returns true when a drawing, text, selection, resize, or pan gesture handled
 * the request, so workspace-level Focus Mode must remain active.
 */
export function requestActiveInteractionCancellation(target: EventTarget): boolean {
  const event = new Event(CANCEL_ACTIVE_INTERACTION_EVENT, { cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}
