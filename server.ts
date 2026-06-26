import express, { Request, Response } from 'express';
import cors from 'cors';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import GeminiService from './src/services/geminiService.js';
import MarketDataService from './src/services/marketDataService.js';
import DataValidationService from './src/services/dataValidation.js';
import logger from './src/utils/logger.js';
import {
  GenerateResponseRequest,
  GenerateResponseResponse,
  StockPrice,
  NewsArticle,
} from './src/types/index.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ===== Health Check =====
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
  });
});

// ===== Main Chat API - Answer questions with real data =====
app.post('/api/chat', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { query, userId, includeNews, includeStocks, symbols } =
      req.body as GenerateResponseRequest;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    logger.info(`Processing chat query: ${query.substring(0, 100)}`);

    // Generate response with real data grounding
    const result = await GeminiService.generateGroundedResponse(query, {
      includeStocks: includeStocks !== false,
      includeNews: includeNews !== false,
      symbols,
    });

    const response: GenerateResponseResponse = {
      response: result.response,
      sources: result.sources,
      accuracyScore: result.accuracyScore,
      processingTime: Date.now() - startTime,
    };

    logger.info(`Chat response generated in ${response.processingTime}ms`);
    res.json(response);
  } catch (error) {
    logger.error('Error in /api/chat:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Real-Time Stock Prices =====
app.get('/api/stocks/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const { validation } = req.query;

    logger.info(`Fetching stock price for ${symbol}`);

    const { data, source } = await MarketDataService.getStockPrice(
      symbol.toUpperCase()
    );

    if (!data) {
      res.status(404).json({ error: `Stock ${symbol} not found` });
      return;
    }

    // Validate if requested
    if (validation === 'true') {
      const validation_result = DataValidationService.validateStockPrice(data);
      res.json({
        data,
        source,
        validation: validation_result,
      });
      return;
    }

    res.json({ data, source });
  } catch (error) {
    logger.error('Error in /api/stocks:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Multiple Stocks =====
app.post('/api/stocks', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.body as { symbols: string[] };

    if (!symbols || !Array.isArray(symbols)) {
      res.status(400).json({ error: 'Symbols array is required' });
      return;
    }

    logger.info(`Fetching prices for ${symbols.join(', ')}`);

    const { data, sources } = await MarketDataService.getStockPrices(symbols);

    // Validate and cross-check prices
    const { validated, discrepancies } =
      DataValidationService.crossValidatePrices(data);

    res.json({
      data: validated,
      sources,
      discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
    });
  } catch (error) {
    logger.error('Error in /api/stocks POST:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Cryptocurrency Prices =====
app.get('/api/crypto', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.query;

    const cryptoSymbols = (symbols as string)?.split(',') || [
      'BTC',
      'ETH',
      'XRP',
      'ADA',
    ];

    logger.info(`Fetching crypto prices for ${cryptoSymbols.join(', ')}`);

    const { data, sources } =
      await MarketDataService.getCryptoPrices(cryptoSymbols);

    res.json({ data, sources });
  } catch (error) {
    logger.error('Error in /api/crypto:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Financial News =====
app.get('/api/news', async (req: Request, res: Response) => {
  try {
    const { keywords, limit } = req.query;

    const newsKeywords = (keywords as string)?.split(',') || [
      'stock market',
      'finance',
    ];
    const newsLimit = parseInt(limit as string) || 10;

    logger.info(
      `Fetching news for ${newsKeywords.join(', ')} (limit: ${newsLimit})`
    );

    const { data, sources } = await MarketDataService.getFinancialNews(
      newsKeywords,
      newsLimit
    );

    res.json({ data, sources });
  } catch (error) {
    logger.error('Error in /api/news:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Company Data & Analysis =====
app.get('/api/company/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    logger.info(`Fetching company data for ${symbol}`);

    const { data, source } = await MarketDataService.getCompanyData(
      symbol.toUpperCase()
    );

    if (!data) {
      res.status(404).json({ error: `Company ${symbol} not found` });
      return;
    }

    res.json({ data, source });
  } catch (error) {
    logger.error('Error in /api/company:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Data Accuracy Report =====
app.post('/api/validate', async (req: Request, res: Response) => {
  try {
    const { sources } = req.body;

    if (!sources || !Array.isArray(sources)) {
      res.status(400).json({ error: 'Sources array is required' });
      return;
    }

    logger.info(`Validating ${sources.length} sources`);

    // Validate each source
    const validations = sources.map((source) =>
      DataValidationService.validateDataSource(source)
    );

    // Calculate overall accuracy
    const accuracyReport =
      DataValidationService.calculateAccuracyScore(sources);

    // Check source credibility
    const credibilityChecks = sources.map((source) =>
      DataValidationService.checkSourceCredibility(source.url)
    );

    res.json({
      validations,
      accuracyReport,
      credibilityChecks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in /api/validate:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Web Search with Grounding =====
app.post('/api/search', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    logger.info(`Performing web search for: ${query}`);

    const result = await GeminiService.generateWithWebSearch(query);

    res.json(result);
  } catch (error) {
    logger.error('Error in /api/search:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Batch Data Request =====
app.post('/api/batch', async (req: Request, res: Response) => {
  try {
    const { stocks, crypto, news } = req.body;

    logger.info('Processing batch request');

    const results: any = {};

    // Fetch stocks
    if (stocks && Array.isArray(stocks)) {
      const stockResults = await MarketDataService.getStockPrices(stocks);
      results.stocks = stockResults;
    }

    // Fetch crypto
    if (crypto && Array.isArray(crypto)) {
      const cryptoResults =
        await MarketDataService.getCryptoPrices(crypto);
      results.crypto = cryptoResults;
    }

    // Fetch news
    if (news && Array.isArray(news)) {
      const newsResults = await MarketDataService.getFinancialNews(news, 5);
      results.news = newsResults;
    }

    results.timestamp = new Date().toISOString();
    res.json(results);
  } catch (error) {
    logger.error('Error in /api/batch:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

// ===== Error Handling =====
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method,
  });
});

// ===== Start Server =====
app.listen(PORT, () => {
  logger.info(`🚀 Mars AI Server running on port ${PORT}`);
  logger.info(`📊 Real-time market data integration active`);
  logger.info(`🔍 Web search grounding enabled`);
  logger.info(`✅ Data validation running`);
  logger.info(`🤖 Gemini AI model: ${process.env.GEMINI_MODEL}`);
});

export default app;
