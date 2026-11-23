import "./globals.css";
import { IBM_Plex_Sans_KR } from "next/font/google";

const plex = IBM_Plex_Sans_KR({ weight: ["400", "500", "700"], subsets: ["latin"], display: "swap", preload: false });

export const metadata = { title: "prd-interview" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={plex.className}>
      <body>{children}</body>
    </html>
  );
}
