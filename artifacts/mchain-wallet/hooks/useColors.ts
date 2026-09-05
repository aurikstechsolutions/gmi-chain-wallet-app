import colors from "@/constants/colors";

/**
 * Returns the light GMI Wallet design tokens.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * The wallet intentionally uses the light palette on every platform so
 * the web preview and native app have the same appearance.
 */
export function useColors() {
  return {
    ...colors.light,
    radius: colors.radius,
  };
}
