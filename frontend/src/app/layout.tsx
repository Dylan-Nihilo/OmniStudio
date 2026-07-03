import "./globals.css";
import EnvConfigChecker from "@/components/EnvConfigChecker";
import { Providers } from "@/components/Providers";
import TauriDragBar from "@/components/layout/TauriDragBar";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className="atelier-dark" suppressHydrationWarning>
      <head>
        <title>LumenX Studio</title>
        <meta name="description" content="AI-Native Motion Comic Creation Platform" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var P=["atelier-dark","bridge-dark","brand-dark","atelier-light","brand-light"];var d=JSON.parse(localStorage.getItem("lumenx-settings")||"{}");var t=d.state&&d.state.theme;document.documentElement.className=P.indexOf(t)>=0?t:"atelier-dark";}catch(e){document.documentElement.className="atelier-dark";}})();`,
          }}
        />
        {/* Tauri desktop: reset font-size to 100% to avoid layout bloat in WKWebView */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(window.__TAURI__){document.documentElement.style.fontSize="87.5%";}`,
          }}
        />
      </head>
      <body className="font-sans bg-background text-foreground antialiased">
        <Providers>
          <TauriDragBar />
          <EnvConfigChecker />
          {children}
        </Providers>
      </body>
    </html>
  );
}
