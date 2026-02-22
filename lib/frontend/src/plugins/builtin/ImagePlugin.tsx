import { useEffect, useRef } from "react";
import { renderImageToCanvas } from "../../panels/builtin/ImagePanel.tsx";
import type { DisplayPlugin, SidebarPluginProps } from "../DisplayPlugin.ts";

function ImageSidebar({ message }: SidebarPluginProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderImageToCanvas(canvas, message);
  }, [message]);

  const width = (message.width as number) ?? 0;
  const height = (message.height as number) ?? 0;
  const encoding = (message.encoding as string) ?? "";

  return (
    <div style={{ padding: "4px 8px" }}>
      <canvas ref={canvasRef} style={{ maxWidth: "100%", imageRendering: "auto", display: "block" }} />
      <div style={{ fontSize: "10px", color: "#888888", marginTop: "4px" }}>
        {width}x{height} {encoding}
      </div>
    </div>
  );
}

export const ImagePlugin: DisplayPlugin = {
  id: "image",
  canHandle: (type) => type === "sensor_msgs/Image" || type === "sensor_msgs/CompressedImage",
  sidebarComponent: ImageSidebar,
};
