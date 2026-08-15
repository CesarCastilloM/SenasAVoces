import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function Field({ icon, label, action, isDark, ...props }) {
  return (
    <label className="block">
      <span className={`mb-2 block text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-brand-soft' : 'text-brand-muted'}`}>{label}</span>
      <span className="relative block">
        <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#5A8A94]' : 'text-[#8AA8B0]'}`}>
          {icon}
        </span>
        <input
          {...props}
          className={`input-focus-ring w-full rounded-lg border py-3.5 pl-11 pr-12 text-sm font-medium transition ${
            isDark
              ? 'border-brand-line bg-brand-deep text-white placeholder:text-[#5A8A94]'
              : 'border-brand-mist bg-brand-cream text-brand-ink placeholder:text-[#8AA8B0]'
          }`}
        />
        {action && <span className="absolute right-3.5 top-1/2 -translate-y-1/2">{action}</span>}
      </span>
    </label>
  );
}

function Icon({ name, className = "h-5 w-5" }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className };
  const filled = { viewBox: "0 0 20 20", fill: "currentColor", className };
  const icons = {
    moon: <svg {...filled}><path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8 8 0 1 0 10.586 10.586z" /></svg>,
    sun: <svg {...common} viewBox="-2 -2 28 28"><circle cx="12" cy="12" r="4" /><path d="M12 1v3" /><path d="M12 20v3" /><path d="M4.22 4.22 6.34 6.34" /><path d="m17.66 17.66 2.12 2.12" /><path d="M1 12h3" /><path d="M20 12h3" /><path d="m4.22 19.78 2.12-2.12" /><path d="m17.66 6.34 2.12-2.12" /></svg>,
    mail: <svg {...filled}><path d="M3 4a2 2 0 0 0-2 2v1.16l8.44 4.22a1.25 1.25 0 0 0 1.12 0L19 7.16V6a2 2 0 0 0-2-2H3Z" /><path d="m19 8.84-7.77 3.88a2.75 2.75 0 0 1-2.46 0L1 8.84V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.84Z" /></svg>,
    lock: <svg {...filled}><path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" /></svg>,
    user: <svg {...filled}><path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493A7.002 7.002 0 0 1 16.54 14.49c.196.507.022 1.077-.408 1.41A9.957 9.957 0 0 1 10 18a9.957 9.957 0 0 1-6.125-2.095 1.23 1.23 0 0 1-.41-1.412Z" /></svg>,
    eye: <svg {...filled}><path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /><path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" /></svg>,
    google: <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v4.64c2.28 4.18 6.5 6.96 11.38 6.96z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>,
  };
  return icons[name] || icons.user;
}

function Logo({ isDark, compact = false }) {
  return (
    <img
      src="/logo-senas-a-voces-crop.png"
      alt="Señas a Voces Academy"
      className={`h-auto object-contain ${compact ? "w-40 sm:w-48 md:w-56" : "w-56 sm:w-72"} ${isDark && "logo-on-dark"}`}
    />
  );
}

function WaveBackground({ isDark }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className={`animate-wave-drift absolute -left-20 -top-20 h-[400px] w-[600px] ${isDark ? "text-brand-card" : "text-brand-teal"}`} viewBox="0 0 600 400" fill="currentColor" opacity="0.06">
        <path d="M0 200C100 100 200 300 300 200C400 100 500 300 600 200V0H0V200Z" />
      </svg>
      <svg className={`animate-wave-drift absolute -bottom-16 -right-16 h-[350px] w-[500px] ${isDark ? "text-brand-cyan" : "text-brand-orange"}`} viewBox="0 0 500 350" fill="currentColor" opacity="0.05" style={{ animationDelay: "2s" }}>
        <path d="M0 150C80 50 160 250 240 150C320 50 400 250 500 150V350H0V150Z" />
      </svg>
    </div>
  );
}

