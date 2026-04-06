// Data fetching layer - uses real APIs when configured, falls back to demo data
import type { KPIData, ShiftAnalysisData, LaborRatioData } from './types';
import { getDemoKPIData, getDemoShiftAnalysisData, getDemoLaborRatioData } from './demo-data';

function isDemoMode(): boolean {
  // Explicit demo mode flag
  if (process.env.DEMO_MODE === 'true') return true;

  // Auto-detect: no Clover credentials = demo mode
  const hasClover = process.env.CLOVER_MERCHANT_TOKEN && process.env.CLOVER_MERCHANT_ID;
  return !hasClover;
}

export async function getKPIData(): Promise<KPIData> {
  if (isDemoMode()) {
    return getDemoKPIData();
  }

  // TODO: Implement real Clover API integration
  // For now, return demo data
  return getDemoKPIData();
}

export async function getShiftAnalysisData(lookbackDays: number = 30): Promise<ShiftAnalysisData> {
  if (isDemoMode()) {
    return getDemoShiftAnalysisData(lookbackDays);
  }

  // TODO: Implement real Clover API integration for historical sales data
  return getDemoShiftAnalysisData(lookbackDays);
}

export async function getLaborRatioData(): Promise<LaborRatioData> {
  if (isDemoMode()) {
    return getDemoLaborRatioData();
  }

  // TODO: Implement real Homebase API integration for labor data
  return getDemoLaborRatioData();
}

export function getIsDemoMode(): boolean {
  return isDemoMode();
}
