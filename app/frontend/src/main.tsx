import "@rosbag-viewer/plugins/builtin/index.ts";
import { registerPlugins } from "@rosbag-viewer/plugins/PluginRegistry.ts";
import { createRoot } from "react-dom/client";
import { ParticleCloudPlugin } from "./plugins/ParticleCloudPlugin.ts";

registerPlugins([ParticleCloudPlugin]);

import { App } from "@rosbag-viewer/app/App.tsx";

// biome-ignore lint/style/noNonNullAssertion: root element guaranteed by index.html
createRoot(document.getElementById("root")!).render(<App />);
