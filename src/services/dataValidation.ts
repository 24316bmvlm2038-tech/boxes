import { StockPrice, NewsArticle, DataSource } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * Data Validation Service
 * Ensures all market data and news is accurate, complete, and from verified sources
 */

export class DataValidationService {
  /**
   * Validate stock price data for consistency and freshness
   */
  static validateStockPrice(price: StockPrice): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check price is a valid positive number
    if (!price.price || price.price <= 0) {
      issues.push(`Invalid price: ${price.price}`);
    }

    // Check price is recent (less than 5 minutes old)
    const ageMinutes = (Date.now() - price.timestamp.getTime()) / 60000;
    if (ageMinutes > 5 && price.source !== 'alpha-vantage') {
      // Alpha Vantage free tier has delayed data (up to 5 min)
      issues.push(`Price data is ${ageMinutes.toFixed(1)} minutes old`);
    }

    // Check symbol format (2-5 uppercase letters)
    if (!/^[A-Z]{1,5}$/.test(price.symbol)) {
      issues.push(`Invalid stock symbol: ${price.symbol}`);
    }

    // Sanity check on price changes (no more than 30% in a minute)
    if (Math.abs(price.changePercent) > 30) {
      issues.push(
        `Extreme price movement detected: ${price.changePercent}% - may be data error`
      );
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Validate news article for completeness and freshness
   */
  static validateNewsArticle(article: NewsArticle): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check required fields
    if (!article.title || article.title.trim().length === 0) {
      issues.push('Missing article title');
    }

    if (!article.url || !this.isValidUrl(article.url)) {
      issues.push('Invalid or missing article URL');
    }

    if (!article.source || article.source.trim().length === 0) {
      issues.push('Missing news source');
    }

    // Check article is recent (less than 7 days old)
    const ageHours = (Date.now() - article.publishedAt.getTime()) / 3600000;
    if (ageHours > 168) {
      issues.push(`News article is ${(ageHours / 24).toFixed(1)} days old`);
    }

    // Check title is reasonable length (not too short, not too long)
    if (article.title.length < 10) {
      issues.push('Title too short to be meaningful');
    }
    if (article.title.length > 300) {
      issues.push('Title too long');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Validate data source credibility
   */
  static validateDataSource(source: DataSource): {
    valid: boolean;
    issues: string[];
    confidence: number;
  } {
    const issues: string[] = [];
    let confidence = 1.0;

    // Validate URL format
    if (!this.isValidUrl(source.url)) {
      issues.push('Invalid source URL format');
      confidence -= 0.5;
    }

    // Check source is recent
    const ageMinutes = (Date.now() - source.fetchedAt.getTime()) / 60000;
    if (ageMinutes > 60) {
      issues.push(`Source data is ${ageMinutes.toFixed(0)} minutes old`);
      confidence -= 0.1 * Math.min(ageMinutes / 60, 1); // Gradually reduce confidence
    }

    // Validate confidence score
    if (source.confidence < 0 || source.confidence > 1) {
      issues.push('Invalid confidence score');
      confidence = 0;
    }

    // Penalize low-confidence sources
    confidence *= source.confidence;

    // Check source type is valid
    const validTypes = ['web-search', 'stock-api', 'news-api', 'financial-api'];
    if (!validTypes.includes(source.type)) {
      issues.push(`Unknown source type: ${source.type}`);
      confidence -= 0.2;
    }

    return {
      valid: confidence > 0.5,
      issues,
      confidence: Math.max(0, confidence),
    };
  }

  /**
   * Calculate overall accuracy score for a response
   * Based on source credibility, data freshness, and verification
   */
  static calculateAccuracyScore(sources: DataSource[]): {
    score: number;
    verification: {
      totalSources: number;
      verifiedSources: number;
      averageAge: number;
      averageConfidence: number;
    };
  } {
    if (sources.length === 0) {
      return {
        score: 0,
        verification: {
          totalSources: 0,
          verifiedSources: 0,
          averageAge: 0,
          averageConfidence: 0,
        },
      };
    }

    let verifiedCount = 0;
    let totalConfidence = 0;
    let totalAge = 0;

    sources.forEach((source) => {
      const validation = this.validateDataSource(source);
      if (validation.valid) {
        verifiedCount++;
      }
      totalConfidence += validation.confidence;
      totalAge += (Date.now() - source.fetchedAt.getTime()) / 60000; // in minutes
    });

    const averageConfidence = totalConfidence / sources.length;
    const averageAge = totalAge / sources.length;

    // Accuracy score formula:
    // - Base: average confidence of all sources (60%)
    // - Verified ratio: percentage of verified sources (30%)
    // - Freshness penalty: reduce by 5% for every 60 minutes old
    let score = averageConfidence * 0.6;
    score += (verifiedCount / sources.length) * 0.3;
    score -= Math.min(0.15, (averageAge / 60) * 0.05); // Max 15% penalty

    return {
      score: Math.max(0, Math.min(1, score)),
      verification: {
        totalSources: sources.length,
        verifiedSources: verifiedCount,
        averageAge: Math.round(averageAge * 10) / 10,
        averageConfidence: Math.round(averageConfidence * 100) / 100,
      },
    };
  }

  /**
   * Cross-validate stock prices from multiple sources
   */
  static crossValidatePrices(
    prices: StockPrice[]
  ): { validated: StockPrice[]; discrepancies: string[] } {
    const discrepancies: string[] = [];
    const validated: StockPrice[] = [];

    // Group prices by symbol
    const pricesBySymbol = new Map<string, StockPrice[]>();
    prices.forEach((price) => {
      if (!pricesBySymbol.has(price.symbol)) {
        pricesBySymbol.set(price.symbol, []);
      }
      pricesBySymbol.get(price.symbol)!.push(price);
    });

    // Validate each symbol
    pricesBySymbol.forEach((symbolPrices, symbol) => {
      if (symbolPrices.length === 1) {
        validated.push(symbolPrices[0]);
      } else {
        // Multiple sources - check for consistency
        const prices_values = symbolPrices.map((p) => p.price);
        const avgPrice =
          prices_values.reduce((a, b) => a + b, 0) / prices_values.length;
        const maxDeviation = Math.max(
          ...prices_values.map((p) => Math.abs(p - avgPrice) / avgPrice)
        );

        if (maxDeviation > 0.05) {
          // More than 5% deviation
          discrepancies.push(
            `Price discrepancy for ${symbol}: ` +
              `sources report $${Math.min(...prices_values).toFixed(2)} - $${Math.max(...prices_values).toFixed(2)}`
          );
        }

        // Use most recent data
        const mostRecent = symbolPrices.sort(
          (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
        )[0];
        validated.push(mostRecent);
      }
    });

    return { validated, discrepancies };
  }

  /**
   * Detect and flag potential misinformation or unreliable sources
   */
  static checkSourceCredibility(
    url: string
  ): { credible: boolean; rating: 'high' | 'medium' | 'low'; reason: string } {
    // List of highly trusted financial/news sources
    const trustedDomains = [
      'bloomberg.com',
      'reuters.com',
      'cnbc.com',
      'marketwatch.com',
      'nasdaq.com',
      'nyse.com',
      'sec.gov',
      'financialpost.com',
      'investing.com',
      'yahoo.com',
      'newsapi.org',
      'bbc.com',
      'cnn.com',
      'apnews.com',
      'ft.com',
      'economist.com',
    ];

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      const isTrusted = trustedDomains.some((trusted) => domain.includes(trusted));

      if (isTrusted) {
        return {
          credible: true,
          rating: 'high',
          reason: 'Source is from a recognized financial/news outlet',
        };
      }

      if (domain.includes('wikipedia.org') || domain.includes('investopedia.com')) {
        return {
          credible: true,
          rating: 'medium',
          reason: 'Source is educational but may need cross-reference',
        };
      }

      return {
        credible: false,
        rating: 'low',
        reason: 'Source is not from a recognized financial/news outlet',
      };
    } catch {
      return {
        credible: false,
        rating: 'low',
        reason: 'Invalid URL format',
      };
    }
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

export default DataValidationService;
