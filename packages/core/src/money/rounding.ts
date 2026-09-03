/**
 * Integer division with explicit rounding.
 *
 * All money arithmetic that cannot be expressed as exact integer operations routes
 * through here, so rounding is always a deliberate, named choice rather than whatever
 * the language happens to do.
 *
 * Rounding operates on magnitudes, so HALF_UP means "half away from zero"
 * (-2.5 -> -3), which is the convention accountants expect.
 */

export const RoundingMode = {
  /** Toward zero. 2.9 -> 2, -2.9 -> -2 */
  DOWN: "DOWN",
  /** Away from zero. 2.1 -> 3, -2.1 -> -3 */
  UP: "UP",
  /** Nearest; ties away from zero. 2.5 -> 3, -2.5 -> -3. Default. */
  HALF_UP: "HALF_UP",
  /** Nearest; ties to even. 2.5 -> 2, 3.5 -> 4. Minimises cumulative bias. */
  HALF_EVEN: "HALF_EVEN",
} as const;

export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/**
 * Divide `numerator` by `denominator`, rounding per `mode`.
 * Sign is applied after rounding the magnitudes, so behaviour is symmetric about zero.
 */
export function divideRound(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = RoundingMode.HALF_UP,
): bigint {
  if (denominator === 0n) {
    throw new RangeError("Money: division by zero");
  }

  const isNegative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;

  const quotient = a / b;
  const remainder = a % b;

  let magnitude: bigint;
  if (remainder === 0n) {
    magnitude = quotient;
  } else {
    switch (mode) {
      case RoundingMode.DOWN:
        magnitude = quotient;
        break;
      case RoundingMode.UP:
        magnitude = quotient + 1n;
        break;
      case RoundingMode.HALF_UP:
        magnitude = remainder * 2n >= b ? quotient + 1n : quotient;
        break;
      case RoundingMode.HALF_EVEN: {
        const twice = remainder * 2n;
        if (twice > b) magnitude = quotient + 1n;
        else if (twice < b) magnitude = quotient;
        else magnitude = quotient % 2n === 0n ? quotient : quotient + 1n;
        break;
      }
    }
  }

  return isNegative ? -magnitude : magnitude;
}
