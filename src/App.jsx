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
  ChevronLeft,
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
  Settings,
  Folder,
  Apple,
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
  getDoc,
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
  nutrition: { label: "Nutrição", color: "var(--sage)", icon: Apple },
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

const SARCF_ITEMS = [
  "Força: dificuldade para levantar e carregar objetos de cerca de 4,5 kg (0 = nenhuma, 1 = alguma, 2 = muita ou incapaz)",
  "Deambulação: dificuldade para atravessar um cômodo (0 = nenhuma, 1 = alguma, 2 = muita, usa apoio ou incapaz)",
  "Levantar: dificuldade para se levantar de uma cadeira ou cama (0 = nenhuma, 1 = alguma, 2 = muita ou incapaz sem ajuda)",
  "Escadas: dificuldade para subir um lance de 10 degraus (0 = nenhuma, 1 = alguma, 2 = muita ou incapaz)",
  "Quedas: número de quedas no último ano (0 = nenhuma, 1 = 1 a 3 quedas, 2 = 4 ou mais quedas)",
];

const MNA_SF_ITEMS = [
  {
    label:
      "A. Nos últimos 3 meses, houve diminuição da ingestão alimentar por perda de apetite, problemas digestivos, ou dificuldade para mastigar ou engolir?",
    options: [
      { score: 0, label: "Diminuição grave da ingestão" },
      { score: 1, label: "Diminuição moderada da ingestão" },
      { score: 2, label: "Sem diminuição da ingestão" },
    ],
  },
  {
    label: "B. Perda de peso nos últimos 3 meses?",
    options: [
      { score: 0, label: "Perda de peso maior que 3 kg" },
      { score: 1, label: "Não sabe informar" },
      { score: 2, label: "Perda de peso entre 1 e 3 kg" },
      { score: 3, label: "Sem perda de peso" },
    ],
  },
  {
    label: "C. Mobilidade",
    options: [
      { score: 0, label: "Restrito ao leito ou à cadeira de rodas" },
      { score: 1, label: "Deambula, mas não sai de casa" },
      { score: 2, label: "Sai de casa normalmente" },
    ],
  },
  {
    label: "D. Passou por algum estresse psicológico ou doença aguda nos últimos 3 meses?",
    options: [
      { score: 0, label: "Sim" },
      { score: 2, label: "Não" },
    ],
  },
  {
    label: "E. Problemas neuropsicológicos",
    options: [
      { score: 0, label: "Demência ou depressão grave" },
      { score: 1, label: "Demência leve" },
      { score: 2, label: "Sem problemas psicológicos" },
    ],
  },
  {
    label: "F. Índice de Massa Corporal (IMC)",
    showImcReference: true,
    options: [
      { score: 0, label: "IMC menor que 19" },
      { score: 1, label: "IMC entre 19 e menos de 21" },
      { score: 2, label: "IMC entre 21 e menos de 23" },
      { score: 3, label: "IMC 23 ou mais" },
    ],
  },
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
  strength_sarcf: {
    category: "strength",
    name: "SARC-CalF (rastreio de sarcopenia)",
    unit: "pontos",
    input: "checklist",
    items: SARCF_ITEMS,
    showCalfReference: true,
    protocol:
      "Questionário SARC-F combinado com a circunferência da panturrilha (SARC-CalF), para maior sensibilidade no rastreio de sarcopenia. Para cada item, pontue conforme os critérios descritos (0, 1 ou 2), somando 0 a 10 pontos no SARC-F. Se a circunferência da panturrilha estiver abaixo do ponto de corte (< 34 cm em homens, < 33 cm em mulheres), são somados +10 pontos automaticamente. Pontuação combinada ≥ 11 indica rastreio positivo.",
    classify: (total, patient) => {
      const calf =
        patient.health && patient.health.calf ? parseFloat(patient.health.calf) : null;
      if (calf) {
        const cutoff = patient.sex === "M" ? 34 : 33;
        const belowCutoff = calf < cutoff;
        const combined = total + (belowCutoff ? 10 : 0);
        if (combined >= 11)
          return {
            label: `SARC-CalF: ${combined} pts — rastreio positivo, investigar sarcopenia`,
            tone: "high",
          };
        return {
          label: `SARC-CalF: ${combined} pts — rastreio negativo (baixo risco)`,
          tone: "good",
        };
      }
      if (total >= 4)
        return {
          label: "SARC-F: rastreio positivo (panturrilha não registrada)",
          tone: "high",
        };
      return {
        label: "SARC-F: rastreio negativo (panturrilha não registrada)",
        tone: "good",
      };
    },
  },
  nutrition_mnasf: {
    category: "nutrition",
    name: "MNA-SF (Mini Avaliação Nutricional)",
    unit: "pontos",
    input: "mnasf",
    items: MNA_SF_ITEMS,
    protocol:
      "Ferramenta validada de rastreio nutricional para idosos. Responda os 6 itens (A a F). No item F, use o IMC já cadastrado no perfil do paciente como referência. Pontuação total de 0 a 14: 12–14 estado nutricional normal, 8–11 risco de desnutrição, 0–7 desnutrido.",
    classify: (total) => {
      if (total >= 12)
        return { label: "Estado nutricional normal", tone: "good" };
      if (total >= 8)
        return { label: "Risco de desnutrição", tone: "mid" };
      return { label: "Desnutrido", tone: "high" };
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

function fmtISODate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}


function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const DEFAULT_UBS_LIST = [
  "UBS 1", "UBS 2", "UBS 3", "UBS 4", "UBS 5",
  "UBS 6", "UBS 7", "UBS 8", "UBS 9", "UBS 10",
];

function getUbsName(ubsList, ubsId) {
  if (!ubsId) return "";
  const idx = parseInt(ubsId.replace("ubs", ""), 10) - 1;
  return (ubsList && ubsList[idx]) || ubsId;
}

function calcAgeFromBirthDate(birthDateIso) {
  if (!birthDateIso) return null;
  const [y, m, d] = birthDateIso.split("-").map(Number);
  const birth = new Date(y, m - 1, d);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
}

const EMPTY_HEALTH = {
  weight: "",
  height: "",
  bpSystolic: "",
  bpDiastolic: "",
  heartRate: "",
  glucose: "",
  spo2: "",
  calf: "",
  gripLeft1: "",
  gripLeft2: "",
  gripRight1: "",
  gripRight2: "",
};

function avgPair(a, b) {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (isNaN(na) && isNaN(nb)) return null;
  if (isNaN(na)) return nb.toFixed(1);
  if (isNaN(nb)) return na.toFixed(1);
  return ((na + nb) / 2).toFixed(1);
}

function calcImc(weight, height) {
  const w = parseFloat(weight);
  const hCm = parseFloat(height);
  if (!w || !hCm) return null;
  const hM = hCm / 100;
  if (hM <= 0) return null;
  return (w / (hM * hM)).toFixed(1);
}

/* ---------------------------------------------------------------
   Firestore helpers (data is scoped under users/{uid}/...)
---------------------------------------------------------------- */

async function loadUbsList(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "settings", "ubs"));
    if (snap.exists() && Array.isArray(snap.data().names) && snap.data().names.length === 10) {
      return snap.data().names;
    }
    return DEFAULT_UBS_LIST;
  } catch {
    return DEFAULT_UBS_LIST;
  }
}
async function saveUbsList(uid, names) {
  try {
    await setDoc(doc(db, "users", uid, "settings", "ubs"), { names });
  } catch {}
}

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

