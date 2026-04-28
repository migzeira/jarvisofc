/**
 * chart.ts
 * Gera graficos financeiros como imagem via QuickChart.io.
 * Retorna URL da imagem para envio direto pela Evolution API.
 */

// Cores por categoria (paleta fixa para consistencia visual)
const CATEGORY_COLORS: Record<string, string> = {
  alimentacao: "#FF6384",
  transporte:  "#36A2EB",
  moradia:     "#FFCE56",
  saude:       "#4BC0C0",
  lazer:       "#9966FF",
  educacao:    "#FF9F40",
  trabalho:    "#C9CBCF",
  outros:      "#7C8CF8",
};

const CATEGORY_LABELS: Record<string, string> = {
  alimentacao: "Alimentacao",
  transporte:  "Transporte",
  moradia:     "Moradia",
  saude:       "Saude",
  lazer:       "Lazer",
  educacao:    "Educacao",
  trabalho:    "Trabalho",
  outros:      "Outros",
};

const DEFAULT_COLOR = "#A0AEC0";

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

/** Valida URL do QuickChart com HEAD request */
async function validateChartUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) { console.error(`[chart] QuickChart HEAD failed: ${res.status}`); return null; }
    return url;
  } catch (err) {
    console.error("[chart] QuickChart validation failed:", err);
    return null;
  }
}

/**
 * Gera um grafico doughnut de gastos por categoria.
 * Retorna URL publica da imagem PNG ou null se falhar.
 */
export async function generateExpenseChartUrl(params: {
  byCategory: Record<string, number>;
  periodLabel: string;
  totalExpense: number;
}): Promise<string | null> {
  const { byCategory, periodLabel, totalExpense } = params;

  const entries = Object.entries(byCategory)
    .filter(([_, val]) => val > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;

  const labels = entries.map(([cat, val]) => {
    const pct = totalExpense > 0 ? Math.round((val / totalExpense) * 100) : 0;
    const name = CATEGORY_LABELS[cat] || cat;
    return `${name} - ${formatBRL(val)} (${pct}%)`;
  });

  const data = entries.map(([_, val]) => val);
  const colors = entries.map(([cat]) => CATEGORY_COLORS[cat] || DEFAULT_COLOR);

  const chartConfig = {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: "#1a1a2e",
        borderWidth: 3,
      }],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: `Gastos - ${periodLabel}`,
          color: "#ffffff",
          font: { size: 18, weight: "bold" },
          padding: { bottom: 10 },
        },
        legend: {
          position: "bottom",
          labels: {
            color: "#ffffff",
            font: { size: 11 },
            padding: 12,
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        doughnutlabel: {
          labels: [
            {
              text: formatBRL(totalExpense),
              font: { size: 22, weight: "bold" },
              color: "#ffffff",
            },
            {
              text: "Total",
              font: { size: 13 },
              color: "#aaaaaa",
            },
          ],
        },
      },
      layout: {
        padding: { top: 10, bottom: 10 },
      },
    },
  };

  // Monta URL com chart config encodado — QuickChart aceita GET com ate ~16KB
  const chartJson = JSON.stringify(chartConfig);
  const encodedChart = encodeURIComponent(chartJson);
  const chartUrl = `https://quickchart.io/chart?v=2&bkg=%231a1a2e&w=600&h=600&f=png&c=${encodedChart}`;

  return await validateChartUrl(chartUrl);
}

/**
 * Gera grafico de resumo semanal: bar chart com gastos diarios + anotacoes.
 * Mostra gastos por dia da semana + stats no titulo.
 */
export async function generateWeeklySummaryChartUrl(params: {
  dailyExpenses: { day: string; amount: number }[];
  totalExpense: number;
  totalIncome: number;
  eventsCount: number;
  eventsDone: number;
  eventsCancelled: number;
  notesCount: number;
  habitsCompleted: number;
  habitsTotal: number;
  periodLabel: string;
}): Promise<string | null> {
  const { dailyExpenses, totalExpense, totalIncome, eventsCount, eventsDone, eventsCancelled, notesCount, habitsCompleted, habitsTotal, periodLabel } = params;

  if (dailyExpenses.length === 0 && eventsCount === 0) return null;

  const labels = dailyExpenses.map(d => d.day);
  const data = dailyExpenses.map(d => d.amount);
  const balance = totalIncome - totalExpense;
  const balanceSign = balance >= 0 ? "+" : "";
  const habitsPct = habitsTotal > 0 ? Math.round((habitsCompleted / habitsTotal) * 100) : 0;

  // Score de produtividade (0-100)
  const eventScore = eventsCount > 0 ? Math.round((eventsDone / eventsCount) * 100) : 100;
  const productivityScore = Math.round((eventScore + habitsPct) / 2);

  const subtitleParts = [];
  if (totalExpense > 0) subtitleParts.push(`Gastos: ${formatBRL(totalExpense)}`);
  if (totalIncome > 0) subtitleParts.push(`Receitas: ${formatBRL(totalIncome)}`);
  if (balance !== 0) subtitleParts.push(`Saldo: ${balanceSign}${formatBRL(Math.abs(balance))}`);

  const chartConfig = {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Gastos (R$)",
        data,
        backgroundColor: data.map(v => v > 0 ? "#FF6384" : "#333"),
        borderColor: "#FF6384",
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: [`Resumo Semanal - ${periodLabel}`, subtitleParts.join("  |  ")],
          color: "#ffffff",
          font: { size: 16, weight: "bold" },
          padding: { bottom: 5 },
        },
        subtitle: {
          display: true,
          text: `Compromissos: ${eventsDone}/${eventsCount}  |  Notas: ${notesCount}`,
          color: "#aaaaaa",
          font: { size: 11 },
          padding: { bottom: 10 },
        },
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: "#aaaaaa", font: { size: 11 } },
          grid: { color: "#333" },
        },
        y: {
          ticks: { color: "#aaaaaa", font: { size: 10 }, callback: (v: number) => `R$${v}` },
          grid: { color: "#333" },
          beginAtZero: true,
        },
      },
      layout: { padding: { top: 5, bottom: 5 } },
    },
  };

  const chartJson = JSON.stringify(chartConfig);
  const encodedChart = encodeURIComponent(chartJson);
  const chartUrl = `https://quickchart.io/chart?v=2&bkg=%231a1a2e&w=700&h=450&f=png&c=${encodedChart}`;

  return await validateChartUrl(chartUrl);
}
