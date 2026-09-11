import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Plus,
  User,
  Play,
  Square,
  RotateCcw,
  TrendingUp,
  Calendar,
  ChevronRight,
  X,
  Check,
  Activity,
  Dumbbell,
  Footprints,
  Ruler,
  Printer,
  Pencil,
  Trash2,
  LogOut,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { auth, db } from "./firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
} from "firebase/firestore";

/* ---------------------------------------------------------------
   Reference data & scoring
   These are general, published clinical reference ranges used to
   support (not replace) professional judgement.
---------------------------------------------------------------- */

const CATEGORIES = {
  balance: { label: "Equilíbrio", color: "var(--teal)", icon: Activity },
  strength: { label: "Força", color: "var(--ochre)", icon: Dumbbell },
  mobility: { label: "Mobilidade", color: "var(--slate)", icon: Footprints },
};

const CHAIR_STAND_TABLE = {
  M: [
    [60, 64, 14, 19],
    [65, 69, 12, 18],
    [70, 74, 12, 17],
    [75, 79, 11, 17],
    [80, 84, 10, 15],
    [85, 89, 8, 14],
    [90, 99, 7, 12],
  ],
  F: [
    [60, 64, 12, 17],
    [65, 69, 11, 16],
    [70, 74, 10, 15],
    [75, 79, 10, 15],
    [80, 84, 9, 14],
    [85, 89, 8, 13],
    [90, 99, 4, 11],
  ],
};

function chairStandBand(age, sex) {
  const rows = CHAIR_STAND_TABLE[sex] || CHAIR_STAND_TABLE.F;
  const row =
    rows.find((r) => age >= r[0] && age <= r[1]) ||
    (age < 60 ? rows[0] : rows[rows.length - 1]);
  return { min: row[2], max: row[3] };
}

const MINI_BEST_ITEMS = [
  "Levantar da cadeira sem usar os braços",
  "Ficar na ponta dos pés",
  "Equilíbrio em apoio unipodal",
  "Reação a um empurrão para frente (passo de proteção)",
  "Reação a um empurrão para trás (passo de proteção)",
  "Reação a um empurrão lateral (passo de proteção)",
  "Pés juntos, olhos fechados, sobre superfície macia",
  "Em pé sobre superfície inclinada, olhos fechados",
  "Alternar a velocidade da marcha ao comando",
  "Caminhar virando a cabeça para os lados",
  "Caminhar e girar o corpo (pivô) ao comando",
  "Passar por cima de um obstáculo durante a marcha",
  "Caminhar realizando uma tarefa mental simultânea",
  "Subir e descer um degrau",
];

function fmtCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const TESTS = {
  balance_single_leg: {
    category: "balance",
    name: "Apoio Unipodal",
    unit: "s",
    input: "timer",
    cap: 60,
    protocol:
      "Peça para a pessoa ficar em pé sobre uma perna, sem apoio, olhos abertos. Inicie o cronômetro ao levantar o pé e pare ao tocar o chão ou ao haver compensação evidente. Tempo máximo de 60 segundos.",
    classify: (v) => {
      if (v < 5) return { label: "Risco elevado de queda", tone: "high" };
      if (v < 30)
        return { label: "Abaixo do esperado para a idade", tone: "mid" };
      return { label: "Dentro do esperado", tone: "good" };
    },
  },
  balance_reach: {
    category: "balance",
    name: "Alcance Funcional",
    unit: "cm",
    input: "manual",
    protocol:
      "Com a pessoa em pé ao lado de uma parede, braço estendido a 90°, meça a posição inicial do dedo médio. Peça para inclinar o tronco à frente o máximo possível sem dar passos e meça a nova posição. Registre a diferença.",
    classify: (v) => {
      if (v < 15) return { label: "Risco elevado de queda", tone: "high" };
      if (v <= 25) return { label: "Risco moderado", tone: "mid" };
      return { label: "Risco baixo", tone: "good" };
    },
  },
  balance_minibest: {
    category: "balance",
    name: "Mini-BESTest (adaptado)",
    unit: "pontos",
    input: "checklist",
    items: MINI_BEST_ITEMS,
    protocol:
      "Versão simplificada de uma escala de equilíbrio dinâmico e reativo, para registro rápido de evolução. Para cada item, pontue 0 (incapaz ou grande comprometimento), 1 (realiza com compensação ou apoio) ou 2 (realiza normalmente). Use o protocolo completo da escala original para pontuação formal e critérios detalhados de cada item.",
    classify: (total) => {
      const max = MINI_BEST_ITEMS.length * 2;
      const pct = total / max;
      if (pct < 0.5)
        return { label: "Equilíbrio dinâmico comprometido", tone: "high" };
      if (pct < 0.75)
        return { label: "Equilíbrio dinâmico limítrofe", tone: "mid" };
      return { label: "Equilíbrio dinâmico preservado", tone: "good" };
    },
  },
  strength_chair_stand: {
    category: "strength",
    name: "Sentar e Levantar (30s)",
    unit: "repetições",
    input: "countdown-counter",
    duration: 30,
    protocol:
      "Cadeira sem braços, encostada na parede. A pessoa inicia sentada, braços cruzados no peito. Ao sinal, deve levantar e sentar o maior número de vezes possível em 30 segundos. Conte cada levantada completa.",
    classify: (v, patient) => {
      const { min, max } = chairStandBand(patient.age, patient.sex);
      if (v < min)
        return {
          label: `Abaixo da média da faixa etária (${min}–${max})`,
          tone: "mid",
        };
      if (v > max)
        return {
          label: `Acima da média da faixa etária (${min}–${max})`,
          tone: "good",
        };
      return {
        label: `Dentro da média da faixa etária (${min}–${max})`,
        tone: "good",
      };
    },
  },
  strength_grip: {
    category: "strength",
    name: "Dinamometria Manual",
    unit: "kg",
    input: "manual",
    protocol:
      "Meça a força de preensão palmar com dinamômetro manual, pessoa sentada, cotovelo a 90°. Registre o maior valor entre duas ou três tentativas.",
    classify: (v, patient) => {
      const cutoff = patient.sex === "M" ? 27 : 16;
      if (v < cutoff)
        return {
          label: "Força reduzida (abaixo do ponto de corte)",
          tone: "high",
        };
      return { label: "Força preservada", tone: "good" };
    },
  },
  mobility_tug: {
    category: "mobility",
    name: "Timed Up and Go",
    unit: "s",
    input: "timer",
    protocol:
      "A pessoa inicia sentada em uma cadeira com braços. Ao sinal, deve levantar, caminhar 3 metros, contornar um marcador, retornar e sentar. Cronometre do início do movimento até sentar novamente.",
    classify: (v) => {
      if (v < 10) return { label: "Mobilidade normal", tone: "good" };
      if (v <= 20)
        return { label: "Atenção — mobilidade reduzida", tone: "mid" };
      return { label: "Risco elevado de queda", tone: "high" };
    },
  },
  mobility_gait: {
    category: "mobility",
    name: "Velocidade da Marcha (4m)",
    unit: "m/s",
    input: "timer-distance",
    distance: 4,
    protocol:
      "Marque um percurso reto de 4 metros. Peça para caminhar no ritmo habitual. Cronometre entre o primeiro e o último marcador; a velocidade é calculada automaticamente.",
    classify: (v) => {
      if (v < 0.6) return { label: "Indicador de fragilidade", tone: "high" };
      if (v < 1.0) return { label: "Mobilidade limítrofe", tone: "mid" };
      return { label: "Mobilidade adequada", tone: "good" };
    },
  },
  mobility_6mwt: {
    category: "mobility",
    name: "Caminhada de 6 Minutos",
    unit: "m",
    input: "walk6",
    duration: 360,
    protocol:
      "Marque um corredor plano de 20 a 30 metros. Peça para caminhar o mais rápido possível, sem correr, durante 6 minutos, podendo desacelerar ou parar para descansar se necessário. Ao final (ou em caso de interrupção), registre a distância total percorrida.",
    classify: (v) => {
      if (v < 300)
        return { label: "Capacidade funcional reduzida", tone: "high" };
      if (v < 450)
        return { label: "Capacidade funcional limítrofe", tone: "mid" };
      return { label: "Capacidade funcional preservada", tone: "good" };
    },
  },
  mobility_2min_step: {
    category: "mobility",
    name: "Marcha Estacionária (2 min)",
    unit: "repetições",
    input: "countdown-counter",
    duration: 120,
    protocol:
      "Marque na parede, em um suporte ou com uma fita, a altura correspondente ao ponto médio entre a patela e a crista ilíaca da pessoa. Ao sinal, ela deve marchar no lugar elevando os joelhos até essa marca, o maior número de vezes possível em 2 minutos, podendo se apoiar em uma parede ou cadeira se necessário. Conte apenas as vezes que o joelho direito atinge a altura marcada.",
    classify: (v) => {
      if (v < 65)
        return { label: "Capacidade aeróbica reduzida", tone: "high" };
      if (v < 100)
        return { label: "Capacidade aeróbica limítrofe", tone: "mid" };
      return { label: "Capacidade aeróbica adequada", tone: "good" };
    },
  },
};

