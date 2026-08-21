import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins class names, letting the last conflicting utility win.
 *
 * `clsx` alone would produce `px-4 px-6`, and which one applies then depends on
 * the order Tailwind happened to emit them in rather than on the order the
 * caller wrote them. `twMerge` resolves the conflict the way a reader expects:
 * a caller passing `className="px-6"` to a component whose default is `px-4`
 * gets 24px, every time.
 *
 * This is what makes every V2 component overridable at the call site without
 * needing a prop for each thing somebody might want to change.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
