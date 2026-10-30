import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kadosh · Gestión",
  description: "Clientes, ventas y envíos, inventario y compras en un solo lugar.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-GT">
      <body className="antialiased">{children}</body>
    </html>
  );
}