const toneColor = (tone) =>
  tone === "high" ? "var(--brick)" : tone === "mid" ? "var(--ochre)" : "var(--teal)";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ---------------------------------------------------------------
   Firestore helpers (data is scoped under users/{uid}/...)
---------------------------------------------------------------- */

async function loadPatients(uid) {
  try {
    const snap = await getDocs(collection(db, "users", uid, "patients"));
    return snap.docs.map((d) => d.data());
  } catch {
    return [];
  }
}
async function savePatientDoc(uid, patient) {
  try {
    await setDoc(doc(db, "users", uid, "patients", patient.id), patient);
  } catch {}
}
async function deletePatientDoc(uid, patientId) {
  try {
    const resultsSnap = await getDocs(
      collection(db, "users", uid, "patients", patientId, "results")
    );
    await Promise.all(resultsSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "users", uid, "patients", patientId));
  } catch {}
}
async function loadResults(uid, patientId) {
  try {
    const snap = await getDocs(
      collection(db, "users", uid, "patients", patientId, "results")
    );
    return snap.docs.map((d) => d.data());
  } catch {
    return [];
  }
}
async function saveResultDoc(uid, patientId, result) {
  try {
    await setDoc(
      doc(db, "users", uid, "patients", patientId, "results", result.id),
      result
    );
  } catch {}
}

/* ---------------------------------------------------------------
   Small building blocks
---------------------------------------------------------------- */

function TopBar({ title, onBack, right }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="Voltar">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="brand-mark">D</div>
        )}
        <h1>{title}</h1>
      </div>
      {right}
    </div>
  );
}

function Pill({ tone, children }) {
  return (
    <span className="pill" style={{ background: toneColor(tone) }}>
      {children}
    </span>
  );
}

function CategoryIcon({ category, size = 18 }) {
  const Icon = CATEGORIES[category].icon;
  return <Icon size={size} />;
}

/* ---------------------------------------------------------------
   Stopwatch hook
---------------------------------------------------------------- */

function useStopwatch() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  const tick = useCallback(() => {
    setElapsed((Date.now() - startRef.current) / 1000);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = () => {
    startRef.current = Date.now() - elapsed * 1000;
    setRunning(true);
    rafRef.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    setRunning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };
  const reset = () => {
    stop();
    setElapsed(0);
  };

  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  return { elapsed, running, start, stop, reset };
}

/* ---------------------------------------------------------------
   Screens
---------------------------------------------------------------- */

function LoginScreen() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      const map = {
        "auth/invalid-email": "E-mail inválido.",
        "auth/user-not-found": "Não encontramos essa conta. Crie uma nova abaixo.",
        "auth/wrong-password": "Senha incorreta.",
        "auth/invalid-credential": "E-mail ou senha incorretos.",
        "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Tente entrar.",
        "auth/weak-password": "Use uma senha com pelo menos 6 caracteres.",
      };
      setError(map[e.code] || "Não foi possível continuar. Tente novamente.");
    }
    setBusy(false);
  };

  return (
    <div className="screen">
      <TopBar title="Douglas Valeriano (Personal Sênior)" />
      <p className="subtitle">Avaliação física para idosos</p>

      <div className="form-card" style={{ marginTop: 10 }}>
        <div className="form-row">
          <label>E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
          />
        </div>
        <div className="form-row">
          <label>Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        {error && <p className="login-error">{error}</p>}
        <div className="form-actions">
          <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={submit}>
            {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </div>
        <button
          className="link-btn"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
        >
          {mode === "login" ? "Ainda não tenho conta — criar agora" : "Já tenho conta — entrar"}
        </button>
      </div>
    </div>
  );
}

