import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function Icon({ name, className = "h-5 w-5" }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className };
  const filled = { viewBox: "0 0 20 20", fill: "currentColor", className };
  const icons = {
    moon: <svg {...filled}><path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8 8 0 1 0 10.586 10.586z" /></svg>,
    sun: <svg {...common} viewBox="-2 -2 28 28"><circle cx="12" cy="12" r="4" /><path d="M12 1v3" /><path d="M12 20v3" /><path d="M4.22 4.22 6.34 6.34" /><path d="m17.66 17.66 2.12 2.12" /><path d="M1 12h3" /><path d="M20 12h3" /><path d="m4.22 19.78 2.12-2.12" /><path d="m17.66 6.34 2.12-2.12" /></svg>,
    mail: <svg {...filled}><path d="M3 4a2 2 0 0 0-2 2v1.16l8.44 4.22a1.25 1.25 0 0 0 1.12 0L19 7.16V6a2 2 0 0 0-2-2H3Z" /><path d="m19 8.84-7.77 3.88a2.75 2.75 0 0 1-2.46 0L1 8.84V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.84Z" /></svg>,
    refresh: <svg {...common}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>,
    check: <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>,
  };
  return icons[name] || icons.mail;
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

export default function EmailConfirmationPage({ isDark, setIsDark, navigate, email }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // "success" or "error"

  const handleResendEmail = async () => {
    setLoading(true);
    setMessage("");
    
    try {
      const { supabase } = await import('../lib/supabaseClient');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
      });

      if (error) {
        setMessage("Error al reenviar email. Intenta nuevamente.");
        setMessageType("error");
      } else {
        setMessage("Email reenviado exitosamente. Revisa tu bandeja de entrada.");
        setMessageType("success");
      }
    } catch (error) {
      setMessage("Error al reenviar email. Intenta nuevamente.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
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
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div className={`animate-float-in w-full max-w-md rounded-3xl p-8 lg:p-10 ${
          isDark
            ? "border border-brand-line bg-brand-card/80 backdrop-blur-xl"
            : "border border-gray-100 bg-white/90 shadow-2xl shadow-gray-200/50 backdrop-blur-xl"
        }`}>
          <div className="mb-8 flex justify-center">
            <div className={`flex h-20 w-20 items-center justify-center rounded-full ${isDark ? "bg-brand-cyan/20" : "bg-brand-teal/20"}`}>
              <Icon name="mail" className={`h-10 w-10 ${isDark ? "text-brand-cyan" : "text-brand-teal"}`} />
            </div>
          </div>
          
          <h2 className={`text-center text-2xl font-extrabold ${isDark ? "text-white" : "text-brand-ink"}`}>
            Confirma tu email
          </h2>
          <p className={`mt-4 text-center text-sm leading-relaxed ${isDark ? "text-brand-soft" : "text-brand-muted"}`}>
            Hemos enviado un enlace de confirmación a <strong>{email}</strong>. 
            Por favor revisa tu bandeja de entrada y haz clic en el enlace para activar tu cuenta.
          </p>

          <div className={`mt-6 rounded-xl border p-4 ${isDark ? "border-brand-line bg-brand-deep/30" : "border-brand-mist bg-brand-cream/50"}`}>
            <p className={`text-xs font-medium ${isDark ? "text-brand-soft" : "text-brand-muted"}`}>
              <strong className={isDark ? "text-brand-cyan" : "text-brand-teal"}>¿No recibiste el email?</strong>
            </p>
            <p className={`mt-2 text-xs ${isDark ? "text-brand-soft" : "text-brand-muted"}`}>
              Revisa tu carpeta de spam o correo no deseado. Si aún no lo encuentras, puedes reenviarlo.
            </p>
          </div>

          {message && (
            <div className={`mt-4 rounded-lg p-3 text-sm ${
              messageType === "success"
                ? isDark ? "bg-[#1A6B4A] text-[#D4F5E4]" : "bg-brand-mint text-[#1A4A32]"
                : isDark ? "bg-[#8B3A3A] text-[#FDE8D4]" : "bg-red-50 text-red-600"
            }`}>
              {message}
            </div>
          )}

          <button
            onClick={handleResendEmail}
            disabled={loading}
            className={`btn-press mt-6 w-full rounded-lg py-3.5 text-sm font-bold transition ${
              isDark
                ? "bg-brand-cyan text-brand-deep hover:bg-[#2AABB8]"
                : "bg-brand-teal text-white hover:bg-[#0A4D5D]"
            } ${loading && "cursor-not-allowed opacity-55"}`}
          >
            {loading ? "Enviando..." : "Reenviar email de confirmación"}
          </button>

          <button
            onClick={() => navigate("/")}
            className={`mt-4 w-full rounded-lg py-3.5 text-sm font-bold transition ${
              isDark
                ? "text-brand-soft hover:bg-brand-deep/30"
                : "text-brand-muted hover:bg-brand-cream/50"
            }`}
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
