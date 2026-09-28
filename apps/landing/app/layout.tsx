import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Prompt Registry — Git-Like Prompt Version Control & CI/CD',
  description: 'Stop managing production prompts in loose markdown files or code constants. Version, branch, A/B test, evaluate, and deploy prompts with zero application downtime.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-slate-800 selection:text-white">
        {children}
      </body>
    </html>
  );
}
