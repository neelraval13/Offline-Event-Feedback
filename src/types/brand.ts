/**
 * Nominal ("branded") typing helper.
 *
 * Identifiers in this system are all strings at runtime, but they are not
 * interchangeable: passing a `DeviceId` where a `StationId` is expected is a
 * bug we want the compiler to catch. Branding costs nothing at runtime.
 */
declare const brand: unique symbol

export type Brand<TBase, TBrand extends string> = TBase & {
  readonly [brand]: TBrand
}