function PatientsScreen({ patients, onOpen, onAdd, onLogout }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("F");

  const submit = () => {
    if (!name.trim() || !age) return;
    onAdd({ id: uid(), name: name.trim(), age: parseInt(age, 10), sex });
    setName("");
    setAge("");
    setSex("F");
    setShowForm(false);
  };

  return (
    <div className="screen">
      <TopBar
        title="Douglas Valeriano (Personal Sênior)"
        right={
          <button className="icon-btn" onClick={onLogout} aria-label="Sair" title="Sair da conta">
            <LogOut size={18} />
          </button>
        }
      />
      <p className="subtitle">Avaliação física para idosos</p>

      <div className="list">
        {patients.length === 0 && !showForm && (
          <div className="empty">
            <User size={28} strokeWidth={1.5} />
            <p>Nenhum paciente cadastrado ainda.</p>
            <p className="empty-sub">Adicione o primeiro para começar uma avaliação.</p>
          </div>
        )}
        {patients.map((p) => (
          <button key={p.id} className="patient-row" onClick={() => onOpen(p.id)}>
            <div className="patient-avatar">{p.name.charAt(0).toUpperCase()}</div>
            <div className="patient-info">
              <div className="patient-name">{p.name}</div>
              <div className="patient-meta">
                {p.age} anos · {p.sex === "M" ? "Masculino" : "Feminino"}
              </div>
            </div>
            <ChevronRight size={18} color="var(--ink-faint)" />
          </button>
        ))}
      </div>

      {showForm ? (
        <div className="form-card">
          <div className="form-row">
            <label>Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="form-row form-row-split">
            <div>
              <label>Idade</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="Ex: 72"
              />
            </div>
            <div>
              <label>Sexo</label>
              <div className="segmented">
                <button
                  className={sex === "F" ? "seg active" : "seg"}
                  onClick={() => setSex("F")}
                >
                  Feminino
                </button>
                <button
                  className={sex === "M" ? "seg active" : "seg"}
                  onClick={() => setSex("M")}
                >
                  Masculino
                </button>
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={submit}>
              Salvar paciente
            </button>
          </div>
        </div>
      ) : (
        <button className="fab" onClick={() => setShowForm(true)}>
          <Plus size={20} /> Novo paciente
        </button>
      )}
    </div>
  );
}

function PatientDetailScreen({ patient, results, onBack, onNewTest, onHistory, onExportPdf, onEdit }) {
  const latestByTest = {};
  results.forEach((r) => {
    if (!latestByTest[r.testId] || r.date > latestByTest[r.testId].date) {
      latestByTest[r.testId] = r;
    }
  });

  return (
    <div className="screen">
      <TopBar
        title={patient.name}
        onBack={onBack}
        right={
          <div className="topbar-actions">
            <button className="icon-btn" onClick={onEdit} aria-label="Editar paciente" title="Editar paciente">
              <Pencil size={18} />
            </button>
            <button className="icon-btn" onClick={onExportPdf} aria-label="Exportar relatório em PDF" title="Exportar PDF">
              <Printer size={18} />
            </button>
          </div>
        }
      />
      <p className="subtitle">
        {patient.age} anos · {patient.sex === "M" ? "Masculino" : "Feminino"}
      </p>

      {Object.entries(CATEGORIES).map(([catKey, cat]) => {
        const testsInCat = Object.entries(TESTS).filter(([, t]) => t.category === catKey);
        return (
          <div key={catKey} className="cat-block">
            <div className="cat-heading">
              <span className="cat-dot" style={{ background: cat.color }} />
              <CategoryIcon category={catKey} size={16} />
              <span>{cat.label}</span>
            </div>
            {testsInCat.map(([testId, test]) => {
              const last = latestByTest[testId];
              return (
                <button
                  key={testId}
                  className="test-row"
                  style={{ borderLeftColor: cat.color }}
                  onClick={() => onHistory(testId)}
                >
                  <div className="test-row-main">
                    <div className="test-row-name">{test.name}</div>
                    {last ? (
                      <div className="test-row-value">
                        {last.value} {test.unit} · {fmtDate(last.date)}
                        {last.manual && <span className="manual-tag"> · manual</span>}
                      </div>
                    ) : (
                      <div className="test-row-value test-row-empty">Sem registros</div>
                    )}
                  </div>
                  {last && <Pill tone={last.tone}>{" "}</Pill>}
                </button>
              );
            })}
          </div>
        );
      })}

      <button className="fab" onClick={onNewTest}>
        <Plus size={20} /> Nova avaliação
      </button>
    </div>
  );
}