export default function AuthPage({ mode, isDark, setIsDark, navigate }) {
  const isSignup = mode === "signup";
  const { signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    if (isSignup) {
      if (formData.password !== formData.confirmPassword) {
        setError("Las contraseñas no coinciden");
        setLoading(false);
        return;
      }
      if (formData.password.length < 8) {
        setError("La contraseña debe tener al menos 8 caracteres");
        setLoading(false);
        return;
      }
      if (!agreed) {
        setError("Debes aceptar los términos de servicio");
        setLoading(false);
        return;
      }

      const { data, error, requiresEmailConfirmation, email } = await signUp({
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
      });

      if (error) {
        let errorMessage = error.message || "Error al crear cuenta";
        
        // Improve error messages for common Supabase errors
        if (errorMessage.includes("rate limit")) {
          errorMessage = "Has excedido el límite de envío de correos. Por favor espera unos minutos e inténtalo de nuevo.";
        } else if (errorMessage.includes("already registered")) {
          errorMessage = "Este correo ya está registrado. Por favor inicia sesión.";
        } else if (errorMessage.includes("password")) {
          errorMessage = "La contraseña debe tener al menos 6 caracteres.";
        }
        
        setError(errorMessage);
        setLoading(false);
      } else if (requiresEmailConfirmation) {
        navigate("/confirm-email", { state: { email } });
      } else {
        navigate("/dashboard");
      }
    } else {
      const { data, error } = await signIn({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        setError(error.message || "Error al iniciar sesión");
        setLoading(false);
      } else {
        navigate("/dashboard");
      }
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setGoogleLoading(true);

    const { data, error } = await signInWithGoogle();

    if (error) {
      setError(error.message || "Error al iniciar sesión con Google");
      setGoogleLoading(false);
    }
    // Navigation will be handled by auth state change
  };

  return (
    <div className={`relative min-h-screen overflow-hidden transition-colors ${isDark ? "bg-brand-deep" : "bg-brand-cream"}`}>
      <WaveBackground isDark={isDark} />
      <button
        onClick={() => setIsDark(!isDark)}
        className={`btn-press fixed right-6 top-6 z-50 rounded-xl p-2.5 ${isDark ? "bg-brand-card text-brand-orange" : "bg-white text-brand-teal shadow-sm"}`}
        aria-label="Cambiar tema"
      >
        <Icon name={isDark ? "sun" : "moon"} />
      </button>
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <section className="hidden w-[55%] items-center justify-center p-12 lg:flex">
          <div className="relative max-w-lg">
            <Logo isDark={isDark} />
            <h1 className={`mt-8 text-4xl font-extrabold leading-tight ${isDark ? "text-white" : "text-brand-ink"}`}>
              {isSignup ? "Únete a la" : "Aprende LSM"}<br />
              <span className={isDark ? "text-brand-cyan" : "text-brand-teal"}>
                {isSignup ? "comunidad LSM" : "a tu ritmo"}
              </span>
            </h1>
            <p className={`mt-4 text-lg leading-relaxed ${isDark ? "text-brand-soft" : "text-brand-muted"}`}>
              {isSignup
                ? "Crea tu cuenta gratuita y comienza con práctica inmersiva y retroalimentación inteligente."
                : "Únete a miles de personas que ya aprenden Lengua de Señas Mexicana con práctica inmersiva."}
            </p>
            <div className="mt-10 flex gap-8">
              {(isSignup
                ? [
                    ["Gratis", "Para siempre"],
                    ["5 min", "Por día"],
                    ["IA", "Retroalimentación"],
                  ]
                : [
                    ["2,400+", "Señas enseñadas"],
                    ["15K+", "Estudiantes activos"],
                    ["98%", "Satisfacción"],
                  ]
              ).map(([num, label]) => (
                <div key={label}>
                  <div className={`text-2xl font-extrabold ${isDark ? "text-brand-cyan" : "text-brand-teal"}`}>
                    {num}
                  </div>
                  <div className={`mt-1 text-xs font-medium ${isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]"}`}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="flex flex-1 items-center justify-center p-6 lg:p-12">
          <div className={`animate-float-in w-full max-w-md rounded-3xl p-8 lg:p-10 ${
            isDark
              ? "border border-brand-line bg-brand-card/80 backdrop-blur-xl"
              : "border border-gray-100 bg-white/90 shadow-2xl shadow-gray-200/50 backdrop-blur-xl"
          }`}>
            <div className="mb-8 flex justify-center lg:hidden">
              <Logo isDark={isDark} />
            </div>
            <h2 className={`text-2xl font-extrabold ${isDark ? "text-white" : "text-brand-ink"}`}>
              {isSignup ? "Crea tu cuenta" : "Bienvenido de nuevo"}
            </h2>
            <p className={`mb-8 mt-1 text-sm ${isDark ? "text-brand-soft" : "text-brand-muted"}`}>
              {isSignup ? "Empieza a aprender LSM hoy mismo" : "Inicia sesión para continuar tu aprendizaje"}
            </p>
            
            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <form onSubmit={submit} className="space-y-5">
              {isSignup && (
                <Field
                  icon={<Icon name="user" className="h-4 w-4" />}
                  label="Nombre completo"
                  placeholder="Tu nombre"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleChange}
                  isDark={isDark}
                />
              )}
              <Field
                icon={<Icon name="mail" className="h-4 w-4" />}
                label="Correo electrónico"
                type="email"
                placeholder="tu@correo.com"
                name="email"
                value={formData.email}
                onChange={handleChange}
                isDark={isDark}
              />
              <Field
                icon={<Icon name="lock" className="h-4 w-4" />}
                label="Contraseña"
                type={showPassword ? "text" : "password"}
                placeholder={isSignup ? "Mínimo 8 caracteres" : "••••••••"}
                name="password"
                value={formData.password}
                onChange={handleChange}
                isDark={isDark}
                action={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`rounded-lg p-1 ${isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]"}`}
                  >
                    <Icon name="eye" className="h-4 w-4" />
                  </button>
                }
              />
              {isSignup && (
                <Field
                  icon={<Icon name="lock" className="h-4 w-4" />}
                  label="Confirmar contraseña"
                  type="password"
                  placeholder="Repite tu contraseña"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  isDark={isDark}
                />
              )}
              {isSignup ? (
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-brand-teal"
                  />
                  <span className={`text-xs leading-relaxed ${isDark ? "text-brand-soft" : "text-brand-muted"}`}>
                    Acepto los términos de servicio y la política de privacidad.
                  </span>
                </label>
              ) : (
                <div className="flex items-center justify-between">
                  <label className={`flex cursor-pointer items-center gap-2 text-xs font-medium ${isDark ? "text-brand-soft" : "text-brand-muted"}`}>
                    <input type="checkbox" className="h-4 w-4 accent-brand-teal" />
                    Recordarme
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!formData.email) {
                        setError("Ingresa tu correo para restablecer la contraseña");
                        return;
                      }
                      setError("");
                      setResetSent(true);
                      const { error } = await resetPassword(formData.email);
                      if (error) {
                        setError(error.message || "Error al enviar el correo");
                        setResetSent(false);
                      }
                    }}
                    className={`text-xs font-semibold ${isDark ? "text-brand-cyan" : "text-brand-teal"}`}
                  >
                    {resetSent ? "Correo enviado ✓" : "¿Olvidaste tu contraseña?"}
                  </button>
                </div>
              )}
              
              {/* Google OAuth Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
                className={`btn-press w-full rounded-lg py-3.5 text-sm font-bold transition flex items-center justify-center gap-3 border ${
                  isDark
                    ? "bg-brand-deep border-brand-line text-white hover:bg-brand-card"
                    : "bg-white border-gray-200 text-gray-900 hover:bg-gray-50"
                } ${googleLoading && "cursor-not-allowed opacity-55"}`}
              >
                <Icon name="google" className="h-5 w-5" />
                {googleLoading ? "Conectando con Google..." : "Continuar con Google"}
              </button>

              <div className="relative my-6">
                <div className={`absolute inset-0 flex items-center ${isDark ? "text-brand-line" : "text-gray-200"}`}>
                  <div className="w-full border-t" style={{ borderColor: isDark ? "#1A5C6A" : "#E8EEEF" }}></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className={`px-2 ${isDark ? "bg-brand-deep text-brand-soft" : "bg-white text-gray-500"}`}>
                    o
                  </span>
                </div>
              </div>

              <button
                disabled={loading || (isSignup && !agreed)}
                className={`btn-press w-full rounded-lg py-3.5 text-sm font-bold transition ${
                  isSignup
                    ? "bg-brand-orange text-white hover:bg-[#E08A50]"
                    : "bg-brand-teal text-white hover:bg-[#0A4D5D]"
                } ${(loading || (isSignup && !agreed)) && "cursor-not-allowed opacity-55"}`}
              >
                {loading ? "Procesando..." : isSignup ? "Crear cuenta gratis" : "Iniciar sesión"}
              </button>
            </form>
            <p className={`mt-8 text-center text-sm ${isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]"}`}>
              {isSignup ? "¿Ya tienes cuenta? " : "¿No tienes cuenta? "}
              <button
                onClick={() => navigate(isSignup ? "/" : "/signup")}
                className={`font-bold ${isDark ? "text-brand-cyan" : "text-brand-teal"}`}
              >
                {isSignup ? "Inicia sesión" : "Regístrate gratis"}
              </button>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