async function loadAulas(uid) {
  try {
    const snap = await getDocs(collection(db, "users", uid, "aulas"));
    return snap.docs.map((d) => d.data());
  } catch {
    return [];
  }
}
async function saveAulaDoc(uid, aula) {
  try {
    await setDoc(doc(db, "users", uid, "aulas", aula.id), aula);
  } catch {}
}
async function deleteAulaDoc(uid, aulaId) {
  try {
    await deleteDoc(doc(db, "users", uid, "aulas", aulaId));
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
          <div className="brand-mark">E</div>
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

function HealthFields({ health, onChange }) {
  const set = (key) => (e) => onChange({ [key]: e.target.value });
  const imc = calcImc(health.weight, health.height);
  const avgLeft = avgPair(health.gripLeft1, health.gripLeft2);
  const avgRight = avgPair(health.gripRight1, health.gripRight2);

  return (
    <>
      <div className="form-section-title">Dados de saúde (opcional)</div>

      <div className="form-row form-row-split">
        <div>
          <label>Peso (kg)</label>
          <input type="number" inputMode="decimal" value={health.weight} onChange={set("weight")} placeholder="Ex: 68" />
        </div>
        <div>
          <label>Altura (cm)</label>
          <input type="number" inputMode="decimal" value={health.height} onChange={set("height")} placeholder="Ex: 160" />
        </div>
      </div>
      {imc && (
        <div className="imc-display">
          IMC calculado: <strong>{imc}</strong> kg/m²
        </div>
      )}

      <div className="form-row form-row-split3">
        <div>
          <label>PA sistólica</label>
          <input type="number" inputMode="decimal" value={health.bpSystolic} onChange={set("bpSystolic")} placeholder="120" />
        </div>
        <div>
          <label>PA diastólica</label>
          <input type="number" inputMode="decimal" value={health.bpDiastolic} onChange={set("bpDiastolic")} placeholder="80" />
        </div>
        <div>
          <label>BPM</label>
          <input type="number" inputMode="decimal" value={health.heartRate} onChange={set("heartRate")} placeholder="72" />
        </div>
      </div>

      <div className="form-row form-row-split">
        <div>
          <label>Glicemia (mg/dL)</label>
          <input type="number" inputMode="decimal" value={health.glucose} onChange={set("glucose")} placeholder="Ex: 95" />
        </div>
        <div>
          <label>SpO2 (%)</label>
          <input type="number" inputMode="decimal" value={health.spo2} onChange={set("spo2")} placeholder="Ex: 97" />
        </div>
      </div>

      <div className="form-row">
        <label>Circunferência da panturrilha (cm)</label>
        <input type="number" inputMode="decimal" value={health.calf} onChange={set("calf")} placeholder="Ex: 33" />
      </div>

      <div className="form-row">
        <label>Força de preensão manual (kg)</label>
        <div className="grip-grid">
          <div className="grip-col">
            <div className="grip-col-label">Esquerda</div>
            <input type="number" inputMode="decimal" placeholder="Rep. 1" value={health.gripLeft1} onChange={set("gripLeft1")} />
            <input type="number" inputMode="decimal" placeholder="Rep. 2" value={health.gripLeft2} onChange={set("gripLeft2")} />
            {avgLeft && <div className="grip-avg">Média: {avgLeft} kg</div>}
          </div>
          <div className="grip-col">
            <div className="grip-col-label">Direita</div>
            <input type="number" inputMode="decimal" placeholder="Rep. 1" value={health.gripRight1} onChange={set("gripRight1")} />
            <input type="number" inputMode="decimal" placeholder="Rep. 2" value={health.gripRight2} onChange={set("gripRight2")} />
            {avgRight && <div className="grip-avg">Média: {avgRight} kg</div>}
          </div>
        </div>
      </div>
    </>
  );
}

function HealthSummary({ health }) {
  if (!health) return null;
  const rows = [
    ["Peso", health.weight ? `${health.weight} kg` : null],
    ["Altura", health.height ? `${health.height} cm` : null],
    ["IMC", health.imc ? `${health.imc} kg/m²` : null],
    [
      "Pressão arterial",
      health.bpSystolic || health.bpDiastolic
        ? `${health.bpSystolic || "—"}/${health.bpDiastolic || "—"} mmHg`
        : null,
    ],
    ["Frequência cardíaca", health.heartRate ? `${health.heartRate} bpm` : null],
    ["Glicemia", health.glucose ? `${health.glucose} mg/dL` : null],
    ["SpO2", health.spo2 ? `${health.spo2}%` : null],
    ["Circunf. panturrilha", health.calf ? `${health.calf} cm` : null],
  ].filter(([, v]) => v);

  const gripLeftAvg = avgPair(health.gripLeft1, health.gripLeft2);
  const gripRightAvg = avgPair(health.gripRight1, health.gripRight2);
  if (gripLeftAvg) rows.push(["Preensão esquerda (média)", `${gripLeftAvg} kg`]);
  if (gripRightAvg) rows.push(["Preensão direita (média)", `${gripRightAvg} kg`]);

  if (rows.length === 0) return null;

  return (
    <div className="health-summary">
      {rows.map(([label, value]) => (
        <div key={label} className="health-summary-row">
          <span className="health-summary-label">{label}</span>
          <span className="health-summary-value">{value}</span>
        </div>
      ))}
    </div>
  );
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
    <div className="screen screen-bg-login">
      <TopBar title="Acompanhamento de unidades e pacientes (Emulti)" />
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

function UBSFoldersScreen({ patients, ubsList, onOpenUbs, onSettings, onLogout }) {
  const noUbsCount = patients.filter((p) => !p.ubsId).length;

  return (
    <div className="screen screen-with-nav screen-bg-folders">
      <TopBar
        title="Acompanhamento de unidades e pacientes (Emulti)"
        right={
          <div className="topbar-actions">
            <button className="icon-btn" onClick={onSettings} aria-label="Gerenciar UBS" title="Gerenciar UBS">
              <Settings size={18} />
            </button>
            <button className="icon-btn" onClick={onLogout} aria-label="Sair" title="Sair da conta">
              <LogOut size={18} />
            </button>
          </div>
        }
      />
      <p className="subtitle">Selecione uma UBS para ver os pacientes</p>

      <div className="list">
        {ubsList.map((ubsName, idx) => {
          const id = `ubs${idx + 1}`;
          const count = patients.filter((p) => p.ubsId === id).length;
          return (
            <button key={id} className="ubs-folder-row" onClick={() => onOpenUbs(id, ubsName)}>
              <div className="ubs-folder-icon">
                <Folder size={20} />
              </div>
              <div className="ubs-folder-info">
                <div className="ubs-folder-name">{ubsName}</div>
                <div className="ubs-folder-count">
                  {count} paciente{count !== 1 ? "s" : ""}
                </div>
              </div>
              <ChevronRight size={18} color="var(--ink-faint)" />
            </button>
          );
        })}

        {noUbsCount > 0 && (
          <button className="ubs-folder-row" onClick={() => onOpenUbs(null, "Sem UBS")}>
            <div className="ubs-folder-icon">
              <Folder size={20} />
            </div>
            <div className="ubs-folder-info">
              <div className="ubs-folder-name">Sem UBS</div>
              <div className="ubs-folder-count">
                {noUbsCount} paciente{noUbsCount !== 1 ? "s" : ""}
              </div>
            </div>
            <ChevronRight size={18} color="var(--ink-faint)" />
          </button>
        )}
      </div>
    </div>
  );
}

function PatientsInUbsScreen({ patients, ubsId, ubsName, onOpen, onAdd, onBack }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [cpf, setCpf] = useState("");
  const [susNumber, setSusNumber] = useState("");
  const [sex, setSex] = useState("F");
  const [health, setHealth] = useState(EMPTY_HEALTH);
  const updateHealth = (patch) => setHealth((prev) => ({ ...prev, ...patch }));

  const handleBirthDateChange = (val) => {
    setBirthDate(val);
    const computed = calcAgeFromBirthDate(val);
    if (computed !== null) setAge(String(computed));
  };

  const submit = () => {
    if (!name.trim() || !age) return;
    const imc = calcImc(health.weight, health.height);
    onAdd({
      id: uid(),
      name: name.trim(),
      age: parseInt(age, 10),
      birthDate: birthDate || null,
      cpf: cpf.trim() || null,
      susNumber: susNumber.trim() || null,
      sex,
      ubsId: ubsId,
      health: { ...health, imc },
    });
    setName("");
    setAge("");
    setBirthDate("");
    setCpf("");
    setSusNumber("");
    setSex("F");
    setHealth(EMPTY_HEALTH);
    setShowForm(false);
  };

  const filteredPatients = ubsId
    ? patients.filter((p) => p.ubsId === ubsId)
    : patients.filter((p) => !p.ubsId);

  return (
    <div className="screen">
      <TopBar title={ubsName} onBack={onBack} />
      <p className="subtitle">
        {filteredPatients.length} paciente{filteredPatients.length !== 1 ? "s" : ""}
      </p>

      <div className="list">
        {filteredPatients.length === 0 && !showForm && (
          <div className="empty">
            <User size={28} strokeWidth={1.5} />
            <p>Nenhum paciente cadastrado nesta UBS ainda.</p>
            <p className="empty-sub">Adicione o primeiro para começar uma avaliação.</p>
          </div>
        )}
        {filteredPatients.map((p) => (
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
              <label>Data de nascimento</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => handleBirthDateChange(e.target.value)}
              />
            </div>
            <div>
              <label>Idade</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="Ex: 72"
              />
            </div>
          </div>

          <div className="form-row">
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

          <div className="form-row form-row-split">
            <div>
              <label>CPF</label>
              <input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                placeholder="000.000.000-00"
              />
            </div>
            <div>
              <label>Cartão SUS</label>
              <input
                inputMode="numeric"
                value={susNumber}
                onChange={(e) => setSusNumber(e.target.value)}
                placeholder="Número do cartão"
              />
            </div>
          </div>

          <HealthFields health={health} onChange={updateHealth} />

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

function PatientDetailScreen({ patient, results, onBack, onNewTest, onHistory, onExportPdf, onEdit, onSaveNotes }) {
  const [notesText, setNotesText] = useState(patient.notes || "");
  const [notesSaved, setNotesSaved] = useState(false);

  const handleSaveNotes = () => {
    onSaveNotes(notesText);
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 1800);
  };

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

      {(patient.birthDate || patient.cpf || patient.susNumber) && (
        <div className="patient-ids">
          {patient.birthDate && (
            <span>Nasc.: {fmtISODate(patient.birthDate)}</span>
          )}
          {patient.cpf && <span>CPF: {patient.cpf}</span>}
          {patient.susNumber && <span>SUS: {patient.susNumber}</span>}
        </div>
      )}

      <HealthSummary health={patient.health} />

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

      <div className="form-card patient-notes-card">
        <div className="form-row">
          <label>Observações</label>
          <textarea
            rows={4}
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Escreva suas observações sobre este paciente..."
          />
        </div>
        <div className="form-actions">
          <button className="btn-primary" onClick={handleSaveNotes}>
            <Check size={16} /> {notesSaved ? "Salvo!" : "Salvar observações"}
          </button>
        </div>
      </div>

      <button className="fab" onClick={onNewTest}>
        <Plus size={20} /> Nova avaliação
      </button>
    </div>
  );
}

function BottomNav({ active, onNavigate }) {
  return (
    <div className="bottom-nav">
      <button
        className={active === "patients" ? "bottom-nav-item active" : "bottom-nav-item"}
        onClick={() => onNavigate("patients")}
      >
        <User size={20} />
        <span>Pacientes</span>
      </button>
      <button
        className={active === "calendar" ? "bottom-nav-item active" : "bottom-nav-item"}
        onClick={() => onNavigate("calendar")}
      >
        <Calendar size={20} />
        <span>Aulas</span>
      </button>
    </div>
  );
}

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

function CalendarScreen({ aulas, onSelectDay }) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const aulaDatesSet = new Set(aulas.map((a) => a.date));
  const monthLabel = viewDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const todayStr = new Date().toISOString().slice(0, 10);

  const isoFor = (d) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="screen screen-with-nav">
      <TopBar title="Aulas" />
      <p className="subtitle">Toque numa data para ver ou cadastrar uma aula</p>

      <div className="calendar-nav">
        <button
          className="icon-btn"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          aria-label="Mês anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="calendar-month-label">{monthLabel}</div>
        <button
          className="icon-btn"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          aria-label="Próximo mês"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="calendar-grid calendar-weekdays">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i} className="calendar-weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="calendar-cell empty" />;
          const iso = isoFor(d);
          const hasAula = aulaDatesSet.has(iso);
          const isToday = iso === todayStr;
          return (
            <button
              key={i}
              className={`calendar-cell${isToday ? " today" : ""}`}
              onClick={() => onSelectDay(iso)}
            >
              {d}
              {hasAula && <span className="calendar-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayScreen({ dateIso, aulas, ubsList, onBack, onNewAula, onOpenAula }) {
  const dayAulas = aulas.filter((a) => a.date === dateIso);
  const label = new Date(dateIso + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="screen">
      <TopBar title="Aulas do dia" onBack={onBack} />
      <p className="subtitle">{label}</p>

      <div className="list">
        {dayAulas.length === 0 && (
          <div className="empty">
            <Calendar size={28} strokeWidth={1.5} />
            <p>Nenhuma aula registrada nesse dia.</p>
          </div>
        )}
        {dayAulas.map((a) => (
          <button key={a.id} className="aula-row" onClick={() => onOpenAula(a.id)}>
            <div className="aula-row-main">
              <div className="aula-row-title">{a.title || "Aula"}</div>
              <div className="aula-row-meta">
                {a.time ? `${a.time} · ` : ""}
                {a.ubsId ? `${getUbsName(ubsList, a.ubsId)} · ` : ""}
                {a.participantIds.length} participante{a.participantIds.length !== 1 ? "s" : ""}
              </div>
            </div>
            <ChevronRight size={18} color="var(--ink-faint)" />
          </button>
        ))}
      </div>

      <button className="fab" onClick={onNewAula}>
        <Plus size={20} /> Nova aula
      </button>
    </div>
  );
}

function AulaFormScreen({ aula, dateIso, patients, ubsList, onBack, onSave, onDelete }) {
  const [title, setTitle] = useState(aula ? aula.title : "");
  const [time, setTime] = useState(aula ? aula.time || "" : "");
  const [ubsId, setUbsId] = useState(aula ? aula.ubsId || "" : "");
  const [participantIds, setParticipantIds] = useState(aula ? aula.participantIds : []);
  const [search, setSearch] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const label = new Date(dateIso + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const toggleParticipant = (id) => {
    setParticipantIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filteredPatients = patients.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      id: aula ? aula.id : uid(),
      date: dateIso,
      title: title.trim(),
      time,
      ubsId: ubsId || null,
      participantIds,
    });
  };

  return (
    <div className="screen">
      <TopBar title={aula ? "Editar aula" : "Nova aula"} onBack={onBack} />
      <p className="subtitle">{label}</p>

      <div className="form-card">
        <div className="form-row">
          <label>Título da aula</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Equilíbrio - Turma A"
          />
        </div>
        <div className="form-row form-row-split">
          <div>
            <label>Horário</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <label>UBS</label>
            <select value={ubsId} onChange={(e) => setUbsId(e.target.value)}>
              <option value="">—</option>
              {ubsList.map((name, idx) => (
                <option key={idx} value={`ubs${idx + 1}`}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="form-section-title">Participantes ({participantIds.length})</div>
      <input
        className="participant-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar paciente..."
      />
      <div className="list" style={{ marginTop: 10 }}>
        {filteredPatients.length === 0 && (
          <div className="empty">
            <User size={24} strokeWidth={1.5} />
            <p>Nenhum paciente encontrado.</p>
          </div>
        )}
        {filteredPatients.map((p) => {
          const checked = participantIds.includes(p.id);
          return (
            <button
              key={p.id}
              className={checked ? "participant-row active" : "participant-row"}
              onClick={() => toggleParticipant(p.id)}
            >
              <div className="patient-avatar">{p.name.charAt(0).toUpperCase()}</div>
              <div className="patient-info">
                <div className="patient-name">{p.name}</div>
                <div className="patient-meta">
                  {p.ubsId ? getUbsName(ubsList, p.ubsId) : "Sem UBS"}
                </div>
              </div>
              {checked && <Check size={18} color="var(--accent)" />}
            </button>
          );
        })}
      </div>

      <button className="btn-primary btn-block" disabled={!title.trim()} onClick={submit}>
        <Check size={18} /> Salvar aula
      </button>

      {aula && (
        <div className="danger-zone">
          {!confirmingDelete ? (
            <button className="btn-danger-ghost" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={16} /> Excluir aula
            </button>
          ) : (
            <div className="confirm-card">
              <p>
                Isso apagará esta aula e a lista de participantes. Esta ação não pode ser
                desfeita.
              </p>
              <div className="form-actions">
                <button className="btn-ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancelar
                </button>
                <button className="btn-danger" onClick={() => onDelete(aula.id)}>
                  <Trash2 size={16} /> Excluir definitivamente
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UBSSettingsScreen({ ubsList, onBack, onSave }) {
  const [names, setNames] = useState(ubsList);

  const setName = (idx, val) => {
    setNames((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  return (
    <div className="screen">
      <TopBar title="Gerenciar UBS" onBack={onBack} />
      <p className="subtitle">Dê um nome a cada uma das 10 unidades</p>

      <div className="form-card">
        {names.map((name, idx) => (
          <div key={idx} className="form-row">
            <label>UBS {idx + 1}</label>
            <input
              value={name}
              onChange={(e) => setName(idx, e.target.value)}
              placeholder={`UBS ${idx + 1}`}
            />
          </div>
        ))}
        <div className="form-actions">
          <button className="btn-ghost" onClick={onBack}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={() => onSave(names)}>
            <Check size={16} /> Salvar unidades
          </button>
        </div>
      </div>
    </div>
  );
}

function PatientEditScreen({ patient, onBack, onSave, onDelete, ubsList }) {
  const [name, setName] = useState(patient.name);
  const [age, setAge] = useState(String(patient.age));
  const [birthDate, setBirthDate] = useState(patient.birthDate || "");
  const [cpf, setCpf] = useState(patient.cpf || "");
  const [susNumber, setSusNumber] = useState(patient.susNumber || "");
  const [sex, setSex] = useState(patient.sex);
  const [ubsId, setUbsId] = useState(patient.ubsId || "ubs1");
  const [health, setHealth] = useState(patient.health || EMPTY_HEALTH);
  const updateHealth = (patch) => setHealth((prev) => ({ ...prev, ...patch }));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleBirthDateChange = (val) => {
    setBirthDate(val);
    const computed = calcAgeFromBirthDate(val);
    if (computed !== null) setAge(String(computed));
  };

  const submit = () => {
    if (!name.trim() || !age) return;
    const imc = calcImc(health.weight, health.height);
    onSave({
      ...patient,
      name: name.trim(),
      age: parseInt(age, 10),
      birthDate: birthDate || null,
      cpf: cpf.trim() || null,
      susNumber: susNumber.trim() || null,
      sex,
      ubsId,
      health: { ...health, imc },
    });
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
            <label>Data de nascimento</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => handleBirthDateChange(e.target.value)}
            />
          </div>
          <div>
            <label>Idade</label>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Ex: 72"
            />
          </div>
        </div>

        <div className="form-row">
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

        <div className="form-row form-row-split">
          <div>
            <label>CPF</label>
            <input
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
            />
          </div>
          <div>
            <label>Cartão SUS</label>
            <input
              inputMode="numeric"
              value={susNumber}
              onChange={(e) => setSusNumber(e.target.value)}
              placeholder="Número do cartão"
            />
          </div>
        </div>

        <div className="form-row">
          <label>UBS de origem</label>
          <select value={ubsId} onChange={(e) => setUbsId(e.target.value)}>
            {ubsList.map((ubsName, idx) => (
              <option key={idx} value={`ubs${idx + 1}`}>
                {ubsName}
              </option>
            ))}
          </select>
        </div>

        <HealthFields health={health} onChange={updateHealth} />

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
  if (test.input === "checklist" || test.input === "mnasf") {
    const answered = test.items.every((_, idx) => itemScores[idx] !== undefined);
    finalValue = answered
      ? test.items.reduce((sum, _, idx) => sum + itemScores[idx], 0)
      : null;
  }

  let canSave = false;
  if (isManualOverride) {
    canSave = finalValue !== null && !isNaN(finalValue);
  } else if (test.input === "manual" || test.input === "checklist" || test.input === "mnasf") {
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
            {test.showCalfReference && (
              <div className="calf-reference">
                {patient.health && patient.health.calf ? (
                  (() => {
                    const calfVal = parseFloat(patient.health.calf);
                    const cutoff = patient.sex === "M" ? 34 : 33;
                    const below = calfVal < cutoff;
                    return (
                      <>
                        Circunferência da panturrilha: <strong>{patient.health.calf} cm</strong>
                        {" — "}
                        {below
                          ? `abaixo do ponto de corte (${cutoff} cm), +10 pontos no SARC-CalF`
                          : `dentro do esperado (ponto de corte: ${cutoff} cm), sem pontos extras`}
                      </>
                    );
                  })()
                ) : (
                  <>
                    Circunferência da panturrilha <strong>não registrada</strong> — será usado
                    apenas o SARC-F, sem a pontuação combinada do SARC-CalF.
                  </>
                )}
              </div>
            )}
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

        {test.input === "mnasf" && (
          <div className="mnasf-list">
            {test.items.map((item, idx) => (
              <div key={idx} className="mnasf-item">
                <div className="mnasf-item-label">{item.label}</div>
                {item.showImcReference && (
                  <div className="mnasf-imc-ref">
                    IMC cadastrado:{" "}
                    <strong>
                      {patient.health && patient.health.imc
                        ? `${patient.health.imc} kg/m²`
                        : "não registrado"}
                    </strong>
                  </div>
                )}
                <div className="mnasf-options">
                  {item.options.map((opt) => (
                    <button
                      key={opt.score}
                      className={itemScores[idx] === opt.score ? "mnasf-option active" : "mnasf-option"}
                      onClick={() => setItemScores((prev) => ({ ...prev, [idx]: opt.score }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="checklist-total">
              Total: {Object.values(itemScores).reduce((a, b) => a + b, 0)} / 14
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

function ReportEditScreen({ patient, onBack, onGenerate }) {
  const savedValues = patient.reportValues || {};
  const [values, setValues] = useState(() => {
    const v = {};
    Object.keys(TESTS).forEach((id) => {
      v[id] = savedValues[id] ? [...savedValues[id]] : ["", "", ""];
    });
    return v;
  });
  const [dates, setDates] = useState(patient.reportDates || ["", "", ""]);
  const [notesText, setNotesText] = useState(patient.notes || "");

  const setCell = (testId, colIdx, val) => {
    setValues((prev) => {
      const row = [...prev[testId]];
      row[colIdx] = val;
      return { ...prev, [testId]: row };
    });
  };

  const setDateCol = (colIdx, val) => {
    setDates((prev) => {
      const next = [...prev];
      next[colIdx] = val;
      return next;
    });
  };

  return (
    <div className="screen">
      <TopBar title="Relatório" onBack={onBack} />
      <p className="subtitle">Preencha os valores das 3 avaliações</p>

      <table className="report-table">
        <thead>
          <tr>
            <th>Categoria</th>
            <th>Teste</th>
            {[0, 1, 2].map((i) => (
              <th key={i}>
                Avaliação {i + 1}
                <input
                  type="date"
                  className="report-date-input"
                  value={dates[i]}
                  onChange={(e) => setDateCol(i, e.target.value)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(TESTS).map(([id, t]) => (
            <tr key={id}>
              <td>{CATEGORIES[t.category].label}</td>
              <td>{t.name}</td>
              {[0, 1, 2].map((i) => (
                <td key={i}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={values[id][i]}
                    onChange={(e) => setCell(id, i, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="form-card" style={{ marginTop: 16 }}>
        <div className="form-row">
          <label>Observações</label>
          <textarea
            rows={4}
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Escreva observações sobre o acompanhamento do paciente..."
          />
        </div>
      </div>

      <button className="btn-primary btn-block" onClick={() => onGenerate(values, dates, notesText)}>
        <Printer size={18} /> Gerar e imprimir relatório
      </button>
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
          <div className="report-brand">Acompanhamento de unidades e pacientes (Emulti)</div>
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
              {[0, 1, 2].map((i) => (
                <th key={i}>
                  {patient.reportDates && patient.reportDates[i]
                    ? fmtISODate(patient.reportDates[i])
                    : `Avaliação ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(TESTS).map(([id, t]) => {
              const vals = (patient.reportValues && patient.reportValues[id]) || ["", "", ""];
              return (
                <tr key={id}>
                  <td>{CATEGORIES[t.category].label}</td>
                  <td>{t.name}</td>
                  <td className="report-blank-cell">{vals[0]}</td>
                  <td className="report-blank-cell">{vals[1]}</td>
                  <td className="report-blank-cell">{vals[2]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!isSingleTest && (
        <div className="report-block">
          <h3>Observações</h3>
          {patient.notes && patient.notes.trim() !== "" ? (
            <p className="report-notes">{patient.notes}</p>
          ) : (
            <div className="report-notes-box"></div>
          )}
        </div>
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
  const [ubsList, setUbsList] = useState(DEFAULT_UBS_LIST);
  const [aulas, setAulas] = useState([]);
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
      const [p, u, a] = await Promise.all([
        loadPatients(user.uid),
        loadUbsList(user.uid),
        loadAulas(user.uid),
      ]);
      setPatients(p);
      setUbsList(u);
      setAulas(a);
      setLoading(false);
    })();
  }, [user]);

  const saveUbsSettings = async (names) => {
    setUbsList(names);
    if (user) await saveUbsList(user.uid, names);
  };

  const saveAula = async (aula) => {
    setAulas((prev) => {
      const exists = prev.some((a) => a.id === aula.id);
      return exists ? prev.map((a) => (a.id === aula.id ? aula : a)) : [...prev, aula];
    });
    if (user) await saveAulaDoc(user.uid, aula);
  };

  const deleteAula = async (aulaId) => {
    setAulas((prev) => prev.filter((a) => a.id !== aulaId));
    if (user) await deleteAulaDoc(user.uid, aulaId);
  };

  useEffect(() => {
    const reset = () => {
      setExportScope(null);
      setNav((prev) =>
        prev.screen === "reportEdit"
          ? { screen: "patientDetail", patientId: prev.patientId }
          : prev
      );
    };
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  const exportFullReport = () => {
    setExportScope({ mode: "full" });
    setTimeout(() => window.print(), 150);
  };
  const exportTestReport = (testId) => {
    setExportScope({ mode: "test", testId });
    setTimeout(() => window.print(), 150);
  };

  const saveReportData = async (patientId, values, dates, notesText) => {
    const target = patients.find((p) => p.id === patientId);
    if (!target) return;
    const updated = { ...target, reportValues: values, reportDates: dates, notes: notesText };
    setPatients((prev) => prev.map((p) => (p.id === patientId ? updated : p)));
    await savePatientDoc(user.uid, updated);
  };

  const saveNotes = async (patientId, notesText) => {
    const target = patients.find((p) => p.id === patientId);
    if (!target) return;
    const updated = { ...target, notes: notesText };
    setPatients((prev) => prev.map((p) => (p.id === patientId ? updated : p)));
    await savePatientDoc(user.uid, updated);
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
          <UBSFoldersScreen
            patients={patients}
            ubsList={ubsList}
            onOpenUbs={(ubsId, ubsName) => setNav({ screen: "patientsInUbs", ubsId, ubsName })}
            onLogout={() => signOut(auth)}
            onSettings={() => setNav({ screen: "ubsSettings" })}
          />
        )}

        {nav.screen === "patientsInUbs" && (
          <PatientsInUbsScreen
            patients={patients}
            ubsId={nav.ubsId}
            ubsName={nav.ubsName}
            onOpen={openPatient}
            onAdd={addPatient}
            onBack={() => setNav({ screen: "patients" })}
          />
        )}

        {nav.screen === "calendar" && (
          <CalendarScreen
            aulas={aulas}
            onSelectDay={(dateIso) => setNav({ screen: "day", dateIso })}
          />
        )}

        {nav.screen === "day" && (
          <DayScreen
            dateIso={nav.dateIso}
            aulas={aulas}
            ubsList={ubsList}
            onBack={() => setNav({ screen: "calendar" })}
            onNewAula={() => setNav({ screen: "aulaForm", dateIso: nav.dateIso })}
            onOpenAula={(aulaId) => setNav({ screen: "aulaForm", dateIso: nav.dateIso, aulaId })}
          />
        )}

        {nav.screen === "aulaForm" && (
          <AulaFormScreen
            aula={aulas.find((a) => a.id === nav.aulaId) || null}
            dateIso={nav.dateIso}
            patients={patients}
            ubsList={ubsList}
            onBack={() => setNav({ screen: "day", dateIso: nav.dateIso })}
            onSave={(aula) => {
              saveAula(aula);
              setNav({ screen: "day", dateIso: nav.dateIso });
            }}
            onDelete={(aulaId) => {
              deleteAula(aulaId);
              setNav({ screen: "day", dateIso: nav.dateIso });
            }}
          />
        )}

        {(nav.screen === "patients" || nav.screen === "calendar") && (
          <BottomNav active={nav.screen} onNavigate={(screen) => setNav({ screen })} />
        )}

        {nav.screen === "ubsSettings" && (
          <UBSSettingsScreen
            ubsList={ubsList}
            onBack={() => setNav({ screen: "patients" })}
            onSave={(names) => {
              saveUbsSettings(names);
              setNav({ screen: "patients" });
            }}
          />
        )}

        {nav.screen === "patientDetail" && patient && (
          <PatientDetailScreen
            patient={patient}
            results={resultsByPatient[patient.id] || []}
            onBack={() =>
              setNav({
                screen: "patientsInUbs",
                ubsId: patient.ubsId || null,
                ubsName: patient.ubsId ? getUbsName(ubsList, patient.ubsId) : "Sem UBS",
              })
            }
            onNewTest={() => setNav({ screen: "testSelect", patientId: patient.id })}
            onHistory={(testId) => setNav({ screen: "history", patientId: patient.id, testId })}
            onExportPdf={() => setNav({ screen: "reportEdit", patientId: patient.id })}
            onSaveNotes={(text) => saveNotes(patient.id, text)}
            onEdit={() => setNav({ screen: "patientEdit", patientId: patient.id })}
          />
        )}

        {nav.screen === "reportEdit" && patient && (
          <ReportEditScreen
            patient={patient}
            onBack={() => setNav({ screen: "patientDetail", patientId: patient.id })}
            onGenerate={(values, dates, notesText) => {
              saveReportData(patient.id, values, dates, notesText);
              exportFullReport();
            }}
          />
        )}

        {nav.screen === "patientEdit" && patient && (
          <PatientEditScreen
            patient={patient}
            onBack={() => setNav({ screen: "patientDetail", patientId: patient.id })}
            onSave={updatePatient}
            onDelete={deletePatient}
            ubsList={ubsList}
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
        --sage: #8FBF6F;
        --line: #333333;
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.35);
        --shadow-md: 0 2px 6px rgba(0, 0, 0, 0.35), 0 6px 16px rgba(0, 0, 0, 0.4);
      }

      html, body {
        background: var(--paper);
        margin: 0;
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
      .screen-with-nav {
        padding-bottom: 86px;
      }

      .screen-bg-login,
      .screen-bg-folders {
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-attachment: fixed;
      }
      .screen-bg-login {
        background-image: linear-gradient(rgba(18, 18, 18, 0.82), rgba(18, 18, 18, 0.93)),
          url("/images/bg-login.jpg");
      }
      .screen-bg-folders {
        background-image: linear-gradient(rgba(18, 18, 18, 0.8), rgba(18, 18, 18, 0.92)),
          url("/images/bg-folders.png");
      }

      .bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        max-width: 420px;
        margin: 0 auto;
        display: flex;
        background: var(--surface);
        border-top: 1px solid var(--line);
        z-index: 20;
        padding-bottom: env(safe-area-inset-bottom, 0);
      }
      .bottom-nav-item {
        flex: 1;
        background: none;
        border: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 10px 4px 8px;
        font-family: inherit;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--ink-faint);
        cursor: pointer;
      }
      .bottom-nav-item.active { color: var(--accent); }

      .calendar-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
      }
      .calendar-month-label {
        font-family: 'Newsreader', serif;
        font-weight: 600;
        font-size: 16px;
        text-transform: capitalize;
      }
      .calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
      }
      .calendar-weekdays { margin-bottom: 6px; }
      .calendar-weekday {
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        color: var(--ink-faint);
        padding: 4px 0;
      }
      .calendar-cell {
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 9px;
        font-family: inherit;
        font-size: 13px;
        color: var(--ink);
        cursor: pointer;
      }
      .calendar-cell.empty {
        background: transparent;
        border: none;
        cursor: default;
      }
      .calendar-cell.today {
        border-color: var(--accent);
        font-weight: 700;
        color: var(--accent);
      }
      .calendar-dot {
        position: absolute;
        bottom: 5px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--accent);
      }

      .aula-row {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px 14px;
        text-align: left;
        cursor: pointer;
        color: var(--ink);
        box-shadow: var(--shadow-sm);
      }
      .aula-row-main { flex: 1; }
      .aula-row-title { font-weight: 600; font-size: 14px; }
      .aula-row-meta { font-size: 12px; color: var(--ink-faint); margin-top: 2px; }

      .participant-search {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 9px;
        padding: 10px 11px;
        font-size: 14px;
        font-family: inherit;
        background: var(--paper);
        color: var(--ink);
        box-sizing: border-box;
        margin-bottom: 4px;
      }
      .participant-row {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 10px 14px;
        text-align: left;
        cursor: pointer;
        color: var(--ink);
        box-shadow: var(--shadow-sm);
      }
      .participant-row.active {
        border-color: var(--accent);
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
      .patient-ids {
        display: flex;
        flex-wrap: wrap;
        gap: 5px 14px;
        font-size: 12px;
        color: var(--ink-faint);
        margin: -12px 0 18px;
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
      .form-row input,
      .form-row textarea,
      .form-row select {
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
      .form-row select {
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239C9690' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
        background-repeat: no-repeat;
        background-position: right 12px center;
        padding-right: 34px;
      }
      .ubs-folder-row {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 13px 14px;
        text-align: left;
        cursor: pointer;
        color: var(--ink);
        box-shadow: var(--shadow-sm);
      }
      .ubs-folder-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: var(--paper);
        border: 1px solid var(--line);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--accent);
        flex-shrink: 0;
      }
      .ubs-folder-info { flex: 1; }
      .ubs-folder-name { font-weight: 600; font-size: 14.5px; }
      .ubs-folder-count { font-size: 12.5px; color: var(--ink-faint); margin-top: 1px; }
      .form-row textarea {
        resize: vertical;
        line-height: 1.5;
      }
      .form-row-split {
        display: grid;
        grid-template-columns: 1fr 1.4fr;
        gap: 10px;
      }
      .form-row-split3 {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }
      .form-row-split3 label {
        display: block;
        font-size: 12.5px;
        color: var(--ink-faint);
        margin-bottom: 5px;
      }
      .form-row-split3 input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 9px;
        padding: 10px 8px;
        font-size: 14px;
        font-family: inherit;
        background: var(--paper);
        color: var(--ink);
        box-sizing: border-box;
      }
      .form-section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-faint);
        margin: 18px 0 12px;
        padding-top: 14px;
        border-top: 1px solid var(--line);
      }
      .imc-display {
        font-size: 13.5px;
        color: var(--ink);
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 9px;
        padding: 9px 11px;
        margin: -4px 0 12px;
      }
      .imc-display strong { color: var(--accent); }
      .grip-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .grip-col {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .grip-col-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--ink-faint);
      }
      .grip-col input {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 8px 9px;
        font-size: 13.5px;
        font-family: inherit;
        background: var(--paper);
        color: var(--ink);
        box-sizing: border-box;
        width: 100%;
      }
      .grip-avg {
        font-size: 12px;
        color: var(--accent);
        font-weight: 600;
      }
      .health-summary {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 13px;
        margin-bottom: 16px;
        box-shadow: var(--shadow-sm);
      }
      .health-summary-row {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-size: 12.5px;
        padding: 4px 0;
      }
      .health-summary-row:not(:last-child) {
        border-bottom: 1px solid var(--line);
      }
      .health-summary-label { color: var(--ink-faint); }
      .health-summary-value { font-weight: 600; }
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
      .calf-reference {
        background: var(--surface);
        border: 1px solid var(--line);
        border-left: 4px solid var(--ochre);
        border-radius: 10px;
        padding: 10px 13px;
        font-size: 13px;
        color: var(--ink-faint);
      }
      .calf-reference strong { color: var(--ink); }
      .mnasf-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
      }
      .mnasf-item {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px 13px;
      }
      .mnasf-item-label {
        font-size: 13px;
        line-height: 1.5;
        margin-bottom: 10px;
        font-weight: 600;
      }
      .mnasf-imc-ref {
        font-size: 12.5px;
        color: var(--ink-faint);
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 7px 10px;
        margin-bottom: 10px;
      }
      .mnasf-imc-ref strong { color: var(--ink); }
      .mnasf-options {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .mnasf-option {
        text-align: left;
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 9px 11px;
        font-family: inherit;
        font-size: 13px;
        color: var(--ink-faint);
        cursor: pointer;
      }
      .mnasf-option.active {
        background: var(--sage);
        border-color: var(--sage);
        color: #1B2A12;
        font-weight: 600;
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

      .patient-notes-card {
        margin: 6px 0 18px;
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
      .report-date-input {
        display: block;
        margin-top: 4px;
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 4px 5px;
        font-size: 11.5px;
        font-family: inherit;
        font-weight: 400;
        background: var(--paper);
        color: var(--ink);
        box-sizing: border-box;
      }
      .report-table td {
        border-bottom: 1px solid var(--line);
        padding: 6px 8px;
      }
      .report-table td input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 5px 6px;
        font-size: 12.5px;
        font-family: inherit;
        background: var(--paper);
        color: var(--ink);
        box-sizing: border-box;
      }
      .report-notes {
        font-size: 13px;
        line-height: 1.6;
        color: #1F1E1A;
        white-space: pre-wrap;
        margin: 0;
      }
      .report-block { margin-bottom: 18px; }
      .report-block h3 {
        font-family: 'Newsreader', serif;
        font-size: 14.5px;
        font-weight: 600;
        margin: 0 0 8px;
      }
      .report-blank-cell {
        height: 30px;
      }
      .report-notes-box {
        border: 1px solid var(--line);
        border-radius: 6px;
        min-height: 110px;
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
