// Synthetic demo data for Nature's Understory
// Used when Clover/Homebase API keys are not configured

import type {
  KPIData,
  QuietScore,
  DayOfWeekBreakdown,
  LaborActuals,
  LaborProjection,
  ShiftAnalysisData,
  LaborRatioData,
} from './types';

// Seed random for reproducible demo data
function seededRandom(seed: number): () => number {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function getDateSeed(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// Generate quiet scores for each hour (6am - 9pm store hours)
function generateHourlyQuietScores(date: Date): QuietScore[] {
  const rand = seededRandom(getDateSeed(date));
  const dayOfWeek = date.getDay();

  // Peak patterns vary by day
  const weekdayPeaks = [11, 12, 17, 18]; // lunch and after-work rush
  const weekendPeaks = [10, 11, 12, 13, 14, 15]; // midday busy
  const peaks = dayOfWeek === 0 || dayOfWeek === 6 ? weekendPeaks : weekdayPeaks;

  const scores: QuietScore[] = [];

  for (let hour = 6; hour <= 21; hour++) {
    let baseScore: number;

    if (peaks.includes(hour)) {
      baseScore = 2 + rand() * 2; // Peak: 2-4
    } else if (hour < 9 || hour > 19) {
      baseScore = 7 + rand() * 3; // Early/late: 7-10
    } else {
      baseScore = 4 + rand() * 3; // Normal: 4-7
    }

    const score = Math.min(10, Math.max(0, Math.round(baseScore * 10) / 10));

    const transactions = Math.round(score >= 7 ? rand() * 5 : score >= 4 ? 5 + rand() * 10 : 10 + rand() * 20);
    scores.push({
      hour,
      score,
      label: score >= 7 ? 'quiet' : score >= 4 ? 'light' : 'peak',
      transactions,
      hourlySales: Math.round(transactions * (20 + rand() * 30) * 100) / 100,
    });
  }

  return scores;
}

// Generate day-of-week breakdown
function generateDayOfWeekBreakdown(lookbackDays: number): DayOfWeekBreakdown[] {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return days.map((day, idx) => {
    const rand = seededRandom(idx * 1000);

    // Weekends are busier overall
    const isWeekend = idx === 0 || idx === 6;
    const baseAvg = isWeekend ? 4 + rand() * 2 : 5.5 + rand() * 2;

    return {
      day,
      avgQuietScore: Math.round(baseAvg * 10) / 10,
      bestHours: isWeekend ? [7, 8, 19, 20] : [7, 8, 14, 15, 20],
      peakHours: isWeekend ? [10, 11, 12, 13, 14] : [11, 12, 17, 18],
    };
  });
}

// Generate labor actuals for past days
function generateLaborActuals(days: number): LaborActuals[] {
  const actuals: LaborActuals[] = [];
  const today = new Date();

  for (let i = days; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    const rand = seededRandom(getDateSeed(date));
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Base values with day-of-week variation
    const baseSales = isWeekend ? 8500 : 6500;
    const salesVariation = rand() * 2000 - 1000;
    const netSales = Math.round(baseSales + salesVariation);

    const baseHours = isWeekend ? 65 : 50;
    const hoursVariation = rand() * 10 - 5;
    const timesheetHours = Math.round((baseHours + hoursVariation) * 10) / 10;

    const avgWage = 15.5 + rand() * 2;
    const wages = Math.round(timesheetHours * avgWage * 100) / 100;
    const loadedCostFactor = 1.25 + rand() * 0.1;
    const fullyLoadedCost = Math.round(wages * loadedCostFactor * 100) / 100;

    const laborRatio = Math.round((fullyLoadedCost / netSales) * 1000) / 10;

    actuals.push({
      date: date.toISOString().split('T')[0],
      timesheetHours,
      wages,
      fullyLoadedCost,
      netSales,
      laborRatio,
      hasLaborData: true,
    });
  }

  return actuals;
}

// Generate labor projections for upcoming days
function generateLaborProjections(days: number): LaborProjection[] {
  const projections: LaborProjection[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);

    const rand = seededRandom(getDateSeed(date) + 1000);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const baseSales = isWeekend ? 8200 : 6200;
    const salesVariation = rand() * 1500 - 750;
    const projectedSales = Math.round(baseSales + salesVariation);

    const baseHours = isWeekend ? 62 : 48;
    const hoursVariation = rand() * 8 - 4;
    const scheduledHours = Math.round((baseHours + hoursVariation) * 10) / 10;

    const avgWage = 15.5 + rand() * 2;
    const projectedWages = Math.round(scheduledHours * avgWage * 100) / 100;
    const loadedCostFactor = 1.28;
    const projectedLoadedCost = Math.round(projectedWages * loadedCostFactor * 100) / 100;

    const projectedLaborRatio = Math.round((projectedLoadedCost / projectedSales) * 1000) / 10;

    projections.push({
      date: date.toISOString().split('T')[0],
      scheduledHours,
      projectedWages,
      projectedLoadedCost,
      projectedSales,
      projectedLaborRatio,
    });
  }

  return projections;
}

export function getDemoKPIData(): KPIData {
  const today = new Date();
  const rand = seededRandom(getDateSeed(today));
  const hour = today.getHours();

  // Sales accumulate throughout the day
  const hourFactor = Math.min(1, (hour - 6) / 15);
  const baseDailySales = 6800 + rand() * 1500;
  const todaySales = Math.round(baseDailySales * hourFactor);

  // Compare to same day last week
  const lastWeekRand = seededRandom(getDateSeed(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)));
  const lastWeekSales = Math.round((6800 + lastWeekRand() * 1500) * hourFactor);
  const todaySalesChange = lastWeekSales > 0
    ? Math.round(((todaySales - lastWeekSales) / lastWeekSales) * 1000) / 10
    : 0;

  // Current quiet score based on hour
  const hourlyScores = generateHourlyQuietScores(today);
  const currentHourScore = hourlyScores.find(s => s.hour === hour) || hourlyScores[0];

  // Labor ratio from recent actuals
  const recentActuals = generateLaborActuals(7);
  const avgLaborRatio = recentActuals.reduce((sum, a) => sum + a.laborRatio, 0) / recentActuals.length;

  return {
    todaySales,
    todaySalesChange,
    laborRatio: Math.round(avgLaborRatio * 10) / 10,
    laborRatioTarget: 25,
    currentQuietScore: currentHourScore.score,
    quietScoreLabel: currentHourScore.label,
  };
}

export function getDemoShiftAnalysisData(lookbackDays: number = 30): ShiftAnalysisData {
  const today = new Date();

  return {
    hourlyScores: generateHourlyQuietScores(today),
    dayOfWeekBreakdown: generateDayOfWeekBreakdown(lookbackDays),
    lookbackDays,
  };
}

export function getDemoLaborRatioData(): LaborRatioData {
  const actuals = generateLaborActuals(14);
  const projections = generateLaborProjections(7);

  const avgActualRatio = actuals.reduce((sum, a) => sum + a.laborRatio, 0) / actuals.length;
  const avgProjectedRatio = projections.reduce((sum, p) => sum + p.projectedLaborRatio, 0) / projections.length;

  return {
    actuals,
    projections,
    laborRatioPercent: Math.round(avgActualRatio * 10) / 10,
    projectedRatioPercent: Math.round(avgProjectedRatio * 10) / 10,
    loadedCostFactor: 1.28,
  };
}
