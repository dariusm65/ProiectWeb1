import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { matchUniversityDomain, UNIVERSITY_BADGE_LABEL_RO } from '../domain/universityDomains.js';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

const QUICK_EXAMPLE_EMAILS = [
  'ioana.popescu@ulbsibiu.ro',
  'andrei.m@stud.ubbcluj.ro',
  'darius@stud.acs.upb.ro',
  'student.test@gmail.com',
];

export function AuthPage() {
  useDocumentMeta({
    title: 'StudRide · Autentificare & Înregistrare Student',
    description:
      'Creează un cont StudRide sau autentifică-te. Domeniile universitare din România primesc badge-ul Validat pe domeniu (nu identitate verificată).',
  });

  const navigate = useNavigate();
  const { login, register, authError } = useAuth();
  const [activeTab, setActiveTab] = useState('register');

  // Register state
  const [fullName, setFullName] = useState('Ioana Popescu');
  const [regEmail, setRegEmail] = useState('ioana.popescu@ulbsibiu.ro');
  const [regPassword, setRegPassword] = useState('ParolaSigura123');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('female');

  // Login state
  const [loginEmail, setLoginEmail] = useState('ioana.popescu@ulbsibiu.ro');
  const [loginPassword, setLoginPassword] = useState('ParolaSigura123');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const matchedUni = matchUniversityDomain(regEmail);

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMsg('');

    const trimmedName = fullName.trim();
    const trimmedEmail = regEmail.trim();
    if (trimmedName.length < 2) {
      setFormError('Numele complet trebuie să conțină minim 2 caractere.');
      return;
    }
    if (!trimmedEmail.includes('@')) {
      setFormError('Te rugăm să introduci o adresă de email validă.');
      return;
    }
    if (regPassword.length < 8) {
      setFormError('Parola trebuie să conțină minim 8 caractere.');
      return;
    }

    setSubmitting(true);
    try {
      const createdUser = await register({
        full_name: trimmedName,
        email: trimmedEmail,
        password: regPassword,
        phone: phone.trim() ? phone.trim() : null,
        gender,
      });
      setSuccessMsg(
        createdUser.has_university_badge
          ? `Cont creat cu succes! Badge-ul ${UNIVERSITY_BADGE_LABEL_RO} a fost atașat profilului tău.`
          : 'Cont standard creat cu succes!',
      );
      navigate('/rides');
    } catch (err) {
      setFormError(err.message || 'Înregistrarea a eșuat. Verifică datele introduse.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccessMsg('');

    if (!loginEmail.trim().includes('@') || !loginPassword) {
      setFormError('Introdu adresa de email și parola pentru autentificare.');
      return;
    }

    setSubmitting(true);
    try {
      await login({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      navigate('/rides');
    } catch (err) {
      setFormError(err.message || 'Adresa de email sau parola nu corespund.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-aside" aria-labelledby="aside-heading">
        <h1 className="aside-title" id="aside-heading">
          Acces transparent pentru comunitatea studențească
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          Oricine își poate crea un cont cu o adresă de email validă. Dacă adresa aparține unui domeniu universitar
          acreditat din România, profilul primește automat badge-ul universitar pe domeniu.
        </p>
        <ul className="policy-list">
          <li className="policy-item">
            <strong>Badge universitar pe domeniu</strong>
            Etichetat explicit ca „{UNIVERSITY_BADGE_LABEL_RO}”. Nu verificăm accesul la căsuța poștală sau actul de
            identitate.
          </li>
          <li className="policy-item">
            <strong>Opțiune privată pentru curse Women-only</strong>
            Genul auto-declarat rămâne privat și este folosit exclusiv pentru eligibilitatea curselor „Women-only”
            (doar conturile cu <strong>Femeie</strong> pot publica sau rezerva).
          </li>
          <li className="policy-item">
            <strong>Reputație dublă din prima zi</strong>
            Fiecare cont nou începe cu scor de seriozitate 100% și rating 1–5 stele acordat doar după finalizarea
            cursei.
          </li>
        </ul>
      </section>

      <section className="auth-card" aria-label="Formular autentificare și înregistrare">
        <div className="tabs" role="tablist" aria-label="Tip acces cont">
          <button
            type="button"
            className="tab-btn"
            id="tab-register"
            role="tab"
            aria-selected={activeTab === 'register'}
            aria-controls="panel-register"
            onClick={() => {
              setActiveTab('register');
              setFormError('');
            }}
          >
            Înregistrare
          </button>
          <button
            type="button"
            className="tab-btn"
            id="tab-login"
            role="tab"
            aria-selected={activeTab === 'login'}
            aria-controls="panel-login"
            onClick={() => {
              setActiveTab('login');
              setFormError('');
            }}
          >
            Autentificare
          </button>
        </div>

        {(formError || authError) && (
          <div className="status-banner error" role="alert">
            <div>
              <strong>Eroare:</strong> {formError || authError?.message}
            </div>
          </div>
        )}

        {successMsg && (
          <div className="status-banner success" role="status" aria-live="polite">
            <div>{successMsg}</div>
          </div>
        )}

        {activeTab === 'register' ? (
          <form
            id="panel-register"
            role="tabpanel"
            aria-labelledby="tab-register"
            onSubmit={handleRegisterSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
          >
            <div className="field">
              <label htmlFor="reg-name">Nume complet</label>
              <input
                id="reg-name"
                className="input"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className="field">
              <label htmlFor="reg-email">Adresă de email</label>
              <input
                id="reg-email"
                className="input"
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                autoComplete="email"
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.25rem' }}>
                {QUICK_EXAMPLE_EMAILS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="chip-btn"
                    onClick={() => setRegEmail(sample)}
                  >
                    @{sample.split('@')[1]}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={matchedUni ? 'domain-detector matched' : 'domain-detector standard'}
              role="status"
              aria-live="polite"
            >
              {matchedUni ? (
                <>
                  <strong style={{ color: 'var(--color-primary-ink)' }}>
                    ✓ {matchedUni.universityName} — {UNIVERSITY_BADGE_LABEL_RO}
                  </strong>
                  <p style={{ color: 'var(--color-text-muted)' }}>
                    Domeniul <strong>@{matchedUni.domain}</strong> este în lista universităților acreditate din
                    România. Badge-ul indică exclusiv potrivirea formatului de domeniu, nu verificarea căsuței de
                    email sau a identității fizice.
                  </p>
                </>
              ) : (
                <>
                  <strong>Cont standard (fără badge universitar)</strong>
                  <p style={{ color: 'var(--color-text-muted)' }}>
                    Te poți înregistra cu orice adresă de email validă. Contul nu va afișa badge-ul „
                    {UNIVERSITY_BADGE_LABEL_RO}”.
                  </p>
                </>
              )}
            </div>

            <div className="field">
              <label htmlFor="reg-phone">Telefon (opțional)</label>
              <input
                id="reg-phone"
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex: 0722 123 456"
              />
            </div>

            <div className="field">
              <label htmlFor="reg-password">Parolă (minim 8 caractere)</label>
              <input
                id="reg-password"
                className="input"
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <fieldset className="gender-group">
              <legend className="field-label">Gen auto-declarat (opțional, privat)</legend>
              <div className="gender-options">
                {[
                  { value: 'female', label: 'Femeie' },
                  { value: 'male', label: 'Bărbat' },
                  { value: 'prefer_not_to_say', label: 'Prefer să nu spun' },
                ].map((opt) => (
                  <label key={opt.value} className="radio-card">
                    <input
                      type="radio"
                      name="gender"
                      value={opt.value}
                      checked={gender === opt.value}
                      onChange={() => setGender(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Folosit strict pentru eligibilitatea curselor „Women-only” (doar conturile cu „Femeie” pot publica sau
                rezerva curse Women-only). Auto-declarat și neverificat.
              </p>
            </fieldset>

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Se creează contul...' : 'Creează cont StudRide'}
            </button>
          </form>
        ) : (
          <form
            id="panel-login"
            role="tabpanel"
            aria-labelledby="tab-login"
            onSubmit={handleLoginSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
          >
            <div className="field">
              <label htmlFor="login-email">Adresă de email</label>
              <input
                id="login-email"
                className="input"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Parolă</label>
              <input
                id="login-password"
                className="input"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Se autentifică...' : 'Intră în cont'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
