import { useCallback, useRef } from "react";

/**
 * Encapsulates pinch-zoom, pan/drag, and swipe gesture logic for the lightbox.
 */
export function useLightboxGestures({
  zoomScale,
  setZoomScale,
  panOffset,
  setPanOffset,
  lightboxIndex,
  totalImages,
  setLightboxIndex,
}: {
  zoomScale: number;
  setZoomScale: React.Dispatch<React.SetStateAction<number>>;
  panOffset: { x: number; y: number };
  setPanOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  lightboxIndex: number | null;
  totalImages: number;
  setLightboxIndex: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOffsetStart = useRef({ x: 0, y: 0 });
  const initialPinchDist = useRef<number | null>(null);
  const initialPinchScale = useRef(1);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Mouse drag-to-pan
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomScale <= 1) return;
    e.preventDefault();
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    panOffsetStart.current = { ...panOffset };
  }, [zoomScale, panOffset]);

  const handlePanMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setPanOffset({
      x: panOffsetStart.current.x + (e.clientX - panStart.current.x),
      y: panOffsetStart.current.y + (e.clientY - panStart.current.y),
    });
  }, [setPanOffset]);

  const handlePanMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Combined touch handlers
  const handleCombinedTouchStart = useCallback((e: React.TouchEvent) => {
    // Swipe init
    if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      if (zoomScale > 1) {
        panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        panOffsetStart.current = { ...panOffset };
      }
    }
    // Pinch init
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist.current = Math.hypot(dx, dy);
      initialPinchScale.current = zoomScale;
    }
  }, [zoomScale, panOffset]);

  const handleCombinedTouchMove = useCallback((e: React.TouchEvent) => {
    // Pinch
    if (e.touches.length === 2 && initialPinchDist.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.min(5, Math.max(1, initialPinchScale.current * (dist / initialPinchDist.current)));
      setZoomScale(newScale);
    }
    // Touch pan when zoomed
    if (e.touches.length === 1 && zoomScale > 1 && touchStartX.current !== null) {
      setPanOffset({
        x: panOffsetStart.current.x + (e.touches[0].clientX - panStart.current.x),
        y: panOffsetStart.current.y + (e.touches[0].clientY - panStart.current.y),
      });
    }
  }, [zoomScale, setZoomScale, setPanOffset]);

  const handleCombinedTouchEnd = useCallback((e: React.TouchEvent) => {
    initialPinchDist.current = null;
    // Swipe navigation
    if (zoomScale <= 1 && touchStartX.current !== null && touchStartY.current !== null && lightboxIndex !== null) {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0 && lightboxIndex < totalImages - 1) setLightboxIndex(lightboxIndex + 1);
        else if (dx > 0 && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [lightboxIndex, totalImages, zoomScale, setLightboxIndex]);

  return {
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
    handleCombinedTouchStart,
    handleCombinedTouchMove,
    handleCombinedTouchEnd,
  };
}
