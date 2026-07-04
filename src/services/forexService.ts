/**
 * Centralized Forex API Service
 * Provides unified interface for multiple forex data sources with automatic fallback
 * Priority: Frankfurter -> Twelve Data -> ForexRate API -> Base Prices
 */

import { PAIRS_CONFIG } from '../constants/config';

interface ForexRate {
  [symbol: string]: number | null;
}

interface ApiResponse {
  success: boolean;
  source: string;
  timestamp?: string;
  rates?: ForexRate;
  error?: string;
}

// API Priority Configuration - can be modified to change fallback order
export const API_PRIORITY = ['Frankfurter', 'TwelveData', 'ForexRate', 'BasePrices'] as const;

class ForexService {
  private static instance: ForexService;
  private cache: Map<string, { data: ApiResponse; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds cache

  private constructor() {}

  public static getInstance(): ForexService {
    if (!ForexService.instance) {
      ForexService.instance = new ForexService();
    }
    return ForexService.instance;
  }

  /**
   * Main method: Fetch forex rates with automatic fallback through all available APIs
   */
  public async getRates(): Promise<ApiResponse> {
    // Check cache first
    const cached = this.cache.get('all_rates');
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Try APIs in priority order
    for (const apiName of API_PRIORITY) {
      const result = await this.fetchFromApi(apiName);
      if (result.success) {
        // Cache successful result
        this.cache.set('all_rates', { data: result, timestamp: Date.now() });
        return result;
      }
      console.warn(`[ForexService] ${apiName} failed: ${result.error}`);
    }

    // If all APIs failed, return base prices
    const baseResult = this.getBaseRates();
    this.cache.set('all_rates', { data: baseResult, timestamp: Date.now() });
    return baseResult;
  }

  /**
   * Fetch rates for a specific symbol only
   */
  public async getSymbolRate(symbol: string): Promise<ApiResponse> {
    const allRates = await this.getRates();
    
    if (allRates.success && allRates.rates) {
      const symbolRate = allRates.rates[symbol];
      return {
        ...allRates,
        rates: symbolRate !== undefined ? { [symbol]: symbolRate } : {}
      };
    }
    
    return allRates;
  }

  /**
   * Check health of all forex APIs
   */
  public async checkHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};
    
    for (const apiName of API_PRIORITY) {
      try {
        const result = await this.fetchFromApi(apiName, 5000); // 5 second timeout for health check
        health[apiName] = result.success;
      } catch (error) {
        health[apiName] = false;
      }
    }
    
