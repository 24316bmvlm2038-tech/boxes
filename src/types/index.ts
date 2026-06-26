// API Response Types
export interface StockPrice {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  timestamp: Date;
  source: 'alpha-vantage' | 'finnhub';
  currency?: string;
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  image?: string;
  publishedAt: Date;
  content?: string;
  category?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  timestamp: Date;
}

export interface MarketData {
  stocks: StockPrice[];
  news: NewsArticle[];
  crypto?: CryptoPrice[];
  fetchedAt: Date;
}

export interface CryptoPrice {
  symbol: string;
  price: number;
  change24h: number;
  marketCap?: number;
  timestamp: Date;
}

// Chat & Database Types
export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: DataSource[];
  accuracy_score?: number;
  created_at: Date;
}

export interface DataSource {
  type: 'web-search' | 'stock-api' | 'news-api' | 'financial-api';
  url: string;
  title: string;
  fetchedAt: Date;
  confidence: number; // 0-1
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
  preferences: UserPreferences;
}

export interface UserPreferences {
  theme: 'dark' | 'light';
  watchlist: string[];
  newsSources: string[];
  autoRefresh: boolean;
  refreshInterval: number;
}

export interface AnalyticsEvent {
  id: string;
  userId: string;
  event_type: string;
  data: Record<string, any>;
  created_at: Date;
}

export interface DataAccuracyReport {
  messageId: string;
  accuracy_score: number;
  verified_sources: number;
  total_sources: number;
  verification_timestamp: Date;
  issues?: string[];
}

// API Request/Response Types
export interface GenerateResponseRequest {
  query: string;
  userId: string;
  includeNews: boolean;
  includeStocks: boolean;
  symbols?: string[];
}

export interface GenerateResponseResponse {
  response: string;
  sources: DataSource[];
  marketData?: MarketData;
  accuracyScore: number;
  processingTime: number;
}

export interface StockQueryRequest {
  symbols: string[];
  includeForex?: boolean;
  includeCrypto?: boolean;
}

export interface NewsQueryRequest {
  keywords: string[];
  categories?: string[];
  limit?: number;
}
