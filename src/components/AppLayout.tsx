import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DollarSign, LayoutDashboard, LogOut, Users } from 'lucide-react';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/groups', icon: Users, label: 'Groups' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="container flex h-14 items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-lg">SplitEase</span>
          </Link>

          <nav className="flex items-center gap-1">
            {navItems.map(({ to, icon: Icon, label }) => (
              <Link key={to} to={to}>
                <Button
                  variant={location.pathname === to ? 'secondary' : 'ghost'}
                  size="sm"
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              </Link>
            ))}
            <div className="ml-2 flex items-center gap-2 border-l pl-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.email}
              </span>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        </div>
      </header>

      <main className="container py-6 animate-fade-in">
        {children}
      </main>
    </div>
  );
}