    return health;
  }

  /**
   * Clear cache (useful for testing or when APIs come back online)
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Fetch from a specific API by name
   */
  private async fetchFromApi(apiName: string, timeoutMs?: number): Promise<ApiResponse> {
    const timeout = timeoutMs || 10000; // Default 10 seconds
    
    const timeoutPromise = new Promise<ApiResponse>((resolve) => 
      setTimeout(() => resolve({ 
        success: false, 
        source: apiName, 
        error: 'Request timeout' 
      }), timeout)
    );

    const fetchPromise = this.fetchApi(apiName);
    
    return Promise.race([fetchPromise, timeoutPromise]);
  }

  /**
   * Fetch from specific API implementation
   */
  private async fetchApi(apiName: string): Promise<ApiResponse> {
    switch (apiName) {
      case 'Frankfurter':
        return this.fetchFrankfurter();
      case 'TwelveData':
        return this.fetchTwelveData();
      case 'ForexRate':
        return this.fetchForexRate();
      case 'BasePrices':
        return this.getBaseRates();
      default:
        return { success: false, source: apiName, error: 'Unknown API' };
    }
  }

  /**
   * Fetch from Frankfurter API (Primary - no API key required)
   * Free, reliable, updates daily, supports most currency pairs
   */
  private async fetchFrankfurter(): Promise<ApiResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
      
      const response = await fetch('https://api.frankfurter.app/latest?from=USD', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ApexFX-Terminal/1.0'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const rates = data.rates || {};
      const timestamp = data.date || new Date().toISOString();

      // Convert Frankfurter format to our symbol format
      const forexRates: ForexRate = {
        // USD-based pairs (direct from Frankfurter)
        USDJPY: rates.JPY ? parseFloat(rates.JPY.toFixed(3)) : null,
        USDCAD: rates.CAD ? parseFloat(rates.CAD.toFixed(5)) : null,
        USDCHF: rates.CHF ? parseFloat(rates.CHF.toFixed(5)) : null,
        
        // EUR-based pairs (inverse of Frankfurter rates)
        EURUSD: rates.EUR ? parseFloat((1 / rates.EUR).toFixed(5)) : null,
        
        // GBP-based pairs (inverse of Frankfurter rates)
        GBPUSD: rates.GBP ? parseFloat((1 / rates.GBP).toFixed(5)) : null,
        
        // AUD-based pairs (inverse of Frankfurter rates)
        AUDUSD: rates.AUD ? parseFloat((1 / rates.AUD).toFixed(5)) : null,
        
        // Cross rates (calculated from USD base)
        GBPJPY: rates.GBP && rates.JPY ? parseFloat((rates.JPY / rates.GBP).toFixed(3)) : null,
        EURJPY: rates.EUR && rates.JPY ? parseFloat((rates.JPY / rates.EUR).toFixed(3)) : null,
        EURGBP: rates.EUR && rates.GBP ? parseFloat((rates.GBP / rates.EUR).toFixed(5)) : null,
        AUDJPY: rates.AUD && rates.JPY ? parseFloat((rates.JPY / rates.AUD).toFixed(3)) : null,
        
        // Additional forex pairs
        NZDUSD: rates.NZD ? parseFloat((1 / rates.NZD).toFixed(5)) : null,
        USDNOK: rates.NOK ? parseFloat(rates.NOK.toFixed(5)) : null,
        USDSEK: rates.SEK ? parseFloat(rates.SEK.toFixed(5)) : null,
        
        // Commodities (not available from Frankfurter free API)
        XAUUSD: null,
        XAGUSD: null,
      };

      return {
        success: true,
        source: 'Frankfurter',
        timestamp,
        rates: forexRates
      };
    } catch (error: any) {
      return { 
        success: false, 
        source: 'Frankfurter', 
        error: error.message || 'Frankfurter API request failed' 
      };
    }
  }

  /**
   * Fetch from Twelve Data API (Secondary - requires API key on server)
   */
  private async fetchTwelveData(): Promise<ApiResponse> {
    try {
      const response = await fetch('/api/market/prices');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.rates) {
        return {
          success: true,
          source: 'TwelveData',
          timestamp: data.timestamp || new Date().toISOString(),
          rates: this.normalizeRates(data.rates)
        };
      } else {
        throw new Error(data.error || 'Invalid Twelve Data response');
      }
    } catch (error: any) {
      return { 
        success: false, 
        source: 'TwelveData', 
        error: error.message || 'Twelve Data API request failed' 
      };
    }
  }

  /**
   * Fetch from ForexRate API (Tertiary - if configured)
   */
  private async fetchForexRate(): Promise<ApiResponse> {
    try {
      const response = await fetch('/api/market/forexrate');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.rates) {
        return {
          success: true,
          source: 'ForexRate',
          timestamp: data.timestamp || new Date().toISOString(),
          rates: this.normalizeRates(data.rates)
        };
      } else {
        throw new Error(data.error || 'Invalid ForexRate API response');
      }
    } catch (error: any) {
      return { 
        success: false, 
        source: 'ForexRate', 
        error: error.message || 'ForexRate API request failed' 
      };
    }
  }

  /**
   * Normalize rates from any API to our standard format
   */
  private normalizeRates(inputRates: Record<string, any>): ForexRate {
    const rates: ForexRate = {};
    
    // Map known symbols
    const knownSymbols = Object.keys(PAIRS_CONFIG);
    knownSymbols.forEach(symbol => {
      if (inputRates[symbol] !== undefined) {
        rates[symbol] = parseFloat(inputRates[symbol]);
      } else {
        rates[symbol] = null;
      }
    });
    
    return rates;
  }

  /**
   * Fallback to base prices from configuration
   */
  private getBaseRates(): ApiResponse {
    const rates: ForexRate = {};
    
    Object.keys(PAIRS_CONFIG).forEach(symbol => {
      rates[symbol] = PAIRS_CONFIG[symbol].basePrice;
    });

    return {
      success: true,
      source: 'BasePrices',
      timestamp: new Date().toISOString(),
      rates
    };
  }
}

// Singleton instance
export const forexService = ForexService.getInstance();