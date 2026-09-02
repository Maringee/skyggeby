import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GameLayout } from '@/layouts/GameLayout';
import { GuestRoute, ProtectedRoute } from '@/components/ProtectedRoute';
import { AssetsPage } from '@/pages/AssetsPage';
import { BusinessesPage } from '@/pages/BusinessesPage';
import { CityPage } from '@/pages/CityPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EconomyPage } from '@/pages/EconomyPage';
import { InformationPage } from '@/pages/InformationPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/LoginPage';
import { MessagesPage } from '@/pages/MessagesPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PropertiesPage } from '@/pages/PropertiesPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { PublicProfilePage } from '@/pages/PublicProfilePage';
import { RegisterPage } from '@/pages/RegisterPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { StatsPage } from '@/pages/StatsPage';
import { StreetPage } from '@/pages/StreetPage';
import { TransactionsPage } from '@/pages/TransactionsPage';
import { VehiclesPage } from '@/pages/VehiclesPage';
import { AuthProvider } from '@/state/AuthContext';

/**
 * Every signed-in page sits under one guarded layout route, so the session
 * check and the navigation exist in exactly one place. A new system becomes a
 * new page plus one entry in `nav/navigation.tsx` - never an addition to an
 * existing page.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route
            path="/"
            element={
              <GuestRoute>
                <LandingPage />
              </GuestRoute>
            }
          />
          <Route
            path="/logg-inn"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />
          <Route
            path="/registrer"
            element={
              <GuestRoute>
                <RegisterPage />
              </GuestRoute>
            }
          />

          {/* Signed in */}
          <Route
            element={
              <ProtectedRoute>
                <GameLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashbord" element={<DashboardPage />} />
            <Route path="/byen" element={<CityPage />} />
            <Route path="/gata" element={<StreetPage />} />
            <Route path="/informasjon" element={<InformationPage />} />
            <Route path="/kjoretoy" element={<VehiclesPage />} />
            <Route path="/okonomi" element={<EconomyPage />} />
            <Route path="/okonomi/inventar" element={<InventoryPage />} />
            <Route path="/okonomi/virksomheter" element={<BusinessesPage />} />
            <Route path="/okonomi/transaksjoner" element={<TransactionsPage />} />
            <Route path="/eiendeler" element={<AssetsPage />} />
            <Route path="/eiendom" element={<PropertiesPage />} />
            <Route path="/meg" element={<ProfilePage />} />
            <Route path="/spiller/:username" element={<PublicProfilePage />} />
            <Route path="/meg/ferdigheter" element={<SkillsPage />} />
            <Route path="/meg/kontakter" element={<ContactsPage />} />
            <Route path="/meg/statistikk" element={<StatsPage />} />
            <Route path="/meldinger" element={<MessagesPage />} />
            <Route path="/innstillinger" element={<SettingsPage />} />
          </Route>

          <Route path="/hjem" element={<Navigate to="/dashbord" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
