/*
 * The browser print boundary.
 *
 * A one-function module so the rest of the app has a single, mockable place
 * where control leaves for the operating system.
 *
 * What this cannot do is report whether anything was printed. `window.print()`
 * returns once the dialog closes, and the browser tells us nothing about
 * whether the operator pressed Print or Cancel, whether the printer had label
 * stock, or whether the sticker came out legible. Treating its return as proof
 * of a printed sticker would be a lie the UI then tells staff.
 *
 * So the system keeps two separate facts: **registration persisted**, which is
 * knowable and is what invariant 1 turns on, and **sticker physically
 * printed**, which is not knowable here and stays the operator's judgement,
 * which is why reprint is always available.
 */

/** Opens the browser print dialog for the current document. */
export function printDocument(): void {
  window.print()
}
