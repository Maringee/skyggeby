import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { Alert } from '@/components/Alert';
import { AuthShell } from '@/components/AuthShell';
import { useAuth } from '@/state/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await login({ username, password });
      navigate('/dashbord', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Innloggingen feilet. Prøv igjen.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Logg inn"
      intro="Skriv inn navnet ditt og passordet ditt for å komme tilbake til gata."
      footer={
        <>
          Har du ingen spiller ennå?{' '}
          <Link to="/registrer" className="font-semibold text-blood-400 hover:text-blood-500">
            Opprett en her
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <div>
          <label htmlFor="username" className="label-xs mb-2 block">
            Brukernavn
          </label>
          <input
            id="username"
            name="username"
            className="field"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Ditt kallenavn"
          />
        </div>

        <div>
          <label htmlFor="password" className="label-xs mb-2 block">
            Passord
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="field"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Logger inn ...' : 'Logg inn'}
        </button>
      </form>
    </AuthShell>
  );
}
