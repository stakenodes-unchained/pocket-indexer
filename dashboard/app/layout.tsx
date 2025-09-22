import './globals.css';

export const metadata = { title: 'Pocket Indexer Dashboard' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="max-w-6xl mx-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-semibold">Pocket Indexer Dashboard</h1>
            <a href="/" className="text-sm text-blue-600 hover:underline">Overview</a>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}

