import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LIMITS, STARTING_STATS, formatMoney } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { Alert } from '@/components/Alert';
import { AuthShell } from '@/components/AuthShell';
import { useAuth } from '@/state/AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    try {
      await register({ username, password, confirmPassword });
      navigate('/dashbord', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields);
      } else {
        setError('Registreringen feilet. Prøv igjen.');
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <p className="mt-1.5 text-xs text-blood-400">{fieldErrors[name]}</p>
    ) : null;

  return (
    <AuthShell
      title="Opprett spiller"
      intro={`Nye spillere starter med ${formatMoney(STARTING_STATS.cash)} i kontanter og et rykte helt uten flekker.`}
      footer={
        <>
          Har du allerede en spiller?{' '}
          <Link to="/logg-inn" className="font-semibold text-blood-400 hover:text-blood-500">
            Logg inn
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
            maxLength={LIMITS.usernameMax}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Velg et kallenavn"
          />
          {fieldError('username') ?? (
            <p className="mt-1.5 text-xs text-steel-500">
              {LIMITS.usernameMin}–{LIMITS.usernameMax} tegn. Bokstaver, tall, bindestrek og
              understrek.
            </p>
          )}
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {fieldError('password') ?? (
            <p className="mt-1.5 text-xs text-steel-500">
              Minst {LIMITS.passwordMin} tegn.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="label-xs mb-2 block">
            Gjenta passord
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            className="field"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
          {fieldError('confirmPassword')}
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Oppretter ...' : 'Bli med i SKYGGEBY'}
        </button>
      </form>
    </AuthShell>
  );
}
