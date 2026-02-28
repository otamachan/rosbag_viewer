import { useEffect, useRef } from "react";
import { renderImageToCanvas } from "../../panels/builtin/ImagePanel.tsx";
import type { DisplayPlugin, SidebarPluginProps } from "../DisplayPlugin.ts";

function ImageSidebar({ message, settings }: SidebarPluginProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderImageToCanvas(canvas, message);
  }, [message]);

  const isCompressed = message.format != null && message.encoding == null;
  const label = isCompressed
    ? ((message.format as string) ?? "")
    : `${(message.width as number) ?? 0}x${(message.height as number) ?? 0} ${(message.encoding as string) ?? ""}`;

  const rotateDeg = Number.parseInt((settings?.rotate as string) ?? "0", 10);

  return (
    <div style={{ padding: "4px 8px" }}>
      <div style={{ overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: "100%",
            imageRendering: "auto",
            display: "block",
            transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
            transformOrigin: "center center",
          }}
        />
      </div>
      <div style={{ fontSize: "10px", color: "#888888", marginTop: "4px" }}>{label}</div>
    </div>
  );
}

export const ImagePlugin: DisplayPlugin = {
  id: "image",
  canHandle: (type) => type === "sensor_msgs/Image" || type === "sensor_msgs/CompressedImage",
  sidebarComponent: ImageSidebar,
  properties: [
    {
      key: "rotate",
      label: "Rotate",
      type: "select",
      options: [
        { value: "0", label: "0\u00B0" },
        { value: "90", label: "90\u00B0" },
        { value: "180", label: "180\u00B0" },
        { value: "270", label: "270\u00B0" },
      ],
      defaultValue: "0",
    },
  ],
};
