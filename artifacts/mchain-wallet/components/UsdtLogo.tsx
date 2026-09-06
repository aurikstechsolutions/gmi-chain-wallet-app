import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

export function UsdtLogo({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityLabel="USDT logo">
      <Circle cx="24" cy="24" r="24" fill="#26A17B" />
      <Path
        fill="#FFFFFF"
        d="M27 20.06v-3.58h8.18V11H12.82v5.48H21v3.58c-6.65.31-11.65 1.63-11.65 3.21s5 2.9 11.65 3.21V38h6V26.48c6.64-.31 11.64-1.63 11.64-3.21s-5-2.9-11.64-3.21Zm0 5.44v-.01c-.17.01-1.05.07-3 .07-1.56 0-2.65-.05-3-.07v.01c-6-.27-10.48-1.31-10.48-2.55S15 20.68 21 20.41v4.04c.36.03 1.47.09 3.03.09 1.87 0 2.81-.08 2.97-.09v-4.04c5.99.27 10.47 1.31 10.47 2.54S32.99 25.23 27 25.5Z"
      />
    </Svg>
  );
}