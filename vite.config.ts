import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const target = process.env.BEG_API ?? "http://127.0.0.1:17890";

export default defineConfig(({ mode }) => {
  const isTest = mode === "test";
  return {
    root: isTest ? "." : "src/web",
    base: "./",
    plugins: isTest ? [] : [preact()],
    esbuild: isTest ? { jsx: "automatic", jsxImportSource: "preact" } : undefined,
    build: {
      outDir: "../../dist-web",
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          configure: (proxy) => {
            // 服务端校验 Origin 与 Host 同源；dev 页面源是 localhost:5173，需改写成目标地址
            proxy.on("proxyReq", (req) => {
              req.setHeader("origin", target);
            });
          },
        },
      },
    },
  };
});
