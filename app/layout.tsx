import "./globals.css";
import Link from "next/link";

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>
    <header className="top"><div className="container nav">
      <Link href="/" className="brand">🏈 CFL Pick Pool</Link>
      <nav><Link href="/">Picks</Link><Link href="/standings">Standings</Link><Link href="/login">Login</Link></nav>
    </div></header>
    {children}
  </body></html>;
}