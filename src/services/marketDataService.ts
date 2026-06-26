import axios from 'axios';
import { StockPrice, CryptoPrice, NewsArticle, DataSource } from '../types/index.js';
import logger from '../utils/logger.js';
import { RedisCache } from '../utils/cache.js';

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const NEWS_API_BASE = 'https://newsapi.org/v2';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/**
 * Market Data Service
 * Fetches real-time stock, forex, crypto, and news data from multiple reliable APIs
 */

export class MarketDataService {
  private static cache = new RedisCache();

  /**
   * Get real-time stock price with fallback sources
   */
  static async getStockPrice(symbol: string): Promise<{
    data: StockPrice | null;
    source: DataSource;
  }> {
    const cacheKey = `stock:${symbol}`;
    const cached = await this.cache.get<StockPrice>(cacheKey);

    if (cached) {
      logger.info(`Cache hit for stock ${symbol}`);
      return {
        data: cached,
        source: {
          type: 'stock-api',
          url: 'cache',
          title: `Cached ${symbol} price`,
          fetchedAt: new Date(),
          confidence: 0.95,
        },
      };
    }

    try {
      // Try Alpha Vantage first (most reliable for stocks)
      const alphaResult = await this.fetchAlphaVantageQuote(symbol);
      if (alphaResult) {
        await this.cache.set(cacheKey, alphaResult, 60); // Cache for 60 seconds
        return {
          data: alphaResult,
          source: {
            type: 'stock-api',
            url: ALPHA_VANTAGE_BASE,
            title: `${symbol} price from Alpha Vantage`,
            fetchedAt: new Date(),
            confidence: 0.98,
          },
        };
      }

      // Fallback to Finnhub
      const finnhubResult = await this.fetchFinnhubQuote(symbol);
      if (finnhubResult) {
        await this.cache.set(cacheKey, finnhubResult, 60);
        return {
          data: finnhubResult,
          source: {
            type: 'stock-api',
            url: FINNHUB_BASE,
            title: `${symbol} price from Finnhub`,
            fetchedAt: new Date(),
            confidence: 0.96,
          },
        };
      }

      logger.warn(`Failed to fetch stock price for ${symbol}`);
      return { data: null, source: {} as DataSource };
    } catch (error) {
      logger.error(`Error fetching stock price for ${symbol}:`, error);
      return { data: null, source: {} as DataSource };
    }
  }

  /**
   * Get multiple stocks at once
   */
  static async getStockPrices(symbols: string[]): Promise<{
    data: StockPrice[];
    sources: DataSource[];
  }> {
    const results = await Promise.all(
      symbols.map((symbol) => this.getStockPrice(symbol))
    );

    return {
      data: results.map((r) => r.data).filter((d) => d !== null) as StockPrice[],
      sources: results.map((r) => r.source).filter((s) => s.url),
    };
  }

  /**
   * Get cryptocurrency prices with real-time data
   */
  static async getCryptoPrices(symbols: string[]): Promise<{
    data: CryptoPrice[];
    sources: DataSource[];
  }> {
    const cacheKey = `crypto:${symbols.join(',')}`;
    const cached = await this.cache.get<CryptoPrice[]>(cacheKey);

    if (cached) {
      return {
        data: cached,
        sources: [
          {
            type: 'stock-api',
            url: 'cache',
            title: 'Cached crypto prices',
            fetchedAt: new Date(),
            confidence: 0.9,
          },
        ],
      };
    }

    try {
      const cryptoIds = this.mapSymbolsToCoinGeckoIds(symbols);
      const response = await axios.get(`${COINGECKO_BASE}/simple/price`, {
        params: {
          ids: cryptoIds.join(','),
          vs_currencies: 'usd',
          include_market_cap: true,
          include_24hr_change: true,
        },
        timeout: 5000,
      });

      const data: CryptoPrice[] = [];
      Object.entries(response.data).forEach(([id, prices]: any) => {
        const symbol = this.mapCoinGeckoIdToSymbol(id);
        data.push({
          symbol,
          price: prices.usd,
          change24h: prices.usd_24h_change,
          marketCap: prices.usd_market_cap,
          timestamp: new Date(),
        });
      });

      await this.cache.set(cacheKey, data, 60);

      return {
        data,
        sources: [
          {
            type: 'stock-api',
            url: COINGECKO_BASE,
            title: 'Cryptocurrency prices from CoinGecko',
            fetchedAt: new Date(),
            confidence: 0.97,
          },
        ],
      };
    } catch (error) {
      logger.error('Error fetching crypto prices:', error);
      return { data: [], sources: [] };
    }
  }

