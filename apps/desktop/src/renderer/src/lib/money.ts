import { type Centavos, formatCentavos } from '@bcis/shared';

/**
 * Format an amount that arrived from the API.
 *
 * ── THE ONE CAST, AND WHY IT IS SAFE ────────────────────────────────────────
 * `Centavos` is a branded number, and a brand does not survive JSON: the API
 * sends a plain integer. This is the single place the value is re-branded, and
 * it is safe because `centavosSchema` on the API rejected anything that was not
 * a non-negative integer of centavos before it was ever written or returned.
 *
 * The alternative — formatting in each screen with `Number.toFixed` — is how
 * float money gets back into a codebase that spent a phase keeping it out.
 */
export function formatMoney(centavos: number): string {
  return formatCentavos(centavos as Centavos);
}
