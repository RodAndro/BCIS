import { Sidebar } from '@renderer/components/sidebar';
import { TopBar } from '@renderer/components/top-bar';
import { SystemHealthPanel } from '@renderer/features/system-health/system-health-panel';
import type { JSX } from 'react';

/**
 * Application shell.
 *
 * Phase 1 has exactly one functional screen. There is no router yet: routing
 * is introduced in Phase 2 alongside authentication, because routes and
 * permission guards are the same piece of work. Adding a router now would mean
 * either writing guards with nothing to guard, or writing them twice.
 */
export function App(): JSX.Element {
  return (
    <div className="flex h-full">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />

        <main className="flex-1 overflow-y-auto px-6 py-6">
          <SystemHealthPanel />
        </main>
      </div>
    </div>
  );
}
