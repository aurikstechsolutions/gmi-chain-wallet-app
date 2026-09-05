import React from "react";
import { Image } from "react-native";

type Props = {
  size?: number;
  color?: string; // primary mark
  accentColor?: string; // accent mark
};

export function GmiLogo({ size = 150, color, accentColor }: Props) {
  return (
    <Image
      source={require("../assets/images/gmi-icon.png")}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="GMI logo"
    />
  );
}
