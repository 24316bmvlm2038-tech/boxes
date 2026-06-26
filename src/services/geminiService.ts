import { GoogleGenerativeAI } from '@google/generative-ai';
import { MarketDataService } from './marketDataService.js';
import { DataValidationService } from './dataValidation.js';
import { StockPrice, NewsArticle, DataSource } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * Gemini AI Service
 * Uses Google's Gemini API with grounding in real market data and news
 */

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

export class GeminiService {
  /**
   * Generate response with real-time data grounding
   */
  static async generateGroundedResponse(
    query: string,
    options?: {
      includeStocks?: boolean;
      includeNews?: boolean;
      symbols?: string[];
    }
  ): Promise<{
    response: string;
    sources: DataSource[];
    accuracyScore: number;
    executionTime: number;
  }> {
    const startTime = Date.now();
    const sources: DataSource[] = [];
    let groundingContext = '';

    try {
      // Extract potential stock symbols from query
      const symbols = options?.symbols || this.extractSymbols(query);

      // Fetch real-time data if requested
      if (options?.includeStocks && symbols.length > 0) {
        logger.info(`Fetching stock data for: ${symbols.join(', ')}`);
        const { data: stocks, sources: stockSources } =
          await MarketDataService.getStockPrices(symbols);

        if (stocks.length > 0) {
          // Validate stock data
          const { validated, discrepancies } =
            DataValidationService.crossValidatePrices(stocks);

          if (discrepancies.length > 0) {
            logger.warn('Stock price discrepancies:', discrepancies);
          }

          sources.push(...stockSources);
          groundingContext += this.formatStockData(validated);
        }
      }

      // Fetch financial news if requested
      if (options?.includeNews !== false) {
        logger.info('Fetching financial news');
        const keywords = this.extractKeywords(query);
        const { data: articles, sources: newsSources } =
          await MarketDataService.getFinancialNews(keywords, 5);

        if (articles.length > 0) {
          // Validate news articles
          const validated = articles.filter((article) => {
            const validation = DataValidationService.validateNewsArticle(article);
            if (!validation.valid) {
              logger.warn(`Invalid news article: ${article.title}`);
            }
            return validation.valid;
          });

          sources.push(...newsSources);
          groundingContext += this.formatNewsData(validated);
        }
      }

      // Build enhanced prompt with grounding
      const enhancedPrompt = this.buildEnhancedPrompt(query, groundingContext);

      // Call Gemini API
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        systemInstruction: this.getSystemInstructions(),
      });

      const result = await model.generateContent(enhancedPrompt);
      const response = result.response.text();

      // Calculate accuracy score
      const accuracyScore =
        DataValidationService.calculateAccuracyScore(sources).score;

      const executionTime = Date.now() - startTime;

      logger.info(`Generated response in ${executionTime}ms with accuracy: ${(accuracyScore * 100).toFixed(1)}%`);

      return {
        response,
        sources,
        accuracyScore,
        executionTime,
      };
    } catch (error) {
      logger.error('Error generating grounded response:', error);
      const executionTime = Date.now() - startTime;
      return {
        response: `I encountered an error processing your query: ${error instanceof Error ? error.message : 'Unknown error'}`,
        sources,
        accuracyScore: 0,
        executionTime,
      };
    }
  }

  /**
   * Generate response with web search grounding
   */
  static async generateWithWebSearch(query: string): Promise<{
    response: string;
    searchResults: any[];
    sources: DataSource[];
  }> {
    try {
      // Use Brave Search API for web search grounding
      const searchResults = await this.performWebSearch(query);

      const sources: DataSource[] = searchResults.map((result: any) => ({
        type: 'web-search' as const,
        url: result.url,
        title: result.title,
        fetchedAt: new Date(),
        confidence: 0.85,
      }));

      // Build context from search results
      const searchContext = searchResults
        .slice(0, 5)
        .map((r: any) => `- ${r.title}: ${r.snippet}`)
        .join('\n');

      const enhancedPrompt = `Based on these current web search results:\n\n${searchContext}\n\nAnswer this query: ${query}`;

      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      });

      const result = await model.generateContent(enhancedPrompt);

      return {
        response: result.response.text(),
        searchResults,
        sources,
      };
    } catch (error) {
      logger.error('Error with web search grounding:', error);
      return {
        response: `I couldn't search the web for current information: ${error instanceof Error ? error.message : 'Unknown error'}`,
        searchResults: [],
        sources: [],
      };
    }
  }

  // ===== Private Helper Methods =====

  private static extractSymbols(query: string): string[] {
    const symbolPattern = /\b([A-Z]{1,5})\b/g;
    const matches = query.match(symbolPattern) || [];

    // Filter out common words that aren't stock symbols
    const commonWords = ['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY', 'DID', 'ITS', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE'];
    const filtered = matches.filter((s) => !commonWords.includes(s));
    return [...new Set(filtered)].slice(0, 10); // Limit to 10 unique symbols
  }

  private static extractKeywords(query: string): string[] {
    // Remove common stop words
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'is',
      'was',
      'are',
      'been',
      'be',
    ]);

    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stopWords.has(word))
      .slice(0, 5);

    return words;
  }

  private static formatStockData(stocks: StockPrice[]): string {
    if (stocks.length === 0) return '';

    const table = stocks
      .map(
        (s) =>
          `${s.symbol}: $${s.price.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%)`
      )
      .join('\n');

    return `\n## Real-Time Stock Prices\n${table}\nLast updated: ${new Date().toISOString()}\n`;
  }

  private static formatNewsData(articles: NewsArticle[]): string {
    if (articles.length === 0) return '';

    const newsItems = articles
      .map(
        (a) =>
          `- **${a.title}** (${a.source})\n  ${a.description || a.content?.substring(0, 100)}`
      )
      .join('\n');

    return `\n## Latest Financial News\n${newsItems}\n`;
  }

  private static buildEnhancedPrompt(query: string, groundingContext: string): string {
    return `You are Mars AI, an expert financial and market analyst with access to real-time data.

${groundingContext}

User Query: ${query}

IMPORTANT INSTRUCTIONS:
1. Base your answer ONLY on the real-time data provided above
2. Always cite specific prices, dates, and sources
3. Be precise with numbers and percentages
4. If data is missing or unclear, say so explicitly
5. Provide analysis with clear reasoning
6. Include relevant caveats and disclaimers

Answer the query comprehensively and accurately:`;
  }

  private static getSystemInstructions(): string {
    return `You are Mars AI, a professional financial advisor and market analyst. Your strengths:
- Real-time market analysis with access to current stock prices and news
- Accurate financial calculations and comparisons
- Clear explanations of complex financial concepts
- Data-driven insights backed by credible sources
- Precise citations of your information sources

Always:
1. Prioritize accuracy over speculation
2. Cite your sources and data points
3. Use current real-time data when available
4. Provide specific numbers with appropriate precision
5. Include relevant context and caveats
6. Structure responses clearly with headings and sections`;
  }

  private static async performWebSearch(
    query: string
  ): Promise<any[]> {
    try {
      if (!process.env.BRAVE_SEARCH_API_KEY) {
        logger.warn('BRAVE_SEARCH_API_KEY not configured');
        return [];
      }

      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Brave Search API error: ${response.status}`);
      }

      const data = await response.json();
      return (data.web || []).slice(0, 10);
    } catch (error) {
      logger.error('Web search error:', error);
      return [];
    }
  }
}

export default GeminiService;
