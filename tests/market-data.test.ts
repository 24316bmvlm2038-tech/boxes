import { MarketDataService } from '../src/services/marketDataService.js';
import { DataValidationService } from '../src/services/dataValidation.js';

/**
 * Test suite for market data accuracy and integration
 * Run with: npm test
 */

async function testStockPricing() {
  console.log('\n📊 Testing Stock Price Fetching...');
  try {
    const { data, source } = await MarketDataService.getStockPrice('AAPL');

    if (!data) {
      console.error('❌ Failed to fetch AAPL price');
      return false;
    }

    console.log(`✅ AAPL: $${data.price} (${data.changePercent}%)`);

    // Validate
    const validation = DataValidationService.validateStockPrice(data);
    if (!validation.valid) {
      console.error('❌ Validation failed:', validation.issues);
      return false;
    }

    console.log(`✅ Data validation passed`);
    console.log(`📍 Source: ${source.url}`);
    console.log(`📈 Confidence: ${(source.confidence * 100).toFixed(0)}%`);
    return true;
  } catch (error) {
    console.error('❌ Stock price test failed:', error);
    return false;
  }
}

async function testMultipleStocks() {
  console.log('\n📊 Testing Multiple Stock Prices...');
  try {
    const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA'];
    const { data, sources } = await MarketDataService.getStockPrices(symbols);

    console.log(`✅ Fetched ${data.length} stocks`);
    data.forEach((stock) => {
      console.log(`  ${stock.symbol}: $${stock.price.toFixed(2)}`);
    });

    // Cross-validate
    const { validated, discrepancies } =
      DataValidationService.crossValidatePrices(data);

    if (discrepancies.length > 0) {
      console.warn('⚠️  Discrepancies found:');
      discrepancies.forEach((d) => console.warn(`  ${d}`));
    } else {
      console.log('✅ All prices validated successfully');
    }

    return true;
  } catch (error) {
    console.error('❌ Multiple stocks test failed:', error);
    return false;
  }
}

async function testCryptoPrices() {
  console.log('\n💰 Testing Cryptocurrency Prices...');
  try {
    const { data, sources } = await MarketDataService.getCryptoPrices([
      'BTC',
      'ETH',
      'XRP',
    ]);

    if (data.length === 0) {
      console.error('❌ No crypto data fetched');
      return false;
    }

    console.log(`✅ Fetched ${data.length} cryptocurrencies`);
    data.forEach((crypto) => {
      console.log(
        `  ${crypto.symbol}: $${crypto.price.toFixed(2)} (24h: ${crypto.change24h > 0 ? '+' : ''}${crypto.change24h.toFixed(2)}%)`
      );
    });

    return true;
  } catch (error) {
    console.error('❌ Crypto prices test failed:', error);
    return false;
  }
}

async function testFinancialNews() {
  console.log('\n📰 Testing Financial News Fetching...');
  try {
    const { data, sources } = await MarketDataService.getFinancialNews(
      ['stock market', 'technology'],
      5
    );

    if (data.length === 0) {
      console.error('❌ No news articles fetched');
      return false;
    }

    console.log(`✅ Fetched ${data.length} news articles`);
    data.slice(0, 3).forEach((article) => {
      console.log(`  📰 ${article.title}`);
      console.log(`     Source: ${article.source}`);
      const validation = DataValidationService.validateNewsArticle(article);
      console.log(`     Valid: ${validation.valid ? '✅' : '❌'}`);
    });

    return true;
  } catch (error) {
    console.error('❌ Financial news test failed:', error);
    return false;
  }
}

async function testDataValidation() {
  console.log('\n🔍 Testing Data Validation...');
  try {
    // Test source credibility
    const urls = [
      'https://nasdaq.com/market-activity/stocks',
      'https://bloomberg.com/news/finance',
      'https://example-fake-source.com/news',
    ];

    console.log('Source Credibility Check:');
    urls.forEach((url) => {
      const result = DataValidationService.checkSourceCredibility(url);
      console.log(`  ${url}`);
      console.log(`    Rating: ${result.rating} - ${result.reason}`);
    });

    return true;
  } catch (error) {
    console.error('❌ Data validation test failed:', error);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Mars AI Market Data Test Suite');
  console.log('==================================\n');

  const results = {
    stockPricing: await testStockPricing(),
    multipleStocks: await testMultipleStocks(),
    cryptoPrices: await testCryptoPrices(),
    financialNews: await testFinancialNews(),
    dataValidation: await testDataValidation(),
  };

  console.log('\n==================================');
  console.log('📊 Test Results Summary:');
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`  ${passed ? '✅' : '❌'} ${test}`);
  });

  const passedCount = Object.values(results).filter((r) => r).length;
  console.log(`\nPassed: ${passedCount}/${Object.keys(results).length}`);
}

runAllTests().catch(console.error);
