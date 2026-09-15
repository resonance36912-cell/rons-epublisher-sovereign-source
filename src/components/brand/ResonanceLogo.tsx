import * as React from "react";

/**
 * <ResonanceLogo />
 * The shared logo lockup. Place a PNG at /public/resonance-lockup.png
 * (or import the asset) and pass it as `src`.
 */
export function ResonanceLogo({
  src = "/resonance-lockup.png",
  height = 28,
  className = "",
  invert = true,
  alt = "The Resonance",
}: {
  src?: string;
  height?: number;
  className?: string;
  invert?: boolean;
  alt?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      style={{ height, width: "auto" }}
      className={`${invert ? "brightness-0 invert" : ""} ${className}`.trim()}
    />
  );
}
