import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/state/AuthContext';
import { LoadingScreen } from './LoadingScreen';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { player, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!player) return <Navigate to="/logg-inn" replace state={{ from: location.pathname }} />;

  return <>{children}</>;
}

export function GuestRoute({ children }: { children: ReactNode }) {
  const { player, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (player) return <Navigate to="/dashbord" replace />;

  return <>{children}</>;
}
