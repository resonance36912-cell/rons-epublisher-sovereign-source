// Drop-in <img> replacement that keeps its `src` pointed at a fresh signed
// URL for the lifetime of the element. Use anywhere a chapter-images asset
// is rendered — the auto-refresh scheduler in `signed-image-url.ts` will
// re-sign before expiry and SignedImage will update its src in place.
import { forwardRef, type ImgHTMLAttributes } from "react";
import { useSignedImageUrl } from "@/hooks/use-signed-image-url";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  uiAction?: string;
  projectId?: string;
};

export const SignedImage = forwardRef<HTMLImageElement, Props>(function SignedImage(
  { src, uiAction, projectId, ...rest },
  ref,
) {
  const live = useSignedImageUrl(src ?? undefined, { uiAction, projectId });
  return <img ref={ref} src={live} {...rest} />;
});