  /**
   * Get latest financial news
   */
  static async getFinancialNews(keywords: string[], limit: number = 10): Promise<{
    data: NewsArticle[];
    sources: DataSource[];
  }> {
    const cacheKey = `news:${keywords.join(',')}:${limit}`;
    const cached = await this.cache.get<NewsArticle[]>(cacheKey);

    if (cached) {
      return {
        data: cached,
        sources: [
          {
            type: 'news-api',
            url: 'cache',
            title: 'Cached news articles',
            fetchedAt: new Date(),
            confidence: 0.9,
          },
        ],
      };
    }

    try {
      const query = keywords.join(' OR ');
      const response = await axios.get(`${NEWS_API_BASE}/everything`, {
        params: {
          q: query,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: limit,
          apiKey: process.env.NEWS_API_KEY,
        },
        timeout: 10000,
      });

      const articles: NewsArticle[] = response.data.articles
        .slice(0, limit)
        .map((article: any) => ({
          id: `${article.source.id}-${article.publishedAt}`,
          title: article.title,
          description: article.description,
          content: article.content,
          url: article.url,
          image: article.urlToImage,
          source: article.source.name,
          publishedAt: new Date(article.publishedAt),
          category: 'finance',
        }));

      await this.cache.set(cacheKey, articles, 300); // Cache for 5 minutes

      return {
        data: articles,
        sources: [
          {
            type: 'news-api',
            url: NEWS_API_BASE,
            title: 'Financial news from NewsAPI',
            fetchedAt: new Date(),
            confidence: 0.95,
          },
        ],
      };
    } catch (error) {
      logger.error('Error fetching news:', error);
      return { data: [], sources: [] };
    }
  }

  /**
   * Get company fundamentals and financial data
   */
  static async getCompanyData(symbol: string): Promise<{
    data: any;
    source: DataSource;
  }> {
    const cacheKey = `company:${symbol}`;
    const cached = await this.cache.get<any>(cacheKey);

    if (cached) {
      return {
        data: cached,
        source: {
          type: 'financial-api',
          url: 'cache',
          title: `Cached ${symbol} company data`,
          fetchedAt: new Date(),
          confidence: 0.9,
        },
      };
    }

    try {
      if (!process.env.FINNHUB_API_KEY) {
        throw new Error('FINNHUB_API_KEY not configured');
      }

      const response = await axios.get(`${FINNHUB_BASE}/quote`, {
        params: {
          symbol,
          token: process.env.FINNHUB_API_KEY,
        },
        timeout: 5000,
      });

      const data = {
        symbol,
        price: response.data.c,
        high: response.data.h,
        low: response.data.l,
        open: response.data.o,
        previousClose: response.data.pc,
        change: response.data.d,
        changePercent: response.data.dp,
        timestamp: new Date((response.data.t || Math.floor(Date.now() / 1000)) * 1000),
      };

      await this.cache.set(cacheKey, data, 300);

      return {
        data,
        source: {
          type: 'financial-api',
          url: FINNHUB_BASE,
          title: `${symbol} company data from Finnhub`,
          fetchedAt: new Date(),
          confidence: 0.96,
        },
      };
    } catch (error) {
      logger.error(`Error fetching company data for ${symbol}:`, error);
      return {
        data: null,
        source: {} as DataSource,
      };
    }
  }

  // ===== Private Helper Methods =====

  private static async fetchAlphaVantageQuote(
    symbol: string
  ): Promise<StockPrice | null> {
    try {
      if (!process.env.ALPHA_VANTAGE_API_KEY) {
        return null;
      }

      const response = await axios.get(ALPHA_VANTAGE_BASE, {
        params: {
          function: 'GLOBAL_QUOTE',
          symbol,
          apikey: process.env.ALPHA_VANTAGE_API_KEY,
        },
        timeout: 5000,
      });

      const quote = response.data['Global Quote'];
      if (!quote || !quote['05. price']) {
        return null;
      }

      return {
        symbol,
        price: parseFloat(quote['05. price']),
        change: parseFloat(quote['09. change'] || '0'),
        changePercent: parseFloat(quote['10. change percent']?.replace('%', '') || '0'),
        timestamp: new Date(),
        source: 'alpha-vantage',
      };
    } catch (error) {
      logger.debug(`Alpha Vantage error for ${symbol}:`, error);
      return null;
    }
  }

  private static async fetchFinnhubQuote(symbol: string): Promise<StockPrice | null> {
    try {
      if (!process.env.FINNHUB_API_KEY) {
        return null;
      }

      const response = await axios.get(`${FINNHUB_BASE}/quote`, {
        params: {
          symbol,
          token: process.env.FINNHUB_API_KEY,
        },
        timeout: 5000,
      });

      const data = response.data;
      if (!data.c) {
        return null;
      }

      return {
        symbol,
        price: data.c,
        change: data.d || 0,
        changePercent: data.dp || 0,
        timestamp: new Date((data.t || Math.floor(Date.now() / 1000)) * 1000),
        source: 'finnhub',
      };
    } catch (error) {
      logger.debug(`Finnhub error for ${symbol}:`, error);
      return null;
    }
  }

  private static mapSymbolsToCoinGeckoIds(symbols: string[]): string[] {
    const mapping: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      XRP: 'ripple',
      ADA: 'cardano',
      SOL: 'solana',
      DOT: 'polkadot',
      DOGE: 'dogecoin',
      MATIC: 'matic-network',
      LINK: 'chainlink',
      UNI: 'uniswap',
    };

    return symbols.map((s) => mapping[s.toUpperCase()] || s.toLowerCase());
  }

  private static mapCoinGeckoIdToSymbol(id: string): string {
    const mapping: Record<string, string> = {
      bitcoin: 'BTC',
      ethereum: 'ETH',
      ripple: 'XRP',
      cardano: 'ADA',
      solana: 'SOL',
      polkadot: 'DOT',
      dogecoin: 'DOGE',
      'matic-network': 'MATIC',
      chainlink: 'LINK',
      uniswap: 'UNI',
    };

    return mapping[id] || id.toUpperCase();
  }
}

export default MarketDataService;