function PatientEditScreen({ patient, onBack, onSave, onDelete }) {
  const [name, setName] = useState(patient.name);
  const [age, setAge] = useState(String(patient.age));
  const [sex, setSex] = useState(patient.sex);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const submit = () => {
    if (!name.trim() || !age) return;
    onSave({ ...patient, name: name.trim(), age: parseInt(age, 10), sex });
  };

  return (
    <div className="screen">
      <TopBar title="Editar paciente" onBack={onBack} />

      <div className="form-card" style={{ marginTop: 6 }}>
        <div className="form-row">
          <label>Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
        </div>
        <div className="form-row form-row-split">
          <div>
            <label>Idade</label>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Ex: 72"
            />
          </div>
          <div>
            <label>Sexo</label>
            <div className="segmented">
              <button className={sex === "F" ? "seg active" : "seg"} onClick={() => setSex("F")}>
                Feminino
              </button>
              <button className={sex === "M" ? "seg active" : "seg"} onClick={() => setSex("M")}>
                Masculino
              </button>
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-ghost" onClick={onBack}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={submit}>
            <Check size={16} /> Salvar alterações
          </button>
        </div>
      </div>

      <div className="danger-zone">
        {!confirmingDelete ? (
          <button className="btn-danger-ghost" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={16} /> Excluir paciente
          </button>
        ) : (
          <div className="confirm-card">
            <p>
              Isso apagará <strong>{patient.name}</strong> e todo o histórico de avaliações. Esta
              ação não pode ser desfeita.
            </p>
            <div className="form-actions">
              <button className="btn-ghost" onClick={() => setConfirmingDelete(false)}>
                Cancelar
              </button>
              <button className="btn-danger" onClick={() => onDelete(patient.id)}>
                <Trash2 size={16} /> Excluir definitivamente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TestSelectScreen({ onBack, onSelect }) {
  const [tab, setTab] = useState("balance");
  return (
    <div className="screen">
      <TopBar title="Nova avaliação" onBack={onBack} />
      <div className="tabs">
        {Object.entries(CATEGORIES).map(([key, cat]) => (
          <button
            key={key}
            className={tab === key ? "tab active" : "tab"}
            style={tab === key ? { color: cat.color, borderColor: cat.color } : {}}
            onClick={() => setTab(key)}
          >
            <CategoryIcon category={key} size={16} />
            {cat.label}
          </button>
        ))}
      </div>
      <div className="list">
        {Object.entries(TESTS)
          .filter(([, t]) => t.category === tab)
          .map(([id, t]) => (
            <button key={id} className="test-pick" onClick={() => onSelect(id)}>
              <div>
                <div className="test-pick-name">{t.name}</div>
                <div className="test-pick-protocol">{t.protocol}</div>
              </div>
              <ChevronRight size={18} color="var(--ink-faint)" />
            </button>
          ))}
      </div>
    </div>
  );
}

function TestRunScreen({ testId, patient, onBack, onSave }) {
  const test = TESTS[testId];
  const sw = useStopwatch();
  const [count, setCount] = useState(0);
  const [countdown, setCountdown] = useState(test.duration || 0);
  const [phase, setPhase] = useState("ready"); // ready | running | measuring | done
  const [manualValue, setManualValue] = useState("");
  const [itemScores, setItemScores] = useState({});
  const [mode, setMode] = useState("auto"); // auto | manual (manual override for timed/counted tests)
  const [manualOverride, setManualOverride] = useState("");
  const countdownRef = useRef(null);

  const MANUAL_OVERRIDE_TYPES = ["timer", "timer-distance", "countdown-counter", "walk6"];
  const supportsManualOverride = MANUAL_OVERRIDE_TYPES.includes(test.input);
  const isManualOverride = supportsManualOverride && mode === "manual";

  useEffect(() => {
    if ((test.input === "countdown-counter" || test.input === "walk6") && phase === "running") {
      countdownRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(countdownRef.current);
            setPhase(test.input === "walk6" ? "measuring" : "done");
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      return () => clearInterval(countdownRef.current);
    }
  }, [phase, test.input]);

  useEffect(() => {
    if (test.input === "timer" && test.cap && sw.elapsed >= test.cap && phase === "running") {
      sw.stop();
      setPhase("done");
    }
  }, [sw.elapsed, phase, test]);

  const startTimer = () => {
    setPhase("running");
    sw.start();
  };
  const stopTimer = () => {
    sw.stop();
    setPhase("done");
  };
  const startCountdown = () => {
    setPhase("running");
    setCount(0);
    setCountdown(test.duration);
  };
  const startWalk = () => {
    setPhase("running");
    setCountdown(test.duration);
  };

  let finalValue = null;
  if (isManualOverride) {
    const parsed = manualOverride === "" ? null : parseFloat(manualOverride);
    if (test.input === "timer-distance") {
      finalValue = parsed && parsed > 0 ? Math.round((test.distance / parsed) * 100) / 100 : null;
    } else if (test.input === "countdown-counter") {
      finalValue = parsed === null || isNaN(parsed) ? null : Math.round(parsed);
    } else {
      finalValue = parsed;
    }
  } else if (test.input === "timer") {
    finalValue = Math.round(sw.elapsed * 10) / 10;
  } else if (test.input === "countdown-counter") {
    finalValue = count;
  } else if (test.input === "timer-distance") {
    finalValue = sw.elapsed > 0 ? Math.round((test.distance / sw.elapsed) * 100) / 100 : 0;
  } else if (test.input === "walk6") {
    finalValue = manualValue === "" ? null : parseFloat(manualValue);
  }
  if (test.input === "manual") finalValue = manualValue === "" ? null : parseFloat(manualValue);
  if (test.input === "checklist") {
    const answered = test.items.every((_, idx) => itemScores[idx] !== undefined);
    finalValue = answered
      ? test.items.reduce((sum, _, idx) => sum + itemScores[idx], 0)
      : null;
  }

  let canSave = false;
  if (isManualOverride) {
    canSave = finalValue !== null && !isNaN(finalValue);
  } else if (test.input === "manual" || test.input === "checklist") {
    canSave = finalValue !== null && !isNaN(finalValue);
  } else if (test.input === "walk6") {
    canSave = phase === "measuring" && finalValue !== null && !isNaN(finalValue);
  } else {
    canSave = phase === "done";
  }

  const handleSave = () => {
    if (!canSave) return;
    const classification = test.classify(finalValue, patient);
    onSave({
      id: uid(),
      testId,
      category: test.category,
      value: finalValue,
      unit: test.unit,
      tone: classification.tone,
      label: classification.label,
      date: new Date().toISOString(),
      extra:
        test.input === "timer-distance"
          ? { seconds: isManualOverride ? parseFloat(manualOverride) : Math.round(sw.elapsed * 10) / 10 }
          : null,
      manual: isManualOverride,
    });
  };

  return (
    <div className="screen">
      <TopBar title={test.name} onBack={onBack} />
      <div
        className="protocol-card"
        style={{ borderLeftColor: CATEGORIES[test.category].color }}
      >
        {test.protocol}
      </div>

      {supportsManualOverride && (
        <div className="segmented mode-toggle">
          <button
            className={mode === "auto" ? "seg active" : "seg"}
            onClick={() => setMode("auto")}
          >
            Cronômetro do app
          </button>
          <button
            className={mode === "manual" ? "seg active" : "seg"}
            onClick={() => setMode("manual")}
          >
            Inserir valor manual
          </button>
        </div>
      )}

      <div className="run-stage">
        {test.input === "timer" && mode === "manual" && (
          <div className="manual-entry">
            <Ruler size={22} color="var(--ink-faint)" />
            <input
              type="number"
              inputMode="decimal"
              placeholder={`0 ${test.unit}`}
              value={manualOverride}
              onChange={(e) => setManualOverride(e.target.value)}
            />
            <span className="unit-tag">{test.unit}</span>
          </div>
        )}

        {test.input === "timer" && mode === "auto" && (
          <>
            <div className="big-number">{sw.elapsed.toFixed(1)}<span>s</span></div>
            {test.cap && <div className="cap-note">limite de {test.cap}s</div>}
            {phase !== "done" ? (
              <button
                className={phase === "running" ? "run-btn stop" : "run-btn go"}
                onClick={phase === "running" ? stopTimer : startTimer}
              >
                {phase === "running" ? <Square size={22} /> : <Play size={22} />}
                {phase === "running" ? "Parar" : "Iniciar"}
              </button>
            ) : (
              <button className="run-btn reset" onClick={() => { sw.reset(); setPhase("ready"); }}>
                <RotateCcw size={18} /> Refazer
              </button>
            )}
          </>
        )}

        {test.input === "timer-distance" && mode === "manual" && (
          <>
            <div className="cap-note">percurso de {test.distance} m</div>
            <div className="manual-entry">
              <Ruler size={22} color="var(--ink-faint)" />
              <input
                type="number"
                inputMode="decimal"
                placeholder="0 s"
                value={manualOverride}
                onChange={(e) => setManualOverride(e.target.value)}
              />
              <span className="unit-tag">s</span>
            </div>
            {finalValue !== null && !isNaN(finalValue) && (
              <div className="derived">{finalValue} m/s</div>
            )}
          </>
        )}

        {test.input === "timer-distance" && mode === "auto" && (
          <>
            <div className="big-number">{sw.elapsed.toFixed(1)}<span>s</span></div>
            <div className="cap-note">percurso de {test.distance} m</div>
            {phase !== "done" ? (
              <button
                className={phase === "running" ? "run-btn stop" : "run-btn go"}
                onClick={phase === "running" ? stopTimer : startTimer}
              >
                {phase === "running" ? <Square size={22} /> : <Play size={22} />}
                {phase === "running" ? "Parar" : "Iniciar"}
              </button>
            ) : (
              <>
                <div className="derived">{finalValue} m/s</div>
                <button className="run-btn reset" onClick={() => { sw.reset(); setPhase("ready"); }}>
                  <RotateCcw size={18} /> Refazer
                </button>
              </>
            )}
          </>
        )}

        {test.input === "countdown-counter" && mode === "manual" && (
          <div className="manual-entry">
            <Ruler size={22} color="var(--ink-faint)" />
            <input
              type="number"
              inputMode="numeric"
              placeholder="0 repetições"
              value={manualOverride}
              onChange={(e) => setManualOverride(e.target.value)}
            />
            <span className="unit-tag">repetições</span>
          </div>
        )}

        {test.input === "countdown-counter" && mode === "auto" && (
          <>
            {phase === "ready" && (
              <button className="run-btn go" onClick={startCountdown}>
                <Play size={22} /> Iniciar {test.duration < 60 ? `${test.duration}s` : fmtCountdown(test.duration)}
              </button>
            )}
            {phase !== "ready" && (
              <>
                <div className="big-number">
                  {test.duration < 60 ? countdown : fmtCountdown(countdown)}
                  <span>{test.duration < 60 ? "s restantes" : "restantes"}</span>
                </div>
                <div className="counter-value">{count}</div>
                <div className="counter-label">repetições</div>
                <button
                  className="tap-btn"
                  disabled={phase === "done"}
                  onClick={() => setCount((c) => c + 1)}
                >
                  +1
                </button>
                {phase === "done" && (
                  <button
                    className="run-btn reset"
                    onClick={() => { setPhase("ready"); setCount(0); setCountdown(test.duration); }}
                  >
                    <RotateCcw size={18} /> Refazer
                  </button>
                )}
              </>
            )}
          </>
        )}

        {test.input === "manual" && (
          <div className="manual-entry">
            <Ruler size={22} color="var(--ink-faint)" />
            <input
              type="number"
              inputMode="decimal"
              placeholder={`0 ${test.unit}`}
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
            />
            <span className="unit-tag">{test.unit}</span>
          </div>
        )}

        {test.input === "walk6" && mode === "manual" && (
          <div className="manual-entry">
            <Ruler size={22} color="var(--ink-faint)" />
            <input
              type="number"
              inputMode="decimal"
              placeholder="0 m"
              value={manualOverride}
              onChange={(e) => setManualOverride(e.target.value)}
            />
            <span className="unit-tag">m</span>
          </div>
        )}

        {test.input === "walk6" && mode === "auto" && (
          <>
            {phase === "ready" && (
              <button className="run-btn go" onClick={startWalk}>
                <Play size={22} /> Iniciar 6:00
              </button>
            )}
            {phase === "running" && (
              <>
                <div className="big-number">
                  {fmtCountdown(countdown)}
                  <span>restantes</span>
                </div>
                <button className="run-btn stop" onClick={() => setPhase("measuring")}>
                  <Square size={22} /> Finalizar
                </button>
              </>
            )}
            {phase === "measuring" && (
              <>
                <div className="cap-note">
                  Tempo utilizado: {fmtCountdown(test.duration - countdown)}
                </div>
                <div className="manual-entry">
                  <Ruler size={22} color="var(--ink-faint)" />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0 m"
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                  />
                  <span className="unit-tag">m</span>
                </div>
                <button
                  className="run-btn reset"
                  onClick={() => {
                    setPhase("ready");
                    setCountdown(test.duration);
                    setManualValue("");
                  }}
                >
                  <RotateCcw size={18} /> Refazer
                </button>
              </>
            )}
          </>
        )}

        {test.input === "checklist" && (
          <div className="checklist">
            {test.items.map((label, idx) => (
              <div key={idx} className="checklist-item">
                <span className="checklist-item-label">{label}</span>
                <div className="score-selector">
                  {[0, 1, 2].map((v) => (
                    <button
                      key={v}
                      className={itemScores[idx] === v ? "score-btn active" : "score-btn"}
                      onClick={() => setItemScores((prev) => ({ ...prev, [idx]: v }))}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="checklist-total">
              Total: {Object.values(itemScores).reduce((a, b) => a + b, 0)} / {test.items.length * 2}
            </div>
          </div>
        )}
      </div>

      {finalValue !== null && !isNaN(finalValue) && canSave && (
        <div className="result-preview" style={{ borderColor: toneColor(test.classify(finalValue, patient).tone) }}>
          <div className="result-preview-value">
            {finalValue} {test.unit}
          </div>
          <div className="result-preview-label" style={{ color: toneColor(test.classify(finalValue, patient).tone) }}>
            {test.classify(finalValue, patient).label}
          </div>
        </div>
      )}

      <button className="btn-primary btn-block" disabled={!canSave} onClick={handleSave}>
        <Check size={18} /> Salvar resultado
      </button>
    </div>
  );
}

function HistoryScreen({ testId, patient, results, onBack, onExportPdf, onStartTest }) {
  const test = TESTS[testId];
  const data = results
    .filter((r) => r.testId === testId)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((r) => ({ date: fmtDate(r.date), value: r.value, tone: r.tone, label: r.label, full: r.date, manual: r.manual }));

  return (
    <div className="screen">
      <TopBar
        title={test.name}
        onBack={onBack}
        right={
          data.length > 0 ? (
            <button className="icon-btn" onClick={onExportPdf} aria-label="Exportar este teste em PDF" title="Exportar PDF">
              <Printer size={18} />
            </button>
          ) : null
        }
      />
      <div className="protocol-card" style={{ borderLeftColor: CATEGORIES[test.category].color }}>
        {test.protocol}
      </div>

      {data.length === 0 ? (
        <div className="empty">
          <TrendingUp size={28} strokeWidth={1.5} />
          <p>Ainda não há registros deste teste.</p>
          <button className="run-btn go" style={{ marginTop: 6 }} onClick={onStartTest}>
            <Play size={20} /> Iniciar este teste agora
          </button>
        </div>
      ) : (
        <>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--ink-faint)" }} axisLine={{ stroke: "var(--line)" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--ink-faint)" }} axisLine={false} tickLine={false} unit={` ${test.unit}`} width={54} />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
                  formatter={(v) => [`${v} ${test.unit}`, test.name]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={CATEGORIES[test.category].color}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: CATEGORIES[test.category].color }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="list">
            {[...data].reverse().map((d, i) => (
              <div key={i} className="history-row">
                <div className="history-date">
                  <Calendar size={14} color="var(--ink-faint)" /> {d.date}
                </div>
                <div className="history-value">
                  {d.value} {test.unit}
                  {d.manual && <span className="manual-tag"> · manual</span>}
                </div>
                <Pill tone={d.tone}>{" "}</Pill>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReportView({ patient, results, scope }) {
  if (!patient) return null;
  const generatedAt = new Date().toLocaleString("pt-BR");
  const latestByTest = {};
  results.forEach((r) => {
    if (!latestByTest[r.testId] || r.date > latestByTest[r.testId].date) {
      latestByTest[r.testId] = r;
    }
  });

  const isSingleTest = scope && scope.mode === "test";
  const testIds = isSingleTest ? [scope.testId] : Object.keys(TESTS);

  return (
    <div className="report">
      <div className="report-header">
        <div>
          <div className="report-brand">Douglas Valeriano (Personal Sênior)</div>
          <div className="report-title">
            {isSingleTest ? `Evolução — ${TESTS[scope.testId].name}` : "Relatório de Avaliação Física"}
          </div>
        </div>
        <div className="report-meta">Gerado em {generatedAt}</div>
      </div>

      <div className="report-patient">
        <span><strong>{patient.name}</strong></span>
        <span>{patient.age} anos</span>
        <span>{patient.sex === "M" ? "Masculino" : "Feminino"}</span>
      </div>

      {!isSingleTest && (
        <table className="report-table">
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Teste</th>
              <th>Último valor</th>
              <th>Data</th>
              <th>Classificação</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(TESTS).map(([id, t]) => {
              const last = latestByTest[id];
              return (
                <tr key={id}>
                  <td>{CATEGORIES[t.category].label}</td>
                  <td>{t.name}</td>
                  <td>{last ? `${last.value} ${t.unit}` : "—"}</td>
                  <td>{last ? fmtDate(last.date) : "—"}</td>
                  <td>{last ? last.label : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {testIds.map((id) => {
        const test = TESTS[id];
        const rows = results
          .filter((r) => r.testId === id)
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        if (rows.length === 0) return null;
        return (
          <div key={id} className="report-block">
            <h3>{test.name} {isSingleTest ? "" : `— histórico (${rows.length} registro${rows.length > 1 ? "s" : ""})`}</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Valor</th>
                  <th>Classificação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.value} {test.unit}</td>
                    <td>{r.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="report-footer">
        Este relatório apresenta valores de referência gerais de literatura clínica publicada e serve como apoio ao
        acompanhamento. Não substitui a avaliação e o julgamento do profissional responsável.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   App shell
---------------------------------------------------------------- */

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [resultsByPatient, setResultsByPatient] = useState({});
  const [nav, setNav] = useState({ screen: "patients" });
  const [exportScope, setExportScope] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
      if (!u) {
        setPatients([]);
        setResultsByPatient({});
        setNav({ screen: "patients" });
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    (async () => {
      const p = await loadPatients(user.uid);
      setPatients(p);
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    const reset = () => setExportScope(null);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  const exportFullReport = () => {
    setExportScope({ mode: "full" });
    setTimeout(() => window.print(), 60);
  };
  const exportTestReport = (testId) => {
    setExportScope({ mode: "test", testId });
    setTimeout(() => window.print(), 60);
  };

  const openPatient = async (id) => {
    if (!resultsByPatient[id]) {
      const r = await loadResults(user.uid, id);
      setResultsByPatient((prev) => ({ ...prev, [id]: r }));
    }
    setNav({ screen: "patientDetail", patientId: id });
  };

  const addPatient = async (p) => {
    setPatients((prev) => [...prev, p]);
    await savePatientDoc(user.uid, p);
  };

  const updatePatient = async (updated) => {
    setPatients((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    await savePatientDoc(user.uid, updated);
    setNav({ screen: "patientDetail", patientId: updated.id });
  };

  const deletePatient = async (patientId) => {
    setPatients((prev) => prev.filter((p) => p.id !== patientId));
    setResultsByPatient((prev) => {
      const copy = { ...prev };
      delete copy[patientId];
      return copy;
    });
    await deletePatientDoc(user.uid, patientId);
    setNav({ screen: "patients" });
  };

  const saveResult = async (patientId, result) => {
    setResultsByPatient((prev) => ({
      ...prev,
      [patientId]: [...(prev[patientId] || []), result],
    }));
    await saveResultDoc(user.uid, patientId, result);
    setNav({ screen: "history", patientId, testId: result.testId });
  };

  if (!authChecked) {
    return (
      <div className="app-frame">
        <div className="loading-state">Carregando…</div>
        <Styles />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-frame">
        <LoginScreen />
        <Styles />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-frame">
        <div className="loading-state">Carregando…</div>
        <Styles />
      </div>
    );
  }

  const patient = patients.find((p) => p.id === nav.patientId);

  return (
    <div className="app-frame">
      <div className="no-print">
        {nav.screen === "patients" && (
          <PatientsScreen
            patients={patients}
            onOpen={openPatient}
            onAdd={addPatient}
            onLogout={() => signOut(auth)}
          />
        )}

        {nav.screen === "patientDetail" && patient && (
          <PatientDetailScreen
            patient={patient}
            results={resultsByPatient[patient.id] || []}
            onBack={() => setNav({ screen: "patients" })}
            onNewTest={() => setNav({ screen: "testSelect", patientId: patient.id })}
            onHistory={(testId) => setNav({ screen: "history", patientId: patient.id, testId })}
            onExportPdf={exportFullReport}
            onEdit={() => setNav({ screen: "patientEdit", patientId: patient.id })}
          />
        )}

        {nav.screen === "patientEdit" && patient && (
          <PatientEditScreen
            patient={patient}
            onBack={() => setNav({ screen: "patientDetail", patientId: patient.id })}
            onSave={updatePatient}
            onDelete={deletePatient}
          />
        )}

        {nav.screen === "testSelect" && patient && (
          <TestSelectScreen
            onBack={() => setNav({ screen: "patientDetail", patientId: patient.id })}
            onSelect={(testId) => setNav({ screen: "testRun", patientId: patient.id, testId })}
          />
        )}

        {nav.screen === "testRun" && patient && (
          <TestRunScreen
            testId={nav.testId}
            patient={patient}
            onBack={() => setNav({ screen: "testSelect", patientId: patient.id })}
            onSave={(result) => saveResult(patient.id, result)}
          />
        )}

        {nav.screen === "history" && patient && (
          <HistoryScreen
            testId={nav.testId}
            patient={patient}
            results={resultsByPatient[patient.id] || []}
            onBack={() => setNav({ screen: "patientDetail", patientId: patient.id })}
            onExportPdf={() => exportTestReport(nav.testId)}
            onStartTest={() => setNav({ screen: "testRun", patientId: patient.id, testId: nav.testId })}
          />
        )}
      </div>

      {exportScope && patient && (
        <div className="print-only">
          <ReportView patient={patient} results={resultsByPatient[patient.id] || []} scope={exportScope} />
        </div>
      )}

      <Styles />
    </div>
  );
}

/* ---------------------------------------------------------------
   Styles
---------------------------------------------------------------- */

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600;6..72,700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

      :root {
        --paper: #121212;
        --surface: #1E1E1E;
        --ink: #F5F1E8;
        --ink-faint: #9C9690;
        --accent: #FF7A29;
        --accent-dark: #E8590C;
        --teal: #2BC4B0;
        --ochre: #F2A93C;
        --slate: #6C9BD8;
        --brick: #F2665A;
        --line: #333333;
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.35);
        --shadow-md: 0 2px 6px rgba(0, 0, 0, 0.35), 0 6px 16px rgba(0, 0, 0, 0.4);
      }

      .app-frame {
        max-width: 420px;
        margin: 0 auto;
        background: var(--paper);
        color: var(--ink);
        font-family: 'IBM Plex Sans', sans-serif;
        min-height: 100vh;
        position: relative;
      }

      .loading-state {
        padding: 60px 20px;
        text-align: center;
        color: var(--ink-faint);
      }

      .screen {
        padding: 18px 18px 32px;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 4px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--line);
      }
      .topbar-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .topbar h1 {
        font-family: 'Newsreader', serif;
        font-weight: 600;
        font-size: 22px;
        margin: 0;
        letter-spacing: -0.01em;
        color: var(--ink);
      }
      .brand-mark {
        width: 32px;
        height: 32px;
        border-radius: 9px;
        background: var(--accent);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Newsreader', serif;
        font-weight: 600;
        font-size: 16px;
        box-shadow: var(--shadow-sm);
      }
      .icon-btn {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 9px;
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--ink);
        box-shadow: var(--shadow-sm);
      }
      .topbar-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }

      .subtitle {
        color: var(--ink-faint);
        font-size: 14px;
        margin: 2px 0 18px;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .empty {
        text-align: center;
        padding: 40px 10px;
        color: var(--ink-faint);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }
      .empty-sub { font-size: 13px; }

      .patient-row {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px 14px;
        text-align: left;
        cursor: pointer;
        color: var(--ink);
        box-shadow: var(--shadow-sm);
        transition: box-shadow 0.15s ease, transform 0.15s ease;
      }
      .patient-row:hover {
        box-shadow: var(--shadow-md);
        transform: translateY(-1px);
      }
      .patient-avatar {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Newsreader', serif;
        font-weight: 600;
        flex-shrink: 0;
      }
      .patient-info { flex: 1; }
      .patient-name { font-weight: 600; font-size: 15px; }
      .patient-meta { font-size: 12.5px; color: var(--ink-faint); margin-top: 1px; }

      .fab {
        width: 100%;
        margin-top: 18px;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 12px;
        padding: 14px;
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        box-sizing: border-box;
        box-shadow: var(--shadow-md);
      }

      .form-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 16px;
        margin-top: 10px;
        box-shadow: var(--shadow-sm);
      }
      .form-row { margin-bottom: 12px; }
      .form-row label {
        display: block;
        font-size: 12.5px;
        color: var(--ink-faint);
        margin-bottom: 5px;
      }
      .form-row input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 9px;
        padding: 10px 11px;
        font-size: 15px;
        font-family: inherit;
        background: var(--paper);
        color: var(--ink);
        box-sizing: border-box;
      }
      .form-row-split {
        display: grid;
        grid-template-columns: 1fr 1.4fr;
        gap: 10px;
      }
      .segmented {
        display: flex;
        border: 1px solid var(--line);
        border-radius: 9px;
        overflow: hidden;
      }
      .seg {
        flex: 1;
        border: none;
        background: var(--paper);
        padding: 10px 6px;
        font-size: 12.5px;
        font-family: inherit;
        cursor: pointer;
        color: var(--ink-faint);
      }
      .seg.active { background: var(--accent); color: #fff; }
      .mode-toggle { margin-bottom: 18px; }
      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }
      .btn-ghost {
        flex: 1;
        background: transparent;
        border: 1px solid var(--line);
        border-radius: 9px;
        padding: 11px;
        font-family: inherit;
        font-size: 14px;
        cursor: pointer;
        color: var(--ink);
      }
      .btn-primary {
        flex: 1;
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 9px;
        padding: 11px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-shadow: var(--shadow-sm);
      }
      .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

      .login-error {
        color: var(--brick);
        font-size: 13px;
        margin: -4px 0 10px;
        line-height: 1.4;
      }
      .link-btn {
        width: 100%;
        background: transparent;
        border: none;
        color: var(--accent);
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 600;
        text-align: center;
        margin-top: 12px;
        cursor: pointer;
        padding: 4px;
      }
      .btn-block { width: 100%; padding: 13px; margin-top: 16px; }

      .cat-block { margin-bottom: 18px; }
      .cat-heading {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-faint);
        text-transform: none;
        margin-bottom: 8px;
      }
      .cat-dot { width: 7px; height: 7px; border-radius: 50%; }

      .test-row {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-left: 4px solid;
        border-radius: 10px;
        padding: 11px 13px;
        margin-bottom: 7px;
        width: 100%;
        text-align: left;
        cursor: pointer;
        color: var(--ink);
        box-shadow: var(--shadow-sm);
      }
      .test-row-main { flex: 1; }
      .test-row-name { font-weight: 600; font-size: 14px; }
      .test-row-value { font-size: 12.5px; color: var(--ink-faint); margin-top: 2px; }
      .test-row-empty { font-style: italic; }

      .pill {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--line);
      }
      .tab {
        flex: 1;
        background: none;
        border: none;
        border-bottom: 2.5px solid transparent;
        padding: 9px 4px 11px;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--ink-faint);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }

      .test-pick {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 13px;
        text-align: left;
        cursor: pointer;
        color: var(--ink);
        box-shadow: var(--shadow-sm);
      }
      .test-pick-name { font-weight: 600; font-size: 14.5px; margin-bottom: 4px; }
      .test-pick-protocol { font-size: 12.5px; color: var(--ink-faint); line-height: 1.5; }

      .protocol-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-left: 4px solid;
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 13px;
        color: var(--ink-faint);
        line-height: 1.55;
        margin-bottom: 20px;
        box-shadow: var(--shadow-sm);
      }

      .run-stage {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 22px 0 10px;
      }
      .big-number {
        font-family: 'Newsreader', serif;
        font-weight: 600;
        font-size: 56px;
        line-height: 1;
        color: var(--ink);
      }
      .big-number span {
        font-family: 'IBM Plex Sans', sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: var(--ink-faint);
        margin-left: 6px;
      }
      .cap-note { font-size: 12px; color: var(--ink-faint); margin-top: -8px; }
      .derived {
        font-family: 'Newsreader', serif;
        font-size: 22px;
        font-weight: 600;
        color: var(--slate);
      }
      .run-btn {
        border: none;
        border-radius: 40px;
        padding: 14px 28px;
        font-family: inherit;
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        color: #fff;
        box-shadow: var(--shadow-md);
      }
      .run-btn.go { background: var(--accent); }
      .run-btn.stop { background: var(--brick); }
      .run-btn.reset {
        background: transparent;
        color: var(--ink-faint);
        border: 1px solid var(--line);
        box-shadow: none;
      }
      .counter-value {
        font-family: 'Newsreader', serif;
        font-size: 44px;
        font-weight: 600;
      }
      .counter-label { font-size: 12.5px; color: var(--ink-faint); margin-top: -12px; }
      .tap-btn {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: var(--ochre);
        color: #fff;
        border: none;
        font-family: 'Newsreader', serif;
        font-size: 26px;
        font-weight: 600;
        box-shadow: var(--shadow-md);
        cursor: pointer;
      }
      .tap-btn:disabled { opacity: 0.4; }

      .manual-entry {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px 16px;
        width: 100%;
        box-sizing: border-box;
        box-shadow: var(--shadow-sm);
      }
      .manual-entry input {
        flex: 1;
        border: none;
        background: transparent;
        font-family: 'Newsreader', serif;
        font-size: 28px;
        font-weight: 600;
        color: var(--ink);
        outline: none;
        width: 100%;
        min-width: 0;
      }
      .unit-tag { font-size: 13px; color: var(--ink-faint); }

      .checklist {
        display: flex;
        flex-direction: column;
        gap: 9px;
        width: 100%;
      }
      .checklist-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 11px 13px;
        box-shadow: var(--shadow-sm);
      }
      .checklist-item-label {
        font-size: 12.8px;
        line-height: 1.45;
        flex: 1;
      }
      .score-selector {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }
      .score-btn {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: var(--paper);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        color: var(--ink-faint);
      }
      .score-btn.active {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
      }
      .checklist-total {
        text-align: center;
        font-family: 'Newsreader', serif;
        font-weight: 600;
        font-size: 16px;
        margin-top: 4px;
        padding-top: 8px;
        border-top: 1px solid var(--line);
      }

      .danger-zone {
        margin-top: 24px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
      }
      .btn-danger-ghost {
        width: 100%;
        background: transparent;
        border: 1px solid var(--line);
        border-radius: 9px;
        padding: 11px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        color: var(--brick);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
      }
      .confirm-card {
        background: var(--surface);
        border: 1.5px solid var(--brick);
        border-radius: 10px;
        padding: 14px;
        box-shadow: var(--shadow-sm);
      }
      .confirm-card p {
        font-size: 13px;
        line-height: 1.55;
        color: var(--ink);
        margin: 0 0 12px;
      }
      .btn-danger {
        flex: 1;
        background: var(--brick);
        color: #fff;
        border: none;
        border-radius: 9px;
        padding: 11px;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }

      .result-preview {
        margin-top: 18px;
        border: 1.5px solid;
        border-radius: 10px;
        padding: 12px 14px;
        text-align: center;
        background: var(--surface);
        box-shadow: var(--shadow-sm);
      }
      .result-preview-value {
        font-family: 'Newsreader', serif;
        font-size: 18px;
        font-weight: 600;
      }
      .result-preview-label { font-size: 13px; margin-top: 2px; font-weight: 500; }

      .chart-wrap {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px 6px 4px;
        margin-bottom: 16px;
        box-shadow: var(--shadow-sm);
      }

      .history-row {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 9px;
        padding: 10px 13px;
        box-shadow: var(--shadow-sm);
      }
      .history-date {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 12.5px;
        color: var(--ink-faint);
        width: 74px;
        flex-shrink: 0;
      }
      .history-value { flex: 1; font-weight: 600; font-size: 14px; }
      .manual-tag { font-weight: 500; font-size: 12px; color: var(--ink-faint); font-style: italic; }

      .print-only { display: none; }

      .report {
        font-family: 'IBM Plex Sans', sans-serif;
        color: #1F1E1A;
        padding: 24px;
      }
      .report-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        border-bottom: 2px solid var(--accent-dark);
        padding-bottom: 12px;
        margin-bottom: 16px;
      }
      .report-brand {
        font-family: 'Newsreader', serif;
        font-weight: 600;
        font-size: 15px;
        color: var(--accent-dark);
      }
      .report-title {
        font-family: 'Newsreader', serif;
        font-weight: 600;
        font-size: 21px;
        margin-top: 2px;
      }
      .report-meta { font-size: 12px; color: var(--ink-faint); }
      .report-patient {
        display: flex;
        gap: 16px;
        font-size: 13.5px;
        margin-bottom: 20px;
        color: var(--ink-faint);
      }
      .report-patient strong { color: var(--ink); }
      .report-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
        font-size: 12.5px;
      }
      .report-table th {
        text-align: left;
        border-bottom: 1.5px solid var(--ink);
        padding: 6px 8px;
        font-weight: 600;
      }
      .report-table td {
        border-bottom: 1px solid var(--line);
        padding: 6px 8px;
      }
      .report-block { margin-bottom: 18px; }
      .report-block h3 {
        font-family: 'Newsreader', serif;
        font-size: 14.5px;
        font-weight: 600;
        margin: 0 0 8px;
      }
      .report-footer {
        font-size: 11px;
        color: var(--ink-faint);
        border-top: 1px solid var(--line);
        padding-top: 12px;
        margin-top: 8px;
        line-height: 1.5;
      }

      @media print {
        .no-print { display: none !important; }
        .print-only { display: block !important; }
        .app-frame {
          max-width: none;
          border-radius: 0;
          min-height: 0;
          background: #fff;
        }
      }
    `}</style>
  );
}
