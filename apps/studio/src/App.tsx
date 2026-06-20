import { useCallback, useRef, useState } from "react";
import { phase0Fixture } from "@rn-canvas/fixture";
import { RNFrameRenderer, computePixelDiff, registerAndDiff } from "@rn-canvas/render-web";
import { toPng } from "html-to-image";

type Transform = { x: number; y: number; scale: number };

function loadImageData(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve(data);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

export default function App() {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 80, y: 80, scale: 1 });
  const [simUrl, setSimUrl] = useState<string | null>(null);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [diffScore, setDiffScore] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("Pan: drag · Zoom: scroll/pinch");
  const [busy, setBusy] = useState(false);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    dragRef.current = {
      x: event.clientX - transform.x,
      y: event.clientY - transform.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }, [transform.x, transform.y]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!dragRef.current) return;
    setTransform((prev) => ({
      ...prev,
      x: event.clientX - dragRef.current!.x,
      y: event.clientY - dragRef.current!.y,
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.92 : 1.08;
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(4, Math.max(0.25, prev.scale * delta)),
    }));
  }, []);

  const captureCanvas = useCallback(async () => {
    if (!frameRef.current) return null;
    const dataUrl = await toPng(frameRef.current, { pixelRatio: 2, cacheBust: true });
    setCanvasUrl(dataUrl);
    return dataUrl;
  }, []);

  const captureSim = useCallback(async () => {
    setBusy(true);
    setStatus("Capturing iOS simulator screenshot…");
    try {
      const response = await fetch("/api/sim-screenshot");
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setSimUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setStatus("Simulator screenshot captured.");
      return url;
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Simulator capture failed",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const runDiff = useCallback(async () => {
    setBusy(true);
    setStatus("Running visual diff…");
    try {
      const canvas = canvasUrl ?? (await captureCanvas());
      const sim = simUrl ?? (await captureSim());
      if (!canvas || !sim) {
        setStatus("Need both canvas and simulator screenshots for diff.");
        return;
      }

      const [canvasData, simData] = await Promise.all([
        loadImageData(canvas),
        loadImageData(sim),
      ]);

      // Crop both to the card and resample to a shared size, so the score
      // measures render fidelity rather than the simulator's grey margins.
      const result = registerAndDiff(canvasData, simData, computePixelDiff);
      setDiffScore(result.score);
      setStatus(
        `Fidelity score (card-registered): ${(result.score * 100).toFixed(1)}% ` +
          `(${result.diffPixels}/${result.totalPixels} pixels differ over ${result.width}×${result.height})`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Diff failed");
    } finally {
      setBusy(false);
    }
  }, [canvasUrl, simUrl, captureCanvas, captureSim]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #2a2f3a",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <strong>RN Canvas</strong>
        <span style={{ color: "#9aa0a6", fontSize: 14 }}>Phase 0 spike</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => void captureCanvas()}>
            Snapshot canvas
          </button>
          <button type="button" disabled={busy} onClick={() => void captureSim()}>
            Capture simulator
          </button>
          <button type="button" disabled={busy} onClick={() => void runDiff()}>
            Run diff
          </button>
        </div>
      </header>

      <p style={{ margin: "8px 20px", color: "#9aa0a6", fontSize: 13 }}>{status}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: 16 }}>
        <section>
          <h2 style={{ fontSize: 14, margin: "0 0 8px", color: "#9aa0a6" }}>
            Canvas render (rnw + Yoga WASM) — preview only
          </h2>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            style={{
              height: 360,
              borderRadius: 12,
              border: "1px solid #2a2f3a",
              background:
                "radial-gradient(circle at 1px 1px, #2a2f3a 1px, transparent 0) 0 0 / 20px 20px",
              overflow: "hidden",
              touchAction: "none",
              cursor: "grab",
            }}
          >
            <div
              style={{
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                transformOrigin: "0 0",
                willChange: "transform",
              }}
            >
              <div ref={frameRef} data-frame-root>
                <RNFrameRenderer root={phase0Fixture} />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 14, margin: "0 0 8px", color: "#9aa0a6" }}>
            Simulator screenshot (ground truth)
          </h2>
          <div
            style={{
              height: 360,
              borderRadius: 12,
              border: "1px solid #2a2f3a",
              background: "#151820",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {simUrl ? (
              <img
                src={simUrl}
                alt="Simulator screenshot"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            ) : (
              <span style={{ color: "#666", fontSize: 13 }}>
                Boot the harness app, then click Capture simulator
              </span>
            )}
          </div>
          {diffScore !== null && (
            <p style={{ marginTop: 8, fontSize: 13 }}>
              Match score: <strong>{(diffScore * 100).toFixed(1)}%</strong>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
